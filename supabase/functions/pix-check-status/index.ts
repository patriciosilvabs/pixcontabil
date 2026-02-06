import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface CobStatusResponse {
  txid: string;
  revisao: number;
  status: 'ATIVA' | 'CONCLUIDA' | 'REMOVIDA_PELO_USUARIO_RECEBEDOR' | 'REMOVIDA_PELO_PSP';
  calendario: {
    criacao: string;
    expiracao: number;
  };
  valor: {
    original: string;
  };
  chave: string;
  pix?: Array<{
    endToEndId: string;
    txid: string;
    valor: string;
    horario: string;
    infoPagador?: string;
  }>;
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

    // Get query params
    const url = new URL(req.url);
    const txid = url.searchParams.get('txid');
    const transaction_id = url.searchParams.get('transaction_id');

    if (!txid && !transaction_id) {
      return new Response(
        JSON.stringify({ error: 'txid or transaction_id is required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log(`[pix-check-status] Checking status for txid: ${txid}, transaction_id: ${transaction_id}`);

    // Get transaction from database
    let query = supabase.from('transactions').select('*, company:companies(*)');
    
    if (transaction_id) {
      query = query.eq('id', transaction_id);
    } else if (txid) {
      query = query.eq('pix_txid', txid);
    }

    const { data: transaction, error: txError } = await query.single();

    if (txError || !transaction) {
      return new Response(
        JSON.stringify({ error: 'Transaction not found' }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // If already completed, return cached status
    if (transaction.status === 'completed') {
      return new Response(
        JSON.stringify({
          txid: transaction.pix_txid,
          status: 'CONCLUIDA',
          paid: true,
          paid_at: transaction.paid_at,
          e2eid: transaction.pix_e2eid,
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
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

    // Check status on Pix provider
    const statusUrl = `${config.base_url}/cob/${transaction.pix_txid}`;
    const statusResponse = await fetch(statusUrl, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${access_token}`,
      },
    });

    if (!statusResponse.ok) {
      const errorText = await statusResponse.text();
      console.error('[pix-check-status] Provider error:', errorText);
      return new Response(
        JSON.stringify({ 
          error: 'Failed to check status',
          provider_error: errorText 
        }),
        { status: 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const statusData: CobStatusResponse = await statusResponse.json();
    console.log('[pix-check-status] Status from provider:', statusData.status);

    // Update transaction if status changed
    if (statusData.status === 'CONCLUIDA' && transaction.status !== 'completed') {
      const supabaseAdmin = createClient(
        Deno.env.get('SUPABASE_URL')!,
        Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
      );

      const pixInfo = statusData.pix?.[0];
      
      await supabaseAdmin
        .from('transactions')
        .update({
          status: 'completed',
          paid_at: pixInfo?.horario || new Date().toISOString(),
          pix_e2eid: pixInfo?.endToEndId,
          pix_provider_response: statusData,
        })
        .eq('id', transaction.id);

      console.log('[pix-check-status] Transaction marked as completed');
    } else if (
      (statusData.status === 'REMOVIDA_PELO_USUARIO_RECEBEDOR' || 
       statusData.status === 'REMOVIDA_PELO_PSP') && 
      transaction.status === 'pending'
    ) {
      const supabaseAdmin = createClient(
        Deno.env.get('SUPABASE_URL')!,
        Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
      );

      await supabaseAdmin
        .from('transactions')
        .update({
          status: 'cancelled',
          pix_provider_response: statusData,
        })
        .eq('id', transaction.id);

      console.log('[pix-check-status] Transaction cancelled');
    }

    return new Response(
      JSON.stringify({
        txid: statusData.txid,
        status: statusData.status,
        paid: statusData.status === 'CONCLUIDA',
        paid_at: statusData.pix?.[0]?.horario,
        e2eid: statusData.pix?.[0]?.endToEndId,
        valor: statusData.valor.original,
        pix_data: statusData.pix,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('[pix-check-status] Error:', error);
    return new Response(
      JSON.stringify({ error: 'Internal server error', details: error.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
