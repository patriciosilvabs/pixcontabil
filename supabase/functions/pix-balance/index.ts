import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
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

    const { company_id } = await req.json();

    if (!company_id) {
      return new Response(
        JSON.stringify({ error: 'company_id is required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log(`[pix-balance] Fetching balance for company: ${company_id}`);

    const { data: config, error: configError } = await supabase
      .from('pix_configs')
      .select('*')
      .eq('company_id', company_id)
      .eq('is_active', true)
      .single();

    if (configError || !config) {
      console.log('[pix-balance] No active pix config found');
      return new Response(
        JSON.stringify({ success: true, balance: null, available: false, provider: null, message: 'Nenhuma configuração Pix ativa encontrada' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const provider = config.provider;
    console.log(`[pix-balance] Provider: ${provider}`);

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const authResponse = await fetch(`${supabaseUrl}/functions/v1/pix-auth`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': authHeader,
      },
      body: JSON.stringify({ company_id }),
    });

    if (!authResponse.ok) {
      const authError = await authResponse.text();
      console.error('[pix-balance] Auth failed:', authError);
      return new Response(
        JSON.stringify({ error: 'Falha ao autenticar com o provedor', details: authError }),
        { status: 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const authData = await authResponse.json();
    const accessToken = authData.access_token;

    let balance: number | null = null;

    // ========== TRANSFEERA ==========
    if (provider === 'transfeera') {
      const balanceUrl = `${config.base_url}/statement/balance`;
      console.log(`[pix-balance] Transfeera: GET ${balanceUrl}`);
      const res = await fetch(balanceUrl, {
        headers: { 'Authorization': `Bearer ${accessToken}` },
      });
      if (!res.ok) {
        const errText = await res.text();
        console.error('[pix-balance] Transfeera balance error:', errText);
        return new Response(
          JSON.stringify({ error: 'Falha ao consultar saldo na Transfeera', details: errText }),
          { status: 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
      const data = await res.json();
      console.log('[pix-balance] Transfeera balance response:', JSON.stringify(data));
      balance = parseFloat(data?.value ?? data?.balance ?? data?.available ?? data?.amount ?? '0');
    }

    // ========== WOOVI (OpenPix) ==========
    else if (provider === 'woovi') {
      const balanceUrl = `${config.base_url}/api/v1/account/`;
      console.log(`[pix-balance] Woovi: GET ${balanceUrl}`);
      const res = await fetch(balanceUrl, {
        headers: { 'Authorization': accessToken },
      });
      if (!res.ok) {
        const errText = await res.text();
        console.error('[pix-balance] Woovi balance error:', errText);
        return new Response(
          JSON.stringify({ error: 'Falha ao consultar saldo na Woovi', details: errText }),
          { status: 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
      const data = await res.json();
      console.log('[pix-balance] Woovi balance response:', JSON.stringify(data));
      const defaultAccount = data?.accounts?.find((a: any) => a.isDefault) ?? data?.accounts?.[0];
      balance = (defaultAccount?.balance?.available ?? defaultAccount?.balance?.total ?? 0) / 100;
    }

    // ========== ONZ Infopago (via proxy) ==========
    else if (provider === 'onz') {
      const balanceUrl = `${config.base_url}/accounts/balances/`;
      console.log(`[pix-balance] ONZ: GET ${balanceUrl} (via proxy)`);

      const proxyUrl = Deno.env.get('ONZ_PROXY_URL');
      const proxyApiKey = Deno.env.get('ONZ_PROXY_API_KEY');

      if (!proxyUrl || !proxyApiKey) {
        return new Response(
          JSON.stringify({ error: 'ONZ proxy not configured' }),
          { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      const proxyResponse = await fetch(`https://${proxyUrl.replace(/^https?:\/\//, '').replace(/\/+$/, '')}/proxy`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-proxy-api-key': proxyApiKey },
        body: JSON.stringify({
          url: balanceUrl,
          method: 'GET',
          headers: { 'Authorization': `Bearer ${accessToken}` },
        }),
      });

      if (!proxyResponse.ok) {
        const errText = await proxyResponse.text();
        console.error('[pix-balance] ONZ proxy error:', errText);
        return new Response(
          JSON.stringify({ error: 'Falha ao consultar saldo na ONZ', details: errText }),
          { status: 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      const proxyResult = await proxyResponse.json();
      if (proxyResult.status !== 200) {
        return new Response(
          JSON.stringify({ error: 'ONZ balance failed', details: proxyResult.data }),
          { status: 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      const data = proxyResult.data;
      balance = parseFloat(data?.available ?? data?.balance ?? data?.saldo ?? '0');
    }

    // ========== EFI Pay ==========
    else if (provider === 'efi') {
      if (!config.certificate_encrypted) {
        return new Response(
          JSON.stringify({ error: 'Certificado mTLS obrigatório para EFI Pay' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      let certPem: string;
      let keyPem: string;
      try {
        certPem = atob(config.certificate_encrypted);
        keyPem = config.certificate_key_encrypted ? atob(config.certificate_key_encrypted) : certPem;
      } catch {
        return new Response(
          JSON.stringify({ error: 'Certificado mTLS inválido' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      const httpClient = Deno.createHttpClient({ cert: certPem, key: keyPem });
      const balanceUrl = `${config.base_url}/v2/gn/saldo`;
      console.log(`[pix-balance] EFI: GET ${balanceUrl}`);

      try {
        const res = await fetch(balanceUrl, {
          headers: { 'Authorization': `Bearer ${accessToken}` },
          // @ts-ignore - Deno specific
          client: httpClient,
        });

        if (!res.ok) {
          const errText = await res.text();
          httpClient.close();
          console.error('[pix-balance] EFI balance error:', errText);
          return new Response(
            JSON.stringify({ error: 'Falha ao consultar saldo na EFI', details: errText }),
            { status: 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }

        const data = await res.json();
        balance = parseFloat(data?.saldo ?? '0');
        httpClient.close();
      } catch (fetchError) {
        httpClient.close();
        return new Response(
          JSON.stringify({ error: 'Falha na conexão mTLS com a EFI', details: fetchError.message }),
          { status: 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
    }

    // ========== UNKNOWN ==========
    else {
      return new Response(
        JSON.stringify({ success: true, balance: null, available: false, provider, message: `Provedor '${provider}' não suporta consulta de saldo` }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log(`[pix-balance] Balance: ${balance}`);

    return new Response(
      JSON.stringify({ success: true, balance, available: true, provider }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('[pix-balance] Error:', error);
    return new Response(
      JSON.stringify({ error: 'Internal server error', details: error.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
