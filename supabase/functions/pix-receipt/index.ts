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
    let company_id = url.searchParams.get('company_id');
    let transaction_id = url.searchParams.get('transaction_id');

    if (req.method === 'POST') {
      const body = await req.json();
      end_to_end_id = end_to_end_id || body.end_to_end_id;
      company_id = company_id || body.company_id;
      transaction_id = transaction_id || body.transaction_id;
    }

    if (transaction_id && (!end_to_end_id || !company_id)) {
      const { data: txData } = await supabase
        .from('transactions')
        .select('company_id, pix_e2eid, pix_provider_response, amount, description, paid_at, pix_key')
        .eq('id', transaction_id)
        .single();
      if (txData) {
        company_id = company_id || txData.company_id;
        end_to_end_id = end_to_end_id || txData.pix_e2eid;
      }
    }

    if (!company_id || !end_to_end_id) {
      return new Response(
        JSON.stringify({ error: 'company_id and end_to_end_id are required' }),
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

    // ========== WOOVI ==========
    // Woovi doesn't have a receipt/PDF endpoint; return transaction data
    if (provider === 'woovi') {
      const { data: txData } = await supabase
        .from('transactions')
        .select('*')
        .eq('pix_e2eid', end_to_end_id)
        .single();

      return new Response(
        JSON.stringify({
          success: true,
          end_to_end_id,
          provider: 'woovi',
          receipt_type: 'json',
          transaction: txData,
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // ========== ONZ (via proxy) ==========
    if (provider === 'onz') {
      const receiptUrl = `${config.base_url}/pix/receipts/${end_to_end_id}`;
      const proxyUrl = Deno.env.get('ONZ_PROXY_URL');
      const proxyApiKey = Deno.env.get('ONZ_PROXY_API_KEY');

      if (!proxyUrl || !proxyApiKey) {
        return new Response(
          JSON.stringify({ error: 'ONZ proxy not configured' }),
          { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      const proxyResponse = await fetch(`https://${proxyUrl.replace(/^https?:\/\//, '').replace(/\/+$/, '')}/proxy`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-proxy-api-key': proxyApiKey },
        body: JSON.stringify({
          url: receiptUrl,
          method: 'GET',
          headers: { 'Authorization': `Bearer ${access_token}` },
        }),
      });

      const proxyResult = await proxyResponse.json();
      const data = proxyResult.data;
      return new Response(
        JSON.stringify({ success: true, end_to_end_id, provider: 'onz', pdf_base64: data.pdf, content_type: 'application/pdf' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // ========== TRANSFEERA ==========
    if (provider === 'transfeera') {
      const receiptUrl = `${config.base_url}/pix/transfer/${end_to_end_id}/receipt`;
      const resp = await fetch(receiptUrl, {
        headers: { 'Authorization': `Bearer ${access_token}` },
      });
      const data = await resp.json();
      return new Response(
        JSON.stringify({ success: true, end_to_end_id, provider: 'transfeera', pdf_base64: data.pdf || data.receipt, content_type: 'application/pdf' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // ========== EFI ==========
    if (provider === 'efi') {
      let httpClient: Deno.HttpClient | undefined;
      if (config.certificate_encrypted) {
        try {
          const certPem = atob(config.certificate_encrypted);
          const keyPem = config.certificate_key_encrypted ? atob(config.certificate_key_encrypted) : certPem;
          httpClient = Deno.createHttpClient({ cert: certPem, key: keyPem });
        } catch (_) { /* ignore */ }
      }

      const receiptUrl = `${config.base_url}/v2/gn/receipts/${end_to_end_id}`;
      const fetchOptions: any = {
        method: 'GET',
        headers: { 'Authorization': `Bearer ${access_token}`, 'Content-Type': 'application/json' },
      };
      if (httpClient) fetchOptions.client = httpClient;

      const resp = await fetch(receiptUrl, fetchOptions);
      httpClient?.close();

      if (!resp.ok) {
        const errorText = await resp.text();
        return new Response(
          JSON.stringify({ error: 'Failed to get receipt', provider_error: errorText }),
          { status: 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      const receiptData = await resp.json();
      return new Response(
        JSON.stringify({ success: true, end_to_end_id, provider: 'efi', pdf_base64: receiptData.pdf || receiptData.data?.pdf, content_type: 'application/pdf' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    return new Response(
      JSON.stringify({ error: `Provider '${provider}' não suportado` }),
      { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('[pix-receipt] Error:', error);
    return new Response(
      JSON.stringify({ error: 'Internal server error', details: error.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
