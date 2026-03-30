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

function mod10(block: string): string {
  let sum = 0;
  let weight = 2;
  for (let i = block.length - 1; i >= 0; i--) {
    let prod = parseInt(block[i], 10) * weight;
    if (prod >= 10) prod = Math.floor(prod / 10) + (prod % 10);
    sum += prod;
    weight = weight === 2 ? 1 : 2;
  }
  const remainder = sum % 10;
  return remainder === 0 ? '0' : String(10 - remainder);
}

function convertToLinhaDigitavel(code: string): string {
  const clean = code.replace(/[\s.\-]/g, '');
  if (clean.length !== 44 || clean[0] === '8') return clean;
  const bankCurrency = clean.substring(0, 4);
  const checkDigit = clean[4];
  const dueFactor = clean.substring(5, 9);
  const amount = clean.substring(9, 19);
  const freeField1 = clean.substring(19, 24);
  const freeField2 = clean.substring(24, 34);
  const freeField3 = clean.substring(34, 44);
  const check1 = mod10(bankCurrency + freeField1);
  const check2 = mod10(freeField2);
  const check3 = mod10(freeField3);
  return bankCurrency + freeField1 + check1
       + freeField2 + check2
       + freeField3 + check3
       + checkDigit + dueFactor + amount;
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
    const digitableCode = convertToLinhaDigitavel(cleanBarcode);

    if (config.provider === 'onz') {
      // ========== ONZ: No dedicated consult endpoint ==========
      // ONZ does NOT have a billet consult API. Interest/fines are calculated automatically at payment time.
      // We parse the barcode locally to extract original value and due date.

      const BASE_DATE = new Date(1997, 9, 7); // October 7, 1997

      function parseBarcodeInfo(code: string): { amount: number; dueDate: string | null; isConvenio: boolean } {
        const clean = code.replace(/[\s.\-]/g, '');
        const len = clean.length;

        // Convênio (starts with 8)
        if (clean[0] === '8') {
          const valueId = clean[2];
          let amountCents = 0;
          if (['6', '7', '8', '9'].includes(valueId)) {
            amountCents = parseInt(clean.substring(4, 15), 10);
          }
          return { amount: amountCents / 100, dueDate: null, isConvenio: true };
        }

        // Bank boleto barcode (44 digits)
        let barcode44 = clean;
        if (len === 47) {
          // Convert linha digitável to barcode
          barcode44 =
            clean.substring(0, 4) +
            clean[32] +
            clean.substring(33, 37) +
            clean.substring(37, 47) +
            clean.substring(4, 9) +
            clean.substring(10, 20) +
            clean.substring(21, 31);
        }

        if (barcode44.length === 44) {
          const dueFactor = parseInt(barcode44.substring(5, 9), 10);
          const amountCents = parseInt(barcode44.substring(9, 19), 10);
          let dueDate: string | null = null;
          if (dueFactor > 0) {
            const date = new Date(BASE_DATE);
            date.setDate(date.getDate() + dueFactor);
            dueDate = date.toISOString().split('T')[0];
          }
          return { amount: amountCents / 100, dueDate, isConvenio: false };
        }

        return { amount: 0, dueDate: null, isConvenio: false };
      }

      const parsed = parseBarcodeInfo(cleanBarcode);
      const today = new Date().toISOString().split('T')[0];
      const isOverdue = parsed.dueDate ? parsed.dueDate < today : false;

      console.log(`[billet-consult] ONZ local parse: amount=${parsed.amount}, dueDate=${parsed.dueDate}, isOverdue=${isOverdue}`);

      return new Response(JSON.stringify({
        success: true,
        value: parsed.amount > 0 ? parsed.amount : undefined,
        total_updated_value: undefined, // ONZ calculates at payment time
        due_date: parsed.dueDate,
        fine_value: undefined,
        interest_value: undefined,
        discount_value: undefined,
        recipient_name: undefined,
        recipient_document: undefined,
        type: parsed.isConvenio ? 'CONVENIO' : 'BOLETO',
        digitable_line: digitableCode,
        barcode: cleanBarcode,
        provider: 'onz',
        is_overdue: isOverdue,
        note: isOverdue
          ? 'Boleto vencido. Juros e multa serão calculados automaticamente no momento do pagamento.'
          : 'ONZ calcula automaticamente juros e multas no momento do pagamento.',
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
