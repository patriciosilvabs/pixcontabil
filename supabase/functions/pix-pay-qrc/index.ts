import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface PayQrcRequest {
  company_id: string;
  qr_code: string;
  valor?: number;
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

    const body: PayQrcRequest = await req.json();
    const { company_id, qr_code, valor, descricao } = body;

    if (!company_id || !qr_code) {
      return new Response(
        JSON.stringify({ error: 'company_id and qr_code are required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log(`[pix-pay-qrc] Initiating EFI QR Code payment for company: ${company_id}`);

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

    const authResponse = await fetch(`${Deno.env.get('SUPABASE_URL')}/functions/v1/pix-auth`, {
      method: 'POST',
      headers: { 'Authorization': authHeader, 'Content-Type': 'application/json' },
      body: JSON.stringify({ company_id }),
    });

    if (!authResponse.ok) {
      return new Response(
        JSON.stringify({ error: 'Failed to authenticate with EFI Pay' }),
        { status: 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const { access_token } = await authResponse.json();

    let httpClient: Deno.HttpClient | undefined;
    if (config.certificate_encrypted) {
      try {
        const certPem = atob(config.certificate_encrypted);
        const keyPem = config.certificate_key_encrypted ? atob(config.certificate_key_encrypted) : certPem;
        httpClient = Deno.createHttpClient({ cert: certPem, key: keyPem });
      } catch (e) {
        console.error('[pix-pay-qrc] Failed to create mTLS client:', e);
      }
    }

    // Step 1: Decode QR code to get pix key and amount
    const decodeUrl = `${config.base_url}/v2/gn/qrcode/decode`;
    const decodeFetchOptions: any = {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${access_token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ qrcode: qr_code }),
    };
    if (httpClient) decodeFetchOptions.client = httpClient;

    const decodeResponse = await fetch(decodeUrl, decodeFetchOptions);

    if (!decodeResponse.ok) {
      const errorText = await decodeResponse.text();
      httpClient?.close();
      console.error('[pix-pay-qrc] Failed to decode QR:', errorText);
      return new Response(
        JSON.stringify({ error: 'Failed to decode QR Code', provider_error: errorText }),
        { status: 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const qrcData = await decodeResponse.json();
    console.log('[pix-pay-qrc] QR decoded:', JSON.stringify(qrcData));

    // Step 2: Pay via PUT /v2/gn/pix/:idEnvio using decoded info
    const idEnvio = generateIdEnvio();
    const paymentAmount = valor || (qrcData.valor ? parseFloat(qrcData.valor) : 0);
    const destKey = qrcData.chave;

    if (!destKey) {
      httpClient?.close();
      return new Response(
        JSON.stringify({ error: 'Could not extract Pix key from QR Code' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const paymentPayload = {
      valor: paymentAmount.toFixed(2),
      pagador: {
        chave: config.pix_key,
        infoPagador: descricao || 'Pagamento via QR Code',
      },
      favorecido: {
        chave: destKey,
      },
    };

    const payUrl = `${config.base_url}/v2/gn/pix/${idEnvio}`;
    const payFetchOptions: any = {
      method: 'PUT',
      headers: {
        'Authorization': `Bearer ${access_token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(paymentPayload),
    };
    if (httpClient) payFetchOptions.client = httpClient;

    const paymentResponse = await fetch(payUrl, payFetchOptions);
    httpClient?.close();

    if (!paymentResponse.ok) {
      const errorText = await paymentResponse.text();
      console.error('[pix-pay-qrc] EFI payment error:', errorText);
      return new Response(
        JSON.stringify({ error: 'Failed to initiate Pix payment', provider_error: errorText }),
        { status: 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const paymentData = await paymentResponse.json();
    console.log('[pix-pay-qrc] Payment initiated:', JSON.stringify(paymentData));

    // Save transaction
    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );

    const { data: newTransaction, error: insertError } = await supabaseAdmin
      .from('transactions')
      .insert({
        company_id,
        created_by: userId,
        amount: paymentAmount,
        status: 'pending',
        pix_type: 'qrcode' as const,
        pix_copia_cola: qr_code,
        pix_key: destKey,
        description: descricao,
        pix_e2eid: paymentData.e2eId || paymentData.endToEndId || idEnvio,
        external_id: idEnvio,
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
      action: 'pix_qrc_payment_initiated',
      new_data: { idEnvio, e2eId: paymentData.e2eId, valor: paymentAmount, status: 'pending' },
    });

    return new Response(
      JSON.stringify({
        success: true,
        transaction_id: newTransaction.id,
        end_to_end_id: paymentData.e2eId || paymentData.endToEndId || idEnvio,
        id_envio: idEnvio,
        amount: paymentAmount,
        status: paymentData.status || 'PROCESSING',
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
