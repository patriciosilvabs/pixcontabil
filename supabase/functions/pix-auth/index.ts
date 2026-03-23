import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

async function callOnzViaProxy(url: string, method: string, headers: Record<string, string>, bodyRaw?: string) {
  const proxyUrl = Deno.env.get('ONZ_PROXY_URL');
  const proxyApiKey = Deno.env.get('ONZ_PROXY_API_KEY');
  if (!proxyUrl || !proxyApiKey) throw new Error('ONZ_PROXY_URL and ONZ_PROXY_API_KEY must be configured');

  const proxyBody: any = { url, method, headers };
  if (bodyRaw !== undefined) proxyBody.body_raw = bodyRaw;

  const resp = await fetch(`${proxyUrl}/proxy`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Proxy-API-Key': proxyApiKey },
    body: JSON.stringify(proxyBody),
  });

  const text = await resp.text();
  let data: any;
  try {
    data = JSON.parse(text);
  } catch {
    console.error(`[callOnzViaProxy] Non-JSON response (status ${resp.status}):`, text.substring(0, 500));
    throw new Error(`Proxy returned non-JSON response (HTTP ${resp.status}). Check if ONZ_PROXY_URL is correct and the proxy is running.`);
  }
  return { proxyStatus: resp.status, status: data.status || resp.status, data: data.data || data };
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

    // Validate user token via direct API call (more reliable in edge runtime)
    const token = authHeader.replace('Bearer ', '');
    console.log('[pix-auth] Validating user token via API...');
    const userResponse = await fetch(`${Deno.env.get('SUPABASE_URL')!}/auth/v1/user`, {
      headers: {
        'Authorization': authHeader,
        'apikey': Deno.env.get('SUPABASE_ANON_KEY')!,
      },
    });
    if (!userResponse.ok) {
      const errBody = await userResponse.text();
      console.error('[pix-auth] Token validation failed:', userResponse.status, errBody);
      return new Response(
        JSON.stringify({ error: 'Invalid token', details: errBody }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }
    const userData = await userResponse.json();
    console.log('[pix-auth] User validated:', userData.id);

    // Use service role client for DB operations (bypasses RLS)
    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );

    // Create user-context client for RLS-protected queries
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!,
      { global: { headers: { Authorization: authHeader } } }
    );

    const { company_id, purpose, force_new } = await req.json();

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
      const { data: specificConfig } = await supabase
        .from('pix_configs').select('*')
        .eq('company_id', company_id).eq('is_active', true).eq('purpose', purpose).single();
      config = specificConfig;
    }
    if (!config) {
      const { data: bothConfig } = await supabase
        .from('pix_configs').select('*')
        .eq('company_id', company_id).eq('is_active', true).eq('purpose', 'both').single();
      config = bothConfig;
    }
    if (!config) {
      const { data: anyConfig } = await supabase
        .from('pix_configs').select('*')
        .eq('company_id', company_id).eq('is_active', true).limit(1).single();
      config = anyConfig;
    }

    if (!config) {
      return new Response(
        JSON.stringify({ error: 'Pix configuration not found for this company' }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log(`[pix-auth] Provider: ${config.provider}`);

    // Check cached token (skip if force_new)
    if (!force_new) {
      let cachedTokenQuery = supabase
        .from('pix_tokens').select('*')
        .eq('company_id', company_id)
        .gt('expires_at', new Date().toISOString())
        .order('created_at', { ascending: false }).limit(1);
      if (config.id) cachedTokenQuery = cachedTokenQuery.eq('pix_config_id', config.id);
      const { data: cachedToken } = await cachedTokenQuery.single();

      if (cachedToken) {
        console.log('[pix-auth] Using cached token');
        return new Response(
          JSON.stringify({
            access_token: cachedToken.access_token,
            token_type: cachedToken.token_type,
            provider: config.provider,
            cached: true,
          }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
    } else {
      console.log('[pix-auth] force_new=true, skipping cache');
    }

    let accessToken: string;
    let expiresInSeconds: number;

    if (config.provider === 'onz') {
      // ========== ONZ AUTH via proxy ==========
      // CRITICAL: ONZ expects x-www-form-urlencoded with snake_case fields
      const authUrl = `${config.base_url}/api/v2/oauth/token`;
      const authBody = `client_id=${encodeURIComponent(config.client_id)}&client_secret=${encodeURIComponent(config.client_secret_encrypted)}&grant_type=client_credentials`;

      console.log(`[pix-auth] ONZ: requesting token from ${authUrl}`);

      const result = await callOnzViaProxy(authUrl, 'POST', {
        'Content-Type': 'application/x-www-form-urlencoded',
      }, authBody);

      console.log(`[pix-auth] ONZ proxy response - proxyStatus: ${result.proxyStatus}, status: ${result.status}, data:`, JSON.stringify(result.data));

      const onzTokenData = result.data ?? {};
      const normalizedAccessToken = onzTokenData.access_token ?? onzTokenData.accessToken;
      const normalizedExpiresAt = onzTokenData.expires_at ?? onzTokenData.expiresAt;
      const normalizedExpiresIn = onzTokenData.expires_in ?? onzTokenData.expiresIn;

      if (result.status >= 400 || !normalizedAccessToken) {
        const errorDetail = JSON.stringify(result.data);
        console.error('[pix-auth] ONZ auth error:', errorDetail);
        return new Response(
          JSON.stringify({ error: 'Falha ao autenticar com ONZ', details: errorDetail }),
          { status: 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      accessToken = normalizedAccessToken;
      if (typeof normalizedExpiresAt === 'number') {
        expiresInSeconds = Math.max(0, normalizedExpiresAt - Math.floor(Date.now() / 1000));
      } else if (typeof normalizedExpiresAt === 'string' && /^\d+$/.test(normalizedExpiresAt)) {
        expiresInSeconds = Math.max(0, parseInt(normalizedExpiresAt, 10) - Math.floor(Date.now() / 1000));
      } else if (typeof normalizedExpiresIn === 'number') {
        expiresInSeconds = normalizedExpiresIn;
      } else if (typeof normalizedExpiresIn === 'string' && /^\d+$/.test(normalizedExpiresIn)) {
        expiresInSeconds = parseInt(normalizedExpiresIn, 10);
      } else {
        expiresInSeconds = 1800;
      }
      console.log('[pix-auth] ONZ token received successfully');
    } else {
      // ========== TRANSFEERA AUTH ==========
      const isSandbox = config.is_sandbox;
      const authUrl = isSandbox
        ? 'https://login-api-sandbox.transfeera.com/authorization'
        : 'https://login-api.transfeera.com/authorization';

      console.log(`[pix-auth] Transfeera: requesting token from ${authUrl} (sandbox: ${isSandbox})`);
      expiresInSeconds = 1800;

      try {
        const tokenResponse = await fetch(authUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'User-Agent': 'PixContabil (contato@pixcontabil.com.br)',
          },
          body: JSON.stringify({
            grant_type: 'client_credentials',
            client_id: config.client_id,
            client_secret: config.client_secret_encrypted,
          }),
        });

        if (!tokenResponse.ok) {
          const errorText = await tokenResponse.text();
          console.error('[pix-auth] Transfeera auth error:', errorText);
          return new Response(
            JSON.stringify({ error: 'Falha ao autenticar com Transfeera', details: errorText }),
            { status: 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }

        const tokenData = await tokenResponse.json();
        console.log('[pix-auth] Transfeera token received successfully');
        accessToken = tokenData.access_token;
      } catch (e) {
        console.error('[pix-auth] Transfeera fetch error:', e);
        return new Response(
          JSON.stringify({ error: 'Falha na conexão com Transfeera', details: e.message }),
          { status: 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
    }

    // Cache token (with 60s margin)
    const expiresAt = new Date(Date.now() + (expiresInSeconds - 60) * 1000);

    // Reuse supabaseAdmin from above for caching

    if (config.id) {
      await supabaseAdmin.from('pix_tokens').delete().eq('pix_config_id', config.id);
    } else {
      await supabaseAdmin.from('pix_tokens').delete().eq('company_id', company_id);
    }

    await supabaseAdmin.from('pix_tokens').insert({
      company_id,
      pix_config_id: config.id,
      access_token: accessToken!,
      token_type: 'Bearer',
      expires_at: expiresAt.toISOString(),
    });

    return new Response(
      JSON.stringify({
        access_token: accessToken!,
        token_type: 'Bearer',
        expires_at: expiresAt.toISOString(),
        provider: config.provider,
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
