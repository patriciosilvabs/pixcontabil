import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

function generateIdEnvio(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let result = '';
  for (let i = 0; i < 35; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

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

    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
      return new Response(
        JSON.stringify({ error: 'Invalid token' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const userId = user.id;
    const body = await req.json();
    const { company_id, qr_code, valor, descricao } = body;

    if (!company_id || !qr_code) {
      return new Response(
        JSON.stringify({ error: 'company_id and qr_code are required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const { data: config } = await supabase
      .from('pix_configs')
      .select('*')
      .eq('company_id', company_id)
      .eq('is_active', true)
      .single();

    if (!config) {
      return new Response(
        JSON.stringify({ error: 'Pix configuration not found' }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const provider = config.provider;

    // First decode QR code info
    const qrcInfoResponse = await fetch(`${Deno.env.get('SUPABASE_URL')}/functions/v1/pix-qrc-info`, {
      method: 'POST',
      headers: { 'Authorization': authHeader, 'Content-Type': 'application/json' },
      body: JSON.stringify({ company_id, qr_code }),
    });

    if (!qrcInfoResponse.ok) {
      const errorText = await qrcInfoResponse.text();
      return new Response(
        JSON.stringify({ error: 'Failed to decode QR Code', details: errorText }),
        { status: 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const qrcInfo = await qrcInfoResponse.json();
    const paymentAmount = valor || qrcInfo.amount || 0;
    const destKey = qrcInfo.pix_key;

    if (!destKey && provider !== 'woovi') {
      return new Response(
        JSON.stringify({ error: 'Could not extract Pix key from QR Code' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Now pay via pix-pay-dict (which handles multi-provider)
    const payResponse = await fetch(`${Deno.env.get('SUPABASE_URL')}/functions/v1/pix-pay-dict`, {
      method: 'POST',
      headers: { 'Authorization': authHeader, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        company_id,
        pix_key: destKey || qr_code,
        valor: paymentAmount,
        descricao: descricao || 'Pagamento via QR Code',
      }),
    });

    const payResult = await payResponse.json();

    if (!payResponse.ok) {
      return new Response(
        JSON.stringify(payResult),
        { status: payResponse.status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Update transaction to mark as QR code type
    if (payResult.transaction_id) {
      const supabaseAdmin = createClient(
        Deno.env.get('SUPABASE_URL')!,
        Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
      );
      await supabaseAdmin.from('transactions').update({
        pix_type: 'qrcode',
        pix_copia_cola: qr_code,
      }).eq('id', payResult.transaction_id);
    }

    return new Response(
      JSON.stringify({
        ...payResult,
        amount: paymentAmount,
        qr_info: qrcInfo,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('[pix-pay-qrc] Error:', error);
    return new Response(
      JSON.stringify({ error: 'Internal server error', details: error.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
