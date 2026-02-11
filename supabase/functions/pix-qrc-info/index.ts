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

    const body = await req.json();
    const { company_id, qr_code } = body;

    if (!company_id || !qr_code) {
      return new Response(
        JSON.stringify({ error: 'company_id and qr_code are required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log(`[pix-qrc-info] Decoding QR Code via EFI for company: ${company_id}`);

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

    let httpClient: Deno.HttpClient | undefined;
    if (config.certificate_encrypted) {
      try {
        const certPem = atob(config.certificate_encrypted);
        const keyPem = config.certificate_key_encrypted ? atob(config.certificate_key_encrypted) : certPem;
        httpClient = Deno.createHttpClient({ cert: certPem, key: keyPem });
      } catch (e) {
        console.error('[pix-qrc-info] Failed to create mTLS client:', e);
      }
    }

    // EFI QR Code decode endpoint
    const infoUrl = `${config.base_url}/v2/gn/qrcode/decode`;
    const fetchOptions: any = {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${access_token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ qrcode: qr_code }),
    };
    if (httpClient) fetchOptions.client = httpClient;

    const infoResponse = await fetch(infoUrl, fetchOptions);
    httpClient?.close();

    if (!infoResponse.ok) {
      const errorText = await infoResponse.text();
      console.error('[pix-qrc-info] EFI error:', errorText);
      return new Response(
        JSON.stringify({ error: 'Failed to decode QR Code', provider_error: errorText, status: infoResponse.status }),
        { status: 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const qrcInfo = await infoResponse.json();
    console.log('[pix-qrc-info] QR Code decoded:', JSON.stringify(qrcInfo));

    return new Response(
      JSON.stringify({
        success: true,
        type: qrcInfo.tipo || qrcInfo.type,
        merchant_name: qrcInfo.nome || qrcInfo.merchantName,
        merchant_city: qrcInfo.cidade || qrcInfo.merchantCity,
        amount: qrcInfo.valor ? parseFloat(qrcInfo.valor) : qrcInfo.transactionAmount,
        pix_key: qrcInfo.chave,
        txid: qrcInfo.txid,
        end_to_end_id: qrcInfo.endToEndId,
        payload: qrcInfo,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('[pix-qrc-info] Error:', error);
    return new Response(
      JSON.stringify({ error: 'Internal server error', details: error.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
