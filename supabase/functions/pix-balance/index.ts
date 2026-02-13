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
    return new Response(null, { headers: corsHeaders });
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

    const { company_id } = await req.json();

    if (!company_id) {
      return new Response(
        JSON.stringify({ error: 'company_id is required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log(`[pix-balance] Fetching balance for company: ${company_id}`);

    // Get Pix config
    const { data: config, error: configError } = await supabase
      .from('pix_configs')
      .select('*')
      .eq('company_id', company_id)
      .eq('is_active', true)
      .single();

    if (configError || !config) {
      console.log('[pix-balance] No active pix config found');
      return new Response(
        JSON.stringify({ success: true, balance: null, available: false, provider: null, message: 'Nenhuma configuração Pix ativa encontrada' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const provider = config.provider;
    console.log(`[pix-balance] Provider: ${provider}`);

    // Get auth token via pix-auth (for ALL providers except those handled separately)
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const authResponse = await fetch(`${supabaseUrl}/functions/v1/pix-auth`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': authHeader,
      },
      body: JSON.stringify({ company_id }),
    });

    if (!authResponse.ok) {
      const authError = await authResponse.text();
      console.error('[pix-balance] Auth failed:', authError);
      return new Response(
        JSON.stringify({ error: 'Falha ao autenticar com o provedor', details: authError }),
        { status: 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const authData = await authResponse.json();
    const accessToken = authData.access_token;

    let balance: number | null = null;

    // ========== TRANSFEERA ==========
    if (provider === 'transfeera') {
      const balanceUrl = `${config.base_url}/statement/balance`;
      console.log(`[pix-balance] Transfeera: GET ${balanceUrl}`);

      const res = await fetch(balanceUrl, {
        headers: { 'Authorization': `Bearer ${accessToken}` },
      });

      if (!res.ok) {
        const errText = await res.text();
        console.error('[pix-balance] Transfeera balance error:', errText);
        return new Response(
          JSON.stringify({ error: 'Falha ao consultar saldo na Transfeera', details: errText }),
          { status: 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      const data = await res.json();
      console.log('[pix-balance] Transfeera balance response:', JSON.stringify(data));
      balance = parseFloat(data?.value ?? data?.balance ?? data?.available ?? data?.amount ?? '0');
    }

    // ========== WOOVI (OpenPix) ==========
    else if (provider === 'woovi') {
      const balanceUrl = `${config.base_url}/api/v1/account/`;
      console.log(`[pix-balance] Woovi: GET ${balanceUrl}`);

      const res = await fetch(balanceUrl, {
        headers: { 'Authorization': accessToken },
      });

      if (!res.ok) {
        const errText = await res.text();
        console.error('[pix-balance] Woovi balance error:', errText);
        return new Response(
          JSON.stringify({ error: 'Falha ao consultar saldo na Woovi', details: errText }),
          { status: 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      const data = await res.json();
      console.log('[pix-balance] Woovi balance response:', JSON.stringify(data));
      // Find default account or use first one; balance is in cents
      const defaultAccount = data?.accounts?.find((a: any) => a.isDefault) ?? data?.accounts?.[0];
      balance = (defaultAccount?.balance?.available ?? defaultAccount?.balance?.total ?? 0) / 100;
    }

    // ========== ONZ Infopago ==========
    else if (provider === 'onz') {
      const balanceUrl = `${config.base_url}/accounts/balances/`;
      console.log(`[pix-balance] ONZ: GET ${balanceUrl} (raw TLS)`);

      const certPem = config.certificate_encrypted ? atob(config.certificate_encrypted) : undefined;
      const keyPem = config.certificate_key_encrypted ? atob(config.certificate_key_encrypted) : certPem;
      const caCerts = certPem ? getOnzCaCerts(certPem) : undefined;

      try {
        const resp = await onzTlsFetch(balanceUrl, 'GET', { 'Authorization': `Bearer ${accessToken}` }, undefined, certPem, keyPem, caCerts);
        if (resp.status < 200 || resp.status >= 300) {
          console.error('[pix-balance] ONZ balance error:', resp.body);
          return new Response(
            JSON.stringify({ error: 'Falha ao consultar saldo na ONZ', details: resp.body }),
            { status: 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }
        const data = JSON.parse(resp.body);
        balance = parseFloat(data?.available ?? data?.balance ?? data?.saldo ?? '0');
      } catch (e) {
        console.error('[pix-balance] ONZ TLS error:', e);
        return new Response(
          JSON.stringify({ error: 'Falha na conexão mTLS com ONZ', details: e.message }),
          { status: 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
    }

    // ========== EFI Pay ==========
    else if (provider === 'efi') {
      if (!config.certificate_encrypted) {
        return new Response(
          JSON.stringify({ error: 'Certificado mTLS obrigatório para EFI Pay' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      let certPem: string;
      let keyPem: string;
      try {
        certPem = atob(config.certificate_encrypted);
        keyPem = config.certificate_key_encrypted ? atob(config.certificate_key_encrypted) : certPem;
      } catch {
        return new Response(
          JSON.stringify({ error: 'Certificado mTLS inválido' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      const httpClient = Deno.createHttpClient({ cert: certPem, key: keyPem });
      const balanceUrl = `${config.base_url}/v2/gn/saldo`;
      console.log(`[pix-balance] EFI: GET ${balanceUrl}`);

      try {
        const res = await fetch(balanceUrl, {
          headers: { 'Authorization': `Bearer ${accessToken}` },
          // @ts-ignore - Deno specific
          client: httpClient,
        });

        if (!res.ok) {
          const errText = await res.text();
          httpClient.close();
          console.error('[pix-balance] EFI balance error:', errText);
          return new Response(
            JSON.stringify({ error: 'Falha ao consultar saldo na EFI', details: errText }),
            { status: 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }

        const data = await res.json();
        balance = parseFloat(data?.saldo ?? '0');
        httpClient.close();
      } catch (fetchError) {
        httpClient.close();
        return new Response(
          JSON.stringify({ error: 'Falha na conexão mTLS com a EFI', details: fetchError.message }),
          { status: 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
    }

    // ========== UNKNOWN ==========
    else {
      return new Response(
        JSON.stringify({ success: true, balance: null, available: false, provider, message: `Provedor '${provider}' não suporta consulta de saldo` }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log(`[pix-balance] Balance: ${balance}`);

    return new Response(
      JSON.stringify({ success: true, balance, available: true, provider }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('[pix-balance] Error:', error);
    return new Response(
      JSON.stringify({ error: 'Internal server error', details: error.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
