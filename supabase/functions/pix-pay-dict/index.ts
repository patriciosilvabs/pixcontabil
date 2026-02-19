import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

function normalizePem(pem: string): string {
  const lines = pem.split('\n').map(l => l.trim()).filter(l => l.length > 0);
  const result: string[] = [];
  for (const line of lines) {
    if (line.startsWith('-----')) { result.push(line); }
    else { for (let i = 0; i < line.length; i += 64) result.push(line.substring(i, i + 64)); }
  }
  return result.join('\n') + '\n';
}
function decodeCert(raw: string): string {
  const trimmed = raw.trim();
  if (trimmed.startsWith('-----')) return normalizePem(trimmed);
  const cleanB64 = trimmed.replace(/[\s\r\n]/g, '');
  return normalizePem(atob(cleanB64));
}

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface PayDictRequest {
  company_id: string;
  pix_key: string;
  valor: number;
  descricao?: string;
}

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
    const body: PayDictRequest = await req.json();
    const { company_id, pix_key, valor, descricao } = body;

    if (!company_id || !pix_key || !valor) {
      return new Response(
        JSON.stringify({ error: 'company_id, pix_key and valor are required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const MAX_PAYMENT_VALUE = 1_000_000;
    if (valor <= 0 || valor > MAX_PAYMENT_VALUE) {
      return new Response(
        JSON.stringify({ error: `Valor inválido: R$ ${valor.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}. O valor deve estar entre R$ 0,01 e R$ ${MAX_PAYMENT_VALUE.toLocaleString('pt-BR')}.` }),
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
    console.log(`[pix-pay-dict] Provider: ${provider}, key: ${pix_key}, valor: ${valor}`);

    // Get auth token
    const authResponse = await fetch(`${Deno.env.get('SUPABASE_URL')}/functions/v1/pix-auth`, {
      method: 'POST',
      headers: { 'Authorization': authHeader, 'Content-Type': 'application/json' },
      body: JSON.stringify({ company_id, purpose: 'cash_out', scopes: 'pix.write pix.read' }),
    });

    if (!authResponse.ok) {
      const authErrorText = await authResponse.text();
      console.error('[pix-pay-dict] Auth failed:', authErrorText);
      return new Response(
        JSON.stringify({ error: 'Failed to authenticate with provider' }),
        { status: 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const { access_token } = await authResponse.json();

    let paymentData: any;
    let externalId: string;

    // ========== WOOVI ==========
    if (provider === 'woovi') {
      externalId = generateCorrelationID();

      // Auto-detect pix key type for Woovi
      function detectWooviKeyType(key: string): string {
        const cleaned = key.replace(/[.\-\/\s\(\)]/g, '');
        if (/^[0-9]{11}$/.test(cleaned)) return 'CPF';
        if (/^[0-9]{14}$/.test(cleaned)) return 'CNPJ';
        if (/^.+@.+\..+$/.test(key)) return 'EMAIL';
        if (/^\+?[0-9]{10,13}$/.test(cleaned)) return 'PHONE';
        if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(key)) return 'RANDOM';
        return 'RANDOM';
      }

      const keyType = detectWooviKeyType(pix_key);
      const payUrl = `${config.base_url}/api/v1/payment`;
      const wooviPayload = {
        type: 'PIX_KEY',
        value: Math.round(valor * 100), // centavos
        destinationAlias: pix_key,
        destinationAliasType: keyType,
        comment: descricao || 'Pagamento Pix',
        correlationID: externalId,
      };

      console.log('[pix-pay-dict] Woovi payload:', JSON.stringify(wooviPayload));

      const payResponse = await fetch(payUrl, {
        method: 'POST',
        headers: {
          'Authorization': access_token,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(wooviPayload),
      });

      if (!payResponse.ok) {
        const errorText = await payResponse.text();
        console.error('[pix-pay-dict] Woovi create payment error:', errorText);
        return new Response(
          JSON.stringify({ error: 'Failed to initiate Pix payment', provider_error: errorText }),
          { status: 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      paymentData = await payResponse.json();
      console.log('[pix-pay-dict] Woovi payment created:', JSON.stringify(paymentData));

      // Auto-approve the payment so it executes immediately
      const approveUrl = `${config.base_url}/api/v1/payment/approve`;
      const approveResponse = await fetch(approveUrl, {
        method: 'POST',
        headers: {
          'Authorization': access_token,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ correlationID: externalId }),
      });

      if (!approveResponse.ok) {
        const approveErrorText = await approveResponse.text();
        console.error('[pix-pay-dict] Woovi approve error:', approveErrorText);
      } else {
        const approveData = await approveResponse.json();
        console.log('[pix-pay-dict] Woovi payment approved:', JSON.stringify(approveData));
        paymentData = { ...paymentData, ...approveData };
      }
    }
    // ========== PAGGUE ==========
    else if (provider === 'paggue') {
      externalId = generateCorrelationID();

      // Get Paggue company ID from auth response or config
      const authJson = await (await fetch(`${Deno.env.get('SUPABASE_URL')}/functions/v1/pix-auth`, {
        method: 'POST',
        headers: { 'Authorization': authHeader, 'Content-Type': 'application/json' },
        body: JSON.stringify({ company_id }),
      })).json();
      
      const paggueCompanyId = authJson.provider_company_id || config.provider_company_id;
      
      if (!paggueCompanyId) {
        return new Response(
          JSON.stringify({ error: 'Paggue Company ID não configurado. Configure o X-Company-ID nas configurações Pix.' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      const payUrl = 'https://ms.paggue.io/cashout/api/integration/cash-out';
      const pagguePayload = {
        amount: Math.round(valor * 100), // centavos
        type: 1, // Pix key
        pix_key: pix_key,
        description: descricao || 'Pagamento Pix',
        external_id: externalId,
      };

      const bodyStr = JSON.stringify(pagguePayload);
      console.log('[pix-pay-dict] Paggue payload:', bodyStr);

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
        console.error('[pix-pay-dict] Paggue error:', errorText);
        return new Response(
          JSON.stringify({ error: 'Falha ao iniciar pagamento Pix via Paggue', provider_error: errorText }),
          { status: 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      paymentData = await payResponse.json();
      console.log('[pix-pay-dict] Paggue payment created:', JSON.stringify(paymentData));
    }
    // ========== ONZ (via proxy) ==========
    else if (provider === 'onz') {
      externalId = generateIdEnvio();
      const payUrl = `${config.base_url}/pix/payments/dict`;
      const onzPayload = {
        valor: valor.toFixed(2),
        chaveDestinatario: pix_key,
        descricao: descricao || 'Pagamento Pix',
        idExterno: externalId,
      };

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
          url: payUrl,
          method: 'POST',
          headers: { 'Authorization': `Bearer ${access_token}`, 'Content-Type': 'application/json' },
          body: onzPayload,
        }),
      });

      if (!proxyResponse.ok) {
        const errorText = await proxyResponse.text();
        console.error('[pix-pay-dict] ONZ proxy error:', errorText);
        return new Response(
          JSON.stringify({ error: 'Failed to initiate Pix payment', provider_error: errorText }),
          { status: 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      const proxyResult = await proxyResponse.json();
      if (proxyResult.status !== 200 && proxyResult.status !== 201) {
        return new Response(
          JSON.stringify({ error: 'ONZ payment failed', provider_error: proxyResult.data }),
          { status: 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      paymentData = proxyResult.data;
    }
    // ========== TRANSFEERA ==========
    else if (provider === 'transfeera') {
      externalId = generateIdEnvio();

      function detectPixKeyType(key: string): string {
        const cleaned = key.replace(/[.\-\/\s\(\)]/g, '');
        if (/^[0-9]{11}$/.test(cleaned)) return 'CPF';
        if (/^[0-9]{14}$/.test(cleaned)) return 'CNPJ';
        if (/^.+@.+\..+$/.test(key)) return 'EMAIL';
        if (/^\+?[0-9]{10,13}$/.test(cleaned)) return 'PHONE';
        if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(key)) return 'CHAVE_ALEATORIA';
        return 'CHAVE_ALEATORIA';
      }

      const detectedKeyType = detectPixKeyType(pix_key);
      const payUrl = `${config.base_url}/batch`;
      const transfeeraPayload = {
        name: `Pix ${new Date().toISOString()}`,
        type: 'TRANSFERENCIA',
        auto_close: true,
        transfers: [
          {
            value: valor,
            integration_id: externalId,
            destination_bank_account: {
              pix_key_type: detectedKeyType,
              pix_key: pix_key,
            },
            description: descricao || 'Pagamento Pix',
          },
        ],
      };

      const payResponse = await fetch(payUrl, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${access_token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(transfeeraPayload),
      });

      if (!payResponse.ok) {
        const errorText = await payResponse.text();
        console.error('[pix-pay-dict] Transfeera error:', errorText);
        return new Response(
          JSON.stringify({ error: 'Failed to initiate Pix payment', provider_error: errorText }),
          { status: 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      paymentData = await payResponse.json();
    }
    // ========== EFI ==========
    else if (provider === 'efi') {
      externalId = generateIdEnvio();

      let httpClient: Deno.HttpClient | undefined;
      if (config.certificate_encrypted) {
        try {
          const certPem = decodeCert(config.certificate_encrypted);
          const keyPem = config.certificate_key_encrypted ? decodeCert(config.certificate_key_encrypted) : certPem;
          httpClient = Deno.createHttpClient({ cert: certPem, key: keyPem });
        } catch (e) {
          console.error('[pix-pay-dict] Failed to create mTLS client:', e);
        }
      }

      if (!config.pix_key) {
        return new Response(
          JSON.stringify({ error: 'Chave Pix do pagador não configurada. Configure a chave Pix nas configurações do provedor EFI.' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      const paymentPayload = {
        valor: valor.toFixed(2),
        pagador: {
          chave: config.pix_key,
          infoPagador: descricao ? descricao.substring(0, 140) : 'Pagamento Pix',
        },
        favorecido: { chave: pix_key },
      };

      const paymentUrl = `${config.base_url}/v2/gn/pix/${externalId}`;
      const fetchOptions: any = {
        method: 'PUT',
        headers: {
          'Authorization': `Bearer ${access_token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(paymentPayload),
      };
      if (httpClient) fetchOptions.client = httpClient;

      const paymentResponse = await fetch(paymentUrl, fetchOptions);
      httpClient?.close();

      if (!paymentResponse.ok) {
        const errorText = await paymentResponse.text();
        console.error('[pix-pay-dict] EFI error:', errorText);
        return new Response(
          JSON.stringify({ error: 'Failed to initiate Pix payment', provider_error: errorText }),
          { status: 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      paymentData = await paymentResponse.json();
    }
    // ========== BANCO INTER ==========
    else if (provider === 'inter') {
      externalId = crypto.randomUUID();

      let httpClient: Deno.HttpClient | undefined;
      if (config.certificate_encrypted) {
        try {
          const certPem = decodeCert(config.certificate_encrypted);
          const keyPem = config.certificate_key_encrypted ? decodeCert(config.certificate_key_encrypted) : certPem;
          httpClient = Deno.createHttpClient({ cert: certPem, key: keyPem });
        } catch (e) {
          console.error('[pix-pay-dict] Failed to create mTLS client:', e);
        }
      }

      const interPayload = {
        valor: valor,
        descricao: descricao ? descricao.substring(0, 140) : 'Pagamento Pix',
        destinatario: {
          tipo: 'CHAVE',
          chave: pix_key,
        },
      };

      const paymentUrl = `${config.base_url}/banking/v2/pix`;
      const fetchHeaders: any = {
        'Authorization': `Bearer ${access_token}`,
        'Content-Type': 'application/json',
        'x-id-idempotente': externalId,
      };
      if (config.provider_company_id) {
        fetchHeaders['x-conta-corrente'] = config.provider_company_id;
      }

      const fetchOptions: any = {
        method: 'POST',
        headers: fetchHeaders,
        body: JSON.stringify(interPayload),
      };
      if (httpClient) fetchOptions.client = httpClient;

      const paymentResponse = await fetch(paymentUrl, fetchOptions);
      httpClient?.close();

      if (!paymentResponse.ok) {
        const errorText = await paymentResponse.text();
        console.error('[pix-pay-dict] Inter error:', errorText);
        return new Response(
          JSON.stringify({ error: 'Failed to initiate Pix payment', provider_error: errorText }),
          { status: 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      paymentData = await paymentResponse.json();
      // Map Inter response fields
      if (paymentData.codigoSolicitacao) {
        paymentData.e2eId = paymentData.endToEnd || paymentData.codigoSolicitacao;
      }
    } else {
      return new Response(
        JSON.stringify({ error: `Provider '${provider}' não suportado` }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log('[pix-pay-dict] Payment initiated:', JSON.stringify(paymentData));

    // Save transaction
    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );

    const e2eId = paymentData.e2eId || paymentData.endToEndId || paymentData.correlationID || externalId!;

    const { data: newTransaction, error: insertError } = await supabaseAdmin
      .from('transactions')
      .insert({
        company_id,
        created_by: userId,
        amount: valor,
        status: 'pending',
        pix_type: 'key' as const,
        pix_key,
        description: descricao,
        pix_e2eid: e2eId,
        external_id: externalId!,
        pix_provider_response: paymentData,
      })
      .select('id')
      .single();

    if (insertError) {
      console.error('[pix-pay-dict] Failed to create transaction:', insertError);
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
      action: 'pix_payment_initiated',
      new_data: { provider, externalId: externalId!, e2eId, valor, pix_key, status: 'pending' },
    });

    return new Response(
      JSON.stringify({
        success: true,
        transaction_id: newTransaction.id,
        end_to_end_id: e2eId,
        id_envio: externalId!,
        status: paymentData.status || 'PROCESSING',
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('[pix-pay-dict] Error:', error);
    return new Response(
      JSON.stringify({ error: 'Internal server error', details: error.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
