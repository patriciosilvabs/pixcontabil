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
    const { data: claims, error: authError } = await supabase.auth.getClaims(token);
    
    if (authError || !claims?.claims) {
      return new Response(
        JSON.stringify({ error: 'Invalid token' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const url = new URL(req.url);
    let end_to_end_id = url.searchParams.get('end_to_end_id');
    let transaction_id = url.searchParams.get('transaction_id');
    let company_id = url.searchParams.get('company_id');

    if (req.method === 'POST') {
      const body = await req.json();
      end_to_end_id = end_to_end_id || body.end_to_end_id;
      transaction_id = transaction_id || body.transaction_id;
      company_id = company_id || body.company_id;
    }

    if (transaction_id && !company_id) {
      const { data: txData } = await supabase
        .from('transactions')
        .select('company_id, pix_e2eid')
        .eq('id', transaction_id)
        .single();

      if (txData) {
        company_id = txData.company_id;
        end_to_end_id = end_to_end_id || txData.pix_e2eid;
      }
    }

    if (!company_id || !end_to_end_id) {
      return new Response(
        JSON.stringify({ error: 'company_id and end_to_end_id are required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log(`[pix-check-status] Checking EFI status for e2eId: ${end_to_end_id}`);

    const { data: config, error: configError } = await supabase
      .from('pix_configs')
      .select('*')
      .eq('company_id', company_id)
      .eq('is_active', true)
      .single();

    if (configError || !config) {
      return new Response(
        JSON.stringify({ error: 'Pix configuration not found' }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const authResponse = await fetch(`${Deno.env.get('SUPABASE_URL')}/functions/v1/pix-auth`, {
      method: 'POST',
      headers: { 'Authorization': authHeader, 'Content-Type': 'application/json' },
      body: JSON.stringify({ company_id }),
    });

    if (!authResponse.ok) {
      return new Response(
        JSON.stringify({ error: 'Failed to authenticate with EFI Pay' }),
        { status: 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const { access_token } = await authResponse.json();

    // Create mTLS HTTP client
    let httpClient: Deno.HttpClient | undefined;
    if (config.certificate_encrypted) {
      try {
        const certPem = atob(config.certificate_encrypted);
        const keyPem = config.certificate_key_encrypted ? atob(config.certificate_key_encrypted) : certPem;
        httpClient = Deno.createHttpClient({ cert: certPem, key: keyPem });
      } catch (e) {
        console.error('[pix-check-status] Failed to create mTLS client:', e);
      }
    }

    // EFI endpoint: GET /v2/pix/:e2eId
    const statusUrl = `${config.base_url}/v2/pix/${end_to_end_id}`;
    const fetchOptions: any = {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${access_token}`,
        'Content-Type': 'application/json',
      },
    };
    if (httpClient) fetchOptions.client = httpClient;

    const statusResponse = await fetch(statusUrl, fetchOptions);
    httpClient?.close();

    if (!statusResponse.ok) {
      const errorText = await statusResponse.text();
      console.error('[pix-check-status] EFI error:', errorText);
      return new Response(
        JSON.stringify({ error: 'Failed to get payment status', provider_error: errorText, status: statusResponse.status }),
        { status: 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const statusData = await statusResponse.json();
    console.log('[pix-check-status] Status received:', JSON.stringify(statusData));

    // Map EFI/BCB status to internal
    const efiStatus = statusData.status || '';
    const statusMap: Record<string, string> = {
      'REALIZADO': 'completed',
      'EM_PROCESSAMENTO': 'pending',
      'NAO_REALIZADO': 'failed',
      'DEVOLVIDO': 'refunded',
    };

    const internalStatus = statusMap[efiStatus] || 'pending';
    const isCompleted = efiStatus === 'REALIZADO';

    // Update transaction in DB
    if (transaction_id) {
      const supabaseAdmin = createClient(
        Deno.env.get('SUPABASE_URL')!,
        Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
      );

      const updateData: any = { status: internalStatus, pix_provider_response: statusData };
      if (isCompleted) updateData.paid_at = new Date().toISOString();

      await supabaseAdmin.from('transactions').update(updateData).eq('id', transaction_id);
    }

    return new Response(
      JSON.stringify({
        success: true,
        end_to_end_id: statusData.endToEndId || end_to_end_id,
        status: efiStatus,
        internal_status: internalStatus,
        is_completed: isCompleted,
        valor: statusData.valor,
        horario: statusData.horario,
        infoPagador: statusData.infoPagador,
        devolucoes: statusData.devolucoes,
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
