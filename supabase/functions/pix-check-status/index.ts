import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

function getApiBaseUrl(config: any): string {
  return config.is_sandbox
    ? 'https://api-sandbox.transfeera.com'
    : 'https://api.transfeera.com';
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

    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
      return new Response(
        JSON.stringify({ error: 'Invalid token' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const url = new URL(req.url);
    let transaction_id = url.searchParams.get('transaction_id');
    let company_id = url.searchParams.get('company_id');
    let transfer_id = url.searchParams.get('transfer_id');

    if (req.method === 'POST') {
      const body = await req.json();
      transaction_id = transaction_id || body.transaction_id;
      company_id = company_id || body.company_id;
      transfer_id = transfer_id || body.transfer_id;
    }

    // Get transfer_id from transaction external_id if not provided
    if (transaction_id && (!transfer_id || !company_id)) {
      const { data: txData } = await supabase
        .from('transactions')
        .select('company_id, external_id')
        .eq('id', transaction_id)
        .single();
      if (txData) {
        company_id = company_id || txData.company_id;
        // external_id format: "batchId:transferId"
        if (!transfer_id && txData.external_id) {
          const parts = txData.external_id.split(':');
          transfer_id = parts.length > 1 ? parts[1] : parts[0];
        }
      }
    }

    if (!company_id || !transfer_id) {
      return new Response(
        JSON.stringify({ error: 'company_id and transfer_id (or transaction_id) are required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Get config
    let config: any = null;
    for (const p of ['cash_out', 'both', 'cash_in']) {
      const { data: c } = await supabase
        .from('pix_configs').select('*')
        .eq('company_id', company_id).eq('is_active', true).eq('purpose', p).single();
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
    const apiBase = getApiBaseUrl(config);

    // Transfeera: GET /transfer/{id}
    let statusData: any;
    try {
      const statusResponse = await fetch(`${apiBase}/transfer/${transfer_id}`, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${access_token}`,
          'User-Agent': 'PixContabil (contato@pixcontabil.com.br)',
        },
      });
      statusData = await statusResponse.json();
    } catch (e) {
      return new Response(
        JSON.stringify({ error: 'Falha na conexão com Transfeera', details: e.message }),
        { status: 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log('[pix-check-status] Status received:', JSON.stringify(statusData));

    // Normalize Transfeera status
    const rawStatus = String(statusData.status || '').toUpperCase();
    const statusMap: Record<string, string> = {
      'FINALIZADO': 'completed',
      'TRANSFERENCIA_REALIZADA': 'completed',
      'TRANSFERENCIA_CONFIRMADA': 'completed',
      'CRIADO': 'pending',
      'TRANSFERENCIA_CRIADA': 'pending',
      'LOTE_CRIADO': 'pending',
      'FALHA': 'failed',
      'DEVOLVIDO': 'refunded',
      'ESTORNADO': 'refunded',
    };
    const internalStatus = statusMap[rawStatus] || 'pending';
    const isCompleted = internalStatus === 'completed';

    if (transaction_id) {
      const supabaseAdmin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
      const updateData: any = {
        status: internalStatus,
        pix_provider_response: statusData,
        pix_e2eid: statusData.end_to_end_id || statusData.e2e_id || null,
      };
      if (isCompleted) updateData.paid_at = new Date().toISOString();
      await supabaseAdmin.from('transactions').update(updateData).eq('id', transaction_id);
    }

    return new Response(
      JSON.stringify({
        success: true,
        transfer_id,
        status: statusData.status,
        internal_status: internalStatus,
        is_completed: isCompleted,
        provider: 'transfeera',
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
