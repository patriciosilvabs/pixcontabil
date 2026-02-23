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
function parseCaCerts(raw: string): string[] {
  let content = raw.trim();
  if (!content.startsWith('-----')) { try { content = atob(content.replace(/[\s\r\n]/g, '')); } catch { /* use as-is */ } }
  const parts = content.split(/-----END CERTIFICATE-----/);
  const certs: string[] = [];
  for (const part of parts) {
    const beginIdx = part.indexOf('-----BEGIN CERTIFICATE-----');
    if (beginIdx === -1) continue;
    const cleanB64 = part.substring(beginIdx + '-----BEGIN CERTIFICATE-----'.length).replace(/[^A-Za-z0-9+/=]/g, '');
    if (!cleanB64) continue;
    const lines: string[] = ['-----BEGIN CERTIFICATE-----'];
    for (let i = 0; i < cleanB64.length; i += 64) lines.push(cleanB64.substring(i, i + 64));
    lines.push('-----END CERTIFICATE-----');
    certs.push(lines.join('\n') + '\n');
  }
  return certs;
}

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

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
    // ========== ONZ (via proxy mTLS) ==========
    else if (provider === 'onz') {
      const refundUrl = `${config.base_url}/pix/${transaction.pix_e2eid}/devolucao/${refundId}`;

      const proxyUrl = Deno.env.get('ONZ_PROXY_URL');
      const proxyApiKey = Deno.env.get('ONZ_PROXY_API_KEY');
      if (!proxyUrl || !proxyApiKey) {
        return new Response(
          JSON.stringify({ error: 'ONZ_PROXY_URL não configurado' }),
          { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      const fetchHeaders: any = { 'Authorization': `Bearer ${access_token}`, 'Content-Type': 'application/json' };
      if (config.provider_company_id) fetchHeaders['X-Company-ID'] = config.provider_company_id;

      try {
        const proxyResponse = await fetch(`${proxyUrl}/proxy`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-Proxy-API-Key': proxyApiKey },
          body: JSON.stringify({ url: refundUrl, method: 'PUT', headers: fetchHeaders, body: { valor: refundValue.toFixed(2) } }),
        });

        const proxyData = await proxyResponse.json();
        const data = proxyData.data || proxyData;

        if (!proxyResponse.ok || (proxyData.status && proxyData.status >= 400)) {
          return new Response(
            JSON.stringify({ error: 'Failed to request refund', provider_error: JSON.stringify(data) }),
            { status: 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }
        refundData = data;
      } catch (e) {
        return new Response(
          JSON.stringify({ error: 'Falha na conexão com ONZ', details: e.message }),
          { status: 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
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
          const certPem = decodeCert(config.certificate_encrypted);
          const keyPem = config.certificate_key_encrypted ? decodeCert(config.certificate_key_encrypted) : certPem;
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
    }
    // ========== BANCO INTER ==========
    else if (provider === 'inter') {
      let httpClient: Deno.HttpClient | undefined;
      if (config.certificate_encrypted) {
        try {
          const certPem = decodeCert(config.certificate_encrypted);
          const keyPem = config.certificate_key_encrypted ? decodeCert(config.certificate_key_encrypted) : certPem;
          httpClient = Deno.createHttpClient({ cert: certPem, key: keyPem });
        } catch (_) { /* ignore */ }
      }

      const refundUrl = `${config.base_url}/pix/v2/pix/${transaction.pix_e2eid}/devolucao/${refundId}`;
      const fetchHeaders: any = {
        'Authorization': `Bearer ${access_token}`,
        'Content-Type': 'application/json',
      };
      if (config.provider_company_id) {
        fetchHeaders['x-conta-corrente'] = config.provider_company_id;
      }

      const fetchOptions: any = {
        method: 'PUT',
        headers: fetchHeaders,
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
