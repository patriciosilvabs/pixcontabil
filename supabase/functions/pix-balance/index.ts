import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

async function callNewProxy(path: string, method: string, body?: unknown) {
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

  const rawText = await resp.text();
  let data: any = null;

  try {
    data = rawText ? JSON.parse(rawText) : null;
  } catch {
    data = { raw: rawText };
  }

  return { status: resp.status, data };
}

function unavailableBalanceResponse(provider: string | null, message: string, providerError?: unknown) {
  return jsonResponse({
    success: true,
    balance: null,
    available: false,
    provider,
    message,
    provider_error: providerError ?? null,
  });
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      return jsonResponse({ error: 'Unauthorized' }, 401);
    }

    createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
      global: { headers: { Authorization: authHeader } },
    });

    const { company_id } = await req.json();
    if (!company_id) {
      return jsonResponse({ error: 'company_id is required' }, 400);
    }

    console.log(`[pix-balance] Fetching balance for company: ${company_id}`);

    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );

    let config: any = null;
    const { data: cashOutConfig } = await supabaseAdmin
      .from('pix_configs')
      .select('*')
      .eq('company_id', company_id)
      .eq('is_active', true)
      .eq('purpose', 'cash_out')
      .single();
    config = cashOutConfig;

    if (!config) {
      const { data: bothConfig } = await supabaseAdmin
        .from('pix_configs')
        .select('*')
        .eq('company_id', company_id)
        .eq('is_active', true)
        .eq('purpose', 'both')
        .single();
      config = bothConfig;
    }

    if (!config) {
      return jsonResponse({
        success: true,
        balance: null,
        available: false,
        provider: null,
        message: 'Nenhuma configuração Pix ativa encontrada',
      });
    }

    if (config.provider === 'onz') {
      const result = await callNewProxy('/saldo', 'GET');
      console.log(`[pix-balance] Proxy response: status=${result.status}, data=${JSON.stringify(result.data).substring(0, 500)}`);

      if (result.status >= 400) {
        const errorMsg = result.data?.detail || result.data?.message || result.data?.title || 'Falha ao consultar saldo';
        const isAuthError = result.data?.type === 'onz-0018' || result.status === 401;
        const message = isAuthError
          ? 'Saldo indisponível. O proxy precisa renovar o token OAuth da ONZ.'
          : errorMsg;

        console.error(`[pix-balance] Proxy error (auth=${isAuthError}):`, JSON.stringify(result.data));
        return unavailableBalanceResponse('onz', message, result.data);
      }

      const entries = result.data?.data;
      let balance = 0;

      if (Array.isArray(entries) && entries.length > 0) {
        balance = Number(entries[0]?.balanceAmount?.available ?? entries[0]?.balanceAmount?.current ?? entries[0]?.available) || 0;
      } else {
        balance = Number(
          result.data?.balanceAmount?.available
            ?? result.data?.balance
            ?? result.data?.available
            ?? 0,
        );
      }

      return jsonResponse({ success: true, balance, available: true, provider: 'onz' });
    }

    const authResponse = await fetch(`${Deno.env.get('SUPABASE_URL')!}/functions/v1/pix-auth`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': authHeader,
        'apikey': Deno.env.get('SUPABASE_ANON_KEY')!,
      },
      body: JSON.stringify({ company_id, purpose: 'cash_out' }),
    });

    if (!authResponse.ok) {
      const authError = await authResponse.text();
      console.error('[pix-balance] Transfeera auth error:', authError);
      return unavailableBalanceResponse('transfeera', 'Falha ao autenticar com o provedor', authError);
    }

    const { access_token } = await authResponse.json();
    const apiBase = config.is_sandbox ? 'https://api-sandbox.transfeera.com' : 'https://api.transfeera.com';

    const balanceResponse = await fetch(`${apiBase}/statement/balance`, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${access_token}`,
        'User-Agent': 'PixContabil (contato@pixcontabil.com.br)',
      },
    });

    if (!balanceResponse.ok) {
      const errText = await balanceResponse.text();
      console.error('[pix-balance] Transfeera balance error:', errText);
      return unavailableBalanceResponse('transfeera', 'Falha ao consultar saldo', errText);
    }

    const data = await balanceResponse.json();
    console.log('[pix-balance] Transfeera response:', JSON.stringify(data));
    const balance = parseFloat(data.value ?? data.balance ?? '0');

    return jsonResponse({ success: true, balance, available: true, provider: 'transfeera' });
  } catch (error) {
    console.error('[pix-balance] Error:', error);
    return jsonResponse(
      {
        error: 'Internal server error',
        details: error instanceof Error ? error.message : String(error),
      },
      500,
    );
  }
});
