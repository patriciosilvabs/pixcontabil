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

// EFI Token Response
interface EFITokenResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
  scope: string;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    // Authenticate user
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

    // Get request body
    const { company_id } = await req.json();

    if (!company_id) {
      return new Response(
        JSON.stringify({ error: 'company_id is required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log(`[pix-auth] Getting token for company: ${company_id}`);

    // Check for valid cached token
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
          cached: true
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Get Pix config for this company
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

    // Validate mTLS certificates
    if (!pixConfig.certificate_encrypted) {
      console.error('[pix-auth] mTLS certificate missing');
      return new Response(
        JSON.stringify({ error: 'Certificado mTLS é obrigatório para a EFI Pay. Configure o certificado PEM em Base64 nas configurações.' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Decode certificate from Base64 to PEM
    let certPem: string;
    let keyPem: string;
    try {
      certPem = atob(pixConfig.certificate_encrypted);
      // EFI can use combined PEM (cert+key in one file) or separate files
      keyPem = pixConfig.certificate_key_encrypted 
        ? atob(pixConfig.certificate_key_encrypted) 
        : certPem; // If no separate key, assume combined PEM
    } catch (e) {
      console.error('[pix-auth] Failed to decode certificate:', e);
      return new Response(
        JSON.stringify({ error: 'Certificado mTLS inválido. Verifique se está corretamente codificado em Base64.' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Create HTTP client with mTLS
    const httpClient = Deno.createHttpClient({
      cert: certPem,
      key: keyPem,
    });

    // Request new token from EFI API using Basic Auth
    console.log(`[pix-auth] Requesting new token from EFI Pay (Basic Auth + mTLS)`);

    const tokenUrl = `${pixConfig.base_url}/oauth/token`;
    
    // EFI uses Basic Auth: base64(client_id:client_secret)
    const basicAuth = btoa(`${pixConfig.client_id}:${pixConfig.client_secret_encrypted}`);

    let tokenResponse: Response;
    try {
      tokenResponse = await fetch(tokenUrl, {
        method: 'POST',
        headers: {
          'Authorization': `Basic ${basicAuth}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          grant_type: 'client_credentials',
        }),
        // @ts-ignore - Deno specific option
        client: httpClient,
      });
    } catch (fetchError) {
      httpClient.close();
      console.error('[pix-auth] mTLS fetch failed:', fetchError);
      return new Response(
        JSON.stringify({ error: 'Falha na conexão mTLS com a EFI Pay. Verifique o certificado.', details: fetchError.message }),
        { status: 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (!tokenResponse.ok) {
      const errorText = await tokenResponse.text();
      httpClient.close();
      console.error('[pix-auth] EFI token request failed:', errorText);
      return new Response(
        JSON.stringify({ 
          error: 'Falha ao autenticar com a EFI Pay',
          details: errorText,
          hint: 'Verifique Client ID, Client Secret e certificado mTLS no painel EFI Pay.'
        }),
        { status: 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    httpClient.close();

    const tokenData: EFITokenResponse = await tokenResponse.json();
    console.log('[pix-auth] Token received, expires_in:', tokenData.expires_in);

    // EFI returns expires_in in seconds. Calculate expiration with safety margin.
    const expiresAt = new Date(Date.now() + (tokenData.expires_in - 60) * 1000);

    // Store token in database using service role for insert
    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );

    // Delete old tokens for this company
    await supabaseAdmin
      .from('pix_tokens')
      .delete()
      .eq('company_id', company_id);

    // Insert new token
    const { error: insertError } = await supabaseAdmin
      .from('pix_tokens')
      .insert({
        company_id,
        access_token: tokenData.access_token,
        token_type: tokenData.token_type || 'Bearer',
        expires_at: expiresAt.toISOString()
      });

    if (insertError) {
      console.error('[pix-auth] Failed to cache token:', insertError);
    }

    return new Response(
      JSON.stringify({
        access_token: tokenData.access_token,
        token_type: tokenData.token_type || 'Bearer',
        expires_at: expiresAt.toISOString(),
        scope: tokenData.scope,
        cached: false
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
