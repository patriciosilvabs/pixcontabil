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

function parsePositiveAmount(value: unknown): number | undefined {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
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
  // Already linha digitável (47 or 48 digits) or convênio (starts with 8)
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

    const token = authHeader.replace('Bearer ', '');
    const { data: userData, error: authError } = await supabase.auth.getUser(token);
    if (authError || !userData?.user) {
      return new Response(JSON.stringify({ error: 'Invalid token' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    const userId = userData.user.id;
    const body = await req.json();
    const { company_id, codigo_barras, descricao, valor } = body;

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
      return new Response(JSON.stringify({ error: 'Configuração Pix não encontrada para pagamento de boletos.' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    // Get auth token
    const authResponse = await fetch(`${Deno.env.get('SUPABASE_URL')}/functions/v1/pix-auth`, {
      method: 'POST',
      headers: { 'Authorization': authHeader, 'Content-Type': 'application/json', 'apikey': Deno.env.get('SUPABASE_ANON_KEY')! },
      body: JSON.stringify({ company_id, purpose: 'cash_out' }),
    });

    if (!authResponse.ok) {
      return new Response(JSON.stringify({ error: 'Falha ao autenticar com o provedor' }),
        { status: 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    const { access_token } = await authResponse.json();
    const cleanBarcode = codigo_barras.replace(/[\s.\-]/g, '');
    const informedValue = parsePositiveAmount(valor);

    if (config.provider === 'onz') {
      // ========== ONZ: POST /api/v2/billets/payments ==========
      // ONZ requires digitableCode in linha digitável format (47 digits)
      const digitableCode = convertToLinhaDigitavel(cleanBarcode);
      const idempotencyKey = crypto.randomUUID();
      const onzBody = {
        digitableCode,
        description: descricao || 'Pagamento de boleto',
        paymentFlow: 'INSTANT',
      };

      console.log(`[billet-pay] ONZ: paying billet ${cleanBarcode}`);

      const result = await callOnzViaProxy(
        `${config.base_url}/api/v2/billets/payments`,
        'POST',
        {
          'Authorization': `Bearer ${access_token}`,
          'Content-Type': 'application/json',
          'x-idempotency-key': idempotencyKey,
        },
        JSON.stringify(onzBody),
      );

      if (result.status >= 400) {
        console.error('[billet-pay] ONZ error:', JSON.stringify(result.data));
        return new Response(JSON.stringify({ error: 'Falha ao pagar boleto via ONZ', provider_error: JSON.stringify(result.data) }),
          { status: 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }

      const paymentData = result.data;
      console.log('[billet-pay] ONZ payment result:', JSON.stringify(paymentData));

      const onzId = paymentData.id || '';
      const externalId = `onz:${onzId}`;
      const amount = informedValue || parsePositiveAmount(paymentData.payment?.amount) || parsePositiveAmount(paymentData.amount) || 0;

      // Save transaction
      const supabaseAdmin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

      const { data: newTransaction, error: insertError } = await supabaseAdmin
        .from('transactions')
        .insert({
          company_id,
          created_by: userId,
          amount,
          status: 'pending',
          pix_type: 'boleto' as const,
          boleto_code: codigo_barras,
          description: descricao || 'Pagamento de boleto',
          external_id: externalId,
          pix_provider_response: paymentData,
        })
        .select('id')
        .single();

      if (insertError) {
        console.error('[billet-pay] Failed to create transaction:', insertError);
        return new Response(JSON.stringify({ error: 'Failed to save transaction' }),
          { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }

      await supabaseAdmin.from('audit_logs').insert({
        user_id: userId, company_id, entity_type: 'transaction', entity_id: newTransaction.id,
        action: 'billet_payment_initiated',
        new_data: { provider: 'onz', externalId, amount, status: 'pending' },
      });

      return new Response(JSON.stringify({
        success: true,
        transaction_id: newTransaction.id,
        external_id: externalId,
        billet_id: onzId,
        status: paymentData.status || 'PROCESSING',
        provider: 'onz',
        provider_response: paymentData,
      }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

    } else {
      // ========== TRANSFEERA ==========
      const apiBase = config.is_sandbox ? 'https://api-sandbox.transfeera.com' : 'https://api.transfeera.com';

      // Consult billet first
      let billetInfo: any = null;
      try {
        const consultResponse = await fetch(`${apiBase}/billet/consult?code=${encodeURIComponent(cleanBarcode)}`, {
          method: 'GET',
          headers: { 'Authorization': `Bearer ${access_token}`, 'User-Agent': 'PixContabil (contato@pixcontabil.com.br)' },
        });
        if (consultResponse.ok) billetInfo = await consultResponse.json();
      } catch (e) { console.warn('[billet-pay] Billet consult error:', e.message); }

      const consultPaymentInfo = billetInfo?.payment_info ?? {};
      const consultBarcodeDetails = billetInfo?.barcode_details ?? {};
      const originalConsultValue = parsePositiveAmount(consultPaymentInfo.original_value ?? consultBarcodeDetails.value ?? billetInfo?.value);
      const updatedConsultValue = parsePositiveAmount(consultPaymentInfo.total_updated_value ?? billetInfo?.total_updated_value ?? originalConsultValue);
      const billetAmount = informedValue ?? updatedConsultValue ?? originalConsultValue;

      const paymentDate = new Date().toISOString().split('T')[0];
      const batchPayload = {
        name: `BOLETO_${Date.now()}`, type: 'BOLETO', auto_close: true,
        billets: [{ barcode: cleanBarcode, payment_date: paymentDate, description: descricao || 'Pagamento de boleto', value: billetAmount }],
      };

      let paymentData: any;
      try {
        const batchResponse = await fetch(`${apiBase}/batch`, {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${access_token}`, 'Content-Type': 'application/json', 'User-Agent': 'PixContabil (contato@pixcontabil.com.br)' },
          body: JSON.stringify(batchPayload),
        });
        paymentData = await batchResponse.json();
        if (!batchResponse.ok) {
          return new Response(JSON.stringify({ error: 'Falha ao pagar boleto via Transfeera', provider_error: JSON.stringify(paymentData) }),
            { status: 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
        }
      } catch (e) {
        return new Response(JSON.stringify({ error: 'Falha na conexão com Transfeera', details: e.message }),
          { status: 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }

      const batchId = paymentData.id;
      const billetId = paymentData.billets?.[0]?.id || '';
      const externalId = `${batchId}:${billetId}`;
      const amount = billetAmount ?? parsePositiveAmount(paymentData.billets?.[0]?.value) ?? 0;

      const supabaseAdmin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

      const { data: newTransaction, error: insertError } = await supabaseAdmin
        .from('transactions')
        .insert({
          company_id, created_by: userId, amount, status: 'pending', pix_type: 'boleto' as const,
          boleto_code: codigo_barras, description: descricao || 'Pagamento de boleto',
          external_id: externalId, pix_provider_response: paymentData,
        })
        .select('id').single();

      if (insertError) {
        return new Response(JSON.stringify({ error: 'Failed to save transaction' }),
          { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }

      await supabaseAdmin.from('audit_logs').insert({
        user_id: userId, company_id, entity_type: 'transaction', entity_id: newTransaction.id,
        action: 'billet_payment_initiated',
        new_data: { provider: 'transfeera', externalId, amount, status: 'pending' },
      });

      return new Response(JSON.stringify({
        success: true, transaction_id: newTransaction.id, external_id: externalId,
        batch_id: batchId, billet_id: billetId, status: paymentData.status || 'PROCESSING',
        billet_info: billetInfo, provider_response: paymentData,
      }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

  } catch (error) {
    console.error('[billet-pay] Error:', error);
    return new Response(JSON.stringify({ error: 'Internal server error', details: error.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }
});
