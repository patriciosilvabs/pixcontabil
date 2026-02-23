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

    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
      return new Response(
        JSON.stringify({ error: 'Invalid token' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const body = await req.json();
    const { company_id, billet_id, transaction_id } = body;

    let billetExternalId = billet_id;
    let companyId = company_id;

    // If transaction_id provided, get external_id from transaction
    if (transaction_id && (!billetExternalId || !companyId)) {
      const { data: txData } = await supabase
        .from('transactions')
        .select('company_id, external_id')
        .eq('id', transaction_id)
        .single();
      if (txData) {
        companyId = companyId || txData.company_id;
        billetExternalId = billetExternalId || txData.external_id;
      }
    }

    if (!companyId || !billetExternalId) {
      return new Response(
        JSON.stringify({ error: 'company_id and billet_id (or transaction_id) are required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Get config
    let config: any = null;
    for (const p of ['cash_out', 'both']) {
      const { data: c } = await supabase
        .from('pix_configs')
        .select('*')
        .eq('company_id', companyId)
        .eq('is_active', true)
        .eq('purpose', p)
        .single();
      if (c) { config = c; break; }
    }

    if (!config) {
      return new Response(
        JSON.stringify({ error: 'Pix configuration not found' }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Get auth token
    const authResponse = await fetch(`${Deno.env.get('SUPABASE_URL')}/functions/v1/pix-auth`, {
      method: 'POST',
      headers: { 'Authorization': authHeader, 'Content-Type': 'application/json' },
      body: JSON.stringify({ company_id: companyId, purpose: 'cash_out' }),
    });

    if (!authResponse.ok) {
      return new Response(
        JSON.stringify({ error: 'Failed to authenticate with provider' }),
        { status: 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const { access_token } = await authResponse.json();

    // ONZ billet status via proxy
    const statusUrl = `${config.base_url}/billets/${billetExternalId}`;
    const proxyUrl = Deno.env.get('ONZ_PROXY_URL');
    const proxyApiKey = Deno.env.get('ONZ_PROXY_API_KEY');
    if (!proxyUrl || !proxyApiKey) {
      return new Response(
        JSON.stringify({ error: 'ONZ_PROXY_URL não configurado' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const fetchHeaders: any = { 'Authorization': `Bearer ${access_token}` };
    if (config.provider_company_id) fetchHeaders['X-Company-ID'] = config.provider_company_id;

    let statusData: any;
    try {
      const proxyResponse = await fetch(`${proxyUrl}/proxy`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Proxy-API-Key': proxyApiKey },
        body: JSON.stringify({ url: statusUrl, method: 'GET', headers: fetchHeaders }),
      });
      const proxyData = await proxyResponse.json();
      statusData = proxyData.data || proxyData;
    } catch (e) {
      return new Response(
        JSON.stringify({ error: 'Falha na conexão com ONZ', details: e.message }),
        { status: 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log('[billet-check-status] Status received:', JSON.stringify(statusData));

    // Normalize status
    const rawStatus = String(statusData.status || '').toUpperCase().replace(/,/g, '');
    const statusMap: Record<string, string> = {
      'LIQUIDATED': 'completed',
      'PROCESSING': 'pending',
      'CANCELED': 'failed',
      'REFUNDED': 'refunded',
      'PARTIALLY_REFUNDED': 'refunded',
    };
    const internalStatus = statusMap[rawStatus] || 'pending';

    // Update transaction if transaction_id provided
    if (transaction_id) {
      const supabaseAdmin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
      const updateData: any = { status: internalStatus, pix_provider_response: statusData };
      if (internalStatus === 'completed') updateData.paid_at = new Date().toISOString();
      await supabaseAdmin.from('transactions').update(updateData).eq('id', transaction_id);
    }

    return new Response(
      JSON.stringify({
        success: true,
        billet_id: billetExternalId,
        status: statusData.status,
        internal_status: internalStatus,
        is_completed: internalStatus === 'completed',
        provider: 'onz',
        billetInfo: statusData.billetInfo || null,
        creditorAccount: statusData.creditorAccount || null,
        debtorAccount: statusData.debtorAccount || null,
        payment: statusData.payment || null,
        payload: statusData,
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
