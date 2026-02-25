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
    const qrType = qrcInfo.type;

    const qrEmbeddedAmount = Number(qrcInfo.amount || 0);
    const hasEmbeddedAmount = Number.isFinite(qrEmbeddedAmount) && qrEmbeddedAmount > 0;

    // For dynamic QR with embedded amount, honor QR amount to avoid provider rejection (onz-0010)
    const paymentAmount = (qrType === 'dynamic' && hasEmbeddedAmount)
      ? qrEmbeddedAmount
      : (valor || qrEmbeddedAmount || 0);

    const MAX_PAYMENT_VALUE = 1_000_000;
    if (paymentAmount <= 0 || paymentAmount > MAX_PAYMENT_VALUE) {
      return new Response(
        JSON.stringify({ error: `Valor inválido.` }),
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

    // ===== DYNAMIC QR CODE: use ONZ /pix/payments/qrc to properly settle =====
    console.log('[pix-pay-qrc] Dynamic QR - calling ONZ /pix/payments/qrc directly');

    const proxyUrl = Deno.env.get('ONZ_PROXY_URL');
    const proxyApiKey = Deno.env.get('ONZ_PROXY_API_KEY');
    if (!proxyUrl || !proxyApiKey) {
      return new Response(
        JSON.stringify({ error: 'ONZ_PROXY_URL ou ONZ_PROXY_API_KEY não configurado.' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Use cashout-{uuid} format matching ONZ documentation
    const idempotencyKey = `cashout-${crypto.randomUUID()}`;
    const baseUrl = config.base_url.replace(/\/+$/, '');
    const qrcPaymentUrl = `${baseUrl}/pix/payments/qrc`;

    // Format amount with 2 decimal places to match ONZ expected format
    const formattedAmount = Number(paymentAmount.toFixed(2));

    // Helper to get token and call ONZ via proxy using body_raw (single serialization)
    const callOnzQrc = async (forceNewToken: boolean, payload: Record<string, unknown>) => {
      const authResponse = await fetch(`${Deno.env.get('SUPABASE_URL')}/functions/v1/pix-auth`, {
        method: 'POST',
        headers: { 'Authorization': authHeader, 'Content-Type': 'application/json' },
        body: JSON.stringify({ company_id, purpose: 'cash_out', force_new: forceNewToken }),
      });

      if (!authResponse.ok) {
        const authErr = await authResponse.text();
        throw new Error(`Auth failed: ${authErr}`);
      }

      const authData = await authResponse.json();
      const accessToken = authData.access_token;

      const onzHeaders: Record<string, string> = {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'Authorization': `Bearer ${accessToken}`,
        'x-idempotency-key': idempotencyKey,
      };
      if (config.provider_company_id) {
        onzHeaders['X-Company-ID'] = config.provider_company_id;
      }

      // Serialize payload ONCE here — proxy will forward body_raw as-is (no re-stringify)
      const rawBody = JSON.stringify(payload);
      console.log('[pix-pay-qrc] Raw body to proxy (first 500):', rawBody.substring(0, 500), 'forceNew:', forceNewToken);

      const proxyResponse = await fetch(`${proxyUrl}/proxy`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Proxy-API-Key': proxyApiKey },
        body: JSON.stringify({
          url: qrcPaymentUrl,
          method: 'POST',
          headers: onzHeaders,
          body_raw: rawBody,  // single serialization — proxy sends this directly
        }),
      });

      const proxyData = await proxyResponse.json();
      return { proxyResponse, proxyData };
    };

    // payment object is ALWAYS required per ONZ/Voluti API docs
    const paymentObj = { currency: 'BRL', amount: formattedAmount };

    // Attempt 1: Full EMV BRCode string + payment
    const payloadEmv = {
      qrCode: qr_code,
      description: descricao || 'Pagamento via QR Code',
      paymentFlow: 'INSTANT',
      payment: paymentObj,
    };

    console.log('[pix-pay-qrc] Attempt 1: EMV string + payment, amount:', formattedAmount);
    let { proxyResponse, proxyData } = await callOnzQrc(false, payloadEmv);

    // Retry with fresh token on 401
    let firstResult = proxyData.data || proxyData;
    if (proxyResponse.status === 401 || firstResult?.type === 'onz-0018') {
      console.log('[pix-pay-qrc] Token rejected, retrying with fresh token...');
      ({ proxyResponse, proxyData } = await callOnzQrc(true, payloadEmv));
      firstResult = proxyData.data || proxyData;
    }

    console.log('[pix-pay-qrc] Attempt 1 response:', proxyResponse.status, JSON.stringify(proxyData));

    // If attempt 1 failed with Invalid QrCode, try with payload URL instead of EMV string
    const payloadUrl = qrcInfo.payload_url;
    if (!proxyResponse.ok && (firstResult?.type === 'onz-0010' || firstResult?.title === 'Invalid QrCode') && payloadUrl) {
      console.log('[pix-pay-qrc] Attempt 2: payload URL as qrCode:', payloadUrl);

      // Use a NEW idempotency key for a different payload
      const idempotencyKey2 = `cashout-${crypto.randomUUID()}`;
      const callOnzQrc2 = async (forceNewToken: boolean, payload: Record<string, unknown>) => {
        const authResponse = await fetch(`${Deno.env.get('SUPABASE_URL')}/functions/v1/pix-auth`, {
          method: 'POST',
          headers: { 'Authorization': authHeader, 'Content-Type': 'application/json' },
          body: JSON.stringify({ company_id, purpose: 'cash_out', force_new: forceNewToken }),
        });
        if (!authResponse.ok) throw new Error(`Auth failed: ${await authResponse.text()}`);
        const authData = await authResponse.json();
        const onzHeaders2: Record<string, string> = {
          'Content-Type': 'application/json',
          'Accept': 'application/json',
          'Authorization': `Bearer ${authData.access_token}`,
          'x-idempotency-key': idempotencyKey2,
        };
        if (config.provider_company_id) onzHeaders2['X-Company-ID'] = config.provider_company_id;
        const rawBody = JSON.stringify(payload);
        console.log('[pix-pay-qrc] Raw body attempt 2 (first 500):', rawBody.substring(0, 500));
        const resp = await fetch(`${proxyUrl}/proxy`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-Proxy-API-Key': proxyApiKey },
          body: JSON.stringify({ url: qrcPaymentUrl, method: 'POST', headers: onzHeaders2, body_raw: rawBody }),
        });
        return { proxyResponse: resp, proxyData: await resp.json() };
      };

      const payloadWithUrl = {
        qrCode: payloadUrl,
        description: descricao || 'Pagamento via QR Code',
        paymentFlow: 'INSTANT',
        payment: paymentObj,
      };

      ({ proxyResponse, proxyData } = await callOnzQrc2(false, payloadWithUrl));

      const secondResult = proxyData.data || proxyData;
      if (proxyResponse.status === 401 || secondResult?.type === 'onz-0018') {
        ({ proxyResponse, proxyData } = await callOnzQrc2(true, payloadWithUrl));
      }

      console.log('[pix-pay-qrc] Attempt 2 response:', proxyResponse.status, JSON.stringify(proxyData));
    }

    const onzResult = proxyData.data || proxyData;

    // If ONZ still rejects, fallback to pix-pay-dict using extracted key
    if (!proxyResponse.ok && proxyResponse.status !== 202) {
      const isInvalidQr = onzResult?.type === 'onz-0010' || onzResult?.title === 'Invalid QrCode';

      if (isInvalidQr && destKey) {
        console.log('[pix-pay-qrc] ONZ rejected QR format after both attempts, falling back to pix-pay-dict with key:', destKey);

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
          const supabaseAdmin2 = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
          await supabaseAdmin2.from('transactions').update({ pix_type: 'qrcode', pix_copia_cola: qr_code }).eq('id', dictResult.transaction_id);
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
            details: onzResult,
            hint: 'Não foi possível extrair chave Pix para fallback. Gere um novo QR Code na maquininha e tente novamente.'
          }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      return new Response(
        JSON.stringify({ error: 'Falha no pagamento via QR Code', details: onzResult }),
        { status: proxyResponse.status >= 400 ? proxyResponse.status : 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Create transaction record
    const supabaseAdmin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

    const { data: transaction, error: txError } = await supabaseAdmin.from('transactions').insert({
      company_id,
      created_by: userId,
      amount: paymentAmount,
      description: descricao || 'Pagamento via QR Code dinâmico',
      pix_type: 'qrcode',
      pix_copia_cola: qr_code,
      pix_txid: qrcInfo.txid || null,
      pix_e2eid: onzResult.endToEndId || null,
      external_id: String(onzResult.id || ''),
      beneficiary_name: qrcInfo.merchant_name || null,
      status: 'completed',
      paid_at: new Date().toISOString(),
      pix_provider_response: onzResult,
    }).select('id').single();

    if (txError) {
      console.error('[pix-pay-qrc] Transaction insert error:', txError);
    }

    return new Response(
      JSON.stringify({
        success: true,
        transaction_id: transaction?.id || null,
        end_to_end_id: onzResult.endToEndId || null,
        amount: paymentAmount,
        qr_info: qrcInfo,
        provider_response: onzResult,
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
