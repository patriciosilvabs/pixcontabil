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

function generateRefundId(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let result = '';
  for (let i = 0; i < 10; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
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

    const userId = claims.claims.sub as string;
    const body = await req.json();
    const { transaction_id, valor, motivo } = body;

    if (!transaction_id) {
      return new Response(
        JSON.stringify({ error: 'transaction_id is required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const { data: transaction } = await supabase
      .from('transactions')
      .select('*')
      .eq('id', transaction_id)
      .single();

    if (!transaction) {
      return new Response(
        JSON.stringify({ error: 'Transaction not found' }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (transaction.status !== 'completed') {
      return new Response(
        JSON.stringify({ error: 'Only completed transactions can be refunded' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (!transaction.pix_e2eid) {
      return new Response(
        JSON.stringify({ error: 'Transaction does not have e2eId' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const refundValue = valor || transaction.amount;
    const supabaseAdmin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

    const { data: existingRefunds } = await supabaseAdmin
      .from('pix_refunds')
      .select('valor, status')
      .eq('transaction_id', transaction_id)
      .neq('status', 'NAO_REALIZADO');

    const totalRefunded = existingRefunds?.reduce((sum, r) => sum + Number(r.valor), 0) || 0;
    const availableForRefund = Number(transaction.amount) - totalRefunded;

    if (refundValue > availableForRefund) {
      return new Response(
        JSON.stringify({ error: 'Refund value exceeds available amount', available: availableForRefund }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const { data: config } = await supabase
      .from('pix_configs')
      .select('*')
      .eq('company_id', transaction.company_id)
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
      body: JSON.stringify({ company_id: transaction.company_id }),
    });

    if (!authResponse.ok) {
      return new Response(
        JSON.stringify({ error: 'Failed to authenticate with provider' }),
        { status: 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const { access_token } = await authResponse.json();
    const refundId = generateRefundId();
    let refundData: any;

    // ========== WOOVI ==========
    if (provider === 'woovi') {
      const refundUrl = `${config.base_url}/api/v1/charge/${transaction.pix_e2eid}/refund`;
      const resp = await fetch(refundUrl, {
        method: 'POST',
        headers: { 'Authorization': access_token, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          correlationID: refundId,
          value: Math.round(refundValue * 100),
          comment: motivo || 'Devolução',
        }),
      });
      if (!resp.ok) {
        const errorText = await resp.text();
        return new Response(
          JSON.stringify({ error: 'Failed to request refund', provider_error: errorText }),
          { status: 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
      refundData = await resp.json();
    }
    // ========== ONZ ==========
    else if (provider === 'onz') {
      const refundUrl = `${config.base_url}/pix/${transaction.pix_e2eid}/devolucao/${refundId}`;
      const certPem = config.certificate_encrypted ? atob(config.certificate_encrypted) : undefined;
      const keyPem = config.certificate_key_encrypted ? atob(config.certificate_key_encrypted) : certPem;
      const caCerts = certPem ? getOnzCaCerts(certPem) : undefined;
      const refundBody = JSON.stringify({ valor: refundValue.toFixed(2) });
      const resp = await onzTlsFetch(refundUrl, 'PUT', {
        'Authorization': `Bearer ${access_token}`, 'Content-Type': 'application/json',
      }, refundBody, certPem, keyPem, caCerts);
      if (resp.status < 200 || resp.status >= 300) {
        return new Response(
          JSON.stringify({ error: 'Failed to request refund', provider_error: resp.body }),
          { status: 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
      refundData = JSON.parse(resp.body);
    }
    // ========== TRANSFEERA ==========
    else if (provider === 'transfeera') {
      const refundUrl = `${config.base_url}/pix/refund`;
      const resp = await fetch(refundUrl, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${access_token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          end_to_end_id: transaction.pix_e2eid,
          value: refundValue,
          description: motivo || 'Devolução',
        }),
      });
      if (!resp.ok) {
        const errorText = await resp.text();
        return new Response(
          JSON.stringify({ error: 'Failed to request refund', provider_error: errorText }),
          { status: 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
      refundData = await resp.json();
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

      const refundUrl = `${config.base_url}/v2/pix/${transaction.pix_e2eid}/devolucao/${refundId}`;
      const fetchOptions: any = {
        method: 'PUT',
        headers: { 'Authorization': `Bearer ${access_token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ valor: refundValue.toFixed(2) }),
      };
      if (httpClient) fetchOptions.client = httpClient;

      const resp = await fetch(refundUrl, fetchOptions);
      httpClient?.close();

      if (!resp.ok) {
        const errorText = await resp.text();
        return new Response(
          JSON.stringify({ error: 'Failed to request refund', provider_error: errorText }),
          { status: 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
      refundData = await resp.json();
    } else {
      return new Response(
        JSON.stringify({ error: `Provider '${provider}' não suportado` }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log('[pix-refund] Refund response:', JSON.stringify(refundData));

    const { data: savedRefund } = await supabaseAdmin
      .from('pix_refunds')
      .insert({
        transaction_id,
        e2eid: transaction.pix_e2eid,
        refund_id: refundId,
        valor: refundValue,
        motivo,
        status: refundData.status || 'EM_PROCESSAMENTO',
        refunded_at: refundData.horario?.liquidacao,
        created_by: userId,
      })
      .select()
      .single();

    await supabaseAdmin.from('audit_logs').insert({
      user_id: userId,
      company_id: transaction.company_id,
      entity_type: 'pix_refund',
      entity_id: savedRefund?.id,
      action: 'pix_refund_requested',
      new_data: { provider, refund_id: refundId, valor: refundValue, status: refundData.status },
    });

    return new Response(
      JSON.stringify({
        success: true,
        refund_id: refundId,
        status: refundData.status,
        valor: refundValue,
        rtrId: refundData.rtrId,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('[pix-refund] Error:', error);
    return new Response(
      JSON.stringify({ error: 'Internal server error', details: error.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
