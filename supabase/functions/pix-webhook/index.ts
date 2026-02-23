import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-webhook-secret',
};

// ========== VALIDATION HELPERS ==========
function isValidUUID(str: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(str);
}

function sanitizeString(str: unknown, maxLength = 255): string {
  if (typeof str !== 'string') return '';
  return str.replace(/[^\w\s\-.:@/]/g, '').substring(0, maxLength);
}

function isValidE2EId(str: unknown): boolean {
  if (typeof str !== 'string') return false;
  // E2E IDs are alphanumeric, typically 32 chars (BCB standard)
  return /^[A-Za-z0-9]{1,64}$/.test(str);
}

function isValidAmount(val: unknown): boolean {
  if (typeof val === 'number') return val >= 0 && val <= 999999999;
  if (typeof val === 'string') {
    const num = parseFloat(val);
    return !isNaN(num) && num >= 0 && num <= 999999999;
  }
  return false;
}

// ========== WEBHOOK SECRET VERIFICATION ==========
async function verifyWebhookSecret(req: Request, supabaseAdmin: any): Promise<boolean> {
  const webhookSecret = req.headers.get('x-webhook-secret');
  
  if (!webhookSecret) {
    console.warn('[pix-webhook] Webhook secret header missing - rejecting request');
    return false;
  }

  // Verify the provided secret matches any active config
  const { data: matchingConfigs } = await supabaseAdmin
    .from('pix_configs')
    .select('id')
    .eq('webhook_secret', webhookSecret)
    .eq('is_active', true)
    .limit(1);

  return matchingConfigs && matchingConfigs.length > 0;
}

