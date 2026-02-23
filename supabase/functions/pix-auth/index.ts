import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

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

    const { company_id, purpose } = await req.json();

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
        .from('pix_configs')
        .select('*')
        .eq('company_id', company_id)
        .eq('is_active', true)
        .eq('purpose', purpose)
        .single();
      config = specificConfig;
    }
    if (!config) {
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
      return new Response(
        JSON.stringify({ error: 'Pix configuration not found for this company' }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log(`[pix-auth] Provider: onz`);

    // Check cached token
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
      console.log('[pix-auth] Using cached token');
      return new Response(
        JSON.stringify({
          access_token: cachedToken.access_token,
          token_type: cachedToken.token_type,
          provider: 'onz',
          cached: true,
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // ========== ONZ Infopago (via proxy mTLS) ==========
    const proxyUrl = Deno.env.get('ONZ_PROXY_URL');
    const proxyApiKey = Deno.env.get('ONZ_PROXY_API_KEY');
    if (!proxyUrl || !proxyApiKey) {
      return new Response(
        JSON.stringify({ error: 'ONZ_PROXY_URL ou ONZ_PROXY_API_KEY não configurado.' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const baseUrl = config.base_url.replace(/\/+$/, '');
    const tokenUrl = `${baseUrl}/oauth/token`;
    console.log(`[pix-auth] ONZ: requesting token via proxy -> ${tokenUrl}`);

    const formBody = new URLSearchParams({
      client_id: config.client_id,
      client_secret: config.client_secret_encrypted,
      grant_type: 'client_credentials',
    }).toString();

    let accessToken: string;
    let expiresInSeconds = 3600;

    try {
      const proxyResponse = await fetch(`${proxyUrl}/proxy`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Proxy-API-Key': proxyApiKey },
        body: JSON.stringify({
          url: tokenUrl,
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body_raw: formBody,
        }),
      });

      if (!proxyResponse.ok) {
        const errorText = await proxyResponse.text();
        console.error('[pix-auth] ONZ proxy error:', errorText);
        return new Response(
          JSON.stringify({ error: 'Falha ao autenticar com ONZ', details: errorText }),
          { status: 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      const proxyData = await proxyResponse.json();
      const tokenData = proxyData.data || proxyData;
      console.log('[pix-auth] ONZ token received successfully');

      accessToken = tokenData.accessToken || tokenData.access_token;
      if (tokenData.expiresAt) {
        expiresInSeconds = Math.floor((tokenData.expiresAt * 1000 - Date.now()) / 1000);
      } else if (tokenData.expires_in) {
        expiresInSeconds = tokenData.expires_in;
      }
    } catch (e) {
      console.error('[pix-auth] ONZ fetch error:', e);
      return new Response(
        JSON.stringify({ error: 'Falha na conexão com ONZ', details: e.message }),
        { status: 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Cache token
    const expiresAt = new Date(Date.now() + (expiresInSeconds - 60) * 1000);

    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );

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
        provider: 'onz',
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
