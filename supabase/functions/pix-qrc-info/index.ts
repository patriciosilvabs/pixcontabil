import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface QRCInfoRequest {
  company_id: string;
  qr_code: string;
}

interface ONZQRCInfoResponse {
  type: string;
  merchantCategoryCode?: string;
  transactionCurrency?: string;
  countryCode?: string;
  merchantName?: string;
  merchantCity?: string;
  url?: string;
  transactionAmount?: number;
  txid?: string;
  chave?: string;
  payload?: any;
  endToEndId?: string;
  statusCode: number;
}

// Generate idempotency key
function generateIdempotencyKey(): string {
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

    // Get request body
    const body: QRCInfoRequest = await req.json();
    const { company_id, qr_code } = body;

    if (!company_id || !qr_code) {
      return new Response(
        JSON.stringify({ error: 'company_id and qr_code are required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log(`[pix-qrc-info] Verifying QR Code for company: ${company_id}`);

    // Get Pix config
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

    // Get auth token
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
        JSON.stringify({ error: 'Failed to authenticate with Pix provider' }),
        { status: 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const { access_token } = await authResponse.json();
    const idempotencyKey = generateIdempotencyKey();

    // Create mTLS HTTP client
    let httpClient: Deno.HttpClient | undefined;
    if (config.certificate_encrypted && config.certificate_key_encrypted) {
      try {
        httpClient = Deno.createHttpClient({
          cert: atob(config.certificate_encrypted),
          key: atob(config.certificate_key_encrypted),
        });
      } catch (e) {
        console.error('[pix-qrc-info] Failed to create mTLS client:', e);
      }
    }

    // Query QR Code info from ONZ
    const infoUrl = `${config.base_url}/pix/payments/qrc/info`;
    const fetchOptions: any = {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${access_token}`,
        'Content-Type': 'application/json',
        'x-idempotency-key': idempotencyKey,
      },
      body: JSON.stringify({ qrCode: qr_code }),
    };
    if (httpClient) fetchOptions.client = httpClient;

    const infoResponse = await fetch(infoUrl, fetchOptions);
    httpClient?.close();

    if (!infoResponse.ok) {
      const errorText = await infoResponse.text();
      console.error('[pix-qrc-info] Provider error:', errorText);
      return new Response(
        JSON.stringify({ 
          error: 'Failed to verify QR Code',
          provider_error: errorText,
          status: infoResponse.status
        }),
        { status: 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const qrcInfo: ONZQRCInfoResponse = await infoResponse.json();
    console.log('[pix-qrc-info] QR Code info received:', JSON.stringify(qrcInfo));

    return new Response(
      JSON.stringify({
        success: true,
        type: qrcInfo.type,
        merchant_name: qrcInfo.merchantName,
        merchant_city: qrcInfo.merchantCity,
        amount: qrcInfo.transactionAmount,
        pix_key: qrcInfo.chave,
        txid: qrcInfo.txid,
        end_to_end_id: qrcInfo.endToEndId,
        country_code: qrcInfo.countryCode,
        currency: qrcInfo.transactionCurrency,
        payload: qrcInfo.payload,
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
