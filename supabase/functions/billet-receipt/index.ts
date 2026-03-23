import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

async function callOnzViaProxy(url: string, method: string, headers: Record<string, string>, bodyRaw?: string) {
  const proxyUrl = Deno.env.get('ONZ_PROXY_URL');
  const proxyApiKey = Deno.env.get('ONZ_PROXY_API_KEY');
  if (!proxyUrl || !proxyApiKey) throw new Error('ONZ_PROXY_URL and ONZ_PROXY_API_KEY must be configured');
  const proxyBody: any = { url, method, headers };
  if (bodyRaw !== undefined) proxyBody.body_raw = bodyRaw;
  const resp = await fetch(`${proxyUrl}/proxy`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Proxy-API-Key': proxyApiKey },
    body: JSON.stringify(proxyBody),
  });
  const data = await resp.json();
  return { proxyStatus: resp.status, status: data.status || resp.status, data: data.data || data };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!,
      { global: { headers: { Authorization: authHeader } } }
    );

    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
      return new Response(JSON.stringify({ error: 'Invalid token' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    const body = await req.json();
    const { company_id, billet_id, transaction_id } = body;

    let billetExternalId = billet_id;
    let companyId = company_id;

    if (transaction_id && (!billetExternalId || !companyId)) {
      const { data: txData } = await supabase
        .from('transactions').select('company_id, external_id')
        .eq('id', transaction_id).single();
      if (txData) {
        companyId = companyId || txData.company_id;
        if (!billetExternalId && txData.external_id) {
          const eid = txData.external_id;
          if (eid.startsWith('onz:')) {
            billetExternalId = eid.replace('onz:', '');
          } else {
            const parts = eid.split(':');
            billetExternalId = parts.length > 1 ? parts[1] : parts[0];
          }
        }
      }
    }

    if (!companyId || !billetExternalId) {
      return new Response(JSON.stringify({ error: 'company_id and billet_id (or transaction_id) are required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    // Get config
    let config: any = null;
    for (const p of ['cash_out', 'both']) {
      const { data: c } = await supabase
        .from('pix_configs').select('*')
        .eq('company_id', companyId).eq('is_active', true).eq('purpose', p).single();
      if (c) { config = c; break; }
    }

    if (!config) {
      return new Response(JSON.stringify({ error: 'Pix configuration not found' }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    // Get auth token
    const authResponse = await fetch(`${Deno.env.get('SUPABASE_URL')}/functions/v1/pix-auth`, {
      method: 'POST',
      headers: { 'Authorization': authHeader, 'Content-Type': 'application/json', 'apikey': Deno.env.get('SUPABASE_ANON_KEY')! },
      body: JSON.stringify({ company_id: companyId, purpose: 'cash_out' }),
    });

    if (!authResponse.ok) {
      return new Response(JSON.stringify({ error: 'Failed to authenticate with provider' }),
        { status: 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    const { access_token } = await authResponse.json();

    if (config.provider === 'onz') {
      // ========== ONZ: GET /api/v2/billets/payments/receipt/{id} ==========
      try {
        const result = await callOnzViaProxy(
          `${config.base_url}/api/v2/billets/payments/receipt/${billetExternalId}`,
          'GET',
          { 'Authorization': `Bearer ${access_token}` },
        );

        if (result.status >= 400 || !result.data) {
          return new Response(JSON.stringify({ error: 'Comprovante ainda não disponível', status: result.data?.status }),
            { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
        }

        const pdfBase64 = result.data.pdf || result.data.data?.pdf;
        if (!pdfBase64) {
          return new Response(JSON.stringify({ error: 'Comprovante ainda não disponível' }),
            { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
        }

        return new Response(JSON.stringify({
          success: true, billet_id: billetExternalId, provider: 'onz',
          pdf_base64: pdfBase64, content_type: 'application/pdf',
        }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

      } catch (e) {
        return new Response(JSON.stringify({ error: 'Falha na conexão com ONZ', details: e.message }),
          { status: 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }

    } else {
      // ========== TRANSFEERA ==========
      const apiBase = config.is_sandbox ? 'https://api-sandbox.transfeera.com' : 'https://api.transfeera.com';

      try {
        const billetResponse = await fetch(`${apiBase}/billet/${billetExternalId}`, {
          method: 'GET',
          headers: { 'Authorization': `Bearer ${access_token}`, 'User-Agent': 'PixContabil (contato@pixcontabil.com.br)' },
        });

        const billetData = await billetResponse.json();
        if (!billetResponse.ok) {
          return new Response(JSON.stringify({ error: 'Failed to get billet data', provider_error: JSON.stringify(billetData) }),
            { status: 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
        }

        const receiptUrl = billetData.receipt_url || billetData.bank_receipt_url;
        if (!receiptUrl) {
          return new Response(JSON.stringify({ error: 'Comprovante ainda não disponível', status: billetData.status }),
            { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
        }

        const pdfResponse = await fetch(receiptUrl);
        if (!pdfResponse.ok) {
          return new Response(JSON.stringify({ error: 'Failed to download receipt PDF' }),
            { status: 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
        }

        const pdfBuffer = await pdfResponse.arrayBuffer();
        const pdfBase64 = btoa(String.fromCharCode(...new Uint8Array(pdfBuffer)));

        return new Response(JSON.stringify({
          success: true, billet_id: billetExternalId, provider: 'transfeera',
          pdf_base64: pdfBase64, content_type: 'application/pdf',
        }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

      } catch (e) {
        return new Response(JSON.stringify({ error: 'Falha na conexão com Transfeera', details: e.message }),
          { status: 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }
    }

  } catch (error) {
    console.error('[billet-receipt] Error:', error);
    return new Response(JSON.stringify({ error: 'Internal server error', details: error.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }
});
