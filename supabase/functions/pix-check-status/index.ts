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

    let statusData: any;

    // ========== WOOVI ==========
    if (provider === 'woovi') {
      // Try charge first, then payment
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
    // ========== ONZ ==========
    else if (provider === 'onz') {
      const statusUrl = `${config.base_url}/pix/payments/${end_to_end_id}`;
      const certPem = config.certificate_encrypted ? atob(config.certificate_encrypted) : undefined;
      const keyPem = config.certificate_key_encrypted ? atob(config.certificate_key_encrypted) : certPem;
      const caCerts = certPem ? getOnzCaCerts(certPem) : undefined;
      const resp = await onzTlsFetch(statusUrl, 'GET', {
        'Authorization': `Bearer ${access_token}`, 'Content-Type': 'application/json',
      }, undefined, certPem, keyPem, caCerts);
      statusData = JSON.parse(resp.body);
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
      'EM_PROCESSAMENTO': 'pending', 'PROCESSING': 'pending', 'ACTIVE': 'pending',
      'NAO_REALIZADO': 'failed', 'FAILED': 'failed', 'ERROR': 'failed',
      'DEVOLVIDO': 'refunded', 'REFUNDED': 'refunded',
    };
    const internalStatus = statusMap[rawStatus.toUpperCase()] || 'pending';
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
