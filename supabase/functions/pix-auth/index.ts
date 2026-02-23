import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

function normalizePem(pem: string): string {
  const lines = pem.split('\n').map(l => l.trim()).filter(l => l.length > 0);
  const result: string[] = [];
  for (const line of lines) {
    if (line.startsWith('-----')) { result.push(line); }
    else { for (let i = 0; i < line.length; i += 64) result.push(line.substring(i, i + 64)); }
  }
  return result.join('\n') + '\n';
}

function decodeCert(raw: string): string {
  const trimmed = raw.trim();
  if (trimmed.startsWith('-----')) return normalizePem(trimmed);
  const cleanB64 = trimmed.replace(/[\s\r\n]/g, '');
  return normalizePem(atob(cleanB64));
}

function parseCaCerts(raw: string): string[] {
  let content = raw.trim();
  if (!content.startsWith('-----')) {
    try { content = atob(content.replace(/[\s\r\n]/g, '')); } catch { /* use as-is */ }
  }
  const parts = content.split(/-----END CERTIFICATE-----/);
  const certs: string[] = [];
  for (const part of parts) {
    const beginIdx = part.indexOf('-----BEGIN CERTIFICATE-----');
    if (beginIdx === -1) continue;
    const certContent = part.substring(beginIdx + '-----BEGIN CERTIFICATE-----'.length);
    const cleanB64 = certContent.replace(/[^A-Za-z0-9+/=]/g, '');
    if (!cleanB64) continue;
    const lines: string[] = ['-----BEGIN CERTIFICATE-----'];
    for (let i = 0; i < cleanB64.length; i += 64) lines.push(cleanB64.substring(i, i + 64));
    lines.push('-----END CERTIFICATE-----');
    certs.push(lines.join('\n') + '\n');
  }
  return certs;
}

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
  provider_company_id?: string;
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
    const { data: userData, error: authError } = await supabase.auth.getUser(token);
    
    if (authError || !userData?.user) {
      return new Response(
        JSON.stringify({ error: 'Invalid token' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const { company_id, purpose, scopes: requestedScopes } = await req.json();

    if (!company_id) {
      return new Response(
        JSON.stringify({ error: 'company_id is required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log(`[pix-auth] Getting token for company: ${company_id}, purpose: ${purpose || 'any'}`);

    // Get Pix config with purpose-aware lookup
    let config: any = null;
    if (purpose) {
      // Try specific purpose first
      const { data: specificConfig } = await supabase
        .from('pix_configs')
        .select('*')
        .eq('company_id', company_id)
        .eq('is_active', true)
        .eq('purpose', purpose)
        .single();
      config = specificConfig;
    }
    if (!config) {
      // Fallback to 'both'
      const { data: bothConfig } = await supabase
        .from('pix_configs')
        .select('*')
        .eq('company_id', company_id)
        .eq('is_active', true)
        .eq('purpose', 'both')
        .single();
      config = bothConfig;
    }
    if (!config) {
      // Final fallback: any active config
      const { data: anyConfig } = await supabase
        .from('pix_configs')
        .select('*')
        .eq('company_id', company_id)
        .eq('is_active', true)
        .limit(1)
        .single();
      config = anyConfig;
    }

    if (!config) {
      console.error('[pix-auth] Config not found for company:', company_id);
      return new Response(
        JSON.stringify({ error: 'Pix configuration not found for this company' }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const pixConfig = config as PixConfig;
    const provider = pixConfig.provider;

    console.log(`[pix-auth] Provider: ${provider}`);

    // ========== WOOVI (OpenPix) ==========
    if (provider === 'woovi') {
      console.log('[pix-auth] Woovi: returning AppID as access_token');
      return new Response(
        JSON.stringify({
          access_token: pixConfig.client_id,
          token_type: 'AppID',
          provider: 'woovi',
          cached: true,
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // ========== PAGGUE ==========
    if (provider === 'paggue') {
    // Check cached token first (by pix_config_id if available)
      let cachedTokenQuery = supabase
        .from('pix_tokens')
        .select('*')
        .eq('company_id', company_id)
        .gt('expires_at', new Date().toISOString())
        .order('created_at', { ascending: false })
        .limit(1);
      if (config.id) {
        cachedTokenQuery = cachedTokenQuery.eq('pix_config_id', config.id);
      }
      const { data: cachedToken } = await cachedTokenQuery.single();

      if (cachedToken) {
        console.log('[pix-auth] Paggue: using cached token');
        return new Response(
          JSON.stringify({
            access_token: cachedToken.access_token,
            token_type: cachedToken.token_type,
            provider: 'paggue',
            provider_company_id: pixConfig.provider_company_id,
            cached: true,
          }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      console.log('[pix-auth] Paggue: requesting new token');
      const tokenResponse = await fetch('https://ms.paggue.io/auth/v1/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          client_key: pixConfig.client_id,
          client_secret: pixConfig.client_secret_encrypted,
        }),
      });

      if (!tokenResponse.ok) {
        const errorText = await tokenResponse.text();
        console.error('[pix-auth] Paggue token request failed:', errorText);
        return new Response(
          JSON.stringify({ error: 'Falha ao autenticar com a Paggue', details: errorText }),
          { status: 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      const tokenData = await tokenResponse.json();
      const accessToken = tokenData.access_token;
      
      // Extract company_id from response if not configured
      let paggueCompanyId = pixConfig.provider_company_id;
      if (!paggueCompanyId && tokenData.user?.companies?.[0]?.id) {
        paggueCompanyId = String(tokenData.user.companies[0].id);
        // Save it for future use
        const supabaseAdmin = createClient(
          Deno.env.get('SUPABASE_URL')!,
          Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
        );
        await supabaseAdmin.from('pix_configs').update({ provider_company_id: paggueCompanyId }).eq('id', pixConfig.id);
      }

      // Token valid for 2 months, cache with 1 month margin
      const expiresAt = tokenData.expires_at 
        ? new Date(tokenData.expires_at)
        : new Date(Date.now() + 30 * 24 * 60 * 60 * 1000); // 30 days default

      const supabaseAdmin = createClient(
        Deno.env.get('SUPABASE_URL')!,
        Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
      );

      // Delete old tokens for this specific config
      if (config.id) {
        await supabaseAdmin.from('pix_tokens').delete().eq('pix_config_id', config.id);
      } else {
        await supabaseAdmin.from('pix_tokens').delete().eq('company_id', company_id);
      }
      await supabaseAdmin.from('pix_tokens').insert({
        company_id,
        pix_config_id: config.id,
        access_token: accessToken,
        token_type: 'Bearer',
        expires_at: expiresAt.toISOString(),
      });

      return new Response(
        JSON.stringify({
          access_token: accessToken,
          token_type: 'Bearer',
          provider: 'paggue',
          provider_company_id: paggueCompanyId,
          cached: false,
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // For other OAuth-based providers, check cached token first (by pix_config_id)
    // Skip cache when specific scopes are requested (different operations need different tokens)
    if (!requestedScopes) {
      let otherCachedQuery = supabase
        .from('pix_tokens')
        .select('*')
        .eq('company_id', company_id)
        .gt('expires_at', new Date().toISOString())
        .order('created_at', { ascending: false })
        .limit(1);
      if (config.id) {
        otherCachedQuery = otherCachedQuery.eq('pix_config_id', config.id);
      }
      const { data: cachedToken } = await otherCachedQuery.single();

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
    } else {
      console.log(`[pix-auth] Skipping cache - specific scopes requested: ${requestedScopes}`);
    }

    let accessToken: string;
    let tokenType = 'Bearer';
    let expiresInSeconds = 3600;

    // ========== ONZ Infopago (via proxy mTLS) ==========
    if (provider === 'onz') {
      const proxyUrl = Deno.env.get('ONZ_PROXY_URL');
      const proxyApiKey = Deno.env.get('ONZ_PROXY_API_KEY');

      if (!proxyUrl || !proxyApiKey) {
        return new Response(
          JSON.stringify({ error: 'Proxy mTLS não configurado para ONZ.' }),
          { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      const baseUrl = pixConfig.base_url.replace(/\/+$/, '');
      const tokenUrl = `${baseUrl}/oauth/token`;
      console.log(`[pix-auth] ONZ: requesting token via proxy -> ${tokenUrl}`);

      const requestBody = {
        clientId: pixConfig.client_id,
        clientSecret: pixConfig.client_secret_encrypted,
        grantType: 'client_credentials',
      };

      try {
        const proxyResponse = await fetch(`${proxyUrl}/proxy`, {
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

        const proxyData = await proxyResponse.json();
        console.log('[pix-auth] ONZ proxy response status:', proxyData.status);

        if (proxyData.status && proxyData.status >= 400) {
          console.error('[pix-auth] ONZ auth error:', JSON.stringify(proxyData.data));
          return new Response(
            JSON.stringify({ error: 'Falha ao autenticar com ONZ', details: JSON.stringify(proxyData.data) }),
            { status: 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }

        const tokenData = proxyData.data || proxyData;
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
      if (!pixConfig.certificate_encrypted) {
        return new Response(
          JSON.stringify({ error: 'Certificado mTLS é obrigatório para a EFI Pay.' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      let certPem: string;
      let keyPem: string;
      try {
        certPem = decodeCert(pixConfig.certificate_encrypted);
        keyPem = pixConfig.certificate_key_encrypted
          ? decodeCert(pixConfig.certificate_key_encrypted)
          : certPem;
      } catch (e) {
        return new Response(
          JSON.stringify({ error: 'Certificado mTLS inválido.' }),
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
    // ========== BANCO INTER ==========
    else if (provider === 'inter') {
      if (!pixConfig.certificate_encrypted) {
        return new Response(
          JSON.stringify({ error: 'Certificado mTLS é obrigatório para o Banco Inter.' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      let certPem: string;
      let keyPem: string;
      try {
        certPem = decodeCert(pixConfig.certificate_encrypted);
        keyPem = pixConfig.certificate_key_encrypted
          ? decodeCert(pixConfig.certificate_key_encrypted)
          : certPem;
      } catch (e) {
        return new Response(
          JSON.stringify({ error: 'Certificado mTLS inválido.' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      const httpClient = Deno.createHttpClient({ cert: certPem, key: keyPem });
      const tokenUrl = `${pixConfig.base_url}/oauth/v2/token`;
      const defaultScopes = 'cob.write cob.read cobv.write cobv.read pix.write pix.read pagamento-pix.write pagamento-pix.read pagamento-boleto.write pagamento-boleto.read extrato.read';
      const scopes = requestedScopes || defaultScopes;

      const bodyParams = new URLSearchParams({
        client_id: pixConfig.client_id,
        client_secret: pixConfig.client_secret_encrypted,
        grant_type: 'client_credentials',
        scope: scopes,
      });

      let tokenResponse: Response;
      try {
        tokenResponse = await fetch(tokenUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: bodyParams.toString(),
          // @ts-ignore - Deno specific
          client: httpClient,
        });
      } catch (fetchError) {
        httpClient.close();
        return new Response(
          JSON.stringify({ error: 'Falha na conexão mTLS com o Banco Inter.', details: fetchError.message }),
          { status: 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      if (!tokenResponse.ok) {
        const errorText = await tokenResponse.text();
        httpClient.close();
        console.error('[pix-auth] Inter token request failed:', errorText);
        return new Response(
          JSON.stringify({ error: 'Falha ao autenticar com o Banco Inter', details: errorText }),
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

    // Delete old tokens for this specific config
    if (config.id) {
      await supabaseAdmin.from('pix_tokens').delete().eq('pix_config_id', config.id);
    } else {
      await supabaseAdmin.from('pix_tokens').delete().eq('company_id', company_id);
    }

    await supabaseAdmin.from('pix_tokens').insert({
      company_id,
      pix_config_id: config.id,
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