// ========== RATE LIMITING (simple in-memory) ==========
const rateLimitMap = new Map<string, { count: number; resetAt: number }>();
const RATE_LIMIT_WINDOW = 60_000; // 1 minute
const RATE_LIMIT_MAX = 100; // max 100 requests per IP per minute

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

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  const supabaseAdmin = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  );

  const ip_address = req.headers.get('x-forwarded-for') || req.headers.get('x-real-ip') || 'unknown';

  // Rate limiting
  if (isRateLimited(ip_address)) {
    console.warn('[pix-webhook] Rate limited IP:', ip_address);
    return new Response(
      JSON.stringify({ error: 'Too many requests' }),
      { status: 429, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }

  try {
    // Verify webhook secret
    const isAuthorized = await verifyWebhookSecret(req.clone(), supabaseAdmin);
    if (!isAuthorized) {
      await supabaseAdmin.from('pix_webhook_logs').insert({
        event_type: 'UNAUTHORIZED',
        payload: { message: 'Invalid or missing webhook secret' },
        ip_address,
        processed: false,
        error_message: 'Webhook secret verification failed',
      });
      return new Response(
        JSON.stringify({ error: 'Unauthorized' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    let payload: any;
    try {
      const body = await req.text();
      if (body.length > 1_000_000) { // 1MB max
        return new Response(
          JSON.stringify({ error: 'Payload too large' }),
          { status: 413, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
      payload = JSON.parse(body);
    } catch {
      return new Response(
        JSON.stringify({ error: 'Invalid JSON' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (typeof payload !== 'object' || payload === null) {
      return new Response(
        JSON.stringify({ error: 'Invalid payload format' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log('[pix-webhook] Received webhook from IP:', ip_address);

    // ========== DETECT PROVIDER FORMAT ==========

    // Woovi (OpenPix): has "event" field like "OPENPIX:TRANSACTION_RECEIVED"
    if (payload.event && typeof payload.event === 'string' && payload.event.startsWith('OPENPIX:')) {
      return await handleWooviWebhook(supabaseAdmin, payload, ip_address);
    }

    // EFI (BCB standard): has "pix" array
    if (payload.pix && Array.isArray(payload.pix)) {
      return await handleEfiWebhook(supabaseAdmin, payload, ip_address);
    }

    // Transfeera: has "event_type" or "type" field
    if (payload.event_type || payload.type) {
      return await handleTransfeeraWebhook(supabaseAdmin, payload, ip_address);
    }

    // ONZ: has "evento" or specific ONZ fields
    if (payload.evento || payload.idPagamento) {
      return await handleOnzWebhook(supabaseAdmin, payload, ip_address);
    }

    // Banco Inter Banking webhook: has "codigoSolicitacao" or "tipoTransacao"
    if (payload.codigoSolicitacao || payload.tipoTransacao) {
      return await handleInterBankingWebhook(supabaseAdmin, payload, ip_address);
    }

    // Unknown format - log and return OK
    await supabaseAdmin.from('pix_webhook_logs').insert({
      event_type: 'UNKNOWN',
      payload,
      ip_address,
      processed: false,
      error_message: 'Unknown webhook format',
    });

    return new Response(
      JSON.stringify({ success: true, message: 'Unknown format logged' }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('[pix-webhook] Error:', error);
    return new Response(
      JSON.stringify({ error: 'Internal server error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});

// ========== WOOVI HANDLER ==========
async function handleWooviWebhook(supabaseAdmin: any, payload: any, ip_address: string) {
  const event = sanitizeString(payload.event, 64);
  const charge = payload.charge || payload.pix || {};
  const correlationID = sanitizeString(charge.correlationID || payload.correlationID, 64);
  const value = charge.value ? charge.value / 100 : 0;

  await supabaseAdmin.from('pix_webhook_logs').insert({
    event_type: event,
    payload,
    ip_address,
    processed: false,
  });

  if (event === 'OPENPIX:TRANSACTION_RECEIVED' || event === 'OPENPIX:CHARGE_COMPLETED') {
    // Find transaction by correlationID (stored as external_id or pix_e2eid)
    const { data: transaction } = await supabaseAdmin
      .from('transactions')
      .select('id, company_id, status')
      .or(`external_id.eq.${correlationID},pix_e2eid.eq.${correlationID}`)
      .single();

    if (transaction) {
      await supabaseAdmin.from('transactions').update({
        status: 'completed',
        paid_at: new Date().toISOString(),
        pix_provider_response: payload,
      }).eq('id', transaction.id);

      await supabaseAdmin.from('audit_logs').insert({
        company_id: transaction.company_id,
        entity_type: 'transaction',
        entity_id: transaction.id,
        action: 'pix_webhook_received',
        old_data: { status: transaction.status },
        new_data: { status: 'completed', provider: 'woovi', event },
      });
    }

    await supabaseAdmin.from('pix_webhook_logs').update({ processed: true })
      .eq('payload->>correlationID', correlationID);
  }

  return new Response(JSON.stringify({ success: true }), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

// ========== EFI HANDLER ==========
async function handleEfiWebhook(supabaseAdmin: any, payload: any, ip_address: string) {
  for (const pixEvent of payload.pix) {
    const endToEndId = sanitizeString(pixEvent.endToEndId, 64);
    const txid = sanitizeString(pixEvent.txid, 64);
    const valor = pixEvent.valor;
    const horario = pixEvent.horario;
    const infoPagador = sanitizeString(pixEvent.infoPagador, 255);
    const chave = sanitizeString(pixEvent.chave, 255);
    const devolucoes = pixEvent.devolucoes;

    await supabaseAdmin.from('pix_webhook_logs').insert({
      event_type: devolucoes && devolucoes.length > 0 ? 'REFUND' : 'PIX',
      payload: pixEvent,
      ip_address,
      processed: false,
    });

    if (!endToEndId || !isValidE2EId(endToEndId)) continue;

    const { data: transaction } = await supabaseAdmin
      .from('transactions')
      .select('id, company_id, status')
      .eq('pix_e2eid', endToEndId)
      .single();

    if (transaction) {
      // Check EFI status field to determine real outcome
      const efiStatus = pixEvent.status;
      const isFailed = efiStatus === 'NAO_REALIZADO';
      const errorMotivo = pixEvent.gnExtras?.erro?.motivo;

      const updateData: any = {
        status: isFailed ? 'failed' : 'completed',
        pix_provider_response: pixEvent,
      };
      if (!isFailed) {
        updateData.paid_at = horario || new Date().toISOString();
      }
      if (isFailed && errorMotivo) {
        updateData.description = errorMotivo;
      }
      if (txid) updateData.pix_txid = txid;
      await supabaseAdmin.from('transactions').update(updateData).eq('id', transaction.id);

      // Auto-generate receipt for completed payments
      if (!isFailed) {
        try {
          const receiptUrl = `${Deno.env.get('SUPABASE_URL')}/functions/v1/generate-pix-receipt`;
          fetch(receiptUrl, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')}`,
            },
            body: JSON.stringify({ transaction_id: transaction.id, company_id: transaction.company_id }),
          }).catch(e => console.error('[pix-webhook] Auto-receipt generation failed:', e));
        } catch (e) {
          console.error('[pix-webhook] Error triggering receipt generation:', e);
        }
      }

      const finalStatus = isFailed ? 'failed' : 'completed';
      await supabaseAdmin.from('audit_logs').insert({
        company_id: transaction.company_id,
        entity_type: 'transaction',
        entity_id: transaction.id,
        action: 'pix_webhook_received',
        old_data: { status: transaction.status },
        new_data: { status: finalStatus, endToEndId, valor, ...(errorMotivo ? { error: errorMotivo } : {}) },
      });
    } else {
      // Incoming payment
      const { data: configs } = await supabaseAdmin
        .from('pix_configs')
        .select('company_id')
        .eq('pix_key', chave)
        .eq('is_active', true)
        .limit(1);

      if (configs && configs.length > 0) {
        await supabaseAdmin.from('transactions').insert({
          company_id: configs[0].company_id,
          created_by: '00000000-0000-0000-0000-000000000000',
          amount: parseFloat(valor),
          status: 'completed',
          pix_type: 'key',
          pix_key: chave,
          pix_e2eid: endToEndId,
          pix_txid: txid,
          description: infoPagador || 'Recebimento Pix',
          paid_at: horario || new Date().toISOString(),
          pix_provider_response: pixEvent,
        });
      }
    }

    if (devolucoes && devolucoes.length > 0 && transaction) {
      for (const dev of devolucoes) {
        const { data: existingRefund } = await supabaseAdmin
          .from('pix_refunds')
          .select('id')
          .eq('e2eid', endToEndId)
          .eq('refund_id', dev.id || dev.rtrId)
          .single();

        if (!existingRefund) {
          await supabaseAdmin.from('pix_refunds').insert({
            transaction_id: transaction.id,
            e2eid: endToEndId,
            refund_id: dev.id || dev.rtrId || `REF_${Date.now()}`,
            valor: parseFloat(dev.valor),
            motivo: dev.motivo,
            status: dev.status || 'DEVOLVIDO',
            refunded_at: dev.horario?.liquidacao || new Date().toISOString(),
          });
        }
      }
    }

    await supabaseAdmin.from('pix_webhook_logs').update({ processed: true })
      .eq('payload->endToEndId', endToEndId);
  }

  return new Response(JSON.stringify({ success: true }), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

// ========== TRANSFEERA HANDLER ==========
async function handleTransfeeraWebhook(supabaseAdmin: any, payload: any, ip_address: string) {
  const eventType = payload.event_type || payload.type;

  await supabaseAdmin.from('pix_webhook_logs').insert({
    event_type: eventType,
    payload,
    ip_address,
    processed: false,
  });

  const transferId = payload.data?.id || payload.id;
  const status = payload.data?.status || payload.status;

  if (transferId) {
    const { data: transaction } = await supabaseAdmin
      .from('transactions')
      .select('id, company_id, status')
      .or(`external_id.eq.${transferId},pix_e2eid.eq.${transferId}`)
      .single();

    if (transaction) {
      const statusMap: Record<string, string> = {
        'COMPLETED': 'completed', 'CONFIRMED': 'completed',
        'FAILED': 'failed', 'ERROR': 'failed',
        'PROCESSING': 'pending',
      };
      const internalStatus = statusMap[status?.toUpperCase()] || 'pending';

      const updateData: any = { status: internalStatus, pix_provider_response: payload };
      if (internalStatus === 'completed') updateData.paid_at = new Date().toISOString();

      await supabaseAdmin.from('transactions').update(updateData).eq('id', transaction.id);

      await supabaseAdmin.from('audit_logs').insert({
        company_id: transaction.company_id,
        entity_type: 'transaction',
        entity_id: transaction.id,
        action: 'pix_webhook_received',
        old_data: { status: transaction.status },
        new_data: { status: internalStatus, provider: 'transfeera', event: eventType },
      });
    }
  }

  return new Response(JSON.stringify({ success: true }), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

// ========== ONZ HANDLER ==========
async function handleOnzWebhook(supabaseAdmin: any, payload: any, ip_address: string) {
  const evento = payload.evento || 'PIX';

  await supabaseAdmin.from('pix_webhook_logs').insert({
    event_type: evento,
    payload,
    ip_address,
    processed: false,
  });

  const e2eId = payload.endToEndId || payload.e2eId || payload.idPagamento;

  if (e2eId) {
    const { data: transaction } = await supabaseAdmin
      .from('transactions')
      .select('id, company_id, status')
      .or(`pix_e2eid.eq.${e2eId},external_id.eq.${e2eId}`)
      .single();

    if (transaction) {
      const status = payload.status || '';
      const statusMap: Record<string, string> = {
        'REALIZADO': 'completed', 'CONCLUIDO': 'completed',
        'FALHA': 'failed', 'ERRO': 'failed',
      };
      const internalStatus = statusMap[status.toUpperCase()] || 'completed';

      await supabaseAdmin.from('transactions').update({
        status: internalStatus,
        paid_at: new Date().toISOString(),
        pix_provider_response: payload,
      }).eq('id', transaction.id);

      await supabaseAdmin.from('audit_logs').insert({
        company_id: transaction.company_id,
        entity_type: 'transaction',
        entity_id: transaction.id,
        action: 'pix_webhook_received',
        old_data: { status: transaction.status },
        new_data: { status: internalStatus, provider: 'onz', evento },
      });
    }
  }

  return new Response(JSON.stringify({ success: true }), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

// ========== BANCO INTER BANKING HANDLER ==========
async function handleInterBankingWebhook(supabaseAdmin: any, payload: any, ip_address: string) {
  const codigoSolicitacao = payload.codigoSolicitacao;
  const status = payload.status || '';
  const endToEnd = payload.endToEnd || payload.endToEndId || '';

  await supabaseAdmin.from('pix_webhook_logs').insert({
    event_type: `INTER_BANKING_${status || 'UNKNOWN'}`,
    payload,
    ip_address,
    processed: false,
  });

  const lookupId = codigoSolicitacao || endToEnd;
  if (!lookupId) {
    return new Response(JSON.stringify({ success: true, message: 'No identifier found' }), {
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const { data: transaction } = await supabaseAdmin
    .from('transactions')
    .select('id, company_id, status')
    .or(`external_id.eq.${lookupId},pix_e2eid.eq.${lookupId}`)
    .single();

  if (transaction) {
    const statusMap: Record<string, string> = {
      'PROCESSADO': 'completed', 'EFETIVADO': 'completed',
      'EMPROCESSAMENTO': 'pending', 'APROVACAO': 'pending',
      'CANCELADO': 'failed', 'DEVOLVIDO': 'refunded',
    };
    const internalStatus = statusMap[status.toUpperCase()] || 'pending';

    const updateData: any = { status: internalStatus, pix_provider_response: payload };
    if (internalStatus === 'completed') updateData.paid_at = new Date().toISOString();
    if (endToEnd && !transaction.pix_e2eid) updateData.pix_e2eid = endToEnd;

    await supabaseAdmin.from('transactions').update(updateData).eq('id', transaction.id);

    await supabaseAdmin.from('audit_logs').insert({
      company_id: transaction.company_id,
      entity_type: 'transaction',
      entity_id: transaction.id,
      action: 'pix_webhook_received',
      old_data: { status: transaction.status },
      new_data: { status: internalStatus, provider: 'inter', codigoSolicitacao },
    });
  }

  return new Response(JSON.stringify({ success: true }), {
    headers: { 'Content-Type': 'application/json' },
  });
}
