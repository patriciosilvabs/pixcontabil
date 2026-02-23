import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
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
    const { data: userData, error: authError } = await supabase.auth.getUser(token);
    if (authError || !userData?.user) {
      return new Response(
        JSON.stringify({ error: 'Invalid token' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const userId = userData.user.id;
    const body = await req.json();
    const { company_id, codigo_barras, descricao, payment_flow } = body;

    if (!company_id || !codigo_barras) {
      return new Response(
        JSON.stringify({ error: 'company_id and codigo_barras are required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Get config (cash_out or both)
    let config: any = null;
    const { data: cashOutConfig } = await supabase
      .from('pix_configs')
      .select('*')
      .eq('company_id', company_id)
      .eq('is_active', true)
      .in('purpose', ['cash_out', 'both'])
      .limit(1)
      .maybeSingle();
    config = cashOutConfig;

    if (!config) {
      return new Response(
        JSON.stringify({ error: 'Configuração Pix não encontrada para pagamento de boletos.' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Get auth token
    const authResponse = await fetch(`${Deno.env.get('SUPABASE_URL')}/functions/v1/pix-auth`, {
      method: 'POST',
      headers: { 'Authorization': authHeader, 'Content-Type': 'application/json' },
      body: JSON.stringify({ company_id, purpose: 'cash_out' }),
    });

    if (!authResponse.ok) {
      return new Response(
        JSON.stringify({ error: 'Falha ao autenticar com o provedor' }),
        { status: 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const { access_token } = await authResponse.json();

    // ONZ billet payment via proxy
    const payUrl = `${config.base_url}/billets/payments`;
    const proxyUrl = Deno.env.get('ONZ_PROXY_URL');
    const proxyApiKey = Deno.env.get('ONZ_PROXY_API_KEY');
    if (!proxyUrl || !proxyApiKey) {
      return new Response(
        JSON.stringify({ error: 'ONZ_PROXY_URL não configurado' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const idempotencyKey = crypto.randomUUID();
    const onzPayload: any = {
      digitableCode: codigo_barras,
    };
    if (payment_flow) {
      onzPayload.paymentFlow = payment_flow; // "INSTANT" or "APPROVAL_REQUIRED"
    }

    const fetchHeaders: any = {
      'Authorization': `Bearer ${access_token}`,
      'Content-Type': 'application/json',
      'x-idempotency-key': idempotencyKey,
    };
    if (config.provider_company_id) fetchHeaders['X-Company-ID'] = config.provider_company_id;

    let paymentData: any;
    try {
      const proxyResponse = await fetch(`${proxyUrl}/proxy`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Proxy-API-Key': proxyApiKey },
        body: JSON.stringify({ url: payUrl, method: 'POST', headers: fetchHeaders, body: onzPayload }),
      });

      const proxyData = await proxyResponse.json();
      const data = proxyData.data || proxyData;

      if (!proxyResponse.ok || (proxyData.status && proxyData.status >= 400)) {
        console.error('[billet-pay] ONZ error:', JSON.stringify(data));
        return new Response(
          JSON.stringify({ error: 'Falha ao pagar boleto via ONZ', provider_error: JSON.stringify(data) }),
          { status: 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      paymentData = data;
    } catch (e) {
      return new Response(
        JSON.stringify({ error: 'Falha na conexão com ONZ', details: e.message }),
        { status: 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log('[billet-pay] ONZ payment response:', JSON.stringify(paymentData));

    // Save transaction
    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );

    const externalId = paymentData.id || paymentData.paymentId || idempotencyKey;
    const amount = paymentData.amount || paymentData.valor || 0;

    const { data: newTransaction, error: insertError } = await supabaseAdmin
      .from('transactions')
      .insert({
        company_id,
        created_by: userId,
        amount,
        status: 'pending',
        pix_type: 'boleto' as const,
        boleto_code: codigo_barras,
        description: descricao || 'Pagamento de boleto',
        external_id: externalId,
        pix_provider_response: paymentData,
      })
      .select('id')
      .single();

    if (insertError) {
      console.error('[billet-pay] Failed to create transaction:', insertError);
      return new Response(
        JSON.stringify({ error: 'Failed to save transaction' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    await supabaseAdmin.from('audit_logs').insert({
      user_id: userId,
      company_id,
      entity_type: 'transaction',
      entity_id: newTransaction.id,
      action: 'billet_payment_initiated',
      new_data: { provider: 'onz', externalId, amount, status: 'pending' },
    });

    return new Response(
      JSON.stringify({
        success: true,
        transaction_id: newTransaction.id,
        external_id: externalId,
        status: paymentData.status || 'PROCESSING',
        provider_response: paymentData,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('[billet-pay] Error:', error);
    return new Response(
      JSON.stringify({ error: 'Internal server error', details: error.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
