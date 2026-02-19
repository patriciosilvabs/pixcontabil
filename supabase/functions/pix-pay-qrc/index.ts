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

function generateCorrelationID(): string {
  return crypto.randomUUID();
}

function detectKeyType(key: string): string {
  if (/^\d{11}$/.test(key.replace(/\D/g, '')) && key.replace(/\D/g, '').length === 11) return 'CPF';
  if (/^\d{14}$/.test(key.replace(/\D/g, '')) && key.replace(/\D/g, '').length === 14) return 'CNPJ';
  if (key.includes('@')) return 'EMAIL';
  if (/^\+?\d{10,13}$/.test(key.replace(/\D/g, ''))) return 'PHONE';
  return 'RANDOM';
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

    const provider = config.provider;

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
        JSON.stringify({ error: `Valor inválido: R$ ${paymentAmount.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}. O valor deve estar entre R$ 0,01 e R$ ${MAX_PAYMENT_VALUE.toLocaleString('pt-BR')}.` }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }
    const qrType = qrcInfo.type; // "dynamic" or "static"
    const destKey = qrcInfo.pix_key;

    // ===== STATIC QR CODE: delegate to pix-pay-dict (works correctly) =====
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
        body: JSON.stringify({
          company_id,
          pix_key: destKey,
          valor: paymentAmount,
          descricao: descricao || 'Pagamento via QR Code',
        }),
      });

      const payResult = await payResponse.json();

      if (!payResponse.ok) {
        return new Response(
          JSON.stringify(payResult),
          { status: payResponse.status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      // Update transaction to mark as QR code type
      if (payResult.transaction_id) {
        const supabaseAdmin = createClient(
          Deno.env.get('SUPABASE_URL')!,
          Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
        );
        await supabaseAdmin.from('transactions').update({
          pix_type: 'qrcode',
          pix_copia_cola: qr_code,
        }).eq('id', payResult.transaction_id);
      }

      return new Response(
        JSON.stringify({ ...payResult, amount: paymentAmount, qr_info: qrcInfo }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // ===== DYNAMIC QR CODE: pay natively with full EMV =====
    console.log('[pix-pay-qrc] Dynamic QR - paying natively with EMV');

    // Get auth token
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

    let paymentData: any;
    let externalId: string;

    // ========== WOOVI - Dynamic QR ==========
    if (provider === 'woovi') {
      externalId = generateCorrelationID();

      const decodeUrl = `${config.base_url}/api/v1/decode/emv`;
      console.log('[pix-pay-qrc] Woovi: decoding EMV via /api/v1/decode/emv');

      const decodeResponse = await fetch(decodeUrl, {
        method: 'POST',
        headers: { 'Authorization': access_token, 'Content-Type': 'application/json' },
        body: JSON.stringify({ emv: qr_code }),
      });

      let wooviDecoded: any = null;
      if (decodeResponse.ok) {
        wooviDecoded = await decodeResponse.json();
        console.log('[pix-pay-qrc] Woovi decode result:', JSON.stringify(wooviDecoded));
      } else {
        const decodeErr = await decodeResponse.text();
        console.warn('[pix-pay-qrc] Woovi decode failed:', decodeErr);
      }

      const payUrl = `${config.base_url}/api/v1/payment`;
      
      let wooviPayload: any = {
        type: 'QR_CODE',
        qrCode: qr_code,
        value: Math.round(paymentAmount * 100),
        comment: descricao || 'Pagamento via QR Code',
        correlationID: externalId,
      };

      let payResponse = await fetch(payUrl, {
        method: 'POST',
        headers: { 'Authorization': access_token, 'Content-Type': 'application/json' },
        body: JSON.stringify(wooviPayload),
      });

      if (!payResponse.ok) {
        const qrErr = await payResponse.text();
        console.warn('[pix-pay-qrc] Woovi QR_CODE failed:', qrErr, '- trying BRCODE');

        wooviPayload = {
          type: 'BRCODE', brcode: qr_code,
          value: Math.round(paymentAmount * 100),
          comment: descricao || 'Pagamento via QR Code',
          correlationID: externalId + '-b',
        };
        payResponse = await fetch(payUrl, {
          method: 'POST',
          headers: { 'Authorization': access_token, 'Content-Type': 'application/json' },
          body: JSON.stringify(wooviPayload),
        });
      }

      if (!payResponse.ok) {
        const brcodeErr = await payResponse.text();
        console.warn('[pix-pay-qrc] Woovi BRCODE failed:', brcodeErr, '- falling back to PIX_KEY');

        const payKey = wooviDecoded?.pixKey?.pixKey || wooviDecoded?.chave || destKey;
        const payKeyType = wooviDecoded?.pixKey?.type || detectKeyType(payKey || '');

        if (!payKey) {
          return new Response(
            JSON.stringify({ error: 'Não foi possível pagar este QR Code dinâmico via Woovi.', unsupported_cobv: true }),
            { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }

        externalId = generateCorrelationID();
        wooviPayload = {
          type: 'PIX_KEY', destinationAlias: payKey, destinationAliasType: payKeyType,
          value: Math.round(paymentAmount * 100),
          comment: descricao || 'Pagamento via QR Code',
          correlationID: externalId,
        };
        payResponse = await fetch(payUrl, {
          method: 'POST',
          headers: { 'Authorization': access_token, 'Content-Type': 'application/json' },
          body: JSON.stringify(wooviPayload),
        });

        if (!payResponse.ok) {
          const errorText = await payResponse.text();
          return new Response(
            JSON.stringify({ error: 'Failed to initiate QR Code payment', provider_error: errorText }),
            { status: 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }
      }

      paymentData = await payResponse.json();

      const finalCorrelationID = paymentData.payment?.correlationID || externalId;
      const approveResponse = await fetch(`${config.base_url}/api/v1/payment/approve`, {
        method: 'POST',
        headers: { 'Authorization': access_token, 'Content-Type': 'application/json' },
        body: JSON.stringify({ correlationID: finalCorrelationID }),
      });

      if (approveResponse.ok) {
        const approveData = await approveResponse.json();
        paymentData = { ...paymentData, ...approveData };
      }
    }
    // ========== PAGGUE - Dynamic QR (Brcode cash-out type=2) ==========
    else if (provider === 'paggue') {
      externalId = generateCorrelationID();

      // Get Paggue company ID
      const authJson = await (await fetch(`${Deno.env.get('SUPABASE_URL')}/functions/v1/pix-auth`, {
        method: 'POST',
        headers: { 'Authorization': authHeader, 'Content-Type': 'application/json' },
        body: JSON.stringify({ company_id }),
      })).json();
      
      const paggueCompanyId = authJson.provider_company_id || config.provider_company_id;
      
      if (!paggueCompanyId) {
        return new Response(
          JSON.stringify({ error: 'Paggue Company ID não configurado.' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      // Paggue cash-out type=2 (Brcode) - sends EMV in pix_key field
      // This SETTLES the original COBV charge, so the terminal will confirm payment
      const payUrl = 'https://ms.paggue.io/cashout/api/integration/cash-out';
      const pagguePayload = {
        amount: Math.round(paymentAmount * 100), // centavos
        type: 2, // Brcode
        pix_key: qr_code, // EMV string goes here
        description: descricao || 'Pagamento via QR Code',
        external_id: externalId,
      };

      const bodyStr = JSON.stringify(pagguePayload);
      console.log('[pix-pay-qrc] Paggue Brcode payload (type=2)');

      // Generate HMAC-SHA256 signature using webhook_secret (Paggue's private signing token)
      const signingSecret = config.webhook_secret;
      if (!signingSecret) {
        return new Response(
          JSON.stringify({ error: 'Token de assinatura Paggue não configurado. Configure o webhook_secret nas configurações Pix.' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
      const encoder = new TextEncoder();
      const sigKey = await crypto.subtle.importKey(
        'raw',
        encoder.encode(signingSecret),
        { name: 'HMAC', hash: 'SHA-256' },
        false,
        ['sign']
      );
      const sigBuf = await crypto.subtle.sign('HMAC', sigKey, encoder.encode(bodyStr));
      const signature = Array.from(new Uint8Array(sigBuf)).map(b => b.toString(16).padStart(2, '0')).join('');

      const payResponse = await fetch(payUrl, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${access_token}`,
          'Content-Type': 'application/json',
          'X-Company-ID': paggueCompanyId,
          'Signature': signature,
        },
        body: bodyStr,
      });

      if (!payResponse.ok) {
        const errorText = await payResponse.text();
        console.error('[pix-pay-qrc] Paggue Brcode error:', errorText);
        return new Response(
          JSON.stringify({ error: 'Falha ao pagar QR Code via Paggue', provider_error: errorText }),
          { status: 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      paymentData = await payResponse.json();
      console.log('[pix-pay-qrc] Paggue payment created:', JSON.stringify(paymentData));
    }
    // ========== ONZ - Dynamic QR (via proxy) ==========
    else if (provider === 'onz') {
      externalId = generateIdEnvio();
      const payUrl = `${config.base_url}/pix/payments/qrcode`;

      const proxyUrl = Deno.env.get('ONZ_PROXY_URL');
      const proxyApiKey = Deno.env.get('ONZ_PROXY_API_KEY');

      if (!proxyUrl || !proxyApiKey) {
        return new Response(
          JSON.stringify({ error: 'ONZ proxy not configured' }),
          { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      const onzPayload = {
        valor: paymentAmount.toFixed(2),
        qrCode: qr_code,
        descricao: descricao || 'Pagamento via QR Code',
        idExterno: externalId,
      };

      const proxyResponse = await fetch(`https://${proxyUrl.replace(/^https?:\/\//, '').replace(/\/+$/, '')}/proxy`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-proxy-api-key': proxyApiKey },
        body: JSON.stringify({
          url: payUrl, method: 'POST',
          headers: { 'Authorization': `Bearer ${access_token}`, 'Content-Type': 'application/json' },
          body: onzPayload,
        }),
      });

      if (!proxyResponse.ok) {
        const errorText = await proxyResponse.text();
        return new Response(
          JSON.stringify({ error: 'Failed to initiate QR Code payment', provider_error: errorText }),
          { status: 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      const proxyResult = await proxyResponse.json();
      if (proxyResult.status !== 200 && proxyResult.status !== 201) {
        return new Response(
          JSON.stringify({ error: 'ONZ QR payment failed', provider_error: proxyResult.data }),
          { status: 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      paymentData = proxyResult.data;
    }
    // ========== TRANSFEERA - Dynamic QR ==========
    else if (provider === 'transfeera') {
      externalId = generateIdEnvio();
      const payUrl = `${config.base_url}/pix/qrcode/pay`;
      const transfeeraPayload = { emv: qr_code, value: paymentAmount, description: descricao || 'Pagamento via QR Code' };

      const payResponse = await fetch(payUrl, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${access_token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(transfeeraPayload),
      });

      if (!payResponse.ok) {
        const errorText = await payResponse.text();
        return new Response(
          JSON.stringify({ error: 'Failed to initiate QR Code payment', provider_error: errorText }),
          { status: 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      paymentData = await payResponse.json();
    }
    // ========== EFI - Dynamic QR ==========
    else if (provider === 'efi') {
      externalId = generateIdEnvio();

      let httpClient: Deno.HttpClient | undefined;
      if (config.certificate_encrypted) {
        try {
          const certPem = atob(config.certificate_encrypted);
          const keyPem = config.certificate_key_encrypted ? atob(config.certificate_key_encrypted) : certPem;
          httpClient = Deno.createHttpClient({ cert: certPem, key: keyPem });
        } catch (_) { /* ignore */ }
      }

      const payUrl = `${config.base_url}/v2/gn/pix/${externalId}`;
      const efiPayload = {
        valor: paymentAmount.toFixed(2),
        pagador: { chave: config.pix_key, infoPagador: descricao ? descricao.substring(0, 140) : 'Pagamento via QR Code' },
        favorecido: { chave: destKey || qrcInfo.pix_key },
        qrCode: qr_code,
      };

      const fetchOptions: any = {
        method: 'PUT',
        headers: { 'Authorization': `Bearer ${access_token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(efiPayload),
      };
      if (httpClient) fetchOptions.client = httpClient;

      const payResponse = await fetch(payUrl, fetchOptions);
      httpClient?.close();

      if (!payResponse.ok) {
        const errorText = await payResponse.text();
        return new Response(
          JSON.stringify({ error: 'Failed to initiate QR Code payment', provider_error: errorText }),
          { status: 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      paymentData = await payResponse.json();
    } else {
      return new Response(
        JSON.stringify({ error: `Provider '${provider}' não suportado` }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log('[pix-pay-qrc] Dynamic QR payment initiated:', JSON.stringify(paymentData));

    // Save transaction directly
    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );

    const e2eId = paymentData.e2eId || paymentData.endToEndId ||
      paymentData.transaction?.endToEndId || paymentData.correlationID || externalId!;

    const beneficiaryName = paymentData.transaction?.creditParty?.holder?.name ||
      paymentData.destination?.name || qrcInfo.merchant_name || null;
    const beneficiaryDoc = paymentData.transaction?.creditParty?.holder?.taxID?.taxID ||
      paymentData.destination?.taxID || null;

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
        external_id: externalId!,
        beneficiary_name: beneficiaryName,
        beneficiary_document: beneficiaryDoc,
        pix_provider_response: paymentData,
      })
      .select('id')
      .single();

    if (insertError) {
      console.error('[pix-pay-qrc] Failed to create transaction:', insertError);
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
      new_data: { provider, externalId: externalId!, e2eId, valor: paymentAmount, qr_type: 'dynamic', status: 'pending' },
    });

    return new Response(
      JSON.stringify({
        success: true,
        transaction_id: newTransaction.id,
        end_to_end_id: e2eId,
        id_envio: externalId!,
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
