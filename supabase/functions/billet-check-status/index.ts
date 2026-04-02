import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

async function callNewProxy(path: string, method: string, body?: any) {
  const proxyUrl = Deno.env.get('NEW_PROXY_URL')!;
  const proxyKey = Deno.env.get('NEW_PROXY_KEY')!;
  const headers: Record<string, string> = {
    'x-proxy-key': proxyKey,
    'Content-Type': 'application/json',
  };
  if (method === 'POST') headers['x-idempotency-key'] = crypto.randomUUID();
  const resp = await fetch(`${proxyUrl}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await resp.json();
  return { status: resp.status, data };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!,
      { global: { headers: { Authorization: authHeader } } }
    );

    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
      return new Response(JSON.stringify({ error: 'Invalid token' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    const body = await req.json();
    const { company_id, billet_id, transaction_id } = body;

    let billetExternalId = billet_id;
    let companyId = company_id;

    if (transaction_id && (!billetExternalId || !companyId)) {
      const { data: txData } = await supabase
        .from('transactions').select('company_id, external_id')
        .eq('id', transaction_id).single();
      if (txData) {
        companyId = companyId || txData.company_id;
        if (!billetExternalId && txData.external_id) {
          const eid = txData.external_id;
          if (eid.startsWith('onz:')) {
            billetExternalId = eid.replace('onz:', '');
          } else {
            const parts = eid.split(':');
            billetExternalId = parts.length > 1 ? parts[1] : parts[0];
          }
        }
      }
    }

    if (!companyId || !billetExternalId) {
      return new Response(JSON.stringify({ error: 'company_id and billet_id (or transaction_id) are required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    // Get config
    let config: any = null;
    for (const p of ['cash_out', 'both']) {
      const { data: c } = await supabase
        .from('pix_configs').select('*')
        .eq('company_id', companyId).eq('is_active', true).eq('purpose', p).single();
      if (c) { config = c; break; }
    }

    if (!config) {
      return new Response(JSON.stringify({ error: 'Pix configuration not found' }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    let statusData: any;
    let internalStatus: string;

    if (config.provider === 'onz') {
      // ========== ONZ via novo proxy: GET /status/billet/:id ==========
      const result = await callNewProxy(`/status/billet/${billetExternalId}`, 'GET');

      if (result.status >= 400) {
        return new Response(JSON.stringify({ error: 'Falha ao consultar status do boleto', details: JSON.stringify(result.data) }),
          { status: 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }

      const rawStatusData = result.data;
      statusData = rawStatusData?.data && typeof rawStatusData.data === 'object' && !Array.isArray(rawStatusData.data)
        ? rawStatusData.data
        : rawStatusData;

      const isStatusEnvelope = statusData !== rawStatusData;
      const rawStatus = String(statusData?.status || statusData?.operationStatus || rawStatusData?.status || rawStatusData?.operationStatus || '').toUpperCase();
      const statusMap: Record<string, string> = {
        'LIQUIDATED': 'completed',
        'PAID': 'completed',
        'PROCESSING': 'pending',
        'CREATED': 'pending',
        'SCHEDULED': 'pending',
        'CANCELED': 'failed',
        'FAILED': 'failed',
        'REFUNDED': 'refunded',
      };
      internalStatus = statusMap[rawStatus] || 'pending';

      console.log('[billet-check-status] Billet reconciliation:', JSON.stringify({
        enveloped: isStatusEnvelope,
        provider_status: rawStatus || null,
        internal_status: internalStatus,
        transaction_id: transaction_id ?? null,
      }));

    } else {
      // ========== TRANSFEERA (unchanged) ==========
      const authResponse = await fetch(`${Deno.env.get('SUPABASE_URL')}/functions/v1/pix-auth`, {
        method: 'POST',
        headers: { 'Authorization': authHeader, 'Content-Type': 'application/json', 'apikey': Deno.env.get('SUPABASE_ANON_KEY')! },
        body: JSON.stringify({ company_id: companyId, purpose: 'cash_out' }),
      });

      if (!authResponse.ok) {
        return new Response(JSON.stringify({ error: 'Failed to authenticate with provider' }),
          { status: 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }

      const { access_token } = await authResponse.json();
      const apiBase = config.is_sandbox ? 'https://api-sandbox.transfeera.com' : 'https://api.transfeera.com';
      try {
        const statusResponse = await fetch(`${apiBase}/billet/${billetExternalId}`, {
          method: 'GET',
          headers: { 'Authorization': `Bearer ${access_token}`, 'User-Agent': 'PixContabil (contato@pixcontabil.com.br)' },
        });
        statusData = await statusResponse.json();
      } catch (e) {
        return new Response(JSON.stringify({ error: 'Falha na conexão com Transfeera', details: e.message }),
          { status: 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }

      const rawStatus = String(statusData.status || '').toUpperCase();
      const statusMap: Record<string, string> = {
        'PAGO': 'completed', 'AGENDADO': 'pending', 'CRIADA': 'pending',
        'FALHA': 'failed', 'DEVOLVIDO': 'refunded',
      };
      internalStatus = statusMap[rawStatus] || 'pending';
    }

    console.log('[billet-check-status] Status received:', JSON.stringify(statusData));

    if (transaction_id) {
      const supabaseAdmin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
      const updateData: any = { status: internalStatus, pix_provider_response: statusData };
      if (internalStatus === 'completed') updateData.paid_at = new Date().toISOString();
      await supabaseAdmin.from('transactions').update(updateData).eq('id', transaction_id);
    }

    return new Response(JSON.stringify({
      success: true,
      billet_id: billetExternalId,
      status: statusData?.status || statusData?.operationStatus || null,
      internal_status: internalStatus,
      is_completed: internalStatus === 'completed',
      provider: config.provider,
      payload: statusData,
    }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

  } catch (error) {
    console.error('[billet-check-status] Error:', error);
    return new Response(JSON.stringify({ error: 'Internal server error', details: error.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }
});
