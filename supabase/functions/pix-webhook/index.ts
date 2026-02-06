import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-webhook-secret',
};

interface PixWebhookPayload {
  pix?: Array<{
    endToEndId: string;
    txid?: string;
    valor: string;
    horario: string;
    infoPagador?: string;
    componentesValor?: {
      original: { valor: string };
    };
  }>;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  // Get client IP for logging
  const clientIP = req.headers.get('x-forwarded-for') || 
                   req.headers.get('x-real-ip') || 
                   'unknown';

  const supabaseAdmin = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  );

  try {
    console.log(`[pix-webhook] Received webhook from IP: ${clientIP}`);

    // Get the webhook secret from header
    const webhookSecret = req.headers.get('x-webhook-secret');
    
    // Parse body
    const body = await req.text();
    let payload: PixWebhookPayload;
    
    try {
      payload = JSON.parse(body);
    } catch {
      console.error('[pix-webhook] Invalid JSON payload');
      await supabaseAdmin.from('pix_webhook_logs').insert({
        event_type: 'parse_error',
        payload: { raw: body.substring(0, 1000) },
        ip_address: clientIP,
        processed: false,
        error_message: 'Invalid JSON',
      });
      return new Response(
        JSON.stringify({ error: 'Invalid JSON payload' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log('[pix-webhook] Payload:', JSON.stringify(payload));

    // Process each pix in the webhook
    if (payload.pix && Array.isArray(payload.pix)) {
      for (const pix of payload.pix) {
        console.log(`[pix-webhook] Processing pix: e2eid=${pix.endToEndId}, txid=${pix.txid}`);

        // Find transaction by txid or e2eid
        let query = supabaseAdmin.from('transactions').select('*');
        
        if (pix.txid) {
          query = query.eq('pix_txid', pix.txid);
        } else {
          query = query.eq('pix_e2eid', pix.endToEndId);
        }

        const { data: transaction, error: txError } = await query.single();

        if (txError || !transaction) {
          console.log(`[pix-webhook] Transaction not found for txid: ${pix.txid}`);
          
          // Log the webhook for later processing
          await supabaseAdmin.from('pix_webhook_logs').insert({
            event_type: 'pix_received',
            payload: pix,
            ip_address: clientIP,
            processed: false,
            error_message: 'Transaction not found',
          });
          
          continue;
        }

        // Validate webhook secret if configured
        if (transaction.company_id) {
          const { data: config } = await supabaseAdmin
            .from('pix_configs')
            .select('webhook_secret')
            .eq('company_id', transaction.company_id)
            .single();

          if (config?.webhook_secret && webhookSecret !== config.webhook_secret) {
            console.error('[pix-webhook] Invalid webhook secret');
            await supabaseAdmin.from('pix_webhook_logs').insert({
              company_id: transaction.company_id,
              event_type: 'pix_received',
              payload: pix,
              ip_address: clientIP,
              processed: false,
              error_message: 'Invalid webhook secret',
            });
            continue;
          }
        }

        // Update transaction status
        if (transaction.status !== 'completed') {
          await supabaseAdmin
            .from('transactions')
            .update({
              status: 'completed',
              paid_at: pix.horario,
              pix_e2eid: pix.endToEndId,
              pix_provider_response: pix,
            })
            .eq('id', transaction.id);

          console.log(`[pix-webhook] Transaction ${transaction.id} marked as completed`);

          // Log to audit
          await supabaseAdmin.from('audit_logs').insert({
            company_id: transaction.company_id,
            entity_type: 'transaction',
            entity_id: transaction.id,
            action: 'pix_payment_received',
            new_data: { 
              e2eid: pix.endToEndId, 
              valor: pix.valor, 
              horario: pix.horario 
            },
          });
        }

        // Log successful webhook processing
        await supabaseAdmin.from('pix_webhook_logs').insert({
          company_id: transaction.company_id,
          event_type: 'pix_received',
          payload: pix,
          ip_address: clientIP,
          processed: true,
        });
      }
    }

    return new Response(
      JSON.stringify({ success: true }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('[pix-webhook] Error:', error);

    // Log error
    await supabaseAdmin.from('pix_webhook_logs').insert({
      event_type: 'processing_error',
      payload: { error: error.message },
      ip_address: clientIP,
      processed: false,
      error_message: error.message,
    });

    return new Response(
      JSON.stringify({ error: 'Internal server error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
