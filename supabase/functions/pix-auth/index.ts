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

// ONZ Token Response
interface ONZTokenResponse {
  tokenType: string;
  expiresAt: number;
  refreshExpiresIn: number;
  notBeforePolicy: number;
  accessToken: string;
  scope: string;
}

Deno.serve(async (req) => {
  // Handle CORS preflight
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
    if (!pixConfig.certificate_encrypted || !pixConfig.certificate_key_encrypted) {
      console.error('[pix-auth] mTLS certificates missing');
      return new Response(
        JSON.stringify({ error: 'Certificados mTLS são obrigatórios para o provedor ONZ. Configure o certificado (.crt) e a chave (.key) em Base64 nas configurações.' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Decode certificates from Base64 to PEM
    let certPem: string;
    let keyPem: string;
    try {
      certPem = atob(pixConfig.certificate_encrypted);
      keyPem = atob(pixConfig.certificate_key_encrypted);
    } catch (e) {
      console.error('[pix-auth] Failed to decode certificates:', e);
      return new Response(
        JSON.stringify({ error: 'Certificados mTLS inválidos. Verifique se estão corretamente codificados em Base64.' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Create HTTP client with mTLS
    const httpClient = Deno.createHttpClient({
      cert: certPem,
      key: keyPem,
    });

    // Request new token from ONZ API
    console.log(`[pix-auth] Requesting new token from ONZ provider (with mTLS)`);

    const tokenUrl = `${pixConfig.base_url}/oauth/token`;
    
    // ONZ uses JSON body for authentication
    const tokenPayload = {
      clientId: pixConfig.client_id,
      clientSecret: pixConfig.client_secret_encrypted,
      grantType: "client_credentials",
      scope: "pix.read pix.write transactions.read account.read webhook.read webhook.write"
    };

    let tokenResponse: Response;
    try {
      tokenResponse = await fetch(tokenUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(tokenPayload),
        // @ts-ignore - Deno specific option
        client: httpClient,
      });
    } catch (fetchError) {
      httpClient.close();
      console.error('[pix-auth] mTLS fetch failed:', fetchError);
      return new Response(
        JSON.stringify({ error: 'Falha na conexão mTLS com o provedor. Verifique os certificados.', details: fetchError.message }),
        { status: 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (!tokenResponse.ok) {
      const errorText = await tokenResponse.text();
      httpClient.close();
      console.error('[pix-auth] Token request failed:', errorText);
      return new Response(
        JSON.stringify({ 
          error: 'Failed to authenticate with Pix provider',
          details: errorText 
        }),
        { status: 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    httpClient.close();

    const tokenData: ONZTokenResponse = await tokenResponse.json();
    console.log('[pix-auth] Token received, expiresAt:', tokenData.expiresAt);

    // ONZ returns expiresAt as Unix timestamp (seconds)
    // Calculate expiration time (subtract 60 seconds for safety margin)
    const expiresAt = new Date(tokenData.expiresAt * 1000 - 60000);

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
        access_token: tokenData.accessToken,
        token_type: tokenData.tokenType || 'bearer',
        expires_at: expiresAt.toISOString()
      });

    if (insertError) {
      console.error('[pix-auth] Failed to cache token:', insertError);
      // Continue anyway, token is still valid
    }

    return new Response(
      JSON.stringify({
        access_token: tokenData.accessToken,
        token_type: tokenData.tokenType || 'bearer',
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
