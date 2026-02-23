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
  if (!content.startsWith('-----')) {
    try { content = atob(content.replace(/[\s\r\n]/g, '')); } catch { /* use as-is */ }
  }
  const parts = content.split(/-----END CERTIFICATE-----/);
  const certs: string[] = [];
  for (const part of parts) {
    const beginIdx = part.indexOf('-----BEGIN CERTIFICATE-----');
    if (beginIdx === -1) continue;
    const certContent = part.substring(beginIdx + '-----BEGIN CERTIFICATE-----'.length);
    const cleanB64 = certContent.replace(/[^A-Za-z0-9+/=]/g, '');
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

    // Get Pix config for cash-in (balance check)
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
      console.log('[pix-balance] No active pix config found');
      return new Response(
        JSON.stringify({ success: true, balance: null, available: false, provider: null, message: 'Nenhuma configuração Pix ativa encontrada' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const provider = config.provider;
    console.log(`[pix-balance] Provider: ${provider}`);

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const authResponse = await fetch(`${supabaseUrl}/functions/v1/pix-auth`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': authHeader,
      },
      body: JSON.stringify({ company_id, purpose: 'cash_in', scopes: 'extrato.read' }),
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
      const defaultAccount = data?.accounts?.find((a: any) => a.isDefault) ?? data?.accounts?.[0];
      balance = (defaultAccount?.balance?.available ?? defaultAccount?.balance?.total ?? 0) / 100;
    }

    // ========== PAGGUE ==========
    else if (provider === 'paggue') {
      // Paggue doesn't have a dedicated balance endpoint in the public API.
      // Balance info is available in cash-out responses within person.balance.available (in cents).
      // We'll try the settings endpoint which may return balance info.
      const paggueCompanyId = config.provider_company_id;
      if (!paggueCompanyId) {
        return new Response(
          JSON.stringify({ success: true, balance: null, available: false, provider, message: 'Paggue Company ID não configurado' }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      try {
        const settingsRes = await fetch('https://ms.paggue.io/cashout/api/settings', {
          headers: {
            'Authorization': `Bearer ${accessToken}`,
            'X-Company-ID': paggueCompanyId,
          },
        });

        if (settingsRes.ok) {
          const settingsData = await settingsRes.json();
          console.log('[pix-balance] Paggue settings response:', JSON.stringify(settingsData));
          // Balance may be in person.balance.available (cents)
          const availableCents = settingsData?.person?.balance?.available 
            ?? settingsData?.balance?.available 
            ?? settingsData?.available;
          if (availableCents !== undefined && availableCents !== null) {
            balance = Number(availableCents) / 100;
          } else {
            return new Response(
              JSON.stringify({ success: true, balance: null, available: false, provider, message: 'Saldo não disponível via API Paggue' }),
              { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
            );
          }
        } else {
          const errText = await settingsRes.text();
          console.warn('[pix-balance] Paggue settings error:', errText);
          return new Response(
            JSON.stringify({ success: true, balance: null, available: false, provider, message: 'Consulta de saldo não disponível' }),
            { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }
      } catch (e) {
        console.error('[pix-balance] Paggue balance error:', e);
        return new Response(
          JSON.stringify({ success: true, balance: null, available: false, provider, message: 'Erro ao consultar saldo' }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
    }

    // ========== ONZ Infopago (via proxy mTLS) ==========
    else if (provider === 'onz') {
      const balanceUrl = `${config.base_url}/accounts/balances/`;
      console.log(`[pix-balance] ONZ: GET ${balanceUrl}`);

      const proxyUrl = Deno.env.get('ONZ_PROXY_URL');
      const proxyApiKey = Deno.env.get('ONZ_PROXY_API_KEY');
      if (!proxyUrl || !proxyApiKey) {
        return new Response(
          JSON.stringify({ error: 'ONZ_PROXY_URL não configurado' }),
          { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      const fetchHeaders: any = { 'Authorization': `Bearer ${accessToken}` };
      if (config.provider_company_id) {
        fetchHeaders['X-Company-ID'] = config.provider_company_id;
      }

      try {
        const proxyResponse = await fetch(`${proxyUrl}/proxy`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-Proxy-API-Key': proxyApiKey },
          body: JSON.stringify({ url: balanceUrl, method: 'GET', headers: fetchHeaders }),
        });

        if (!proxyResponse.ok) {
          const errText = await proxyResponse.text();
          console.error('[pix-balance] ONZ proxy error:', errText);
          return new Response(
            JSON.stringify({ error: 'Falha ao consultar saldo na ONZ', details: errText }),
            { status: 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }

        const proxyData = await proxyResponse.json();
        const data = proxyData.data || proxyData;
        console.log('[pix-balance] ONZ response:', JSON.stringify(data));
        balance = parseFloat(data?.available ?? data?.balance ?? data?.saldo ?? '0');
      } catch (fetchError) {
        return new Response(
          JSON.stringify({ error: 'Falha na conexão com ONZ', details: fetchError.message }),
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
        certPem = decodeCert(config.certificate_encrypted);
        keyPem = config.certificate_key_encrypted ? decodeCert(config.certificate_key_encrypted) : certPem;
      } catch {
        return new Response(
          JSON.stringify({ error: 'Certificado mTLS inválido' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      const httpClient = Deno.createHttpClient({ cert: certPem, key: keyPem });
      const balanceUrl = `${config.base_url}/v2/gn/saldo`;

      try {
        const res = await fetch(balanceUrl, {
          headers: { 'Authorization': `Bearer ${accessToken}` },
          // @ts-ignore - Deno specific
          client: httpClient,
        });

        if (!res.ok) {
          const errText = await res.text();
          httpClient.close();
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

    // ========== BANCO INTER ==========
    else if (provider === 'inter') {
      if (!config.certificate_encrypted) {
        return new Response(
          JSON.stringify({ error: 'Certificado mTLS obrigatório para Banco Inter' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      let certPem: string;
      let keyPem: string;
      try {
        certPem = decodeCert(config.certificate_encrypted);
        keyPem = config.certificate_key_encrypted ? decodeCert(config.certificate_key_encrypted) : certPem;
        console.log('[pix-balance] Cert starts:', certPem.substring(0, 60));
        console.log('[pix-balance] Key starts:', keyPem.substring(0, 60));
        console.log('[pix-balance] Cert length:', certPem.length, 'Key length:', keyPem.length);
      } catch (e) {
        console.error('[pix-balance] decodeCert error:', e?.message || e);
        return new Response(
          JSON.stringify({ error: 'Certificado mTLS inválido', details: e?.message }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      const httpClient = Deno.createHttpClient({ cert: certPem, key: keyPem });
      const balanceUrl = `${config.base_url}/banking/v2/saldo`;
      const fetchHeaders: any = { 'Authorization': `Bearer ${accessToken}` };
      if (config.provider_company_id) {
        fetchHeaders['x-conta-corrente'] = config.provider_company_id.replace(/[^0-9]/g, '');
      }

      try {
        const res = await fetch(balanceUrl, {
          headers: fetchHeaders,
          // @ts-ignore - Deno specific
          client: httpClient,
        });

        if (!res.ok) {
          const errText = await res.text();
          httpClient.close();
          return new Response(
            JSON.stringify({ error: 'Falha ao consultar saldo no Banco Inter', details: errText }),
            { status: 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }

        const data = await res.json();
        console.log('[pix-balance] Inter balance response:', JSON.stringify(data));
        balance = parseFloat(data?.disponivel ?? data?.saldo ?? data?.available ?? '0');
        httpClient.close();
      } catch (fetchError) {
        httpClient.close();
        return new Response(
          JSON.stringify({ error: 'Falha na conexão mTLS com o Banco Inter', details: fetchError.message }),
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
