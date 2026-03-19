import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

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
  const data = await resp.json();
  return { proxyStatus: resp.status, status: data.status || resp.status, data: data.data || data };
}

function toNumber(value: unknown): number | undefined {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!,
      { global: { headers: { Authorization: authHeader } } }
    );

    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
      return new Response(JSON.stringify({ error: 'Invalid token' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    const body = await req.json();
    const { company_id, codigo_barras } = body;

    if (!company_id || !codigo_barras) {
      return new Response(JSON.stringify({ error: 'company_id and codigo_barras are required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    // Get config
    const { data: config } = await supabase
      .from('pix_configs').select('*')
      .eq('company_id', company_id).eq('is_active', true)
      .in('purpose', ['cash_out', 'both']).limit(1).maybeSingle();

    if (!config) {
      return new Response(JSON.stringify({ error: 'Configuração Pix não encontrada.' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    const cleanBarcode = codigo_barras.replace(/[\s.\-]/g, '');

    if (config.provider === 'onz') {
      // ========== ONZ: No dedicated consult endpoint ==========
      // ONZ pays with adjusted amount automatically. Return basic info from the barcode itself.
      // We can try POST /api/v2/billets/payments with paymentFlow: APPROVAL_REQUIRED to get info,
      // but this is not documented. For now, return a response indicating ONZ handles it at payment time.
      
      // Get auth token to try the info endpoint if available
      const authResponse = await fetch(`${Deno.env.get('SUPABASE_URL')}/functions/v1/pix-auth`, {
        method: 'POST',
        headers: { 'Authorization': authHeader, 'Content-Type': 'application/json' },
        body: JSON.stringify({ company_id, purpose: 'cash_out' }),
      });

      if (!authResponse.ok) {
        return new Response(JSON.stringify({ error: 'Falha ao autenticar com o provedor' }),
          { status: 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }

      const { access_token } = await authResponse.json();

      // Try ONZ billet info endpoint
      try {
        const result = await callOnzViaProxy(
          `${config.base_url}/api/v2/billets/consult`,
          'POST',
          {
            'Authorization': `Bearer ${access_token}`,
            'Content-Type': 'application/json',
          },
          JSON.stringify({ digitableCode: cleanBarcode }),
        );

        if (result.status < 400 && result.data) {
          const billetInfo = result.data;
          return new Response(JSON.stringify({
            success: true,
            value: toNumber(billetInfo.originalAmount || billetInfo.amount),
            total_updated_value: toNumber(billetInfo.adjustedAmount || billetInfo.totalAmount || billetInfo.amount),
            due_date: billetInfo.dueDate,
            fine_value: toNumber(billetInfo.fineAmount),
            interest_value: toNumber(billetInfo.interestAmount),
            discount_value: toNumber(billetInfo.discountAmount),
            recipient_name: billetInfo.recipientName || billetInfo.beneficiaryName,
            recipient_document: billetInfo.recipientDocument || billetInfo.beneficiaryDocument,
            type: billetInfo.type,
            status: billetInfo.status,
            digitable_line: billetInfo.digitableLine || cleanBarcode,
            barcode: billetInfo.barcode || cleanBarcode,
            provider: 'onz',
            raw: billetInfo,
          }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
        }
      } catch (e) {
        console.warn('[billet-consult] ONZ consult attempt failed:', e.message);
      }

      // Fallback: return basic info indicating payment will use adjusted value
      return new Response(JSON.stringify({
        success: true,
        value: undefined,
        total_updated_value: undefined,
        due_date: undefined,
        recipient_name: undefined,
        recipient_document: undefined,
        type: 'BOLETO',
        digitable_line: cleanBarcode,
        barcode: cleanBarcode,
        provider: 'onz',
        note: 'ONZ calcula automaticamente juros e multas no momento do pagamento.',
        raw: null,
      }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

    } else {
      // ========== TRANSFEERA ==========
      const authResponse = await fetch(`${Deno.env.get('SUPABASE_URL')}/functions/v1/pix-auth`, {
        method: 'POST',
        headers: { 'Authorization': authHeader, 'Content-Type': 'application/json' },
        body: JSON.stringify({ company_id, purpose: 'cash_out' }),
      });

      if (!authResponse.ok) {
        return new Response(JSON.stringify({ error: 'Falha ao autenticar com o provedor' }),
          { status: 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }

      const { access_token } = await authResponse.json();
      const apiBase = config.is_sandbox ? 'https://api-sandbox.transfeera.com' : 'https://api.transfeera.com';

      console.log(`[billet-consult] Consulting billet: ${cleanBarcode}`);

      const consultResponse = await fetch(`${apiBase}/billet/consult?code=${encodeURIComponent(cleanBarcode)}`, {
        method: 'GET',
        headers: { 'Authorization': `Bearer ${access_token}`, 'User-Agent': 'PixContabil (contato@pixcontabil.com.br)' },
      });

      if (!consultResponse.ok) {
        const errText = await consultResponse.text();
        console.error('[billet-consult] Consult failed:', errText);
        return new Response(JSON.stringify({ error: 'Falha ao consultar boleto', details: errText }),
          { status: 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }

      const billetInfo = await consultResponse.json();
      const paymentInfo = billetInfo?.payment_info ?? {};
      const barcodeDetails = billetInfo?.barcode_details ?? {};

      const originalValue = toNumber(paymentInfo.original_value ?? barcodeDetails.value ?? billetInfo?.value);
      const updatedValue = toNumber(paymentInfo.total_updated_value ?? billetInfo?.total_updated_value ?? originalValue);
      const fineValue = toNumber(paymentInfo.fine_value ?? billetInfo?.fine_value);
      const interestValue = toNumber(paymentInfo.interest_value ?? billetInfo?.interest_value);
      const discountValue = toNumber(paymentInfo.total_discount_value ?? paymentInfo.discount_value ?? billetInfo?.discount_value);
      const dueDate = paymentInfo.due_date ?? barcodeDetails.due_date ?? billetInfo?.due_date;
      const recipientName = paymentInfo.recipient_name ?? billetInfo?.recipient_name;
      const recipientDocument = paymentInfo.recipient_document ?? billetInfo?.recipient_document;

      return new Response(JSON.stringify({
        success: true,
        value: originalValue,
        total_updated_value: updatedValue,
        due_date: dueDate,
        fine_value: fineValue,
        interest_value: interestValue,
        discount_value: discountValue,
        recipient_name: recipientName,
        recipient_document: recipientDocument,
        type: barcodeDetails.type ?? billetInfo?.type,
        status: billetInfo?.status,
        digitable_line: barcodeDetails.digitable_line ?? billetInfo?.digitable_line,
        barcode: barcodeDetails.barcode ?? billetInfo?.barcode ?? cleanBarcode,
        provider: 'transfeera',
        raw: billetInfo,
      }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

  } catch (error) {
    console.error('[billet-consult] Error:', error);
    return new Response(JSON.stringify({ error: 'Internal server error', details: error.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }
});
