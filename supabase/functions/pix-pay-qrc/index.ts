import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface PayQrcRequest {
  company_id: string;
  qr_code: string; // Pix copia e cola
  valor?: number; // Optional, can override QR code value
  descricao?: string;
  creditor_document?: string;
  priority?: 'HIGH' | 'NORM';
  payment_flow?: 'INSTANT' | 'APPROVAL_REQUIRED';
  expiration?: number; // seconds, default 600
}

interface ONZPaymentResponse {
  endToEndId: string;
  eventDate: string;
  id: number;
  payment: {
    currency: string;
    amount: number;
  };
  type: string;
}

// Generate idempotency key
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
    // Authenticate user
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

    // Get request body
    const body: PayQrcRequest = await req.json();
    const { 
      company_id, 
      qr_code, 
      valor,
      descricao, 
      creditor_document,
      priority = 'NORM',
      payment_flow = 'INSTANT',
      expiration = 600 
    } = body;

    if (!company_id || !qr_code) {
      return new Response(
        JSON.stringify({ error: 'company_id and qr_code are required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log(`[pix-pay-qrc] Initiating payment via QR Code for company: ${company_id}`);

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

    // Get auth token
    const authResponse = await fetch(`${Deno.env.get('SUPABASE_URL')}/functions/v1/pix-auth`, {
      method: 'POST',
      headers: {
        'Authorization': authHeader,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ company_id }),
    });

    if (!authResponse.ok) {
      const authErrorText = await authResponse.text();
      console.error('[pix-pay-qrc] Auth failed:', authErrorText);
      return new Response(
        JSON.stringify({ error: 'Failed to authenticate with Pix provider' }),
        { status: 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const { access_token } = await authResponse.json();

    // Generate idempotency key
    const idempotencyKey = generateIdempotencyKey();
    console.log(`[pix-pay-qrc] Generated idempotency key: ${idempotencyKey}`);

    // Build ONZ payment payload
    const paymentPayload: any = {
      qrCode: qr_code,
      priority: priority,
      paymentFlow: payment_flow,
      expiration: expiration,
      payment: {
        currency: 'BRL',
        amount: valor || 0
      }
    };

    if (descricao) {
      paymentPayload.description = descricao.substring(0, 140);
    }

    if (creditor_document) {
      paymentPayload.creditorDocument = creditor_document.replace(/\D/g, '');
    }

    console.log('[pix-pay-qrc] Sending to ONZ:', JSON.stringify({ ...paymentPayload, qrCode: '***' }));

    // Create mTLS HTTP client
    let httpClient: Deno.HttpClient | undefined;
    if (config.certificate_encrypted && config.certificate_key_encrypted) {
      try {
        httpClient = Deno.createHttpClient({
          cert: atob(config.certificate_encrypted),
          key: atob(config.certificate_key_encrypted),
        });
      } catch (e) {
        console.error('[pix-pay-qrc] Failed to create mTLS client:', e);
      }
    }

    // Make payment request to ONZ
    const paymentUrl = `${config.base_url}/pix/payments/qrc`;
    const fetchOptions: any = {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${access_token}`,
        'Content-Type': 'application/json',
        'x-idempotency-key': idempotencyKey,
      },
      body: JSON.stringify(paymentPayload),
    };
    if (httpClient) fetchOptions.client = httpClient;

    const paymentResponse = await fetch(paymentUrl, fetchOptions);
    httpClient?.close();

    if (!paymentResponse.ok) {
      const errorText = await paymentResponse.text();
      console.error('[pix-pay-qrc] Provider error:', errorText);
      return new Response(
        JSON.stringify({ 
          error: 'Failed to initiate Pix payment',
          provider_error: errorText,
          status: paymentResponse.status
        }),
        { status: 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const paymentData: ONZPaymentResponse = await paymentResponse.json();
    console.log('[pix-pay-qrc] Payment initiated:', JSON.stringify(paymentData));

    // Save transaction in database using service role
    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );

    const transactionData = {
      company_id,
      created_by: userId,
      amount: paymentData.payment.amount,
      status: 'pending',
      pix_type: 'qrcode' as const,
      pix_copia_cola: qr_code,
      description: descricao,
      pix_e2eid: paymentData.endToEndId,
      external_id: paymentData.id.toString(),
      pix_provider_response: paymentData,
    };

    const { data: newTransaction, error: insertError } = await supabaseAdmin
      .from('transactions')
      .insert(transactionData)
      .select('id')
      .single();

    if (insertError) {
      console.error('[pix-pay-qrc] Failed to create transaction:', insertError);
      return new Response(
        JSON.stringify({ error: 'Failed to save transaction' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Log to audit
    await supabaseAdmin.from('audit_logs').insert({
      user_id: userId,
      company_id,
      entity_type: 'transaction',
      entity_id: newTransaction.id,
      action: 'pix_qrc_payment_initiated',
      new_data: { 
        endToEndId: paymentData.endToEndId, 
        valor: paymentData.payment.amount, 
        status: 'pending' 
      },
    });

    return new Response(
      JSON.stringify({
        success: true,
        transaction_id: newTransaction.id,
        end_to_end_id: paymentData.endToEndId,
        provider_id: paymentData.id,
        event_date: paymentData.eventDate,
        amount: paymentData.payment.amount,
        status: 'PROCESSING',
        idempotency_key: idempotencyKey,
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
