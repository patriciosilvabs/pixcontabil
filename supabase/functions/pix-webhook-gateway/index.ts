import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-webhook-secret',
};

// ========== RATE LIMITING ==========
const rateLimitMap = new Map<string, { count: number; resetAt: number }>();
const RATE_LIMIT_WINDOW = 60_000;
const RATE_LIMIT_MAX = 100;

function isRateLimited(ip: string): boolean {
  const now = Date.now();
  const entry = rateLimitMap.get(ip);
  if (!entry || now > entry.resetAt) {
    rateLimitMap.set(ip, { count: 1, resetAt: now + RATE_LIMIT_WINDOW });
    return false;
  }
  entry.count++;
  return entry.count > RATE_LIMIT_MAX;
}

// ========== SANITIZATION ==========
function sanitizeString(str: unknown, maxLength = 255): string {
  if (typeof str !== 'string') return '';
  return str.replace(/[^\w\s\-.:@/]/g, '').substring(0, maxLength);
}

// ========== WEBHOOK SECRET VERIFICATION ==========
async function verifyWebhookSecret(req: Request, supabaseAdmin: any): Promise<{ valid: boolean; configId?: string }> {
  const headerSecret = req.headers.get('x-webhook-secret');
  const urlSecret = new URL(req.url).searchParams.get('whs');
  const webhookSecret = headerSecret || urlSecret;
  if (!webhookSecret) {
    console.warn(`[webhook-gateway] Secret missing (method: ${req.method})`);
    return { valid: false };
  }
  const { data: configs } = await supabaseAdmin
    .from('pix_configs').select('id, company_id').eq('webhook_secret', webhookSecret).eq('is_active', true).limit(1);
  if (configs && configs.length > 0) {
    return { valid: true, configId: configs[0].id };
  }
  return { valid: false };
}

// ========== PAYLOAD NORMALIZATION ==========
interface NormalizedEvent {
  event: string;
  transaction_id: string;
  end_to_end_id: string;
  amount: number;
  status: string;
  provider_status: string;
  tenant_id: string;
  app_origin: string;
  raw: any;
}

function normalizePayload(payload: any): NormalizedEvent {
  // ONZ format: { type: "TRANSFER"|"RECEIVE"|"CASHOUT", data: { ... } }
  const isOnzFormat = payload.type && !payload.object;
  const data = payload.data || payload;

  if (isOnzFormat) {
    return {
      event: mapOnzEventType(payload.type, data.status),
      transaction_id: data.id || data.txid || '',
      end_to_end_id: data.endToEndId || data.end_to_end_id || '',
      amount: parseFloat(data.payment?.amount || data.amount || 0),
      status: mapOnzStatus(String(data.status || '').toUpperCase()),
      provider_status: String(data.status || ''),
      tenant_id: '',
      app_origin: '',
      raw: payload,
    };
  }

  // Transfeera format: { id, object: "Transfer"|"Billet", data: { ... } }
  return {
    event: mapTransfeeraEventType(payload.object, data.status),
    transaction_id: String(data.transfer_id || data.id || data.batch_id || '').trim(),
    end_to_end_id: data.end_to_end_id || data.e2e_id || data.pix_end2end_id || '',
    amount: parseFloat(data.value || data.amount || 0),
    status: mapTransfeeraStatus(String(data.status || '').toUpperCase()),
    provider_status: String(data.status || ''),
    tenant_id: '',
    app_origin: '',
    raw: payload,
  };
}

function mapOnzEventType(type: string, status: string): string {
  const s = String(status).toUpperCase();
  if (type === 'RECEIVE') return 'payment.received';
  if (s === 'LIQUIDATED' || s === 'COMPLETED') return 'payment.confirmed';
  if (s === 'FAILED' || s === 'CANCELED') return 'payment.failed';
  if (s === 'REFUNDED') return 'payment.refunded';
  return 'payment.updated';
}

function mapTransfeeraEventType(object: string, status: string): string {
  const s = String(status).toUpperCase();
  if (object === 'CashIn') return 'payment.received';
  if (s === 'FINALIZADO' || s === 'TRANSFERENCIA_REALIZADA' || s === 'PAGO') return 'payment.confirmed';
  if (s === 'FALHA') return 'payment.failed';
  if (s === 'DEVOLVIDO' || s === 'ESTORNADO') return 'payment.refunded';
  if (object === 'TransferRefund') return 'payment.refunded';
  return 'payment.updated';
}

