import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-webhook-secret',
};

function sanitizeString(str: unknown, maxLength = 255): string {
  if (typeof str !== 'string') return '';
  return str.replace(/[^\w\s\-.:@/]/g, '').substring(0, maxLength);
}

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

async function verifyWebhookSecret(req: Request, supabaseAdmin: any): Promise<boolean> {
  const headerSecret = req.headers.get('x-webhook-secret');
  const urlSecret = new URL(req.url).searchParams.get('whs');
  const webhookSecret = headerSecret || urlSecret;
  if (!webhookSecret) {
    console.warn(`[pix-webhook] Webhook secret header/query missing (method: ${req.method})`);
    return false;
  }
  const { data: matchingConfigs } = await supabaseAdmin
    .from('pix_configs').select('id').eq('webhook_secret', webhookSecret).eq('is_active', true).limit(1);
  return matchingConfigs && matchingConfigs.length > 0;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  // Health check for provider validation pings
  if (req.method === 'GET') {
    return new Response(JSON.stringify({ status: 'ok', message: 'Webhook endpoint active' }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }

  const supabaseAdmin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
  const ip_address = req.headers.get('x-forwarded-for') || req.headers.get('x-real-ip') || 'unknown';

  if (isRateLimited(ip_address)) {
    return new Response(JSON.stringify({ error: 'Too many requests' }),
      { status: 429, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }

  try {
    const isAuthorized = await verifyWebhookSecret(req.clone(), supabaseAdmin);
    if (!isAuthorized) {
      await supabaseAdmin.from('pix_webhook_logs').insert({
        event_type: 'UNAUTHORIZED', payload: { message: 'Invalid or missing webhook secret' },
        ip_address, processed: false, error_message: 'Webhook secret verification failed',
      });
      return new Response(JSON.stringify({ error: 'Unauthorized' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

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

    console.log('[pix-webhook] Received webhook from IP:', ip_address);

    // Detect provider format
    // ONZ format: { type: "TRANSFER"|"RECEIVE"|"CASHOUT", data: { ... } }
    // Transfeera format: { id, object: "Transfer"|"Billet", data: { ... } }
    const isOnzFormat = payload.type && !payload.object;
    const objectType = isOnzFormat ? payload.type : (payload.object || payload.type || 'UNKNOWN');
    const eventData = payload.data || payload;

    await supabaseAdmin.from('pix_webhook_logs').insert({
      event_type: objectType, payload, ip_address, processed: false,
    });

    if (isOnzFormat) {
      return await handleOnzWebhook(supabaseAdmin, objectType, eventData, ip_address);
    }

    // Transfeera handlers
    if (objectType === 'Transfer' || objectType === 'TransferRefund') {
      return await handleTransfeeraTransferWebhook(supabaseAdmin, objectType, eventData, ip_address);
    }
    if (objectType === 'Billet') {
      return await handleTransfeeraBilletWebhook(supabaseAdmin, eventData, ip_address);
    }
    if (objectType === 'CashIn') {
      return await handleCashInWebhook(supabaseAdmin, eventData, ip_address);
    }

    return new Response(JSON.stringify({ success: true, message: `Unknown type: ${objectType}` }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

  } catch (error) {
    console.error('[pix-webhook] Error:', error);
    return new Response(JSON.stringify({ error: 'Internal server error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }
});

// ========== ONZ WEBHOOK HANDLERS ==========
async function handleOnzWebhook(supabaseAdmin: any, type: string, data: any, ip_address: string) {
  const endToEndId = data.endToEndId || data.end_to_end_id || '';
  const onzId = data.id || '';
  const status = String(data.status || '').toUpperCase();

  const statusMap: Record<string, string> = {
    'LIQUIDATED': 'completed',
    'PROCESSING': 'pending',
    'CREATED': 'pending',
    'SCHEDULED': 'pending',
    'CANCELED': 'failed',
    'FAILED': 'failed',
    'REFUNDED': 'refunded',
  };
  const internalStatus = statusMap[status] || 'pending';

  if (type === 'TRANSFER' || type === 'CASHOUT') {
    // Match by external_id containing the ONZ id or endToEndId
    let transaction: any = null;

    if (onzId) {
      const { data: txById } = await supabaseAdmin
        .from('transactions').select('id, company_id, status, external_id')
        .or(`external_id.ilike.%${onzId}%`).limit(1);
      transaction = txById?.[0] || null;
    }

    if (!transaction && endToEndId) {
      const { data: txByE2e } = await supabaseAdmin
        .from('transactions').select('id, company_id, status, external_id, pix_e2eid')
        .or(`pix_e2eid.eq.${endToEndId},external_id.ilike.%${endToEndId}%`).limit(1);
      transaction = txByE2e?.[0] || null;
    }

    if (transaction) {
      const updateData: any = {
        status: internalStatus,
        pix_provider_response: data,
        pix_e2eid: endToEndId || transaction.pix_e2eid,
      };
      if (internalStatus === 'completed') updateData.paid_at = new Date().toISOString();
      await supabaseAdmin.from('transactions').update(updateData).eq('id', transaction.id);

      // Auto-generate receipt on completion
      if (internalStatus === 'completed') {
        try {
          fetch(`${Deno.env.get('SUPABASE_URL')}/functions/v1/generate-pix-receipt`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')}` },
            body: JSON.stringify({ transaction_id: transaction.id, company_id: transaction.company_id }),
          }).catch(e => console.error('[pix-webhook] Auto-receipt failed:', e));
        } catch (e) { console.error('[pix-webhook] Error triggering receipt:', e); }
      }

      await supabaseAdmin.from('audit_logs').insert({
        company_id: transaction.company_id, entity_type: 'transaction', entity_id: transaction.id,
        action: 'webhook_received',
        old_data: { status: transaction.status },
        new_data: { status: internalStatus, onzId, endToEndId, provider: 'onz', type },
      });
    } else {
      console.warn('[pix-webhook] ONZ transfer not matched:', { onzId, endToEndId, status });
    }
  } else if (type === 'RECEIVE') {
    // Incoming Pix payment via ONZ
    const pixKey = data.pixKey || data.key;
    const amount = parseFloat(data.payment?.amount || data.amount || 0);

    if (pixKey) {
      const { data: configs } = await supabaseAdmin
        .from('pix_configs').select('company_id').eq('pix_key', pixKey).eq('is_active', true).limit(1);

      if (configs?.length) {
        await supabaseAdmin.from('transactions').insert({
          company_id: configs[0].company_id,
          created_by: '00000000-0000-0000-0000-000000000000',
          amount, status: 'completed', pix_type: 'key', pix_key: pixKey,
          pix_e2eid: endToEndId, description: data.description || 'Recebimento Pix',
          paid_at: new Date().toISOString(), pix_provider_response: data,
        });
      }
    }
  }

  return new Response(JSON.stringify({ success: true }),
    { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
}

// ========== TRANSFEERA WEBHOOK HANDLERS ==========
async function handleTransfeeraTransferWebhook(supabaseAdmin: any, objectType: string, data: any, ip_address: string) {
  const transferId = String(data.transfer_id || data.id || '').trim();
  const batchId = String(data.batch_id || '').trim();
  const status = String(data.status || '').toUpperCase();

  const statusMap: Record<string, string> = {
    'FINALIZADO': 'completed', 'TRANSFERENCIA_REALIZADA': 'completed', 'TRANSFERENCIA_CONFIRMADA': 'completed',
    'RECEBIDO': 'pending', 'CRIADO': 'pending', 'FALHA': 'failed', 'DEVOLVIDO': 'refunded', 'ESTORNADO': 'refunded',
  };
  const internalStatus = statusMap[status] || 'pending';

  let transaction: any = null;
  if (transferId) {
    const { data: txByTransfer } = await supabaseAdmin
      .from('transactions').select('id, company_id, status, external_id')
      .or(`external_id.ilike.%${transferId}%`).limit(1);
    transaction = txByTransfer?.[0] || null;
  }
  if (!transaction && batchId) {
    const { data: txByBatch } = await supabaseAdmin
      .from('transactions').select('id, company_id, status, external_id')
      .ilike('external_id', `${batchId}%`).limit(1);
    transaction = txByBatch?.[0] || null;
  }

  if (transaction) {
    const updateData: any = {
      status: internalStatus, pix_provider_response: data,
      pix_e2eid: data.end_to_end_id || data.e2e_id || data.pix_end2end_id || null,
    };
    if (batchId && transferId) updateData.external_id = `${batchId}:${transferId}`;
    if (internalStatus === 'completed') updateData.paid_at = new Date().toISOString();
    await supabaseAdmin.from('transactions').update(updateData).eq('id', transaction.id);

    if (internalStatus === 'completed') {
      try {
        fetch(`${Deno.env.get('SUPABASE_URL')}/functions/v1/generate-pix-receipt`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')}` },
          body: JSON.stringify({ transaction_id: transaction.id, company_id: transaction.company_id }),
        }).catch(e => console.error('[pix-webhook] Auto-receipt failed:', e));
      } catch (e) { console.error('[pix-webhook] Error triggering receipt:', e); }
    }

    await supabaseAdmin.from('audit_logs').insert({
      company_id: transaction.company_id, entity_type: 'transaction', entity_id: transaction.id,
      action: 'pix_webhook_received',
      old_data: { status: transaction.status },
      new_data: { status: internalStatus, transferId, batchId, provider: 'transfeera', objectType },
    });
  }

  if (objectType === 'TransferRefund' && data.end_to_end_id) {
    const { data: refunds } = await supabaseAdmin
      .from('pix_refunds').select('id').eq('e2eid', data.end_to_end_id).limit(1);
    if (refunds?.[0]) {
      await supabaseAdmin.from('pix_refunds').update({
        status: data.status || 'DEVOLVIDO', refunded_at: new Date().toISOString(),
      }).eq('id', refunds[0].id);
    }
  }

  return new Response(JSON.stringify({ success: true }),
    { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
}

async function handleTransfeeraBilletWebhook(supabaseAdmin: any, data: any, ip_address: string) {
  const billetId = data.id;
  const status = String(data.status || '').toUpperCase();
  const statusMap: Record<string, string> = {
    'PAGO': 'completed', 'FALHA': 'failed', 'DEVOLVIDO': 'refunded', 'AGENDADO': 'pending', 'CRIADA': 'pending',
  };
  const internalStatus = statusMap[status] || 'pending';

  if (billetId) {
    const { data: transactions } = await supabaseAdmin
      .from('transactions').select('id, company_id, status').or(`external_id.ilike.%${billetId}%`).limit(1);
    const transaction = transactions?.[0];
    if (transaction) {
      const updateData: any = { status: internalStatus, pix_provider_response: data };
      if (internalStatus === 'completed') updateData.paid_at = new Date().toISOString();
      await supabaseAdmin.from('transactions').update(updateData).eq('id', transaction.id);
      await supabaseAdmin.from('audit_logs').insert({
        company_id: transaction.company_id, entity_type: 'transaction', entity_id: transaction.id,
        action: 'billet_webhook_received',
        old_data: { status: transaction.status },
        new_data: { status: internalStatus, billetId, provider: 'transfeera' },
      });
    }
  }

  return new Response(JSON.stringify({ success: true }),
    { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
}

async function handleCashInWebhook(supabaseAdmin: any, data: any, ip_address: string) {
  const e2eId = data.end_to_end_id || data.e2e_id;
  const pixKey = data.pix_key || data.key;

  if (pixKey) {
    const { data: configs } = await supabaseAdmin
      .from('pix_configs').select('company_id').eq('pix_key', pixKey).eq('is_active', true).limit(1);
    if (configs?.length) {
      await supabaseAdmin.from('transactions').insert({
        company_id: configs[0].company_id,
        created_by: '00000000-0000-0000-0000-000000000000',
        amount: parseFloat(data.value || data.amount || 0),
        status: 'completed', pix_type: 'key', pix_key: pixKey, pix_e2eid: e2eId,
        description: data.description || 'Recebimento Pix',
        paid_at: new Date().toISOString(), pix_provider_response: data,
      });
    }
  }

  return new Response(JSON.stringify({ success: true }),
    { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
}
