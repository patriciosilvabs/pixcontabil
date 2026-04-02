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
    || p?.beneficiary?.name || p?.creditorAccount?.name
    || p?.receiverName || p?.creditorName || '';
  const doc = p?.creditParty?.taxId || p?.creditor?.taxId || p?.receiver?.taxId
    || p?.beneficiary?.document || p?.creditorAccount?.document || p?.creditorAccount?.taxId
    || p?.receiverDocument || p?.creditorTaxId || '';
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
    let end_to_end_id: string | null = url.searchParams.get('end_to_end_id');
    let transactionExternalId: string | null = null;
    let transactionE2eId: string | null = null;

    if (req.method === 'POST') {
      const body = await req.json();
      transaction_id = transaction_id || body.transaction_id;
      company_id = company_id || body.company_id;
      transfer_id = transfer_id || body.transfer_id;
      batch_id = batch_id || body.batch_id;
      end_to_end_id = end_to_end_id || body.end_to_end_id;
    }

    // If we only have end_to_end_id (no transaction_id), look up transaction by pix_e2eid
    if (!transaction_id && end_to_end_id && company_id) {
      const supabaseAdmin2 = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
      const { data: txByE2e } = await supabaseAdmin2.from('transactions')
        .select('id, company_id, external_id, pix_e2eid')
        .eq('pix_e2eid', end_to_end_id)
        .eq('company_id', company_id)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (txByE2e) {
        transaction_id = txByE2e.id;
        transactionExternalId = txByE2e.external_id || null;
        transactionE2eId = txByE2e.pix_e2eid || null;
        const parsedIds = parseIdsFromExternalId(txByE2e.external_id);
        batch_id = batch_id || parsedIds.batchId;
        transfer_id = transfer_id || parsedIds.transferId;
      } else {
        // No transaction found yet — use e2eId directly for proxy query
        transactionE2eId = end_to_end_id;
      }
    }

    let transactionPixType: string | null = null;

    if (transaction_id && (!company_id || !transfer_id || !batch_id)) {
      const { data: txData } = await supabase.from('transactions').select('company_id, external_id, pix_e2eid, pix_type').eq('id', transaction_id).single();
      if (txData) {
        company_id = company_id || txData.company_id;
        transactionExternalId = txData.external_id || null;
        transactionE2eId = txData.pix_e2eid || null;
        transactionPixType = txData.pix_type || null;
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

    const parsedIds = parseIdsFromExternalId(transactionExternalId);

    if (config.provider === 'onz') {
      // ========== ONZ via novo proxy ==========
      const isBoleto = transactionPixType === 'boleto';
      const e2eId = parsedIds.e2eId || transactionE2eId;
      const onzId = parsedIds.onzId;
      const statusId = isBoleto ? onzId : (e2eId || onzId);

      if (!statusId) {
        return new Response(JSON.stringify({
          success: true, status: 'PROCESSING', internal_status: 'pending',
          is_completed: false, provider: 'onz', payload: { status: 'PROCESSING' },
          message: 'Transação em processamento inicial. Aguarde alguns segundos.',
        }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }

      if (isBoleto) {
        // Boleto: use new proxy (GET /status/billet/{id} → ONZ GET /billets/{id})
        const result = await callNewProxy(`/status/billet/${statusId}`, 'GET');
        console.log(`[pix-check-status] New proxy response for billet ${statusId}: status=${result.status}, data=${JSON.stringify(result.data).substring(0, 500)}`);

        if (result.status >= 400) {
          if (result.status === 404 && transaction_id) {
            const { data: stuckTx } = await supabaseAdmin.from('transactions')
              .select('status, created_at')
              .eq('id', transaction_id)
              .single();

            if (stuckTx && stuckTx.status === 'pending') {
              const txAge = Date.now() - new Date(stuckTx.created_at).getTime();
              const TEN_MINUTES = 10 * 60 * 1000;

              if (txAge > TEN_MINUTES) {
                await supabaseAdmin.from('transactions').update({
                  status: 'failed',
                  pix_provider_response: { provider_404: true, checked_at: new Date().toISOString(), raw: result.data },
                }).eq('id', transaction_id);

                console.log(`[pix-check-status] Marked old billet transaction ${transaction_id} as failed (provider 404, age ${Math.round(txAge/60000)}min)`);

                return new Response(JSON.stringify({
                  success: true, status: 'NOT_FOUND', internal_status: 'failed',
                  is_completed: false, provider: 'onz',
                  payload: { status: 'NOT_FOUND', reason: 'Transação não localizada no provedor após período de processamento.' },
                }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
              }

              // Billet is young and provider returns 404 — still processing (ON_QUEUE)
              console.log(`[pix-check-status] Billet ${statusId} not yet available at provider (404), age ${Math.round(txAge/60000)}min — returning PROCESSING`);
              return new Response(JSON.stringify({
                success: true, status: 'PROCESSING', internal_status: 'pending',
                is_completed: false, provider: 'onz',
                payload: { status: 'PROCESSING', reason: 'Boleto em fila de processamento. Aguarde.' },
              }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
            }
          }

          return new Response(JSON.stringify({ error: 'Falha ao consultar status do boleto', details: JSON.stringify(result.data) }), { status: 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
        }

        const rawBilletData = result.data;
        const billetData = rawBilletData?.data && typeof rawBilletData.data === 'object' && !Array.isArray(rawBilletData.data)
          ? rawBilletData.data
          : rawBilletData;
        const isBilletEnvelope = billetData !== rawBilletData;
        const rawBilletStatus = String(
          billetData?.status || billetData?.operationStatus || rawBilletData?.status || rawBilletData?.operationStatus || ''
        ).toUpperCase();
        const billetStatusMap: Record<string, string> = {
          'LIQUIDATED': 'completed', 'PAID': 'completed',
          'PROCESSING': 'pending', 'CREATED': 'pending', 'SCHEDULED': 'pending',
          'CANCELED': 'failed', 'FAILED': 'failed',
          'REFUNDED': 'refunded',
        };
        let internalStatus = billetStatusMap[rawBilletStatus] || 'pending';

        console.log(`[pix-check-status] Billet reconciliation: enveloped=${isBilletEnvelope} provider_status=${rawBilletStatus || 'EMPTY'} internal_status=${internalStatus} transaction_id=${transaction_id || 'none'}`);

        if (transaction_id) {
          const { data: currentTx } = await supabaseAdmin.from('transactions').select('status, beneficiary_name, beneficiary_document, company_id').eq('id', transaction_id).single();
          const finalStatuses = ['completed', 'failed', 'cancelled', 'refunded'];
          if (currentTx && finalStatuses.includes(currentTx.status) && !finalStatuses.includes(internalStatus)) {
            internalStatus = currentTx.status;
          } else {
            const updateData: any = { status: internalStatus, pix_provider_response: billetData };
            if (internalStatus === 'completed') updateData.paid_at = new Date().toISOString();
            const ben = extractBeneficiary(billetData);
            if (ben.name && !currentTx?.beneficiary_name) updateData.beneficiary_name = ben.name;
            if (ben.doc && !currentTx?.beneficiary_document) updateData.beneficiary_document = ben.doc;
            await supabaseAdmin.from('transactions').update(updateData).eq('id', transaction_id);

            if (internalStatus === 'completed' && currentTx?.company_id) {
              fetch(`${Deno.env.get('SUPABASE_URL')}/functions/v1/generate-pix-receipt`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')}`, 'apikey': Deno.env.get('SUPABASE_ANON_KEY')! },
                body: JSON.stringify({ transaction_id, company_id: currentTx.company_id }),
              }).catch(e => console.error('[pix-check-status] Auto-receipt failed:', e));
            }
          }
        }

        return new Response(JSON.stringify({
          success: true, status: billetData?.status || billetData?.operationStatus || rawBilletStatus, internal_status: internalStatus,
          is_completed: internalStatus === 'completed', provider: 'onz', payload: billetData,
        }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }

      // PIX ONZ: use new proxy (unchanged)
      const statusPath = `/status/pix/${statusId}`;
      const result = await callNewProxy(statusPath, 'GET');
      console.log(`[pix-check-status] Proxy response for pix id ${statusId}: status=${result.status}, data=${JSON.stringify(result.data).substring(0, 500)}`);

      if (result.status >= 400) {
        // If provider returns 404, check if this is an old transaction that should be marked as failed
        if (result.status === 404 && transaction_id) {
          const { data: stuckTx } = await supabaseAdmin.from('transactions')
            .select('status, created_at')
            .eq('id', transaction_id)
            .single();

          if (stuckTx && stuckTx.status === 'pending') {
            const txAge = Date.now() - new Date(stuckTx.created_at).getTime();
            const TEN_MINUTES = 10 * 60 * 1000;

            if (txAge > TEN_MINUTES) {
              // Transaction is old and provider can't find it — mark as failed
              await supabaseAdmin.from('transactions').update({
                status: 'failed',
                pix_provider_response: { provider_404: true, checked_at: new Date().toISOString(), raw: result.data },
              }).eq('id', transaction_id);

              console.log(`[pix-check-status] Marked old transaction ${transaction_id} as failed (provider 404, age ${Math.round(txAge/60000)}min)`);

              return new Response(JSON.stringify({
                success: true, status: 'NOT_FOUND', internal_status: 'failed',
                is_completed: false, provider: 'onz',
                payload: { status: 'NOT_FOUND', reason: 'Transação não localizada no provedor após período de processamento.' },
              }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
            }
          }
        }

        return new Response(JSON.stringify({ error: 'Falha ao consultar status', details: JSON.stringify(result.data) }), { status: 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }

      const rawStatusData = result.data;
      const statusData = rawStatusData?.data && typeof rawStatusData.data === 'object' && !Array.isArray(rawStatusData.data)
        ? rawStatusData.data
        : rawStatusData;
      const rawStatus = String(statusData.status || '').toUpperCase();
      const pixStatusMap: Record<string, string> = {
        'LIQUIDATED': 'completed', 'REALIZADO': 'completed', 'CONFIRMED': 'completed',
        'PROCESSING': 'pending', 'EM_PROCESSAMENTO': 'pending', 'ACTIVE': 'pending',
        'CANCELED': 'failed', 'NAO_REALIZADO': 'failed',
        'REFUNDED': 'refunded', 'PARTIALLY_REFUNDED': 'refunded',
      };
      const billetStatusMap: Record<string, string> = {
        'LIQUIDATED': 'completed', 'PAID': 'completed',
        'PROCESSING': 'pending', 'CREATED': 'pending', 'SCHEDULED': 'pending',
        'CANCELED': 'failed', 'FAILED': 'failed',
        'REFUNDED': 'refunded',
      };
      const statusMap = isBoleto ? billetStatusMap : pixStatusMap;
      let internalStatus = statusMap[rawStatus] || 'pending';

      if (transaction_id) {
        const { data: currentTx } = await supabaseAdmin.from('transactions').select('status, beneficiary_name, beneficiary_document, company_id').eq('id', transaction_id).single();
        const finalStatuses = ['completed', 'failed', 'cancelled', 'refunded'];
        if (currentTx && finalStatuses.includes(currentTx.status) && !finalStatuses.includes(internalStatus)) {
          internalStatus = currentTx.status;
        } else {
          const updateData: any = { status: internalStatus, pix_provider_response: statusData, pix_e2eid: e2eId };
          if (internalStatus === 'completed') updateData.paid_at = new Date().toISOString();
          const ben = extractBeneficiary(statusData);
          if (ben.name && !currentTx?.beneficiary_name) updateData.beneficiary_name = ben.name;
          if (ben.doc && !currentTx?.beneficiary_document) updateData.beneficiary_document = ben.doc;
          await supabaseAdmin.from('transactions').update(updateData).eq('id', transaction_id);

          if (internalStatus === 'completed' && currentTx?.company_id) {
            fetch(`${Deno.env.get('SUPABASE_URL')}/functions/v1/generate-pix-receipt`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')}`, 'apikey': Deno.env.get('SUPABASE_ANON_KEY')! },
              body: JSON.stringify({ transaction_id, company_id: currentTx.company_id }),
            }).catch(e => console.error('[pix-check-status] Auto-receipt failed:', e));
          }
        }
      }

      return new Response(JSON.stringify({
        success: true, status: statusData.status, internal_status: internalStatus,
        is_completed: internalStatus === 'completed', provider: 'onz', payload: statusData,
      }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    // ========== TRANSFEERA flow (unchanged) ==========
    const authResponse = await fetch(`${Deno.env.get('SUPABASE_URL')}/functions/v1/pix-auth`, {
      method: 'POST', headers: { 'Authorization': authHeader, 'Content-Type': 'application/json', 'apikey': Deno.env.get('SUPABASE_ANON_KEY')! },
      body: JSON.stringify({ company_id }),
    });
    if (!authResponse.ok) return new Response(JSON.stringify({ error: 'Failed to authenticate with provider' }), { status: 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    const { access_token } = await authResponse.json();

    let statusData: any = null;
    let resolvedTransferId = transfer_id || null;
    let resolvedBatchId = batch_id || null;

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
      const { data: currentTx } = await supabaseAdmin.from('transactions').select('status, company_id, beneficiary_name, beneficiary_document').eq('id', transaction_id).single();
      const finalStatuses = ['completed', 'failed', 'cancelled', 'refunded'];
      if (currentTx && finalStatuses.includes(currentTx.status) && !finalStatuses.includes(internalStatus)) {
        internalStatus = currentTx.status;
      } else {
        const existingIds = parseIdsFromExternalId(transactionExternalId);
        const ben = extractBeneficiary(statusData);
        const updateData: any = { status: internalStatus, pix_provider_response: statusData, pix_e2eid: statusData.end_to_end_id || statusData.e2e_id || null };
        if (resolvedBatchId && resolvedTransferId && (!existingIds.transferId || existingIds.transferId !== resolvedTransferId)) {
          updateData.external_id = `${resolvedBatchId}:${resolvedTransferId}`;
        }
        if (internalStatus === 'completed') updateData.paid_at = new Date().toISOString();
        if (ben.name && !currentTx?.beneficiary_name) updateData.beneficiary_name = ben.name;
        if (ben.doc && !currentTx?.beneficiary_document) updateData.beneficiary_document = ben.doc;
        await supabaseAdmin.from('transactions').update(updateData).eq('id', transaction_id);

        if (internalStatus === 'completed' && currentTx?.company_id) {
          fetch(`${Deno.env.get('SUPABASE_URL')}/functions/v1/generate-pix-receipt`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')}`, 'apikey': Deno.env.get('SUPABASE_ANON_KEY')! },
            body: JSON.stringify({ transaction_id, company_id: currentTx.company_id }),
          }).catch(e => console.error('[pix-check-status] Auto-receipt failed:', e));
        }
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