function mapOnzStatus(status: string): string {
  const m: Record<string, string> = {
    'LIQUIDATED': 'completed', 'PROCESSING': 'pending', 'CREATED': 'pending',
    'SCHEDULED': 'pending', 'CANCELED': 'failed', 'FAILED': 'failed', 'REFUNDED': 'refunded',
  };
  return m[status] || 'pending';
}

function mapTransfeeraStatus(status: string): string {
  const m: Record<string, string> = {
    'FINALIZADO': 'completed', 'TRANSFERENCIA_REALIZADA': 'completed', 'TRANSFERENCIA_CONFIRMADA': 'completed',
    'RECEBIDO': 'pending', 'CRIADO': 'pending', 'FALHA': 'failed', 'DEVOLVIDO': 'refunded',
    'ESTORNADO': 'refunded', 'PAGO': 'completed', 'AGENDADO': 'pending', 'CRIADA': 'pending',
  };
  return m[status] || 'pending';
}

// ========== IDEMPOTENCY KEY GENERATION ==========
function buildIdempotencyKey(provider: string, transactionId: string, eventType: string): string {
  return `${provider}:${transactionId}:${eventType}`;
}

// ========== ROUTING: Find app origin from payment_registry ==========
async function resolveAppOrigin(supabaseAdmin: any, transactionId: string, endToEndId: string): Promise<{ app_origin: string; tenant_id: string; company_id: string | null }> {
  // Try by transaction_id first
  if (transactionId) {
    const { data } = await supabaseAdmin
      .from('payment_registry').select('app_origin, tenant_id, company_id')
      .eq('transaction_id', transactionId).limit(1);
    if (data?.[0]) return data[0];
  }
  // Try by endToEndId
  if (endToEndId) {
    const { data } = await supabaseAdmin
      .from('payment_registry').select('app_origin, tenant_id, company_id')
      .eq('transaction_id', endToEndId).limit(1);
    if (data?.[0]) return data[0];
  }
  // Fallback: try matching in transactions table
  if (transactionId || endToEndId) {
    const orFilters: string[] = [];
    if (transactionId) orFilters.push(`external_id.ilike.%${transactionId}%`);
    if (endToEndId) orFilters.push(`pix_e2eid.eq.${endToEndId}`);
    const { data } = await supabaseAdmin
      .from('transactions').select('company_id').or(orFilters.join(',')).limit(1);
    if (data?.[0]) {
      return { app_origin: 'pixcontabil', tenant_id: '', company_id: data[0].company_id };
    }
  }
  return { app_origin: '', tenant_id: '', company_id: null };
}

// ========== DISPATCH EVENT TO DESTINATION ==========
async function dispatchEvent(supabaseAdmin: any, eventId: string, appOrigin: string, normalizedEvent: NormalizedEvent) {
  if (!appOrigin) return;

  const { data: dest } = await supabaseAdmin
    .from('webhook_destinations').select('id, callback_url, secret_key, is_active')
    .eq('app_name', appOrigin).eq('is_active', true).limit(1);

  if (!dest?.[0]?.callback_url) {
    await supabaseAdmin.from('webhook_events').update({ dispatch_status: 'skipped' }).eq('id', eventId);
    return;
  }

  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (dest[0].secret_key) headers['x-webhook-secret'] = dest[0].secret_key;

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10_000);

    const resp = await fetch(dest[0].callback_url, {
      method: 'POST',
      headers,
      body: JSON.stringify(normalizedEvent),
      signal: controller.signal,
    });
    clearTimeout(timeout);

    const respBody = await resp.text().catch(() => '');
    const dispatchResponse = { status: resp.status, body: respBody.substring(0, 500) };

    if (resp.ok) {
      await supabaseAdmin.from('webhook_events').update({
        dispatch_status: 'dispatched', dispatch_response: dispatchResponse,
      }).eq('id', eventId);
    } else {
      throw new Error(`HTTP ${resp.status}: ${respBody.substring(0, 200)}`);
    }
  } catch (e: any) {
    const { data: evt } = await supabaseAdmin
      .from('webhook_events').select('dispatch_attempts, max_retries').eq('id', eventId).single();

    const attempts = (evt?.dispatch_attempts || 0) + 1;
    const maxRetries = evt?.max_retries || 3;
    const backoffMs = Math.min(attempts * 30_000, 300_000); // 30s, 60s, 90s... max 5min

    await supabaseAdmin.from('webhook_events').update({
      dispatch_status: attempts >= maxRetries ? 'failed' : 'failed',
      dispatch_attempts: attempts,
      error_message: e.message?.substring(0, 500),
      next_retry_at: attempts < maxRetries ? new Date(Date.now() + backoffMs).toISOString() : null,
      dispatch_response: { error: e.message?.substring(0, 200) },
    }).eq('id', eventId);

    console.error(`[webhook-gateway] Dispatch failed for ${eventId}:`, e.message);
  }
}

