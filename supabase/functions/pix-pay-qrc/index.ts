import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

function generateIdEnvio(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let result = '';
  for (let i = 0; i < 35; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
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

    const userId = claims.claims.sub as string;
    const body = await req.json();
    const { company_id, qr_code, valor, descricao } = body;

    if (!company_id || !qr_code) {
      return new Response(
        JSON.stringify({ error: 'company_id and qr_code are required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Get Pix config for cash-out
    let config: any = null;
    const { data: cashOutConfig } = await supabase
      .from('pix_configs')
      .select('*')
      .eq('company_id', company_id)
      .eq('is_active', true)
      .eq('purpose', 'cash_out')
      .single();
    config = cashOutConfig;
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

    // Decode QR code info
    const qrcInfoResponse = await fetch(`${Deno.env.get('SUPABASE_URL')}/functions/v1/pix-qrc-info`, {
      method: 'POST',
      headers: { 'Authorization': authHeader, 'Content-Type': 'application/json' },
      body: JSON.stringify({ company_id, qr_code }),
    });

    if (!qrcInfoResponse.ok) {
      const errorText = await qrcInfoResponse.text();
      return new Response(
        JSON.stringify({ error: 'Failed to decode QR Code', details: errorText }),
        { status: 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const qrcInfo = await qrcInfoResponse.json();
    const paymentAmount = valor || qrcInfo.amount || 0;
    const MAX_PAYMENT_VALUE = 1_000_000;
    if (paymentAmount <= 0 || paymentAmount > MAX_PAYMENT_VALUE) {
      return new Response(
        JSON.stringify({ error: `Valor inválido.` }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }
    const qrType = qrcInfo.type;
    const destKey = qrcInfo.pix_key;

    // ===== STATIC QR CODE: delegate to pix-pay-dict =====
    if (qrType !== 'dynamic') {
      if (!destKey) {
        return new Response(
          JSON.stringify({ error: 'Could not extract Pix key from QR Code' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      console.log('[pix-pay-qrc] Static QR - delegating to pix-pay-dict');
      const payResponse = await fetch(`${Deno.env.get('SUPABASE_URL')}/functions/v1/pix-pay-dict`, {
        method: 'POST',
        headers: { 'Authorization': authHeader, 'Content-Type': 'application/json' },
        body: JSON.stringify({ company_id, pix_key: destKey, valor: paymentAmount, descricao: descricao || 'Pagamento via QR Code' }),
      });

      const payResult = await payResponse.json();

      if (!payResponse.ok) {
        return new Response(JSON.stringify(payResult), {
          status: payResponse.status,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      // Update transaction to mark as QR code type
      if (payResult.transaction_id) {
        const supabaseAdmin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
        await supabaseAdmin.from('transactions').update({ pix_type: 'qrcode', pix_copia_cola: qr_code }).eq('id', payResult.transaction_id);
      }

      return new Response(
        JSON.stringify({ ...payResult, amount: paymentAmount, qr_info: qrcInfo }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // ===== DYNAMIC QR CODE: pay natively with ONZ =====
    console.log('[pix-pay-qrc] Dynamic QR - paying natively with ONZ');

    const pixAuthResponse = await fetch(`${Deno.env.get('SUPABASE_URL')}/functions/v1/pix-auth`, {
      method: 'POST',
      headers: { 'Authorization': authHeader, 'Content-Type': 'application/json' },
      body: JSON.stringify({ company_id, purpose: 'cash_out' }),
    });

    if (!pixAuthResponse.ok) {
      return new Response(
        JSON.stringify({ error: 'Failed to authenticate with provider' }),
        { status: 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const { access_token } = await pixAuthResponse.json();

    const externalId = generateIdEnvio();
    const payUrl = `${config.base_url}/pix/payments/qrcode`;
    const onzPayload = {
      valor: paymentAmount.toFixed(2),
      qrCode: qr_code,
      descricao: descricao || 'Pagamento via QR Code',
      idExterno: externalId,
    };

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

    let paymentData: any;
    try {
      const proxyResponse = await fetch(`${proxyUrl}/proxy`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Proxy-API-Key': proxyApiKey },
        body: JSON.stringify({ url: payUrl, method: 'POST', headers: fetchHeaders, body: onzPayload }),
      });

      const proxyData = await proxyResponse.json();
      const data = proxyData.data || proxyData;

      if (!proxyResponse.ok || (proxyData.status && proxyData.status >= 400)) {
        return new Response(
          JSON.stringify({ error: 'Failed to initiate QR Code payment', provider_error: JSON.stringify(data) }),
          { status: 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      paymentData = data;
    } catch (e) {
      return new Response(
        JSON.stringify({ error: 'Falha na conexão com ONZ', details: e.message }),
        { status: 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log('[pix-pay-qrc] Dynamic QR payment initiated:', JSON.stringify(paymentData));

    // Save transaction
    const supabaseAdmin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

    const e2eId = paymentData.e2eId || paymentData.endToEndId || paymentData.correlationID || externalId;
    const beneficiaryName = paymentData.transaction?.creditParty?.holder?.name || paymentData.destination?.name || qrcInfo.merchant_name || null;
    const beneficiaryDoc = paymentData.transaction?.creditParty?.holder?.taxID?.taxID || paymentData.destination?.taxID || null;

    const { data: newTransaction, error: insertError } = await supabaseAdmin
      .from('transactions')
      .insert({
        company_id,
        created_by: userId,
        amount: paymentAmount,
        status: 'pending',
        pix_type: 'qrcode' as const,
        pix_key: destKey || null,
        pix_copia_cola: qr_code,
        pix_txid: qrcInfo.txid || null,
        description: descricao || 'Pagamento via QR Code',
        pix_e2eid: e2eId,
        external_id: externalId,
        beneficiary_name: beneficiaryName,
        beneficiary_document: beneficiaryDoc,
        pix_provider_response: paymentData,
      })
      .select('id')
      .single();

    if (insertError) {
      return new Response(
        JSON.stringify({ error: 'Failed to save transaction' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    await supabaseAdmin.from('audit_logs').insert({
      user_id: userId,
      company_id,
      entity_type: 'transaction',
      entity_id: newTransaction.id,
      action: 'pix_qrcode_payment_initiated',
      new_data: { provider: 'onz', externalId, e2eId, valor: paymentAmount, qr_type: 'dynamic', status: 'pending' },
    });

    return new Response(
      JSON.stringify({
        success: true,
        transaction_id: newTransaction.id,
        end_to_end_id: e2eId,
        id_envio: externalId,
        status: paymentData.status || 'PROCESSING',
        amount: paymentAmount,
        qr_info: qrcInfo,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('[pix-pay-qrc] Error:', error);
    return new Response(
      JSON.stringify({ error: 'Internal server error', details: error.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
