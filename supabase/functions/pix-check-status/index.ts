import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

async function callOnzViaProxy(url: string, method: string, headers: Record<string, string>, bodyRaw?: string) {
  const proxyUrl = Deno.env.get('ONZ_PROXY_URL')!;
  const proxyApiKey = Deno.env.get('ONZ_PROXY_API_KEY')!;
  const proxyBody: any = { url, method, headers };
  if (bodyRaw !== undefined) proxyBody.body_raw = bodyRaw;
  const resp = await fetch(`${proxyUrl}/proxy`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Proxy-API-Key': proxyApiKey },
    body: JSON.stringify(proxyBody),
  });
  const data = await resp.json();
  return { proxyStatus: resp.status, status: data.status || resp.status, data: data.data || data };
}

function parseIdsFromExternalId(externalId: string | null | undefined): { batchId: string | null; transferId: string | null; isOnz: boolean; onzId: string | null; e2eId: string | null } {
  const raw = String(externalId || '').trim();
  if (!raw) return { batchId: null, transferId: null, isOnz: false, onzId: null, e2eId: null };

  if (raw.startsWith('onz:')) {
    const parts = raw.substring(4).split(':');
    return { batchId: null, transferId: null, isOnz: true, onzId: parts[0] || null, e2eId: parts[1] || null };
  }

  const [batchPart, transferPart] = raw.split(':');
  return { batchId: batchPart?.trim() || null, transferId: transferPart?.trim() || null, isOnz: false, onzId: null, e2eId: null };
}

function extractFirstTransferFromBatchPayload(payload: any): any | null {
  if (!payload) return null;
  if (Array.isArray(payload)) return payload[0] ?? null;
  if (Array.isArray(payload?.transfers)) return payload.transfers[0] ?? null;
  if (Array.isArray(payload?.data)) return payload.data[0] ?? null;
  if (payload?.id || payload?.transfer_id) return payload;
  return null;
}