// ========== PROCESS AND UPDATE INTERNAL TRANSACTION ==========
async function updateInternalTransaction(supabaseAdmin: any, normalized: NormalizedEvent) {
  const { transaction_id, end_to_end_id, status } = normalized;
  if (!transaction_id && !end_to_end_id) return;

  const orFilters: string[] = [];
  if (transaction_id) orFilters.push(`external_id.ilike.%${transaction_id}%`);
  if (end_to_end_id) orFilters.push(`pix_e2eid.eq.${end_to_end_id}`);

  const { data: transactions } = await supabaseAdmin
    .from('transactions').select('id, company_id, status, external_id, pix_e2eid')
    .or(orFilters.join(',')).limit(1);

  const tx = transactions?.[0];
  if (!tx) return;

  const finalStatuses = ['completed', 'failed', 'cancelled', 'refunded'];
  if (finalStatuses.includes(tx.status) && !finalStatuses.includes(status)) {
    console.log(`[webhook-gateway] Skip: tx ${tx.id} already ${tx.status}`);
    return;
  }

  const updateData: any = {
    status,
    pix_provider_response: normalized.raw,
    pix_e2eid: end_to_end_id || tx.pix_e2eid,
  };
  if (status === 'completed') updateData.paid_at = new Date().toISOString();
  await supabaseAdmin.from('transactions').update(updateData).eq('id', tx.id);

  // Auto-generate receipt on completion
  if (status === 'completed') {
    fetch(`${Deno.env.get('SUPABASE_URL')}/functions/v1/generate-pix-receipt`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')}` },
      body: JSON.stringify({ transaction_id: tx.id, company_id: tx.company_id }),
    }).catch(e => console.error('[webhook-gateway] Auto-receipt failed:', e));
  }

  // Audit log
  await supabaseAdmin.from('audit_logs').insert({
    company_id: tx.company_id, entity_type: 'transaction', entity_id: tx.id,
    action: 'webhook_gateway_received',
    old_data: { status: tx.status },
    new_data: { status, provider: 'pix', event: normalized.event },
  });
}

