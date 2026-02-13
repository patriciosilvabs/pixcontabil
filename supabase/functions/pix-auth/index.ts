import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface PixConfig {
  id: string;
  company_id: string;
  provider: string;
  client_id: string;
  client_secret_encrypted: string;
  base_url: string;
  is_sandbox: boolean;
  certificate_encrypted?: string;
  certificate_key_encrypted?: string;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      return new Response(
        JSON.stringify({ error: 'Unauthorized' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!,
      { global: { headers: { Authorization: authHeader } } }
    );

    const token = authHeader.replace('Bearer ', '');
    const { data: claims, error: authError } = await supabase.auth.getClaims(token);
    
    if (authError || !claims?.claims) {
      return new Response(
        JSON.stringify({ error: 'Invalid token' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const { company_id } = await req.json();

    if (!company_id) {
      return new Response(
        JSON.stringify({ error: 'company_id is required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log(`[pix-auth] Getting token for company: ${company_id}`);

    // Get Pix config
    const { data: config, error: configError } = await supabase
      .from('pix_configs')
      .select('*')
      .eq('company_id', company_id)
      .eq('is_active', true)
      .single();

    if (configError || !config) {
      console.error('[pix-auth] Config not found:', configError);
      return new Response(
        JSON.stringify({ error: 'Pix configuration not found for this company' }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const pixConfig = config as PixConfig;
    const provider = pixConfig.provider;

    console.log(`[pix-auth] Provider: ${provider}`);

    // ========== WOOVI (OpenPix) ==========
    // No OAuth needed - uses AppID directly
    if (provider === 'woovi') {
      console.log('[pix-auth] Woovi: returning AppID as access_token');
      return new Response(
        JSON.stringify({
          access_token: pixConfig.client_id, // AppID
          token_type: 'AppID',
          provider: 'woovi',
          cached: true,
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // For OAuth-based providers, check cached token first
    const { data: cachedToken } = await supabase
      .from('pix_tokens')
      .select('*')
      .eq('company_id', company_id)
      .gt('expires_at', new Date().toISOString())
      .order('created_at', { ascending: false })
      .limit(1)
      .single();

    if (cachedToken) {
      console.log('[pix-auth] Using cached token');
      return new Response(
        JSON.stringify({
          access_token: cachedToken.access_token,
          token_type: cachedToken.token_type,
          provider,
          cached: true,
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    let accessToken: string;
    let tokenType = 'Bearer';
    let expiresInSeconds = 3600;

    // ========== ONZ Infopago (via proxy) ==========
    if (provider === 'onz') {
      console.log('[pix-auth] ONZ: requesting token via proxy');
      const baseUrl = pixConfig.base_url.replace(/\/+$/, '');
      const tokenUrl = `${baseUrl}/oauth/token`;
      console.log(`[pix-auth] ONZ token URL: ${tokenUrl}`);

      const proxyUrl = Deno.env.get('ONZ_PROXY_URL');
      const proxyApiKey = Deno.env.get('ONZ_PROXY_API_KEY');

      if (!proxyUrl || !proxyApiKey) {
        return new Response(
          JSON.stringify({ error: 'ONZ proxy not configured. Set ONZ_PROXY_URL and ONZ_PROXY_API_KEY secrets.' }),
          { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      const requestBody = {
        clientId: pixConfig.client_id,
        clientSecret: pixConfig.client_secret_encrypted,
        grantType: 'client_credentials',
      };

      try {
        const proxyResponse = await fetch(`https://${proxyUrl.replace(/^https?:\/\//, '')}/proxy`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-proxy-api-key': proxyApiKey,
          },
          body: JSON.stringify({
            url: tokenUrl,
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: requestBody,
          }),
        });

        if (!proxyResponse.ok) {
          const errorText = await proxyResponse.text();
          console.error('[pix-auth] ONZ proxy error:', errorText);
          return new Response(
            JSON.stringify({ error: 'Falha ao autenticar com ONZ via proxy', details: errorText }),
            { status: 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }

        const proxyResult = await proxyResponse.json();
        const tokenData = proxyResult.data;
        console.log('[pix-auth] ONZ proxy response status:', proxyResult.status);

        if (proxyResult.status !== 200) {
          return new Response(
            JSON.stringify({ error: 'ONZ auth failed', details: tokenData }),
            { status: 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }

        accessToken = tokenData.accessToken || tokenData.access_token;
        if (tokenData.expiresAt) {
          expiresInSeconds = Math.floor((tokenData.expiresAt * 1000 - Date.now()) / 1000);
        } else if (tokenData.expires_in) {
          expiresInSeconds = tokenData.expires_in;
        }
      } catch (e) {
        console.error('[pix-auth] ONZ proxy fetch error:', e);
        return new Response(
          JSON.stringify({ error: 'Falha na conexão com proxy ONZ', details: e.message }),
          { status: 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
    }
    // ========== TRANSFEERA ==========
    else if (provider === 'transfeera') {
      console.log('[pix-auth] Transfeera: requesting token via OAuth2 client_credentials');
      const authUrl = pixConfig.is_sandbox
        ? 'https://login-api-sandbox.transfeera.com/authorization'
        : 'https://login-api.transfeera.com/authorization';

      const tokenResponse = await fetch(authUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          grant_type: 'client_credentials',
          client_id: pixConfig.client_id,
          client_secret: pixConfig.client_secret_encrypted,
        }),
      });

      if (!tokenResponse.ok) {
        const errorText = await tokenResponse.text();
        console.error('[pix-auth] Transfeera token request failed:', errorText);
        return new Response(
          JSON.stringify({ error: 'Falha ao autenticar com Transfeera', details: errorText }),
          { status: 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      const tokenData = await tokenResponse.json();
      accessToken = tokenData.access_token;
      expiresInSeconds = tokenData.expires_in || 3600;
    }
    // ========== EFI Pay ==========
    else if (provider === 'efi') {
      // Validate mTLS certificates
      if (!pixConfig.certificate_encrypted) {
        return new Response(
          JSON.stringify({ error: 'Certificado mTLS é obrigatório para a EFI Pay. Configure o certificado PEM em Base64 nas configurações.' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      let certPem: string;
      let keyPem: string;
      try {
        certPem = atob(pixConfig.certificate_encrypted);
        keyPem = pixConfig.certificate_key_encrypted
          ? atob(pixConfig.certificate_key_encrypted)
          : certPem;
      } catch (e) {
        return new Response(
          JSON.stringify({ error: 'Certificado mTLS inválido. Verifique se está corretamente codificado em Base64.' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      const httpClient = Deno.createHttpClient({ cert: certPem, key: keyPem });
      const tokenUrl = `${pixConfig.base_url}/oauth/token`;
      const basicAuth = btoa(`${pixConfig.client_id}:${pixConfig.client_secret_encrypted}`);

      let tokenResponse: Response;
      try {
        tokenResponse = await fetch(tokenUrl, {
          method: 'POST',
          headers: {
            'Authorization': `Basic ${basicAuth}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ grant_type: 'client_credentials' }),
          // @ts-ignore - Deno specific
          client: httpClient,
        });
      } catch (fetchError) {
        httpClient.close();
        return new Response(
          JSON.stringify({ error: 'Falha na conexão mTLS com a EFI Pay.', details: fetchError.message }),
          { status: 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      if (!tokenResponse.ok) {
        const errorText = await tokenResponse.text();
        httpClient.close();
        return new Response(
          JSON.stringify({ error: 'Falha ao autenticar com a EFI Pay', details: errorText }),
          { status: 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      httpClient.close();
      const tokenData = await tokenResponse.json();
      accessToken = tokenData.access_token;
      expiresInSeconds = tokenData.expires_in || 3600;
    }
    // ========== UNKNOWN PROVIDER ==========
    else {
      return new Response(
        JSON.stringify({ error: `Provider '${provider}' não suportado para autenticação automática` }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Cache token
    const expiresAt = new Date(Date.now() + (expiresInSeconds - 60) * 1000);

    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );

    await supabaseAdmin.from('pix_tokens').delete().eq('company_id', company_id);

    await supabaseAdmin.from('pix_tokens').insert({
      company_id,
      access_token: accessToken!,
      token_type: tokenType,
      expires_at: expiresAt.toISOString(),
    });

    return new Response(
      JSON.stringify({
        access_token: accessToken!,
        token_type: tokenType,
        expires_at: expiresAt.toISOString(),
        provider,
        cached: false,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('[pix-auth] Error:', error);
    return new Response(
      JSON.stringify({ error: 'Internal server error', details: error.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
