import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// ONZ requires [a-zA-Z0-9]{1,50} — no hyphens allowed
function generateIdempotencyKey(): string {
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

    // Decode QR code info locally first (for fallback key extraction)
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
    const qrType = qrcInfo.type;
    const qrEmbeddedAmount = Number(qrcInfo.amount || 0);
    const hasEmbeddedAmount = Number.isFinite(qrEmbeddedAmount) && qrEmbeddedAmount > 0;

    // For dynamic QR with embedded amount, honor QR amount to avoid provider rejection
    const paymentAmount = (qrType === 'dynamic' && hasEmbeddedAmount)
      ? qrEmbeddedAmount
      : (valor || qrEmbeddedAmount || 0);

    const MAX_PAYMENT_VALUE = 1_000_000;
    if (paymentAmount <= 0 || paymentAmount > MAX_PAYMENT_VALUE) {
      return new Response(
        JSON.stringify({ error: 'Valor inválido.' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

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

      if (payResult.transaction_id) {
        const supabaseAdmin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
        await supabaseAdmin.from('transactions').update({ pix_type: 'qrcode', pix_copia_cola: qr_code }).eq('id', payResult.transaction_id);
      }

      return new Response(
        JSON.stringify({ ...payResult, amount: paymentAmount, qr_info: qrcInfo }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // ===== DYNAMIC QR CODE =====
    console.log('[pix-pay-qrc] Dynamic QR - processing via ONZ /pix/payments/qrc');

    const proxyUrl = Deno.env.get('ONZ_PROXY_URL');
    const proxyApiKey = Deno.env.get('ONZ_PROXY_API_KEY');
    if (!proxyUrl || !proxyApiKey) {
      return new Response(
        JSON.stringify({ error: 'ONZ_PROXY_URL ou ONZ_PROXY_API_KEY não configurado.' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const baseUrl = config.base_url.replace(/\/+$/, '');
    const formattedAmount = Number(paymentAmount.toFixed(2));

    // Helper: get ONZ access token
    const getAccessToken = async (forceNew: boolean): Promise<string> => {
      const authResponse = await fetch(`${Deno.env.get('SUPABASE_URL')}/functions/v1/pix-auth`, {
        method: 'POST',
        headers: { 'Authorization': authHeader, 'Content-Type': 'application/json' },
        body: JSON.stringify({ company_id, purpose: 'cash_out', force_new: forceNew }),
      });
      if (!authResponse.ok) {
        throw new Error(`Auth failed: ${await authResponse.text()}`);
      }
      const authData = await authResponse.json();
      return authData.access_token;
    };

    // Helper: call ONZ endpoint via proxy
    const callOnzViaProxy = async (url: string, payload: Record<string, unknown>, idempKey: string, accessToken: string) => {
      const onzHeaders: Record<string, string> = {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'Authorization': `Bearer ${accessToken}`,
        'x-idempotency-key': idempKey,
      };
      if (config.provider_company_id) {
        onzHeaders['X-Company-ID'] = config.provider_company_id;
      }

      const rawBody = JSON.stringify(payload);
      console.log('[pix-pay-qrc] Proxy call to:', url, 'body (first 500):', rawBody.substring(0, 500));

      const proxyResponse = await fetch(`${proxyUrl}/proxy`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Proxy-API-Key': proxyApiKey },
        body: JSON.stringify({
          url,
          method: 'POST',
          headers: onzHeaders,
          body_raw: rawBody,
        }),
      });

      const proxyData = await proxyResponse.json();
      return { proxyResponse, proxyData };
    };

    // ===== STEP 1: Consult QR via ONZ /pix/payments/qrc/info =====
    console.log('[pix-pay-qrc] Step 1: Consulting ONZ /pix/payments/qrc/info');
    let accessToken = await getAccessToken(false);
    const qrcInfoOnzUrl = `${baseUrl}/pix/payments/qrc/info`;
    const infoIdempKey = generateIdempotencyKey();

    let { proxyResponse: infoResponse, proxyData: infoData } = await callOnzViaProxy(
      qrcInfoOnzUrl,
      { qrCode: qr_code },
      infoIdempKey,
      accessToken
    );

    let infoResult = infoData.data || infoData;

    // Retry with fresh token on 401
    if (infoResponse.status === 401 || infoResult?.type === 'onz-0018') {
      console.log('[pix-pay-qrc] Info: token rejected, retrying with fresh token');
      accessToken = await getAccessToken(true);
      ({ proxyResponse: infoResponse, proxyData: infoData } = await callOnzViaProxy(
        qrcInfoOnzUrl,
        { qrCode: qr_code },
        infoIdempKey,
        accessToken
      ));
      infoResult = infoData.data || infoData;
    }

    console.log('[pix-pay-qrc] QRC info response:', infoResponse.status, JSON.stringify(infoData));

    // If info consultation fails, log but continue with payment attempt anyway
    const onzQrcInfo = infoResponse.ok ? infoResult : null;
    if (onzQrcInfo) {
      console.log('[pix-pay-qrc] ONZ QRC info: type=', onzQrcInfo.type, 'statusCode=', onzQrcInfo.statusCode, 'chave=', onzQrcInfo.chave, 'amount=', onzQrcInfo.transactionAmount);
    } else {
      console.warn('[pix-pay-qrc] ONZ /qrc/info failed, proceeding with payment attempt anyway');
    }

    // ===== STEP 2: Pay via ONZ /pix/payments/qrc =====
    console.log('[pix-pay-qrc] Step 2: Payment via /pix/payments/qrc');
    const paymentIdempKey = generateIdempotencyKey();
    const qrcPaymentUrl = `${baseUrl}/pix/payments/qrc`;
    const paymentPayload = {
      qrCode: qr_code,
      description: descricao || 'Pagamento via QR Code',
      paymentFlow: 'INSTANT',
      payment: { currency: 'BRL', amount: formattedAmount },
    };

    let { proxyResponse: payResponse, proxyData: payData } = await callOnzViaProxy(
      qrcPaymentUrl,
      paymentPayload,
      paymentIdempKey,
      accessToken
    );

    let payResult = payData.data || payData;

    // Retry with fresh token on 401
    if (payResponse.status === 401 || payResult?.type === 'onz-0018') {
      console.log('[pix-pay-qrc] Payment: token rejected, retrying with fresh token');
      accessToken = await getAccessToken(true);
      ({ proxyResponse: payResponse, proxyData: payData } = await callOnzViaProxy(
        qrcPaymentUrl,
        paymentPayload,
        paymentIdempKey,
        accessToken
      ));
      payResult = payData.data || payData;
    }

    console.log('[pix-pay-qrc] Payment response:', payResponse.status, JSON.stringify(payData));

    // ===== If ONZ rejects, fallback to pix-pay-dict =====
    if (!payResponse.ok && payResponse.status !== 202) {
      const isInvalidQr = payResult?.type === 'onz-0010' || payResult?.title === 'Invalid QrCode';
      const isInvalidParams = payResult?.type === 'onz-0002' || payResult?.title === 'Invalid params';

      if ((isInvalidQr || isInvalidParams) && destKey) {
        console.log('[pix-pay-qrc] ONZ rejected QR, falling back to pix-pay-dict with key:', destKey);

        const dictResponse = await fetch(`${Deno.env.get('SUPABASE_URL')}/functions/v1/pix-pay-dict`, {
          method: 'POST',
          headers: { 'Authorization': authHeader, 'Content-Type': 'application/json' },
          body: JSON.stringify({ company_id, pix_key: destKey, valor: paymentAmount, descricao: descricao || 'Pagamento via QR Code' }),
        });

        const dictResult = await dictResponse.json();

        if (!dictResponse.ok) {
          return new Response(JSON.stringify(dictResult), {
            status: dictResponse.status,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          });
        }

        if (dictResult.transaction_id) {
          const supabaseAdmin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
          await supabaseAdmin.from('transactions').update({ pix_type: 'qrcode', pix_copia_cola: qr_code }).eq('id', dictResult.transaction_id);
        }

        return new Response(
          JSON.stringify({ ...dictResult, amount: paymentAmount, qr_info: qrcInfo, fallback: 'dict' }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      if (isInvalidQr && !destKey) {
        return new Response(
          JSON.stringify({
            error: 'QR Code dinâmico inválido ou expirado',
            details: payResult,
            hint: 'Não foi possível extrair chave Pix para fallback. Gere um novo QR Code e tente novamente.'
          }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      return new Response(
        JSON.stringify({ error: 'Falha no pagamento via QR Code', details: payResult }),
        { status: payResponse.status >= 400 ? payResponse.status : 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // ===== Success: create transaction record =====
    const supabaseAdmin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

    const { data: transaction, error: txError } = await supabaseAdmin.from('transactions').insert({
      company_id,
      created_by: userId,
      amount: paymentAmount,
      description: descricao || 'Pagamento via QR Code dinâmico',
      pix_type: 'qrcode',
      pix_copia_cola: qr_code,
      pix_txid: qrcInfo.txid || onzQrcInfo?.txid || null,
      pix_e2eid: payResult.endToEndId || null,
      external_id: String(payResult.id || ''),
      beneficiary_name: qrcInfo.merchant_name || onzQrcInfo?.merchantName || null,
      status: 'completed',
      paid_at: new Date().toISOString(),
      pix_provider_response: payResult,
    }).select('id').single();

    if (txError) {
      console.error('[pix-pay-qrc] Transaction insert error:', txError);
    }

    return new Response(
      JSON.stringify({
        success: true,
        transaction_id: transaction?.id || null,
        end_to_end_id: payResult.endToEndId || null,
        amount: paymentAmount,
        qr_info: qrcInfo,
        onz_qrc_info: onzQrcInfo,
        provider_response: payResult,
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