// ========== MAIN HANDLER ==========
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  const supabaseAdmin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
  const url = new URL(req.url);
  const ip_address = req.headers.get('x-forwarded-for') || req.headers.get('x-real-ip') || 'unknown';

  // ===== GET endpoints =====
  if (req.method === 'GET') {
    const path = url.pathname.split('/').pop();

    // Health check
    if (!path || path === 'pix-webhook-gateway') {
      return new Response(JSON.stringify({ status: 'ok', message: 'Webhook Gateway active' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    // GET /events - List events
    if (path === 'events') {
      const limit = Math.min(parseInt(url.searchParams.get('limit') || '50'), 200);
      const offset = parseInt(url.searchParams.get('offset') || '0');
      const statusFilter = url.searchParams.get('status');

      let query = supabaseAdmin.from('webhook_events')
        .select('id, provider, event_type, transaction_id, app_origin, status, dispatch_status, dispatch_attempts, created_at, processed_at, error_message', { count: 'exact' })
        .order('created_at', { ascending: false })
        .range(offset, offset + limit - 1);

      if (statusFilter) query = query.eq('status', statusFilter);

      const { data, count, error } = await query;
      if (error) return new Response(JSON.stringify({ error: error.message }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

      return new Response(JSON.stringify({ data, total: count }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    // GET /events/:id - Event detail
    if (url.searchParams.get('event_id')) {
      const { data, error } = await supabaseAdmin.from('webhook_events')
        .select('*').eq('id', url.searchParams.get('event_id')).single();
      if (error) return new Response(JSON.stringify({ error: 'Event not found' }), { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      return new Response(JSON.stringify(data), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    return new Response(JSON.stringify({ status: 'ok' }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }

  // ===== POST: Reprocess event =====
  if (req.method === 'POST' && url.searchParams.get('reprocess')) {
    const eventId = url.searchParams.get('reprocess');
    const { data: evt } = await supabaseAdmin.from('webhook_events')
      .select('*').eq('id', eventId).single();

    if (!evt) return new Response(JSON.stringify({ error: 'Event not found' }), { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

    // Reset and reprocess
    await supabaseAdmin.from('webhook_events').update({
      status: 'processing', dispatch_status: 'pending', dispatch_attempts: 0, error_message: null, next_retry_at: null,
    }).eq('id', eventId);

    const normalized = evt.normalized_payload as NormalizedEvent || normalizePayload(evt.payload);
    await updateInternalTransaction(supabaseAdmin, normalized);
    if (evt.app_origin) await dispatchEvent(supabaseAdmin, eventId, evt.app_origin, normalized);

    await supabaseAdmin.from('webhook_events').update({ status: 'processed', processed_at: new Date().toISOString() }).eq('id', eventId);
    return new Response(JSON.stringify({ success: true, message: 'Event reprocessed' }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }

  // ===== POST: Receive webhook =====
  if (isRateLimited(ip_address)) {
    return new Response(JSON.stringify({ error: 'Too many requests' }),
      { status: 429, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }

  try {
    const { valid } = await verifyWebhookSecret(req.clone(), supabaseAdmin);
    if (!valid) {
      await supabaseAdmin.from('webhook_events').insert({
        provider: 'pix', event_type: 'UNAUTHORIZED', idempotency_key: `unauth:${Date.now()}:${ip_address}`,
        payload: { message: 'Invalid webhook secret' }, ip_address, status: 'failed',
        error_message: 'Webhook secret verification failed',
      });
      return new Response(JSON.stringify({ error: 'Unauthorized' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    // Parse payload
    let payload: any;
    try {
      const body = await req.text();
      if (body.length > 1_000_000) {
        return new Response(JSON.stringify({ error: 'Payload too large' }),
          { status: 413, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }
      payload = JSON.parse(body);
    } catch {
      return new Response(JSON.stringify({ error: 'Invalid JSON' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    // Normalize
    const normalized = normalizePayload(payload);
    const isOnzFormat = payload.type && !payload.object;
    const provider = isOnzFormat ? 'onz' : 'transfeera';
    const objectType = isOnzFormat ? payload.type : (payload.object || payload.type || 'UNKNOWN');

    // Idempotency check
    const txIdForKey = normalized.transaction_id || normalized.end_to_end_id || `${Date.now()}`;
    const idempotencyKey = buildIdempotencyKey(provider, txIdForKey, objectType);

    const { data: existing } = await supabaseAdmin
      .from('webhook_events').select('id, status').eq('idempotency_key', idempotencyKey).limit(1);

    if (existing?.[0]) {
      console.log(`[webhook-gateway] Duplicate event skipped: ${idempotencyKey}`);
      return new Response(JSON.stringify({ success: true, message: 'Already processed', event_id: existing[0].id }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    // Route: find app origin
    const routing = await resolveAppOrigin(supabaseAdmin, normalized.transaction_id, normalized.end_to_end_id);
    normalized.app_origin = routing.app_origin;
    normalized.tenant_id = routing.tenant_id;

    // Persist event
    const { data: newEvent, error: insertError } = await supabaseAdmin.from('webhook_events').insert({
      provider,
      event_type: objectType,
      transaction_id: normalized.transaction_id || normalized.end_to_end_id,
      idempotency_key: idempotencyKey,
      payload,
      normalized_payload: normalized,
      app_origin: routing.app_origin || null,
      tenant_id: routing.tenant_id || null,
      status: routing.app_origin ? 'processing' : 'unknown_origin',
      company_id: routing.company_id,
      ip_address,
    }).select('id').single();

    if (insertError) {
      // Handle unique constraint (duplicate) gracefully
      if (insertError.code === '23505') {
        return new Response(JSON.stringify({ success: true, message: 'Duplicate' }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }
      throw insertError;
    }

    // Respond immediately (HTTP 200), then process async
    const eventId = newEvent!.id;

    // Also log to legacy pix_webhook_logs for backward compat
    supabaseAdmin.from('pix_webhook_logs').insert({
      event_type: objectType, payload, ip_address, processed: false,
    }).then(() => {});

    // Async processing: update internal transaction + dispatch
    (async () => {
      try {
        await updateInternalTransaction(supabaseAdmin, normalized);
        if (routing.app_origin) {
          await dispatchEvent(supabaseAdmin, eventId, routing.app_origin, normalized);
        }
        await supabaseAdmin.from('webhook_events').update({
          status: 'processed', processed_at: new Date().toISOString(),
        }).eq('id', eventId);
      } catch (e: any) {
        console.error(`[webhook-gateway] Processing error for ${eventId}:`, e);
        await supabaseAdmin.from('webhook_events').update({
          status: 'failed', error_message: e.message?.substring(0, 500),
        }).eq('id', eventId);
      }
    })();

    return new Response(JSON.stringify({ success: true, event_id: eventId }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

  } catch (error: any) {
    console.error('[webhook-gateway] Error:', error);
    return new Response(JSON.stringify({ error: 'Internal server error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }
});
