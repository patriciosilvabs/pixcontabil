import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-webhook-secret',
};

// EFI/BCB Webhook payload
interface EFIWebhookPayload {
  pix: Array<{
    endToEndId: string;
    txid?: string;
    chave: string;
    valor: string;
    horario: string;
    infoPagador?: string;
    devolucoes?: Array<{
      id: string;
      rtrId: string;
      valor: string;
      horario: { solicitacao: string; liquidacao?: string };
      status: string;
      motivo?: string;
    }>;
    componentesValor?: any;
  }>;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  const supabaseAdmin = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  );

  try {
    const ip_address = req.headers.get('x-forwarded-for') || req.headers.get('x-real-ip') || 'unknown';

    const payload: EFIWebhookPayload = await req.json();
    console.log('[pix-webhook] Received EFI webhook:', JSON.stringify(payload));

    if (!payload.pix || !Array.isArray(payload.pix)) {
      console.error('[pix-webhook] Invalid payload: missing pix array');
      return new Response(
        JSON.stringify({ error: 'Invalid payload' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    for (const pixEvent of payload.pix) {
      const { endToEndId, txid, valor, horario, infoPagador, chave, devolucoes } = pixEvent;

      // Log the webhook event
      await supabaseAdmin.from('pix_webhook_logs').insert({
        event_type: devolucoes && devolucoes.length > 0 ? 'REFUND' : 'PIX',
        payload: pixEvent,
        ip_address,
        processed: false,
      });

      if (!endToEndId) {
        console.warn('[pix-webhook] Missing endToEndId, skipping');
        continue;
      }

      // Find transaction by e2eId
      const { data: transaction } = await supabaseAdmin
        .from('transactions')
        .select('id, company_id, status')
        .eq('pix_e2eid', endToEndId)
        .single();

      if (transaction) {
        // Update existing transaction
        const updateData: any = {
          status: 'completed',
          paid_at: horario || new Date().toISOString(),
          pix_provider_response: pixEvent,
        };

        if (txid) updateData.pix_txid = txid;

        await supabaseAdmin.from('transactions').update(updateData).eq('id', transaction.id);

        // Audit log
        await supabaseAdmin.from('audit_logs').insert({
          company_id: transaction.company_id,
          entity_type: 'transaction',
          entity_id: transaction.id,
          action: 'pix_webhook_received',
          old_data: { status: transaction.status },
          new_data: { status: 'completed', endToEndId, valor },
        });

        console.log(`[pix-webhook] Updated transaction ${transaction.id} to completed`);
      } else {
        // Incoming payment - create new transaction
        console.log(`[pix-webhook] No transaction found for e2eId ${endToEndId}, creating incoming payment`);

        // Find company by pix key
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
          console.log('[pix-webhook] Created incoming transaction');
        }
      }

      // Handle refunds in the event
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

      // Mark webhook as processed
      await supabaseAdmin
        .from('pix_webhook_logs')
        .update({ processed: true })
        .eq('payload->endToEndId', endToEndId);
    }

    return new Response(
      JSON.stringify({ success: true }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('[pix-webhook] Error:', error);
    return new Response(
      JSON.stringify({ error: 'Internal server error', details: error.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
