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

    // Get Pix config - prefer cash_out (since decode is for payment), fallback to both, then cash_in
    let config: any = null;
    for (const purpose of ['cash_out', 'both', 'cash_in']) {
      const { data } = await supabase
        .from('pix_configs')
        .select('*')
        .eq('company_id', company_id)
        .eq('is_active', true)
        .eq('purpose', purpose)
        .single();
      if (data) {
        config = data;
        break;
      }
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
      body: JSON.stringify({ company_id, purpose: config.purpose === 'cash_in' ? 'cash_in' : 'cash_out' }),
    });

    if (!authResponse.ok) {
      return new Response(
        JSON.stringify({ error: 'Failed to authenticate with provider' }),
        { status: 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const { access_token } = await authResponse.json();

    // ONZ QR decode via proxy - use /api/v1/decode/emv (not available under /api/v2)
    const baseOrigin = new URL(config.base_url).origin;
    const infoUrl = `${baseOrigin}/api/v1/decode/emv`;
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
        body: JSON.stringify({ url: infoUrl, method: 'POST', headers: fetchHeaders, body: { emv: qr_code } }),
      });

      const rawText = await proxyResponse.text();
      console.log('[pix-qrc-info] Proxy raw response status:', proxyResponse.status, 'body:', rawText.substring(0, 500));

      let proxyData: any;
      try {
        proxyData = JSON.parse(rawText);
      } catch {
        return new Response(
          JSON.stringify({ error: 'Proxy returned invalid JSON', raw: rawText.substring(0, 300) }),
          { status: 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

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

    console.log('[pix-qrc-info] Full ONZ decode response:', JSON.stringify(qrcInfo));

    // Extract amount from various possible ONZ response structures
    function extractAmount(info: any): number | null {
      // Direct numeric fields
      if (typeof info.valor === 'number' && info.valor > 0) return info.valor;
      if (typeof info.valor === 'string' && parseFloat(info.valor) > 0) return parseFloat(info.valor);
      
      // Nested valor object (BACEN cobv format: { valor: { original: "100.00" } })
      if (info.valor && typeof info.valor === 'object') {
        const orig = info.valor.original || info.valor.value || info.valor.amount;
        if (orig) return parseFloat(String(orig));
      }

      // Other common field names
      if (info.transactionAmount) return parseFloat(String(info.transactionAmount));
      if (info.amount) return parseFloat(String(info.amount));
      if (info.value) return parseFloat(String(info.value));
      
      // Nested payment object
      if (info.payment?.amount) return parseFloat(String(info.payment.amount));
      if (info.payment?.value) return parseFloat(String(info.payment.value));

      // BACEN-style nested cobv
      if (info.cobv?.valor?.original) return parseFloat(String(info.cobv.valor.original));
      if (info.cob?.valor?.original) return parseFloat(String(info.cob.valor.original));

      return null;
    }

    const extractedAmount = extractAmount(qrcInfo);
    console.log('[pix-qrc-info] Extracted amount:', extractedAmount);

    // Determine QR type
    const qrType = qrcInfo.tipo || qrcInfo.type || 
      (qrcInfo.cobv || qrcInfo.cob || qrcInfo.txid ? 'dynamic' : 'static');

    return new Response(
      JSON.stringify({
        success: true,
        provider: 'onz',
        type: qrType,
        merchant_name: qrcInfo.nome || qrcInfo.merchantName || qrcInfo.merchant_name || 
          qrcInfo.cobv?.devedor?.nome || qrcInfo.cob?.devedor?.nome || qrcInfo.creditParty?.name,
        merchant_city: qrcInfo.cidade || qrcInfo.merchantCity || qrcInfo.merchant_city,
        amount: extractedAmount,
        pix_key: qrcInfo.chave || qrcInfo.pix_key || qrcInfo.pixKey || 
          qrcInfo.cobv?.chave || qrcInfo.cob?.chave,
        txid: qrcInfo.txid || qrcInfo.cobv?.txid || qrcInfo.cob?.txid,
        end_to_end_id: qrcInfo.endToEndId || qrcInfo.e2eId,
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
