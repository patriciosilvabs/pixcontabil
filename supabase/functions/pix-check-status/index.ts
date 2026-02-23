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

    const url = new URL(req.url);
    let end_to_end_id = url.searchParams.get('end_to_end_id');
    let transaction_id = url.searchParams.get('transaction_id');
    let company_id = url.searchParams.get('company_id');

    if (req.method === 'POST') {
      const body = await req.json();
      end_to_end_id = end_to_end_id || body.end_to_end_id;
      transaction_id = transaction_id || body.transaction_id;
      company_id = company_id || body.company_id;
    }

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

    if (!company_id) {
      return new Response(
        JSON.stringify({ error: 'company_id is required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Get config
    let config: any = null;
    for (const p of ['cash_out', 'both', 'cash_in']) {
      const { data: c } = await supabase
        .from('pix_configs')
        .select('*')
        .eq('company_id', company_id)
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
      body: JSON.stringify({ company_id }),
    });

    if (!authResponse.ok) {
      return new Response(
        JSON.stringify({ error: 'Failed to authenticate with provider' }),
        { status: 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const { access_token } = await authResponse.json();

    // ONZ check status via proxy
    const statusUrl = `${config.base_url}/pix/payments/${end_to_end_id}`;
    const proxyUrl = Deno.env.get('ONZ_PROXY_URL');
    const proxyApiKey = Deno.env.get('ONZ_PROXY_API_KEY');
    if (!proxyUrl || !proxyApiKey) {
      return new Response(
        JSON.stringify({ error: 'ONZ_PROXY_URL não configurado' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const fetchHeaders: any = { 'Authorization': `Bearer ${access_token}`, 'Content-Type': 'application/json' };
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

    console.log('[pix-check-status] Status received:', JSON.stringify(statusData));

    // Normalize status
    const rawStatus = statusData.status || '';
    const statusMap: Record<string, string> = {
      'REALIZADO': 'completed', 'COMPLETED': 'completed', 'CONFIRMED': 'completed',
      'PROCESSADO': 'completed', 'EFETIVADO': 'completed', 'CONCLUIDO': 'completed',
      'EM_PROCESSAMENTO': 'pending', 'PROCESSING': 'pending', 'ACTIVE': 'pending',
      'NAO_REALIZADO': 'failed', 'FAILED': 'failed', 'ERROR': 'failed',
      'CANCELADO': 'failed', 'FALHA': 'failed', 'ERRO': 'failed',
      'DEVOLVIDO': 'refunded', 'REFUNDED': 'refunded',
    };
    const rawStatusStr = String(rawStatus).toUpperCase();
    const internalStatus = statusMap[rawStatusStr] || 'pending';
    const isCompleted = internalStatus === 'completed';

    if (transaction_id) {
      const supabaseAdmin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
      const updateData: any = { status: internalStatus, pix_provider_response: statusData };
      if (isCompleted) updateData.paid_at = new Date().toISOString();
      await supabaseAdmin.from('transactions').update(updateData).eq('id', transaction_id);
    }

    return new Response(
      JSON.stringify({
        success: true,
        end_to_end_id,
        status: rawStatus,
        internal_status: internalStatus,
        is_completed: isCompleted,
        provider: 'onz',
        payload: statusData,
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
