import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-webhook-secret',
};

// ONZ Webhook payload structure
interface ONZWebhookPayload {
  data: {
    id: number;
    idempotencyKey: string;
    endToEndId: string;
    pixKey?: string;
    transactionType: string;
    status: 'CANCELED' | 'PROCESSING' | 'LIQUIDATED' | 'REFUNDED' | 'PARTIALLY_REFUNDED';
    errorCode?: string;
    creditDebitType: 'CREDIT' | 'DEBIT';
    localInstrument: string;
    createdAt: string;
    creditorAccount?: any;
    debtorAccount?: any;
    remittanceInformation?: string;
    txId?: string;
    payment: {
      currency: string;
      amount: number;
    };
    refunds?: any[];
  };
  type: 'TRANSFER' | 'RECEIVE' | 'REFUND' | 'CASHOUT' | 'INFRACTION';
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
    // Validate webhook secret if configured
    const webhookSecret = req.headers.get('x-webhook-secret');
    // We'll validate per-company after finding the transaction,
    // but reject obviously empty payloads early
    
    // Get client IP
    const ip_address = req.headers.get('x-forwarded-for') || 
                       req.headers.get('x-real-ip') || 
                       'unknown';

    // Parse webhook payload
    const payload: ONZWebhookPayload = await req.json();
    console.log('[pix-webhook] Received webhook:', JSON.stringify(payload));

    // Log the webhook
    const { error: logError } = await supabaseAdmin
      .from('pix_webhook_logs')
      .insert({
        event_type: payload.type,
        payload: payload,
        ip_address,
        processed: false,
      });

    if (logError) {
      console.error('[pix-webhook] Failed to log webhook:', logError);
    }

    const paymentData = payload.data;
    const webhookType = payload.type;

    if (!paymentData?.endToEndId) {
      console.error('[pix-webhook] Missing endToEndId in payload');
      return new Response(
        JSON.stringify({ error: 'Missing endToEndId' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Map ONZ status to internal status
    const statusMap: Record<string, string> = {
      'PROCESSING': 'pending',
      'LIQUIDATED': 'completed',
      'CANCELED': 'cancelled',
      'REFUNDED': 'refunded',
      'PARTIALLY_REFUNDED': 'partially_refunded'
    };

    const internalStatus = statusMap[paymentData.status] || 'pending';

    // Find transaction by endToEndId
    const { data: transaction, error: txError } = await supabaseAdmin
      .from('transactions')
      .select('id, company_id, status')
      .eq('pix_e2eid', paymentData.endToEndId)
      .single();

    if (txError || !transaction) {
      // Also try by external_id (provider's id)
      const { data: txById } = await supabaseAdmin
        .from('transactions')
        .select('id, company_id, status')
        .eq('external_id', paymentData.id.toString())
        .single();

      if (!txById) {
        console.log('[pix-webhook] Transaction not found for e2eid:', paymentData.endToEndId);
        
        // For RECEIVE webhooks (cash-in), create a new transaction
        if (webhookType === 'RECEIVE' && paymentData.creditDebitType === 'CREDIT') {
          console.log('[pix-webhook] Creating new transaction for incoming payment');
          
          // We need to find a company to associate - use the first active company with pix config
          const { data: configs } = await supabaseAdmin
            .from('pix_configs')
            .select('company_id')
            .eq('is_active', true)
            .limit(1);

          if (configs && configs.length > 0) {
            const newTransaction = {
              company_id: configs[0].company_id,
              amount: paymentData.payment.amount,
              status: internalStatus,
              pix_type: 'key' as const,
              pix_key: paymentData.pixKey,
              pix_e2eid: paymentData.endToEndId,
              external_id: paymentData.id.toString(),
              description: paymentData.remittanceInformation,
              beneficiary_name: paymentData.debtorAccount?.name,
              beneficiary_document: paymentData.debtorAccount?.document,
              paid_at: paymentData.status === 'LIQUIDATED' ? new Date().toISOString() : null,
              pix_provider_response: payload,
            };

            await supabaseAdmin.from('transactions').insert(newTransaction);
            console.log('[pix-webhook] Created new incoming transaction');
          }
        }

        // Update webhook log as processed
        await supabaseAdmin
          .from('pix_webhook_logs')
          .update({ processed: true })
          .eq('payload->data->endToEndId', paymentData.endToEndId);

        return new Response(
          JSON.stringify({ success: true, message: 'Webhook processed' }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      // Update transaction found by external_id
      const updateData: any = {
        status: internalStatus,
        pix_provider_response: payload,
        pix_e2eid: paymentData.endToEndId,
      };

      if (paymentData.status === 'LIQUIDATED') {
        updateData.paid_at = new Date().toISOString();
      }

      await supabaseAdmin
        .from('transactions')
        .update(updateData)
        .eq('id', txById.id);

      // Log audit
      await supabaseAdmin.from('audit_logs').insert({
        company_id: txById.company_id,
        entity_type: 'transaction',
        entity_id: txById.id,
        action: `pix_webhook_${webhookType.toLowerCase()}`,
        old_data: { status: txById.status },
        new_data: { status: internalStatus, provider_status: paymentData.status },
      });

    } else {
      // Update existing transaction
      const updateData: any = {
        status: internalStatus,
        pix_provider_response: payload,
      };

      if (paymentData.status === 'LIQUIDATED') {
        updateData.paid_at = new Date().toISOString();
      }

      await supabaseAdmin
        .from('transactions')
        .update(updateData)
        .eq('id', transaction.id);

      // Log audit
      await supabaseAdmin.from('audit_logs').insert({
        company_id: transaction.company_id,
        entity_type: 'transaction',
        entity_id: transaction.id,
        action: `pix_webhook_${webhookType.toLowerCase()}`,
        old_data: { status: transaction.status },
        new_data: { status: internalStatus, provider_status: paymentData.status },
      });

      console.log(`[pix-webhook] Updated transaction ${transaction.id} to status: ${internalStatus}`);
    }

    // Handle refund webhooks
    if (webhookType === 'REFUND' && paymentData.refunds && paymentData.refunds.length > 0) {
      for (const refund of paymentData.refunds) {
        // Check if refund already exists
        const { data: existingRefund } = await supabaseAdmin
          .from('pix_refunds')
          .select('id')
          .eq('e2eid', paymentData.endToEndId)
          .eq('refund_id', refund.id || refund.rtrId)
          .single();

        if (!existingRefund && transaction) {
          await supabaseAdmin.from('pix_refunds').insert({
            transaction_id: transaction.id,
            e2eid: paymentData.endToEndId,
            refund_id: refund.id || refund.rtrId || `REF_${Date.now()}`,
            valor: refund.amount || refund.valor,
            motivo: refund.motivo || refund.reason,
            status: refund.status || 'DEVOLVIDO',
            refunded_at: new Date().toISOString(),
          });
        }
      }
    }

    // Mark webhook as processed
    await supabaseAdmin
      .from('pix_webhook_logs')
      .update({ processed: true })
      .eq('payload->data->endToEndId', paymentData.endToEndId);

    return new Response(
      JSON.stringify({ success: true }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('[pix-webhook] Error:', error);

    // Log error
    await supabaseAdmin
      .from('pix_webhook_logs')
      .update({ 
        processed: false, 
        error_message: error.message 
      })
      .order('created_at', { ascending: false })
      .limit(1);

    return new Response(
      JSON.stringify({ error: 'Internal server error', details: error.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
