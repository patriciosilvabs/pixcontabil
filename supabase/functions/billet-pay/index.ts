import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

function normalizePem(pem: string): string {
  const lines = pem.split('\n').map(l => l.trim()).filter(l => l.length > 0);
  const result: string[] = [];
  for (const line of lines) {
    if (line.startsWith('-----')) { result.push(line); }
    else { for (let i = 0; i < line.length; i += 64) result.push(line.substring(i, i + 64)); }
  }
  return result.join('\n') + '\n';
}

function decodeCert(raw: string): string {
  const trimmed = raw.trim();
  if (trimmed.startsWith('-----')) return normalizePem(trimmed);
  const cleanB64 = trimmed.replace(/[\s\r\n]/g, '');
  return normalizePem(atob(cleanB64));
}

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
    const { company_id, codigo_barras, valor, data_pagamento, data_vencimento, descricao } = body;

    if (!company_id || !codigo_barras) {
      return new Response(
        JSON.stringify({ error: 'company_id and codigo_barras are required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Get Pix config for cash-out (boleto uses same provider)
    let config: any = null;
    const { data: cashOutConfig } = await supabase
      .from('pix_configs')
      .select('*')
      .eq('company_id', company_id)
      .eq('is_active', true)
      .eq('purpose', 'cash_out')
      .single();
    config = cashOutConfig;
    if (!config) {
      const { data: bothConfig } = await supabase
        .from('pix_configs')
        .select('*')
        .eq('company_id', company_id)
        .eq('is_active', true)
        .eq('purpose', 'both')
        .single();
      config = bothConfig;
    }

    if (!config) {
      return new Response(
        JSON.stringify({ error: 'Configuração Pix não encontrada' }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const provider = config.provider;

    // ========== BANCO INTER ==========
    if (provider === 'inter') {
      if (!config.certificate_encrypted) {
        return new Response(
          JSON.stringify({ error: 'Certificado mTLS obrigatório para Banco Inter' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      // Get auth token
      const authResponse = await fetch(`${Deno.env.get('SUPABASE_URL')}/functions/v1/pix-auth`, {
        method: 'POST',
        headers: { 'Authorization': authHeader, 'Content-Type': 'application/json' },
        body: JSON.stringify({ company_id, purpose: 'cash_out', scopes: 'pagamento-boleto.write pagamento-boleto.read' }),
      });

      if (!authResponse.ok) {
        return new Response(
          JSON.stringify({ error: 'Falha ao autenticar com o provedor' }),
          { status: 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      const { access_token } = await authResponse.json();

      let certPem: string;
      let keyPem: string;
      try {
        certPem = decodeCert(config.certificate_encrypted);
        keyPem = config.certificate_key_encrypted ? decodeCert(config.certificate_key_encrypted) : certPem;
      } catch {
        return new Response(
          JSON.stringify({ error: 'Certificado mTLS inválido' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      const httpClient = Deno.createHttpClient({ cert: certPem, key: keyPem });

      const today = new Date().toISOString().split('T')[0];
      const interPayload: any = {
        codBarraLinhaDigitavel: codigo_barras,
        valorPagar: valor ? Number(valor).toFixed(2) : undefined,
        dataPagamento: data_pagamento || today,
      };
      if (data_vencimento) {
        interPayload.dataVencimento = data_vencimento;
      }

      const fetchHeaders: any = {
        'Authorization': `Bearer ${access_token}`,
        'Content-Type': 'application/json',
      };
      if (config.provider_company_id) {
        fetchHeaders['x-conta-corrente'] = config.provider_company_id;
      }

      let paymentResponse: Response;
      try {
        paymentResponse = await fetch(`${config.base_url}/banking/v2/pagamento`, {
          method: 'POST',
          headers: fetchHeaders,
          body: JSON.stringify(interPayload),
          // @ts-ignore - Deno specific
          client: httpClient,
        });
      } catch (fetchError) {
        httpClient.close();
        return new Response(
          JSON.stringify({ error: 'Falha na conexão mTLS com o Banco Inter', details: fetchError.message }),
          { status: 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      httpClient.close();

      if (!paymentResponse.ok) {
        const errorText = await paymentResponse.text();
        console.error('[billet-pay] Inter error:', errorText);
        return new Response(
          JSON.stringify({ error: 'Falha ao pagar boleto via Banco Inter', provider_error: errorText }),
          { status: 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      const paymentData = await paymentResponse.json();
      console.log('[billet-pay] Inter payment response:', JSON.stringify(paymentData));

      // Save transaction
      const supabaseAdmin = createClient(
        Deno.env.get('SUPABASE_URL')!,
        Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
      );

      const externalId = paymentData.codigoTransacao || paymentData.codigoBarra || crypto.randomUUID();

      const { data: newTransaction, error: insertError } = await supabaseAdmin
        .from('transactions')
        .insert({
          company_id,
          created_by: userId,
          amount: valor || 0,
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
        new_data: { provider, externalId, valor, status: 'pending' },
      });

      return new Response(
        JSON.stringify({
          success: true,
          transaction_id: newTransaction.id,
          external_id: externalId,
          status: paymentData.statusPagamento || 'PROCESSING',
          provider_response: paymentData,
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // ========== OTHER PROVIDERS ==========
    return new Response(
      JSON.stringify({ 
        error: `Pagamento de boletos não é suportado pelo provedor '${provider}'. Atualmente disponível apenas para Banco Inter.`,
      }),
      { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('[billet-pay] Error:', error);
    return new Response(
      JSON.stringify({ error: 'Internal server error', details: error.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
