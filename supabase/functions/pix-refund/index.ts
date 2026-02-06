import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface RefundRequest {
  transaction_id: string;
  valor?: number; // If not provided, full refund
  motivo?: string;
}

interface RefundResponse {
  id: string;
  rtrId: string;
  valor: string;
  horario: {
    solicitacao: string;
    liquidacao?: string;
  };
  status: 'EM_PROCESSAMENTO' | 'DEVOLVIDO' | 'NAO_REALIZADO';
  motivo?: string;
}

// Generate refund ID (unique per e2eid)
function generateRefundId(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let result = '';
  for (let i = 0; i < 10; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    // Authenticate user
    const authHeader = req.headers.get('Authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      return new Response(
        JSON.stringify({ error: 'Unauthorized' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!,
      { global: { headers: { Authorization: authHeader } } }
    );

    const token = authHeader.replace('Bearer ', '');
    const { data: claims, error: authError } = await supabase.auth.getClaims(token);
    
    if (authError || !claims?.claims) {
      return new Response(
        JSON.stringify({ error: 'Invalid token' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const userId = claims.claims.sub as string;

    // Get request body
    const body: RefundRequest = await req.json();
    const { transaction_id, valor, motivo } = body;

    if (!transaction_id) {
      return new Response(
        JSON.stringify({ error: 'transaction_id is required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log(`[pix-refund] Requesting refund for transaction: ${transaction_id}`);

    // Get transaction
    const { data: transaction, error: txError } = await supabase
      .from('transactions')
      .select('*')
      .eq('id', transaction_id)
      .single();

    if (txError || !transaction) {
      return new Response(
        JSON.stringify({ error: 'Transaction not found' }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Validate transaction state
    if (transaction.status !== 'completed') {
      return new Response(
        JSON.stringify({ error: 'Only completed transactions can be refunded' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (!transaction.pix_e2eid) {
      return new Response(
        JSON.stringify({ error: 'Transaction does not have e2eid (not a Pix payment)' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Calculate refund value
    const refundValue = valor || transaction.amount;

    // Check for existing refunds to prevent over-refunding
    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );

    const { data: existingRefunds } = await supabaseAdmin
      .from('pix_refunds')
      .select('valor, status')
      .eq('transaction_id', transaction_id)
      .neq('status', 'NAO_REALIZADO');

    const totalRefunded = existingRefunds?.reduce((sum, r) => sum + Number(r.valor), 0) || 0;
    const availableForRefund = Number(transaction.amount) - totalRefunded;

    if (refundValue > availableForRefund) {
      return new Response(
        JSON.stringify({ 
          error: 'Refund value exceeds available amount',
          available: availableForRefund,
          requested: refundValue
        }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Get Pix config
    const { data: config, error: configError } = await supabase
      .from('pix_configs')
      .select('*')
      .eq('company_id', transaction.company_id)
      .eq('is_active', true)
      .single();

    if (configError || !config) {
      return new Response(
        JSON.stringify({ error: 'Pix configuration not found' }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Get auth token
    const authResponse = await fetch(`${Deno.env.get('SUPABASE_URL')}/functions/v1/pix-auth`, {
      method: 'POST',
      headers: {
        'Authorization': authHeader,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ company_id: transaction.company_id }),
    });

    if (!authResponse.ok) {
      return new Response(
        JSON.stringify({ error: 'Failed to authenticate with Pix provider' }),
        { status: 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const { access_token } = await authResponse.json();

    // Generate refund ID
    const refundId = generateRefundId();

    // Request refund from Pix provider
    const refundUrl = `${config.base_url}/pix/${transaction.pix_e2eid}/devolucao/${refundId}`;
    const refundPayload = {
      valor: refundValue.toFixed(2),
    };

    console.log(`[pix-refund] Requesting refund at: ${refundUrl}`);

    const refundResponse = await fetch(refundUrl, {
      method: 'PUT',
      headers: {
        'Authorization': `Bearer ${access_token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(refundPayload),
    });

    if (!refundResponse.ok) {
      const errorText = await refundResponse.text();
      console.error('[pix-refund] Provider error:', errorText);
      return new Response(
        JSON.stringify({ 
          error: 'Failed to request refund',
          provider_error: errorText 
        }),
        { status: 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const refundData: RefundResponse = await refundResponse.json();
    console.log('[pix-refund] Refund response:', JSON.stringify(refundData));

    // Save refund to database
    const { data: savedRefund, error: saveError } = await supabaseAdmin
      .from('pix_refunds')
      .insert({
        transaction_id,
        e2eid: transaction.pix_e2eid,
        refund_id: refundId,
        valor: refundValue,
        motivo,
        status: refundData.status,
        refunded_at: refundData.horario?.liquidacao,
        created_by: userId,
      })
      .select()
      .single();

    if (saveError) {
      console.error('[pix-refund] Failed to save refund:', saveError);
    }

    // Log to audit
    await supabaseAdmin.from('audit_logs').insert({
      user_id: userId,
      company_id: transaction.company_id,
      entity_type: 'pix_refund',
      entity_id: savedRefund?.id,
      action: 'pix_refund_requested',
      new_data: { 
        refund_id: refundId, 
        valor: refundValue, 
        status: refundData.status 
      },
    });

    return new Response(
      JSON.stringify({
        success: true,
        refund_id: refundId,
        status: refundData.status,
        valor: refundValue,
        rtrId: refundData.rtrId,
        horario: refundData.horario,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('[pix-refund] Error:', error);
    return new Response(
      JSON.stringify({ error: 'Internal server error', details: error.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
