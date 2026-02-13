import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Helper: raw TLS fetch for ONZ (bypasses missing SAN in server cert)
async function onzTlsFetch(
  url: string, method: string, headers: Record<string, string>,
  body?: string, certPem?: string, keyPem?: string, caCerts?: string[],
): Promise<{ status: number; body: string }> {
  const u = new URL(url);
  const tlsOpts: any = { hostname: u.hostname, port: parseInt(u.port || '443'), unsafelyDisableHostnameVerification: true };
  if (certPem) { tlsOpts.certChain = certPem; tlsOpts.privateKey = keyPem || certPem; }
  if (caCerts?.length) tlsOpts.caCerts = caCerts;
  const conn = await Deno.connectTls(tlsOpts);
  const path = u.pathname + u.search;
  const enc = new TextEncoder();
  const bodyBytes = body ? enc.encode(body) : null;
  const lines = [`${method} ${path} HTTP/1.1`, `Host: ${u.hostname}`];
  for (const [k, v] of Object.entries(headers)) lines.push(`${k}: ${v}`);
  if (bodyBytes) lines.push(`Content-Length: ${bodyBytes.byteLength}`);
  lines.push('Connection: close', '', body || '');
  await conn.write(enc.encode(lines.join('\r\n')));
  const chunks: Uint8Array[] = [];
  const buf = new Uint8Array(4096);
  while (true) { const n = await conn.read(buf); if (n === null) break; chunks.push(buf.slice(0, n)); }
  conn.close();
  const total = chunks.reduce((s, c) => s + c.length, 0);
  const full = new Uint8Array(total); let off = 0;
  for (const c of chunks) { full.set(c, off); off += c.length; }
  const text = new TextDecoder().decode(full);
  const slEnd = text.indexOf('\r\n');
  const status = parseInt(text.substring(0, slEnd).split(' ')[1]);
  const bStart = text.indexOf('\r\n\r\n');
  let respBody = text.substring(bStart + 4);
  if (text.toLowerCase().includes('transfer-encoding: chunked')) {
    const dc: string[] = []; let rem = respBody;
    while (rem.length > 0) {
      const ce = rem.indexOf('\r\n'); if (ce === -1) break;
      const cs = parseInt(rem.substring(0, ce), 16); if (cs === 0) break;
      dc.push(rem.substring(ce + 2, ce + 2 + cs)); rem = rem.substring(ce + 2 + cs + 2);
    }
    respBody = dc.join('');
  }
  return { status, body: respBody };
}

function getOnzCaCerts(certPem: string): string[] {
  const normalizePem = (pem: string): string => {
    const match = pem.match(/(-----BEGIN [^-]+-----)([\s\S]*?)(-----END [^-]+-----)/);
    if (!match) return pem;
    const body = match[2].replace(/\s+/g, '');
    const lines = body.match(/.{1,64}/g) || [];
    return `${match[1]}\n${lines.join('\n')}\n${match[3]}\n`;
  };
  const caCerts: string[] = [];
  const caCertRaw = Deno.env.get('ONZ_CA_CERT');
  if (caCertRaw) {
    const trimmed = caCertRaw.trim();
    if (trimmed.startsWith('-----BEGIN')) { caCerts.push(normalizePem(trimmed)); }
    else { try { const d = atob(trimmed); if (d.includes('-----BEGIN')) caCerts.push(normalizePem(d)); } catch {} }
  }
  caCerts.push(normalizePem(certPem));
  return caCerts;
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
    // Woovi doesn't have a decode endpoint; attempt basic EMV parsing
    if (provider === 'woovi') {
      // Simple EMV TLV parsing for Pix Copy-Paste
      qrcInfo = { raw: qr_code, provider: 'woovi', type: 'static', decoded_locally: true };
      // Try to extract basic info from the QR code string
      const pixKeyMatch = qr_code.match(/0014br\.gov\.bcb\.pix01(\d{2})(.+?)(?:52|53|54)/);
      if (pixKeyMatch) {
        const keyLen = parseInt(pixKeyMatch[1]);
        qrcInfo.pix_key = pixKeyMatch[2].substring(0, keyLen);
      }
      const amountMatch = qr_code.match(/54(\d{2})(\d+\.\d{2})/);
      if (amountMatch) {
        qrcInfo.amount = parseFloat(amountMatch[2]);
      }
    }
    // ========== ONZ ==========
    else if (provider === 'onz') {
      const infoUrl = `${config.base_url}/pix/qrcode/decode`;
      const certPem = config.certificate_encrypted ? atob(config.certificate_encrypted) : undefined;
      const keyPem = config.certificate_key_encrypted ? atob(config.certificate_key_encrypted) : certPem;
      const caCerts = certPem ? getOnzCaCerts(certPem) : undefined;
      const resp = await onzTlsFetch(infoUrl, 'POST', {
        'Authorization': `Bearer ${access_token}`, 'Content-Type': 'application/json',
      }, JSON.stringify({ qrcode: qr_code }), certPem, keyPem, caCerts);
      qrcInfo = JSON.parse(resp.body);
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
