import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

async function callPixMobileProxy(url: string, method: string, headers: Record<string, string>, body?: any) {
  const proxyApiKey = Deno.env.get('PIXMOBILE_PROXY_API_KEY')!;
  const resp = await fetch('https://pixmobile.com.br/proxy', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-proxy-api-key': proxyApiKey },
    body: JSON.stringify({ url, method, headers, body }),
  });
  const data = await resp.json();
  return { status: resp.status, data: data.data || data };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader?.startsWith('Bearer ')) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

    const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, { global: { headers: { Authorization: authHeader } } });
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) return new Response(JSON.stringify({ error: 'Invalid token' }), { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

    const body = await req.json();
    const { company_id, billet_id, transaction_id } = body;

    let billetExternalId = billet_id;
    let companyId = company_id;

    if (transaction_id && (!billetExternalId || !companyId)) {
      const { data: txData } = await supabase.from('transactions').select('company_id, external_id').eq('id', transaction_id).single();
      if (txData) {
        companyId = companyId || txData.company_id;
        if (!billetExternalId && txData.external_id) {
          const eid = txData.external_id;
          if (eid.startsWith('onz:')) billetExternalId = eid.replace('onz:', '');
          else { const parts = eid.split(':'); billetExternalId = parts.length > 1 ? parts[1] : parts[0]; }
        }
      }
    }

    if (!companyId || !billetExternalId) return new Response(JSON.stringify({ error: 'company_id and billet_id (or transaction_id) are required' }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

    let config: any = null;
    for (const p of ['cash_out', 'both']) {
      const { data: c } = await supabase.from('pix_configs').select('*').eq('company_id', companyId).eq('is_active', true).eq('purpose', p).single();
      if (c) { config = c; break; }
    }
    if (!config) return new Response(JSON.stringify({ error: 'Pix configuration not found' }), { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

    let statusData: any;
    let internalStatus: string;

    if (config.provider === 'onz') {
      // ========== ONZ via pixmobile proxy ==========
      const tokenResponse = await fetch(`${Deno.env.get('SUPABASE_URL')}/functions/v1/pix-auth`, {
        method: 'POST', headers: { 'Authorization': authHeader, 'Content-Type': 'application/json', 'apikey': Deno.env.get('SUPABASE_ANON_KEY')! },
        body: JSON.stringify({ company_id: companyId, purpose: 'cash_out' }),
      });
      if (!tokenResponse.ok) return new Response(JSON.stringify({ error: 'Falha ao autenticar com o provedor' }), { status: 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      const { access_token } = await tokenResponse.json();

      const statusUrl = `${config.base_url}/api/v2/billets/payments/${billetExternalId}`;
      const result = await callPixMobileProxy(statusUrl, 'GET', {
        'Authorization': `Bearer ${access_token}`,
        'Content-Type': 'application/json',
      });

      if (result.status >= 400) return new Response(JSON.stringify({ error: 'Falha ao consultar status do boleto', details: JSON.stringify(result.data) }), { status: 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

      statusData = result.data;
      const rawStatus = String(statusData.status || '').toUpperCase();
      const statusMap: Record<string, string> = {
        'LIQUIDATED': 'completed', 'PAID': 'completed',
        'PROCESSING': 'pending', 'CREATED': 'pending', 'SCHEDULED': 'pending',
        'CANCELED': 'failed', 'FAILED': 'failed', 'REFUNDED': 'refunded',
      };
      internalStatus = statusMap[rawStatus] || 'pending';
    } else {
      // ========== TRANSFEERA (unchanged) ==========
      const authResponse = await fetch(`${Deno.env.get('SUPABASE_URL')}/functions/v1/pix-auth`, {
        method: 'POST', headers: { 'Authorization': authHeader, 'Content-Type': 'application/json', 'apikey': Deno.env.get('SUPABASE_ANON_KEY')! },
        body: JSON.stringify({ company_id: companyId, purpose: 'cash_out' }),
      });
      if (!authResponse.ok) return new Response(JSON.stringify({ error: 'Failed to authenticate with provider' }), { status: 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

      const { access_token } = await authResponse.json();
      const apiBase = config.is_sandbox ? 'https://api-sandbox.transfeera.com' : 'https://api.transfeera.com';
      try {
        const statusResponse = await fetch(`${apiBase}/billet/${billetExternalId}`, {
          method: 'GET', headers: { 'Authorization': `Bearer ${access_token}`, 'User-Agent': 'PixContabil (contato@pixcontabil.com.br)' },
        });
        statusData = await statusResponse.json();
      } catch (e) {
        return new Response(JSON.stringify({ error: 'Falha na conexão com Transfeera', details: e.message }), { status: 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }

      const rawStatus = String(statusData.status || '').toUpperCase();
      const statusMap: Record<string, string> = { 'PAGO': 'completed', 'AGENDADO': 'pending', 'CRIADA': 'pending', 'FALHA': 'failed', 'DEVOLVIDO': 'refunded' };
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
      success: true, billet_id: billetExternalId,
      status: statusData.status, internal_status: internalStatus,
      is_completed: internalStatus === 'completed',
      provider: config.provider, payload: statusData,
    }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

  } catch (error) {
    console.error('[billet-check-status] Error:', error);
    return new Response(JSON.stringify({ error: 'Internal server error', details: error.message }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }
});
