import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

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

    // Get Pix config
    const { data: config, error: configError } = await supabase
      .from('pix_configs')
      .select('*')
      .eq('company_id', company_id)
      .eq('is_active', true)
      .single();

    if (configError || !config) {
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
      body: JSON.stringify({ company_id }),
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
      // Woovi Pix Out via subaccount withdraw
      const payUrl = `${config.base_url}/api/v1/subaccount/withdraw`;
      const wooviPayload = {
        value: Math.round(valor * 100), // centavos
        pixKey: pix_key,
        comment: descricao || 'Pagamento Pix',
        correlationID: externalId,
      };

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
        console.error('[pix-pay-dict] Woovi error:', errorText);
        return new Response(
          JSON.stringify({ error: 'Failed to initiate Pix payment', provider_error: errorText }),
          { status: 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      paymentData = await payResponse.json();
    }
    // ========== ONZ ==========
    else if (provider === 'onz') {
      externalId = generateIdEnvio();
      const payUrl = `${config.base_url}/pix/payments/dict`;
      const onzPayload = {
        valor: valor.toFixed(2),
        chaveDestinatario: pix_key,
        descricao: descricao || 'Pagamento Pix',
        idExterno: externalId,
      };

      const payResponse = await fetch(payUrl, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${access_token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(onzPayload),
      });

      if (!payResponse.ok) {
        const errorText = await payResponse.text();
        console.error('[pix-pay-dict] ONZ error:', errorText);
        return new Response(
          JSON.stringify({ error: 'Failed to initiate Pix payment', provider_error: errorText }),
          { status: 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      paymentData = await payResponse.json();
    }
    // ========== TRANSFEERA ==========
    else if (provider === 'transfeera') {
      externalId = generateIdEnvio();

      // Auto-detect pix_key_type for Transfeera (CPF, CNPJ, EMAIL, PHONE, EVP)
      function detectPixKeyType(key: string): string {
        const cleaned = key.replace(/[.\-\/\s\(\)]/g, '');
        if (/^[0-9]{11}$/.test(cleaned)) return 'CPF';
        if (/^[0-9]{14}$/.test(cleaned)) return 'CNPJ';
        if (/^.+@.+\..+$/.test(key)) return 'EMAIL';
        if (/^\+?[0-9]{10,13}$/.test(cleaned)) return 'PHONE';
        // UUID format = EVP (random key)
        if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(key)) return 'CHAVE_ALEATORIA';
        return 'CHAVE_ALEATORIA';
      }

      const detectedKeyType = detectPixKeyType(pix_key);
      console.log(`[pix-pay-dict] Transfeera detected key type: ${detectedKeyType} for key: ${pix_key}`);

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

      console.log('[pix-pay-dict] Transfeera payload:', JSON.stringify(transfeeraPayload));

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
          const certPem = atob(config.certificate_encrypted);
          const keyPem = config.certificate_key_encrypted ? atob(config.certificate_key_encrypted) : certPem;
          httpClient = Deno.createHttpClient({ cert: certPem, key: keyPem });
        } catch (e) {
          console.error('[pix-pay-dict] Failed to create mTLS client:', e);
        }
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
