import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-webhook-secret',
};

// ========== VALIDATION HELPERS ==========
function sanitizeString(str: unknown, maxLength = 255): string {
  if (typeof str !== 'string') return '';
  return str.replace(/[^\w\s\-.:@/]/g, '').substring(0, maxLength);
}

function isValidE2EId(str: unknown): boolean {
  if (typeof str !== 'string') return false;
  return /^[A-Za-z0-9]{1,64}$/.test(str);
}

// ========== WEBHOOK SECRET VERIFICATION ==========
async function verifyWebhookSecret(req: Request, supabaseAdmin: any): Promise<boolean> {
  const webhookSecret = req.headers.get('x-webhook-secret');
  if (!webhookSecret) {
    console.warn('[pix-webhook] Webhook secret header missing - rejecting request');
    return false;
  }

  const { data: matchingConfigs } = await supabaseAdmin
    .from('pix_configs')
    .select('id')
    .eq('webhook_secret', webhookSecret)
    .eq('is_active', true)
    .limit(1);

  return matchingConfigs && matchingConfigs.length > 0;
}

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

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  const supabaseAdmin = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  );

  const ip_address = req.headers.get('x-forwarded-for') || req.headers.get('x-real-ip') || 'unknown';

  if (isRateLimited(ip_address)) {
    return new Response(
      JSON.stringify({ error: 'Too many requests' }),
      { status: 429, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }

  try {
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
      if (body.length > 1_000_000) {
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

    // ========== ONZ HANDLER ==========
    // ONZ sends either: { evento, endToEndId, ... } or BCB standard { pix: [...] }
    if (payload.pix && Array.isArray(payload.pix)) {
      return await handleBcbPixWebhook(supabaseAdmin, payload, ip_address);
    }

    // ONZ specific format
    if (payload.evento || payload.idPagamento || payload.endToEndId) {
      return await handleOnzWebhook(supabaseAdmin, payload, ip_address);
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

// ========== BCB STANDARD PIX HANDLER (array format) ==========
async function handleBcbPixWebhook(supabaseAdmin: any, payload: any, ip_address: string) {
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
      const isFailed = pixEvent.status === 'NAO_REALIZADO';

      const updateData: any = {
        status: isFailed ? 'failed' : 'completed',
        pix_provider_response: pixEvent,
      };
      if (!isFailed) updateData.paid_at = horario || new Date().toISOString();
      if (txid) updateData.pix_txid = txid;
      await supabaseAdmin.from('transactions').update(updateData).eq('id', transaction.id);

      // Auto-generate receipt for completed payments
      if (!isFailed) {
        try {
          fetch(`${Deno.env.get('SUPABASE_URL')}/functions/v1/generate-pix-receipt`, {
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

      await supabaseAdmin.from('audit_logs').insert({
        company_id: transaction.company_id,
        entity_type: 'transaction',
        entity_id: transaction.id,
        action: 'pix_webhook_received',
        old_data: { status: transaction.status },
        new_data: { status: isFailed ? 'failed' : 'completed', endToEndId, valor, provider: 'onz' },
      });
    } else if (chave) {
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
