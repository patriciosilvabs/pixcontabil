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

    const token = authHeader.replace('Bearer ', '');
    const { data: userData, error: authError } = await supabase.auth.getUser(token);
    if (authError || !userData?.user) {
      return new Response(JSON.stringify({ error: 'Invalid token' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    const { company_id } = await req.json();
    if (!company_id) {
      return new Response(JSON.stringify({ error: 'company_id is required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    console.log(`[register-webhook] Starting for company: ${company_id}`);

    const supabaseAdmin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

    const { data: configs } = await supabaseAdmin
      .from('pix_configs').select('*').eq('company_id', company_id).eq('is_active', true).limit(1);

    const config = configs?.[0];
    if (!config) {
      return new Response(JSON.stringify({ error: 'Configuração Pix não encontrada para esta empresa' }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    const publicWebhookUrl = `${Deno.env.get('SUPABASE_URL')}/functions/v1/pix-webhook`;
    const webhookSecret = config.webhook_secret;

    if (config.provider === 'onz') {
      // ========== ONZ: Register webhooks ==========
      // Get token via pix-auth
      const authResponse = await fetch(`${Deno.env.get('SUPABASE_URL')}/functions/v1/pix-auth`, {
        method: 'POST',
        headers: { 'Authorization': authHeader, 'Content-Type': 'application/json' },
        body: JSON.stringify({ company_id }),
      });

      if (!authResponse.ok) {
        return new Response(JSON.stringify({ error: 'Falha ao autenticar com ONZ' }),
          { status: 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }

      const { access_token } = await authResponse.json();

      const webhookUrl = webhookSecret
        ? `${publicWebhookUrl}?whs=${encodeURIComponent(webhookSecret)}`
        : publicWebhookUrl;

      // Register for transfer events
      const webhookTypes = ['transfer', 'receive'];
      const results: any[] = [];

      for (const type of webhookTypes) {
        try {
          const result = await callOnzViaProxy(
            `${config.base_url}/api/v2/webhooks/${type}`,
            'POST',
            {
              'Authorization': `Bearer ${access_token}`,
              'Content-Type': 'application/json',
            },
            JSON.stringify({ url: webhookUrl }),
          );

          results.push({ type, status: result.status, data: result.data });
          console.log(`[register-webhook] ONZ ${type} webhook result:`, JSON.stringify(result.data));
        } catch (e) {
          console.error(`[register-webhook] ONZ ${type} webhook error:`, e.message);
          results.push({ type, error: e.message });
        }
      }

      await supabaseAdmin.from('pix_configs').update({ webhook_url: publicWebhookUrl }).eq('id', config.id);

      return new Response(JSON.stringify({
        success: true,
        message: 'Webhooks registrados na ONZ',
        provider: 'onz',
        url: publicWebhookUrl,
        results,
      }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

    } else {
      // ========== TRANSFEERA ==========
      const isSandbox = config.is_sandbox;
      const authUrl = isSandbox
        ? 'https://login-api-sandbox.transfeera.com/authorization'
        : 'https://login-api.transfeera.com/authorization';

      const tokenResponse = await fetch(authUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'User-Agent': 'PixContabil (contato@pixcontabil.com.br)' },
        body: JSON.stringify({ grant_type: 'client_credentials', client_id: config.client_id, client_secret: config.client_secret_encrypted }),
      });

      if (!tokenResponse.ok) {
        const errorText = await tokenResponse.text();
        return new Response(JSON.stringify({ error: 'Falha ao autenticar com Transfeera', details: errorText }),
          { status: 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }

      const { access_token } = await tokenResponse.json();

      const webhookUrl = webhookSecret
        ? `${publicWebhookUrl}?whs=${encodeURIComponent(webhookSecret)}`
        : publicWebhookUrl;
      const apiBaseUrl = isSandbox ? 'https://api-sandbox.transfeera.com' : 'https://api.transfeera.com';

      const apiHeaders = {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${access_token}`,
        'User-Agent': 'PixContabil (contato@pixcontabil.com.br)',
      };

      const listResponse = await fetch(`${apiBaseUrl}/webhook`, { method: 'GET', headers: apiHeaders });
      let existingWebhooks: any[] = [];
      if (listResponse.ok) {
        const listData = await listResponse.json();
        existingWebhooks = Array.isArray(listData) ? listData : (listData?.data || []);
      }

      const objectTypes = ['Transfer', 'TransferRefund', 'CashIn', 'CashInRefund'];
      const existingMatch = existingWebhooks.find((w: any) => w.url === webhookUrl) || existingWebhooks[0];

      let result: any;
      if (existingMatch) {
        const updateResponse = await fetch(`${apiBaseUrl}/webhook/${existingMatch.id}`, {
          method: 'PUT', headers: apiHeaders,
          body: JSON.stringify({ url: webhookUrl, object_types: objectTypes }),
        });
        if (!updateResponse.ok) {
          const errorText = await updateResponse.text();
          return new Response(JSON.stringify({ error: 'Falha ao atualizar webhook', details: errorText }),
            { status: 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
        }
        result = { action: 'updated', webhook_id: existingMatch.id };
      } else {
        const createResponse = await fetch(`${apiBaseUrl}/webhook`, {
          method: 'POST', headers: apiHeaders,
          body: JSON.stringify({ url: webhookUrl, object_types: objectTypes }),
        });
        if (!createResponse.ok) {
          const errorText = await createResponse.text();
          return new Response(JSON.stringify({ error: 'Falha ao registrar webhook', details: errorText }),
            { status: 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
        }
        const createData = await createResponse.json();
        result = { action: 'created', webhook_id: createData.id };
      }

      await supabaseAdmin.from('pix_configs').update({ webhook_url: publicWebhookUrl }).eq('id', config.id);

      return new Response(JSON.stringify({
        success: true,
        message: result.action === 'updated' ? 'Webhook atualizado com sucesso na Transfeera' : 'Webhook registrado com sucesso na Transfeera',
        provider: 'transfeera',
        ...result, url: publicWebhookUrl, object_types: objectTypes,
      }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

  } catch (error) {
    console.error('[register-webhook] Error:', error);
    return new Response(JSON.stringify({ error: 'Erro interno', details: error.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }
});
