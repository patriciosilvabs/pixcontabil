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

    // Get Pix config for cash-in (QR code info/decode)
    let config: any = null;
    const { data: cashInConfig } = await supabase
      .from('pix_configs')
      .select('*')
      .eq('company_id', company_id)
      .eq('is_active', true)
      .eq('purpose', 'cash_in')
      .single();
    config = cashInConfig;
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
        JSON.stringify({ error: 'Pix configuration not found' }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const provider = config.provider;

    const authResponse = await fetch(`${Deno.env.get('SUPABASE_URL')}/functions/v1/pix-auth`, {
      method: 'POST',
      headers: { 'Authorization': authHeader, 'Content-Type': 'application/json' },
      body: JSON.stringify({ company_id, purpose: 'cash_in', scopes: 'cob.read cob.write pix.read' }),
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

      // TLV parser for EMV QR Code - extracts tag value by walking sequentially
      function extractEmvTag(emv: string, targetTag: string): string | null {
        let pos = 0;
        while (pos + 4 <= emv.length) {
          const tag = emv.substring(pos, pos + 2);
          const lenStr = emv.substring(pos + 2, pos + 4);
          // Length must be exactly 2 numeric digits
          if (!/^\d{2}$/.test(lenStr)) break;
          const len = parseInt(lenStr, 10);
          if (pos + 4 + len > emv.length) break;
          const val = emv.substring(pos + 4, pos + 4 + len);
          if (tag === targetTag) return val;
          pos += 4 + len;
        }
        return null;
      }

      // Tag 54 = Transaction Amount (must match pattern: digits with optional single decimal point)
      const tag54Value = extractEmvTag(qr_code, '54');
      if (tag54Value && /^\d+(\.\d{1,2})?$/.test(tag54Value)) {
        const parsedAmount = parseFloat(tag54Value);
        if (!isNaN(parsedAmount) && parsedAmount > 0 && parsedAmount <= 1_000_000) {
          qrcInfo.amount = parsedAmount;
        } else {
          console.warn(`[pix-qrc-info] Tag 54 value out of range: ${tag54Value}`);
        }
      } else if (tag54Value) {
        console.warn(`[pix-qrc-info] Tag 54 invalid format: ${tag54Value}`);
      }

      // Optional: validate CRC (tag 63) for EMV integrity
      const tag63Value = extractEmvTag(qr_code, '63');
      if (!tag63Value) {
        console.warn('[pix-qrc-info] EMV missing CRC tag 63 - payload may be corrupted');
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
    // ========== ONZ (mTLS direto) ==========
    else if (provider === 'onz') {
      const infoUrl = `${config.base_url}/pix/qrcode/decode`;

      let httpClient: Deno.HttpClient | undefined;
      if (config.certificate_encrypted) {
        try {
          const certPem = decodeCert(config.certificate_encrypted);
          const keyPem = config.certificate_key_encrypted ? decodeCert(config.certificate_key_encrypted) : certPem;
          httpClient = Deno.createHttpClient({ cert: certPem, key: keyPem });
        } catch (_) { /* ignore */ }
      }

      const fetchHeaders: any = {
        'Authorization': `Bearer ${access_token}`,
        'Content-Type': 'application/json',
      };
      if (config.provider_company_id) {
        fetchHeaders['X-Company-ID'] = config.provider_company_id;
      }

      const fetchOptions: any = {
        method: 'POST',
        headers: fetchHeaders,
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
          const certPem = decodeCert(config.certificate_encrypted);
          const keyPem = config.certificate_key_encrypted ? decodeCert(config.certificate_key_encrypted) : certPem;
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
