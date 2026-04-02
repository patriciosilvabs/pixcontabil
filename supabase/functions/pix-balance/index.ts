import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

async function callNewProxy(path: string, method: string, body?: any) {
  const proxyUrl = Deno.env.get('NEW_PROXY_URL')!;
  const proxyKey = Deno.env.get('NEW_PROXY_KEY')!;
  const headers: Record<string, string> = {
    'x-proxy-key': proxyKey,
    'Content-Type': 'application/json',
  };
  if (method === 'POST') headers['x-idempotency-key'] = crypto.randomUUID();
  const resp = await fetch(`${proxyUrl}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await resp.json();
  return { status: resp.status, data };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader?.startsWith('Bearer ')) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

    const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, { global: { headers: { Authorization: authHeader } } });
    const { company_id } = await req.json();
    if (!company_id) return new Response(JSON.stringify({ error: 'company_id is required' }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

    console.log(`[pix-balance] Fetching balance for company: ${company_id}`);

    const supabaseAdmin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
    let config: any = null;
    const { data: cashOutConfig } = await supabaseAdmin.from('pix_configs').select('*').eq('company_id', company_id).eq('is_active', true).eq('purpose', 'cash_out').single();
    config = cashOutConfig;
    if (!config) { const { data: bothConfig } = await supabaseAdmin.from('pix_configs').select('*').eq('company_id', company_id).eq('is_active', true).eq('purpose', 'both').single(); config = bothConfig; }

    if (!config) {
      return new Response(JSON.stringify({ success: true, balance: null, available: false, provider: null, message: 'Nenhuma configuração Pix ativa encontrada' }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    if (config.provider === 'onz') {
      // ========== ONZ via novo proxy: GET /saldo ==========
      const result = await callNewProxy('/saldo', 'GET');

      if (result.status === 401) {
        return new Response(JSON.stringify({ error: 'Falha de autenticação com o proxy' }), { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }

      if (result.status >= 400) {
        console.error('[pix-balance] Proxy error:', JSON.stringify(result.data));
        return new Response(JSON.stringify({ error: result.data?.message || 'Falha ao consultar saldo', details: JSON.stringify(result.data) }), { status: 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }

      console.log('[pix-balance] Proxy response:', JSON.stringify(result.data));

      // Extract balance from proxy response
      const balanceAmount = result.data?.balanceAmount ?? result.data?.balance ?? result.data?.available ?? 0;
      const balance = Number(balanceAmount) || 0;

      return new Response(JSON.stringify({ success: true, balance, available: true, provider: 'onz' }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    } else {
      // ========== TRANSFEERA (unchanged) ==========
      const authResponse = await fetch(`${Deno.env.get('SUPABASE_URL')!}/functions/v1/pix-auth`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': authHeader, 'apikey': Deno.env.get('SUPABASE_ANON_KEY')! },
        body: JSON.stringify({ company_id, purpose: 'cash_out' }),
      });
      if (!authResponse.ok) {
        const authError = await authResponse.text();
        return new Response(JSON.stringify({ error: 'Falha ao autenticar com o provedor', details: authError }), { status: 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }
      const { access_token } = await authResponse.json();

      const apiBase = config.is_sandbox ? 'https://api-sandbox.transfeera.com' : 'https://api.transfeera.com';
      const balanceResponse = await fetch(`${apiBase}/statement/balance`, {
        method: 'GET',
        headers: { 'Authorization': `Bearer ${access_token}`, 'User-Agent': 'PixContabil (contato@pixcontabil.com.br)' },
      });
      if (!balanceResponse.ok) {
        const errText = await balanceResponse.text();
        return new Response(JSON.stringify({ error: 'Falha ao consultar saldo', details: errText }), { status: 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }
      const data = await balanceResponse.json();
      console.log('[pix-balance] Transfeera response:', JSON.stringify(data));
      const balance = parseFloat(data.value ?? data.balance ?? '0');
      return new Response(JSON.stringify({ success: true, balance, available: true, provider: 'transfeera' }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

  } catch (error) {
    console.error('[pix-balance] Error:', error);
    return new Response(JSON.stringify({ error: 'Internal server error', details: error.message }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }
});
