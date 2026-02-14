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

    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
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

    let qrcInfo: any;

    // ========== WOOVI ==========
    // Woovi doesn't have a decode endpoint; attempt EMV parsing + dynamic payload fetch
    if (provider === 'woovi') {
      qrcInfo = { raw: qr_code, provider: 'woovi', type: 'static', decoded_locally: true };

      // Try to extract pix key from EMV
      const pixTagMatch = qr_code.match(/0014br\.gov\.bcb\.pix01(\d{2})/i);
      if (pixTagMatch) {
        const keyLen = parseInt(pixTagMatch[1]);
        const startIndex = pixTagMatch.index! + pixTagMatch[0].length;
        qrcInfo.pix_key = qr_code.substring(startIndex, startIndex + keyLen);
      }

      // Try to extract amount from EMV tag 54
      const amountMatch = qr_code.match(/54(\d{2})(\d+\.\d{2})/);
      if (amountMatch) {
        qrcInfo.amount = parseFloat(amountMatch[2]);
      }

      // For dynamic QR codes (cobv/cob), try to fetch the payload URL for amount
      const urlMatch = qr_code.match(/0014br\.gov\.bcb\.pix25(\d{2})/i);
      if (urlMatch && !qrcInfo.amount) {
        const urlLen = parseInt(urlMatch[1]);
        const urlStart = urlMatch.index! + urlMatch[0].length;
        const payloadUrl = qr_code.substring(urlStart, urlStart + urlLen);
        
        if (payloadUrl && payloadUrl.length > 10) {
          try {
            console.log('[pix-qrc-info] Fetching dynamic QR payload from:', payloadUrl, 'len:', urlLen);
            const fullUrl = payloadUrl.startsWith('http') ? payloadUrl : `https://${payloadUrl}`;
            const payloadResp = await fetch(fullUrl, {
              headers: { 'Accept': 'application/json, application/jose, */*' },
            });
            
            console.log('[pix-qrc-info] Payload response status:', payloadResp.status, 'content-type:', payloadResp.headers.get('content-type'));
            
            if (payloadResp.ok) {
              const responseText = await payloadResp.text();
              console.log('[pix-qrc-info] Payload response (first 200):', responseText.substring(0, 200));
              
              let payload: any = null;
              
              // Try JSON parse first
              try {
                payload = JSON.parse(responseText);
              } catch (_) {
                // If not JSON, try JWS decode (format: header.payload.signature)
                const parts = responseText.split('.');
                if (parts.length === 3) {
                  try {
                    // Decode base64url payload (second part)
                    const b64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
                    const decoded = atob(b64);
                    payload = JSON.parse(decoded);
                    console.log('[pix-qrc-info] JWS payload decoded successfully');
                  } catch (e2) {
                    console.warn('[pix-qrc-info] Failed to decode JWS payload:', e2);
                  }
                }
              }
              
              if (payload) {
                console.log('[pix-qrc-info] Dynamic payload:', JSON.stringify(payload));
                qrcInfo.type = 'dynamic';
                if (payload.valor?.original) {
                  qrcInfo.amount = parseFloat(payload.valor.original);
                } else if (payload.valor?.final) {
                  qrcInfo.amount = parseFloat(payload.valor.final);
                } else if (payload.amount) {
                  qrcInfo.amount = parseFloat(payload.amount);
                } else if (payload.value) {
                  qrcInfo.amount = parseFloat(payload.value);
                }
                if (payload.devedor?.nome) qrcInfo.merchant_name = payload.devedor.nome;
                if (payload.recebedor?.nome) qrcInfo.merchant_name = payload.recebedor.nome;
                if (payload.chave) qrcInfo.pix_key = payload.chave;
                if (payload.calendario?.expiracao) qrcInfo.expiration = payload.calendario.expiracao;
                if (payload.txid) qrcInfo.txid = payload.txid;
              }
            }
          } catch (e) {
            console.warn('[pix-qrc-info] Failed to fetch dynamic payload:', e);
          }
        }
      }
    }
    // ========== ONZ (via proxy) ==========
    else if (provider === 'onz') {
      const infoUrl = `${config.base_url}/pix/qrcode/decode`;
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
          url: infoUrl,
          method: 'POST',
          headers: { 'Authorization': `Bearer ${access_token}`, 'Content-Type': 'application/json' },
          body: { qrcode: qr_code },
        }),
      });

      const proxyResult = await proxyResponse.json();
      qrcInfo = proxyResult.data;
    }
    // ========== TRANSFEERA ==========
    else if (provider === 'transfeera') {
      const infoUrl = `${config.base_url}/pix/qrcode/decode`;
      const resp = await fetch(infoUrl, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${access_token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ emv: qr_code }),
      });
      qrcInfo = await resp.json();
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

      const infoUrl = `${config.base_url}/v2/gn/qrcode/decode`;
      const fetchOptions: any = {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${access_token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ qrcode: qr_code }),
      };
      if (httpClient) fetchOptions.client = httpClient;

      const resp = await fetch(infoUrl, fetchOptions);
      httpClient?.close();

      if (!resp.ok) {
        const errorText = await resp.text();
        return new Response(
          JSON.stringify({ error: 'Failed to decode QR Code', provider_error: errorText }),
          { status: 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      qrcInfo = await resp.json();
    } else {
      return new Response(
        JSON.stringify({ error: `Provider '${provider}' não suportado` }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log('[pix-qrc-info] QR Code decoded:', JSON.stringify(qrcInfo));

    return new Response(
      JSON.stringify({
        success: true,
        provider,
        type: qrcInfo.tipo || qrcInfo.type,
        merchant_name: qrcInfo.nome || qrcInfo.merchantName || qrcInfo.merchant_name,
        merchant_city: qrcInfo.cidade || qrcInfo.merchantCity || qrcInfo.merchant_city,
        amount: qrcInfo.valor ? parseFloat(qrcInfo.valor) : (qrcInfo.transactionAmount || qrcInfo.amount || qrcInfo.value),
        pix_key: qrcInfo.chave || qrcInfo.pix_key,
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
