import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface BilletPayRequest {
  company_id: string;
  digitable_code: string;
  description: string;
  payment_flow?: 'INSTANT' | 'APPROVAL_REQUIRED';
  amount?: number;
}

interface ONZBilletResponse {
  id: number;
  status: string;
  digitableCode: string;
  barCode?: string;
  dueDate?: string;
  payment?: {
    currency: string;
    amount: number;
  };
  creditor?: {
    name?: string;
    document?: string;
  };
  debtor?: {
    name?: string;
    document?: string;
  };
}

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

    const body: BilletPayRequest = await req.json();
    const {
      company_id,
      digitable_code,
      description,
      payment_flow = 'INSTANT',
      amount,
    } = body;

    if (!company_id || !digitable_code || !description) {
      return new Response(
        JSON.stringify({ error: 'company_id, digitable_code and description are required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log(`[billet-pay] Initiating billet payment, code: ${digitable_code.substring(0, 10)}...`);

    // Get Pix config (same config for billets)
    const { data: config, error: configError } = await supabase
      .from('pix_configs')
      .select('*')
      .eq('company_id', company_id)
      .eq('is_active', true)
      .single();

    if (configError || !config) {
      return new Response(
        JSON.stringify({ error: 'API configuration not found for this company' }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Get auth token via pix-auth
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
      console.error('[billet-pay] Auth failed:', authErrorText);
      return new Response(
        JSON.stringify({ error: 'Failed to authenticate with provider' }),
        { status: 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const { access_token } = await authResponse.json();

    const idempotencyKey = generateIdempotencyKey();
    console.log(`[billet-pay] Idempotency key: ${idempotencyKey}`);

    // Build ONZ payload
    const billetPayload: any = {
      digitableCode: digitable_code.replace(/\D/g, ''),
      description: description.substring(0, 140),
      paymentFlow: payment_flow,
    };

    if (amount && amount > 0) {
      billetPayload.payment = {
        currency: 'BRL',
        amount,
      };
    }

    console.log('[billet-pay] Sending to ONZ:', JSON.stringify(billetPayload));

    const paymentUrl = `${config.base_url}/billets/payments`;
    const paymentResponse = await fetch(paymentUrl, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${access_token}`,
        'Content-Type': 'application/json',
        'x-idempotency-key': idempotencyKey,
      },
      body: JSON.stringify(billetPayload),
    });

    if (!paymentResponse.ok) {
      const errorText = await paymentResponse.text();
      console.error('[billet-pay] Provider error:', errorText);
      return new Response(
        JSON.stringify({
          error: 'Failed to initiate billet payment',
          provider_error: errorText,
          status: paymentResponse.status,
        }),
        { status: 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const billetData: ONZBilletResponse = await paymentResponse.json();
    console.log('[billet-pay] Payment initiated:', JSON.stringify(billetData));

    // Save transaction
    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );

    const finalAmount = billetData.payment?.amount || amount || 0;

    const transactionData = {
      company_id,
      created_by: userId,
      amount: finalAmount,
      status: 'pending' as const,
      pix_type: 'boleto' as const,
      boleto_code: digitable_code,
      description,
      external_id: billetData.id.toString(),
      beneficiary_name: billetData.creditor?.name,
      beneficiary_document: billetData.creditor?.document,
      pix_provider_response: billetData,
    };

    const { data: newTransaction, error: insertError } = await supabaseAdmin
      .from('transactions')
      .insert(transactionData)
      .select('id')
      .single();

    if (insertError) {
      console.error('[billet-pay] Failed to create transaction:', insertError);
      return new Response(
        JSON.stringify({ error: 'Failed to save transaction' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Audit log
    await supabaseAdmin.from('audit_logs').insert({
      user_id: userId,
      company_id,
      entity_type: 'transaction',
      entity_id: newTransaction.id,
      action: 'billet_payment_initiated',
      new_data: {
        billet_id: billetData.id,
        amount: finalAmount,
        digitable_code: digitable_code.substring(0, 10) + '...',
        status: 'pending',
      },
    });

    return new Response(
      JSON.stringify({
        success: true,
        transaction_id: newTransaction.id,
        billet_id: billetData.id,
        status: billetData.status || 'PROCESSING',
        amount: finalAmount,
        due_date: billetData.dueDate,
        creditor: billetData.creditor,
        idempotency_key: idempotencyKey,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('[billet-pay] Error:', error);
    return new Response(
      JSON.stringify({ error: 'Internal server error', details: error.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
