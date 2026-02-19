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
        .select('company_id, pix_e2eid, external_id')
        .eq('id', transaction_id)
        .single();
      if (txData) {
        company_id = txData.company_id;
        end_to_end_id = end_to_end_id || txData.pix_e2eid;
      }
    }

    if (!company_id) {
      return new Response(
        JSON.stringify({ error: 'company_id is required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // For check-status, try to detect purpose from transaction type, fallback to any
    let config: any = null;
    // Try cash_out first (payments are more common for status checks)
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
      const { data: cashInConfig } = await supabase
        .from('pix_configs')
        .select('*')
        .eq('company_id', company_id)
        .eq('is_active', true)
        .eq('purpose', 'cash_in')
        .single();
      config = cashInConfig;
    }

    if (!config) {
      return new Response(
        JSON.stringify({ error: 'Pix configuration not found' }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const provider = config.provider;

    const authResponse = await fetch(`${Deno.env.get('SUPABASE_URL')}/functions/v1/pix-auth`, {
      method: 'POST',
      headers: { 'Authorization': authHeader, 'Content-Type': 'application/json' },
      body: JSON.stringify({ company_id }),
    });

    if (!authResponse.ok) {
      return new Response(
        JSON.stringify({ error: 'Failed to authenticate with provider' }),
        { status: 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const { access_token } = await authResponse.json();

    let statusData: any;

    // ========== WOOVI ==========
    if (provider === 'woovi') {
      const chargeUrl = `${config.base_url}/api/v1/charge/${end_to_end_id}`;
      const resp = await fetch(chargeUrl, {
        headers: { 'Authorization': access_token, 'Content-Type': 'application/json' },
      });
      if (resp.ok) {
        statusData = await resp.json();
      } else {
        await resp.text();
        const payUrl = `${config.base_url}/api/v1/payment/${end_to_end_id}`;
        const resp2 = await fetch(payUrl, {
          headers: { 'Authorization': access_token, 'Content-Type': 'application/json' },
        });
        statusData = await resp2.json();
      }
    }
    // ========== PAGGUE ==========
    else if (provider === 'paggue') {
      const paggueCompanyId = config.provider_company_id;
      const statusUrl = `https://ms.paggue.io/cashout/api/cash-out/${end_to_end_id}`;
      console.log(`[pix-check-status] Paggue: GET ${statusUrl}`);
      const resp = await fetch(statusUrl, {
        headers: {
          'Authorization': `Bearer ${access_token}`,
          'Content-Type': 'application/json',
          ...(paggueCompanyId ? { 'X-Company-ID': paggueCompanyId } : {}),
        },
      });
      statusData = await resp.json();
      console.log('[pix-check-status] Paggue raw status:', JSON.stringify(statusData));
    }
    // ========== ONZ ==========
    else if (provider === 'onz') {
      const statusUrl = `${config.base_url}/pix/payments/${end_to_end_id}`;
      const resp = await fetch(statusUrl, {
        headers: { 'Authorization': `Bearer ${access_token}`, 'Content-Type': 'application/json' },
      });
      statusData = await resp.json();
    }
    // ========== TRANSFEERA ==========
    else if (provider === 'transfeera') {
      const statusUrl = `${config.base_url}/pix/transfer/${end_to_end_id}`;
      const resp = await fetch(statusUrl, {
        headers: { 'Authorization': `Bearer ${access_token}`, 'Content-Type': 'application/json' },
      });
      statusData = await resp.json();
    }
    // ========== EFI ==========
    else if (provider === 'efi') {
      let httpClient: Deno.HttpClient | undefined;
      if (config.certificate_encrypted) {
        try {
          const certPem = atob(config.certificate_encrypted);
          const keyPem = config.certificate_key_encrypted ? atob(config.certificate_key_encrypted) : certPem;
          httpClient = Deno.createHttpClient({ cert: certPem, key: keyPem });
        } catch (_) { /* ignore */ }
      }

      const statusUrl = `${config.base_url}/v2/pix/${end_to_end_id}`;
      const fetchOptions: any = {
        method: 'GET',
        headers: { 'Authorization': `Bearer ${access_token}`, 'Content-Type': 'application/json' },
      };
      if (httpClient) fetchOptions.client = httpClient;

      const resp = await fetch(statusUrl, fetchOptions);
      httpClient?.close();
      statusData = await resp.json();
    }
    // ========== BANCO INTER ==========
    else if (provider === 'inter') {
      let httpClient: Deno.HttpClient | undefined;
      if (config.certificate_encrypted) {
        try {
          const certPem = atob(config.certificate_encrypted);
          const keyPem = config.certificate_key_encrypted ? atob(config.certificate_key_encrypted) : certPem;
          httpClient = Deno.createHttpClient({ cert: certPem, key: keyPem });
        } catch (_) { /* ignore */ }
      }

      const statusUrl = `${config.base_url}/banking/v2/pix/${end_to_end_id}`;
      const fetchHeaders: any = {
        'Authorization': `Bearer ${access_token}`,
        'Content-Type': 'application/json',
      };
      if (config.provider_company_id) {
        fetchHeaders['x-conta-corrente'] = config.provider_company_id;
      }

      const fetchOptions: any = { method: 'GET', headers: fetchHeaders };
      if (httpClient) fetchOptions.client = httpClient;

      const resp = await fetch(statusUrl, fetchOptions);
      httpClient?.close();
      statusData = await resp.json();
    } else {
      return new Response(
        JSON.stringify({ error: `Provider '${provider}' não suportado` }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log('[pix-check-status] Status received:', JSON.stringify(statusData));

    // Normalize status
    const rawStatus = statusData.status || '';
    const statusMap: Record<string, string> = {
      'REALIZADO': 'completed', 'COMPLETED': 'completed', 'CONFIRMED': 'completed',
      'PROCESSADO': 'completed', 'EFETIVADO': 'completed',
      'EM_PROCESSAMENTO': 'pending', 'PROCESSING': 'pending', 'ACTIVE': 'pending',
      'EMPROCESSAMENTO': 'pending', 'APROVACAO': 'pending',
      'NAO_REALIZADO': 'failed', 'FAILED': 'failed', 'ERROR': 'failed',
      'CANCELADO': 'failed',
      'DEVOLVIDO': 'refunded', 'REFUNDED': 'refunded',
      // Paggue statuses (numeric as string)
      '0': 'pending', '1': 'completed', '2': 'failed', '3': 'pending', '5': 'cancelled',
    };
    const rawStatusStr = String(statusData.status || '');
    const internalStatus = statusMap[rawStatusStr.toUpperCase()] || statusMap[rawStatusStr] || 'pending';
    const isCompleted = internalStatus === 'completed';

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
        end_to_end_id,
        status: rawStatus,
        internal_status: internalStatus,
        is_completed: isCompleted,
        provider,
        payload: statusData,
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
