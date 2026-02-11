import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface ONZPaymentDetails {
  data: {
    id: number;
    idempotencyKey: string;
    endToEndId: string;
    pixKey?: string;
    transactionType: string;
    status: 'CANCELED' | 'PROCESSING' | 'LIQUIDATED' | 'REFUNDED' | 'PARTIALLY_REFUNDED';
    errorCode?: string;
    creditDebitType: 'CREDIT' | 'DEBIT';
    localInstrument: string;
    createdAt: string;
    creditorAccount?: any;
    debtorAccount?: any;
    remittanceInformation?: string;
    txId?: string;
    payment: {
      currency: string;
      amount: number;
    };
    refunds?: any[];
  };
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

    // Parse URL for query params or get from body
    const url = new URL(req.url);
    let end_to_end_id = url.searchParams.get('end_to_end_id');
    let idempotency_key = url.searchParams.get('idempotency_key');
    let transaction_id = url.searchParams.get('transaction_id');
    let company_id = url.searchParams.get('company_id');

    // Also check body for POST requests
    if (req.method === 'POST') {
      const body = await req.json();
      end_to_end_id = end_to_end_id || body.end_to_end_id;
      idempotency_key = idempotency_key || body.idempotency_key;
      transaction_id = transaction_id || body.transaction_id;
      company_id = company_id || body.company_id;
    }

    // Get transaction from database if transaction_id provided
    if (transaction_id && !company_id) {
      const { data: txData } = await supabase
        .from('transactions')
        .select('company_id, pix_e2eid, external_id')
        .eq('id', transaction_id)
        .single();

      if (txData) {
        company_id = txData.company_id;
        end_to_end_id = end_to_end_id || txData.pix_e2eid;
      }
    }

    if (!company_id || (!end_to_end_id && !idempotency_key)) {
      return new Response(
        JSON.stringify({ error: 'company_id and (end_to_end_id or idempotency_key) are required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log(`[pix-check-status] Checking status for company: ${company_id}, e2eid: ${end_to_end_id}`);

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
      return new Response(
        JSON.stringify({ error: 'Failed to authenticate with Pix provider' }),
        { status: 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const { access_token } = await authResponse.json();

    // Build the status URL
    let statusUrl: string;
    if (end_to_end_id) {
      statusUrl = `${config.base_url}/pix/payments/${end_to_end_id}`;
    } else if (idempotency_key) {
      statusUrl = `${config.base_url}/pix/payments/idempotencyKey/${idempotency_key}`;
    } else {
      return new Response(
        JSON.stringify({ error: 'end_to_end_id or idempotency_key required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Create mTLS HTTP client
    let httpClient: Deno.HttpClient | undefined;
    if (config.certificate_encrypted && config.certificate_key_encrypted) {
      try {
        httpClient = Deno.createHttpClient({
          cert: atob(config.certificate_encrypted),
          key: atob(config.certificate_key_encrypted),
        });
      } catch (e) {
        console.error('[pix-check-status] Failed to create mTLS client:', e);
      }
    }

    // Query status from ONZ
    const fetchOptions: any = {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${access_token}`,
        'Content-Type': 'application/json',
      },
    };
    if (httpClient) fetchOptions.client = httpClient;

    const statusResponse = await fetch(statusUrl, fetchOptions);
    httpClient?.close();

    if (!statusResponse.ok) {
      const errorText = await statusResponse.text();
      console.error('[pix-check-status] Provider error:', errorText);
      return new Response(
        JSON.stringify({ 
          error: 'Failed to get payment status',
          provider_error: errorText,
          status: statusResponse.status
        }),
        { status: 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const statusData: ONZPaymentDetails = await statusResponse.json();
    console.log('[pix-check-status] Status received:', JSON.stringify(statusData));

    const paymentData = statusData.data;

    // Map ONZ status to our internal status
    const statusMap: Record<string, string> = {
      'PROCESSING': 'pending',
      'LIQUIDATED': 'completed',
      'CANCELED': 'cancelled',
      'REFUNDED': 'refunded',
      'PARTIALLY_REFUNDED': 'partially_refunded'
    };

    const internalStatus = statusMap[paymentData.status] || 'pending';
    const isLiquidated = paymentData.status === 'LIQUIDATED';

    // Update transaction in database if status changed
    if (transaction_id) {
      const supabaseAdmin = createClient(
        Deno.env.get('SUPABASE_URL')!,
        Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
      );

      const updateData: any = {
        status: internalStatus,
        pix_provider_response: statusData,
      };

      if (isLiquidated) {
        updateData.paid_at = new Date().toISOString();
      }

      await supabaseAdmin
        .from('transactions')
        .update(updateData)
        .eq('id', transaction_id);
    }

    return new Response(
      JSON.stringify({
        success: true,
        end_to_end_id: paymentData.endToEndId,
        provider_id: paymentData.id,
        status: paymentData.status,
        internal_status: internalStatus,
        is_liquidated: isLiquidated,
        error_code: paymentData.errorCode,
        amount: paymentData.payment?.amount,
        currency: paymentData.payment?.currency,
        created_at: paymentData.createdAt,
        creditor: paymentData.creditorAccount,
        debtor: paymentData.debtorAccount,
        refunds: paymentData.refunds,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('[pix-check-status] Error:', error);
    return new Response(
      JSON.stringify({ error: 'Internal server error', details: error.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