function extractBeneficiary(payload: any): { name: string; doc: string } {
  const p = payload || {};
  const name = p?.creditParty?.name || p?.creditor?.name || p?.receiver?.name
    || p?.beneficiary?.name || p?.receiverName || p?.creditorName || '';
  const doc = p?.creditParty?.taxId || p?.creditor?.taxId || p?.receiver?.taxId
    || p?.beneficiary?.document || p?.receiverDocument || p?.creditorTaxId || '';
  return { name: String(name).trim(), doc: String(doc).trim() };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader?.startsWith('Bearer ')) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

    const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, { global: { headers: { Authorization: authHeader } } });
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) return new Response(JSON.stringify({ error: 'Invalid token' }), { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

    const url = new URL(req.url);
    let transaction_id = url.searchParams.get('transaction_id');
    let company_id = url.searchParams.get('company_id');
    let transfer_id = url.searchParams.get('transfer_id');
    let batch_id = url.searchParams.get('batch_id');
    let transactionExternalId: string | null = null;
    let transactionE2eId: string | null = null;

    if (req.method === 'POST') {
      const body = await req.json();
      transaction_id = transaction_id || body.transaction_id;
      company_id = company_id || body.company_id;
      transfer_id = transfer_id || body.transfer_id;
      batch_id = batch_id || body.batch_id;
    }

    if (transaction_id && (!company_id || !transfer_id || !batch_id)) {
      const { data: txData } = await supabase.from('transactions').select('company_id, external_id, pix_e2eid').eq('id', transaction_id).single();
      if (txData) {
        company_id = company_id || txData.company_id;
        transactionExternalId = txData.external_id || null;
        transactionE2eId = txData.pix_e2eid || null;
        const parsedIds = parseIdsFromExternalId(txData.external_id);
        batch_id = batch_id || parsedIds.batchId;
        transfer_id = transfer_id || parsedIds.transferId;
      }
    }

    if (!company_id) return new Response(JSON.stringify({ error: 'company_id is required' }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

    const supabaseAdmin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
    let config: any = null;
    for (const p of ['cash_out', 'both', 'cash_in']) {
      const { data: c } = await supabaseAdmin.from('pix_configs').select('*').eq('company_id', company_id).eq('is_active', true).eq('purpose', p).single();
      if (c) { config = c; break; }
    }
    if (!config) return new Response(JSON.stringify({ error: 'Pix configuration not found' }), { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

    const authResponse = await fetch(`${Deno.env.get('SUPABASE_URL')}/functions/v1/pix-auth`, {
      method: 'POST', headers: { 'Authorization': authHeader, 'Content-Type': 'application/json', 'apikey': Deno.env.get('SUPABASE_ANON_KEY')! },
      body: JSON.stringify({ company_id }),
    });
    if (!authResponse.ok) return new Response(JSON.stringify({ error: 'Failed to authenticate with provider' }), { status: 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    const { access_token } = await authResponse.json();

    let statusData: any = null;
    let resolvedTransferId = transfer_id || null;
    let resolvedBatchId = batch_id || null;
    const parsedIds = parseIdsFromExternalId(transactionExternalId);

    if (config.provider === 'onz') {
      // ONZ: GET /pix/payments/{endToEndId}
      const e2eId = parsedIds.e2eId || transactionE2eId;
      if (!e2eId) return new Response(JSON.stringify({ error: 'end_to_end_id not available for this transaction' }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

      const onzHeaders: Record<string, string> = { 'Authorization': `Bearer ${access_token}` };
      if (config.provider_company_id) onzHeaders['X-Company-ID'] = config.provider_company_id;

      const result = await callOnzViaProxy(`${config.base_url}/api/v2/pix/payments/${e2eId}`, 'GET', onzHeaders);
      console.log(`[pix-check-status] ONZ raw response for e2e ${e2eId}: status=${result.status}, data=${JSON.stringify(result.data).substring(0, 500)}`);
      if (result.status >= 400) {
        return new Response(JSON.stringify({ error: 'Falha ao consultar status', details: JSON.stringify(result.data) }), { status: 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }

      // Normalize nested ONZ response: { data: { status: ... } } -> { status: ... }
      const onzPayload = result.data?.data && typeof result.data.data === 'object' && result.data.data.status
        ? result.data.data
        : result.data;
      statusData = onzPayload;
      console.log(`[pix-check-status] ONZ normalized payload status: ${onzPayload.status}`);

      const rawStatus = String(onzPayload.status || '').toUpperCase();
      const statusMap: Record<string, string> = {
        'LIQUIDATED': 'completed', 'REALIZADO': 'completed', 'CONFIRMED': 'completed',
        'PROCESSING': 'pending', 'EM_PROCESSAMENTO': 'pending', 'ACTIVE': 'pending',
        'CANCELED': 'failed', 'NAO_REALIZADO': 'failed',
        'REFUNDED': 'refunded', 'PARTIALLY_REFUNDED': 'refunded',
      };
      let internalStatus = statusMap[rawStatus] || 'pending';

      if (transaction_id) {
        const supabaseAdmin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
        const { data: currentTx } = await supabaseAdmin.from('transactions').select('status, beneficiary_name, beneficiary_document').eq('id', transaction_id).single();
        const finalStatuses = ['completed', 'failed', 'cancelled', 'refunded'];
        if (currentTx && finalStatuses.includes(currentTx.status) && !finalStatuses.includes(internalStatus)) {
          console.log(`[pix-check-status] Skipping update: tx ${transaction_id} already ${currentTx.status}, not overwriting with ${internalStatus}`);
          internalStatus = currentTx.status;
        } else {
          const updateData: any = { status: internalStatus, pix_provider_response: statusData, pix_e2eid: e2eId };
          if (internalStatus === 'completed') updateData.paid_at = new Date().toISOString();
          // Extract beneficiary from ONZ payload (only if not already set)
          const ben = extractBeneficiary(statusData);
          if (ben.name && !currentTx?.beneficiary_name) updateData.beneficiary_name = ben.name;
          if (ben.doc && !currentTx?.beneficiary_document) updateData.beneficiary_document = ben.doc;
          await supabaseAdmin.from('transactions').update(updateData).eq('id', transaction_id);
        }
      }

      return new Response(JSON.stringify({
        success: true, status: onzPayload.status, internal_status: internalStatus,
        is_completed: internalStatus === 'completed', provider: 'onz', payload: statusData,
      }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    // TRANSFEERA flow
    try {
      const apiBase = config.is_sandbox ? 'https://api-sandbox.transfeera.com' : 'https://api.transfeera.com';

      const getTransferStatus = async (id: string) => {
        const response = await fetch(`${apiBase}/transfer/${id}`, { method: 'GET', headers: { 'Authorization': `Bearer ${access_token}`, 'User-Agent': 'PixContabil (contato@pixcontabil.com.br)' } });
        const payload = await response.json().catch(() => null);
        return { ok: response.ok, payload };
      };
      const getBatchTransfers = async (id: string) => {
        const response = await fetch(`${apiBase}/batch/${id}/transfer`, { method: 'GET', headers: { 'Authorization': `Bearer ${access_token}`, 'User-Agent': 'PixContabil (contato@pixcontabil.com.br)' } });
        const payload = await response.json().catch(() => null);
        return { ok: response.ok, payload };
      };

      if (resolvedTransferId) {
        const r = await getTransferStatus(resolvedTransferId);
        if (r.ok && r.payload) statusData = r.payload;
      }
      if ((!statusData || !statusData.status) && resolvedBatchId) {
        const r = await getBatchTransfers(resolvedBatchId);
        if (r.ok && r.payload) {
          const t = extractFirstTransferFromBatchPayload(r.payload);
          if (t) { statusData = t; resolvedTransferId = resolvedTransferId || String(t.transfer_id || t.id || '').trim() || null; }
          else if (r.payload?.status) statusData = r.payload;
        }
      }
      if ((!statusData || !statusData.status) && resolvedTransferId) {
        const r = await getTransferStatus(resolvedTransferId);
        if (r.ok && r.payload) statusData = r.payload;
      }
    } catch (e) {
      return new Response(JSON.stringify({ error: 'Falha na conexão com Transfeera', details: e.message }), { status: 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    if (!statusData) return new Response(JSON.stringify({ error: 'Não foi possível obter status da transferência' }), { status: 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

    const rawStatus = String(statusData.status || statusData.transfer_status || '').toUpperCase();
    const statusMap: Record<string, string> = {
      'FINALIZADO': 'completed', 'TRANSFERENCIA_REALIZADA': 'completed', 'TRANSFERENCIA_CONFIRMADA': 'completed',
      'CRIADO': 'pending', 'RECEBIDO': 'pending', 'TRANSFERENCIA_CRIADA': 'pending', 'LOTE_CRIADO': 'pending',
      'FALHA': 'failed', 'DEVOLVIDO': 'refunded', 'ESTORNADO': 'refunded',
    };
    let internalStatus = statusMap[rawStatus] || 'pending';

    if (transaction_id) {
      const supabaseAdmin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
      // Check current status to avoid overwriting completed/failed with pending
      const { data: currentTx } = await supabaseAdmin.from('transactions').select('status').eq('id', transaction_id).single();
      const finalStatuses = ['completed', 'failed', 'cancelled', 'refunded'];
      if (currentTx && finalStatuses.includes(currentTx.status) && !finalStatuses.includes(internalStatus)) {
        console.log(`[pix-check-status] Skipping update: tx ${transaction_id} already ${currentTx.status}, not overwriting with ${internalStatus}`);
        // Return the actual final status instead of the stale one
        internalStatus = currentTx.status;
      } else {
        const existingIds = parseIdsFromExternalId(transactionExternalId);
        const updateData: any = { status: internalStatus, pix_provider_response: statusData, pix_e2eid: statusData.end_to_end_id || statusData.e2e_id || null };
        if (resolvedBatchId && resolvedTransferId && (!existingIds.transferId || existingIds.transferId !== resolvedTransferId)) {
          updateData.external_id = `${resolvedBatchId}:${resolvedTransferId}`;
        }
        if (internalStatus === 'completed') updateData.paid_at = new Date().toISOString();
        await supabaseAdmin.from('transactions').update(updateData).eq('id', transaction_id);
      }
    }

    return new Response(JSON.stringify({
      success: true, transfer_id: resolvedTransferId, batch_id: resolvedBatchId,
      status: statusData.status, internal_status: internalStatus, is_completed: internalStatus === 'completed',
      provider: 'transfeera', payload: statusData,
    }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

  } catch (error) {
    console.error('[pix-check-status] Error:', error);
    return new Response(JSON.stringify({ error: 'Internal server error', details: error.message }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }
});
