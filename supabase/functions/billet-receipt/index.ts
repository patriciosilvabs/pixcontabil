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
    let billet_id = url.searchParams.get('billet_id');
    let transaction_id = url.searchParams.get('transaction_id');
    let company_id = url.searchParams.get('company_id');

    if (req.method === 'POST') {
      const body = await req.json();
      billet_id = billet_id || body.billet_id;
      transaction_id = transaction_id || body.transaction_id;
      company_id = company_id || body.company_id;
    }

    // Resolve from transaction
    if (transaction_id && (!billet_id || !company_id)) {
      const { data: txData } = await supabase
        .from('transactions')
        .select('company_id, external_id')
        .eq('id', transaction_id)
        .single();

      if (txData) {
        company_id = company_id || txData.company_id;
        billet_id = billet_id || txData.external_id;
      }
    }

    if (!company_id || !billet_id) {
      return new Response(
        JSON.stringify({ error: 'company_id and (billet_id or transaction_id) are required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log(`[billet-receipt] Getting receipt for billet ${billet_id}`);

    const { data: config, error: configError } = await supabase
      .from('pix_configs')
      .select('*')
      .eq('company_id', company_id)
      .eq('is_active', true)
      .single();

    if (configError || !config) {
      return new Response(
        JSON.stringify({ error: 'API configuration not found' }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const authResponse = await fetch(`${Deno.env.get('SUPABASE_URL')}/functions/v1/pix-auth`, {
      method: 'POST',
      headers: {
        'Authorization': authHeader,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ company_id }),
    });

    if (!authResponse.ok) {
      return new Response(
        JSON.stringify({ error: 'Failed to authenticate with provider' }),
        { status: 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const { access_token } = await authResponse.json();

    // Create mTLS HTTP client
    let httpClient: Deno.HttpClient | undefined;
    if (config.certificate_encrypted && config.certificate_key_encrypted) {
      try {
        httpClient = Deno.createHttpClient({
          cert: atob(config.certificate_encrypted),
          key: atob(config.certificate_key_encrypted),
        });
      } catch (e) {
        console.error('[billet-receipt] Failed to create mTLS client:', e);
      }
    }

    const receiptUrl = `${config.base_url}/billets/payments/receipt/${billet_id}`;
    const fetchOptions: any = {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${access_token}`,
        'Content-Type': 'application/json',
      },
    };
    if (httpClient) fetchOptions.client = httpClient;

    const receiptResponse = await fetch(receiptUrl, fetchOptions);
    httpClient?.close();

    if (!receiptResponse.ok) {
      const errorText = await receiptResponse.text();
      console.error('[billet-receipt] Provider error:', errorText);
      return new Response(
        JSON.stringify({
          error: 'Failed to get billet receipt',
          provider_error: errorText,
          status: receiptResponse.status,
        }),
        { status: 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const receiptData = await receiptResponse.json();
    console.log('[billet-receipt] Receipt received');

    return new Response(
      JSON.stringify({
        success: true,
        billet_id,
        pdf_base64: receiptData.data?.pdf || receiptData.pdf,
        content_type: 'application/pdf',
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('[billet-receipt] Error:', error);
    return new Response(
      JSON.stringify({ error: 'Internal server error', details: error.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
