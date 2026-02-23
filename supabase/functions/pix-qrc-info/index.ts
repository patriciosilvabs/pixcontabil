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

    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
      return new Response(
        JSON.stringify({ error: 'Invalid token' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const body = await req.json();
    const { company_id, qr_code } = body;

    if (!company_id || !qr_code) {
      return new Response(
        JSON.stringify({ error: 'company_id and qr_code are required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Get Pix config
    let config: any = null;
    const { data: cashInConfig } = await supabase
      .from('pix_configs')
      .select('*')
      .eq('company_id', company_id)
      .eq('is_active', true)
      .eq('purpose', 'cash_in')
      .single();
    config = cashInConfig;
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
      return new Response(
        JSON.stringify({ error: 'Pix configuration not found' }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Get auth token
    const authResponse = await fetch(`${Deno.env.get('SUPABASE_URL')}/functions/v1/pix-auth`, {
      method: 'POST',
      headers: { 'Authorization': authHeader, 'Content-Type': 'application/json' },
      body: JSON.stringify({ company_id, purpose: 'cash_in' }),
    });

    if (!authResponse.ok) {
      return new Response(
        JSON.stringify({ error: 'Failed to authenticate with provider' }),
        { status: 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const { access_token } = await authResponse.json();

    // ONZ QR decode via proxy
    const infoUrl = `${config.base_url}/pix/qrcode/decode`;
    const proxyUrl = Deno.env.get('ONZ_PROXY_URL');
    const proxyApiKey = Deno.env.get('ONZ_PROXY_API_KEY');
    if (!proxyUrl || !proxyApiKey) {
      return new Response(
        JSON.stringify({ error: 'ONZ_PROXY_URL não configurado' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const fetchHeaders: any = { 'Authorization': `Bearer ${access_token}`, 'Content-Type': 'application/json' };
    if (config.provider_company_id) fetchHeaders['X-Company-ID'] = config.provider_company_id;

    let qrcInfo: any;
    try {
      const proxyResponse = await fetch(`${proxyUrl}/proxy`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Proxy-API-Key': proxyApiKey },
        body: JSON.stringify({ url: infoUrl, method: 'POST', headers: fetchHeaders, body: { qrcode: qr_code } }),
      });

      const proxyData = await proxyResponse.json();
      const data = proxyData.data || proxyData;

      if (!proxyResponse.ok || (proxyData.status && proxyData.status >= 400)) {
        return new Response(
          JSON.stringify({ error: 'Failed to decode QR Code', provider_error: JSON.stringify(data) }),
          { status: 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      qrcInfo = data;
    } catch (e) {
      return new Response(
        JSON.stringify({ error: 'Falha na conexão com ONZ', details: e.message }),
        { status: 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log('[pix-qrc-info] QR Code decoded:', JSON.stringify(qrcInfo));

    return new Response(
      JSON.stringify({
        success: true,
        provider: 'onz',
        type: qrcInfo.tipo || qrcInfo.type,
        merchant_name: qrcInfo.nome || qrcInfo.merchantName || qrcInfo.merchant_name,
        merchant_city: qrcInfo.cidade || qrcInfo.merchantCity || qrcInfo.merchant_city,
        amount: qrcInfo.valor ? parseFloat(qrcInfo.valor) : (qrcInfo.transactionAmount || qrcInfo.amount || qrcInfo.value),
        pix_key: qrcInfo.chave || qrcInfo.pix_key,
        txid: qrcInfo.txid,
        end_to_end_id: qrcInfo.endToEndId,
        payload: qrcInfo,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('[pix-qrc-info] Error:', error);
    return new Response(
      JSON.stringify({ error: 'Internal server error', details: error.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
