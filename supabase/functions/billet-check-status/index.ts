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

    // Parse params from query string or body
    const url = new URL(req.url);
    let billet_id = url.searchParams.get('billet_id');
    let transaction_id = url.searchParams.get('transaction_id');
    let company_id = url.searchParams.get('company_id');

    if (req.method === 'POST') {
      const body = await req.json();
      billet_id = billet_id || body.billet_id;
      transaction_id = transaction_id || body.transaction_id;
      company_id = company_id || body.company_id;
    }

    // Resolve from transaction if needed
    if (transaction_id && (!billet_id || !company_id)) {
      const { data: txData } = await supabase
        .from('transactions')
        .select('company_id, external_id')
        .eq('id', transaction_id)
        .single();

      if (txData) {
        company_id = company_id || txData.company_id;
        billet_id = billet_id || txData.external_id;
      }
    }

    if (!company_id || !billet_id) {
      return new Response(
        JSON.stringify({ error: 'company_id and (billet_id or transaction_id) are required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log(`[billet-check-status] Checking billet ${billet_id} for company ${company_id}`);

    // Get config
    const { data: config, error: configError } = await supabase
      .from('pix_configs')
      .select('*')
      .eq('company_id', company_id)
      .eq('is_active', true)
      .single();

    if (configError || !config) {
      return new Response(
        JSON.stringify({ error: 'API configuration not found' }),
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
        JSON.stringify({ error: 'Failed to authenticate with provider' }),
        { status: 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const { access_token } = await authResponse.json();

    // Query ONZ
    const statusUrl = `${config.base_url}/billets/${billet_id}`;
    const statusResponse = await fetch(statusUrl, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${access_token}`,
        'Content-Type': 'application/json',
      },
    });

    if (!statusResponse.ok) {
      const errorText = await statusResponse.text();
      console.error('[billet-check-status] Provider error:', errorText);
      return new Response(
        JSON.stringify({
          error: 'Failed to get billet status',
          provider_error: errorText,
          status: statusResponse.status,
        }),
        { status: 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const billetData = await statusResponse.json();
    console.log('[billet-check-status] Status received:', JSON.stringify(billetData));

    const data = billetData.data || billetData;

    // Map status
    const statusMap: Record<string, string> = {
      'PROCESSING': 'pending',
      'LIQUIDATED': 'completed',
      'CANCELED': 'cancelled',
      'SETTLED': 'completed',
      'FAILED': 'failed',
    };

    const internalStatus = statusMap[data.status] || 'pending';
    const isCompleted = ['LIQUIDATED', 'SETTLED'].includes(data.status);

    // Update transaction in DB
    if (transaction_id) {
      const supabaseAdmin = createClient(
        Deno.env.get('SUPABASE_URL')!,
        Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
      );

      const updateData: any = {
        status: internalStatus,
        pix_provider_response: billetData,
      };

      if (isCompleted) {
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
        billet_id: data.id,
        status: data.status,
        internal_status: internalStatus,
        is_completed: isCompleted,
        amount: data.payment?.amount,
        due_date: data.dueDate,
        settle_date: data.settleDate,
        bar_code: data.barCode,
        creditor: data.creditor,
        debtor: data.debtor,
        error_code: data.errorCode,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('[billet-check-status] Error:', error);
    return new Response(
      JSON.stringify({ error: 'Internal server error', details: error.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
