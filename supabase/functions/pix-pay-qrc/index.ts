import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

function generateIdempotencyKey(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let result = '';
  for (let i = 0; i < 35; i++) result += chars.charAt(Math.floor(Math.random() * chars.length));
  return result;
}

async function callOnzViaProxy(url: string, method: string, headers: Record<string, string>, bodyRaw?: string) {
  const proxyUrl = Deno.env.get('ONZ_PROXY_URL')!;
  const proxyApiKey = Deno.env.get('ONZ_PROXY_API_KEY')!;
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
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader?.startsWith('Bearer ')) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

    const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, { global: { headers: { Authorization: authHeader } } });
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) return new Response(JSON.stringify({ error: 'Invalid token' }), { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

    const userId = user.id;
    const body = await req.json();
    const { company_id, qr_code: rawQrCode, valor, descricao, idempotency_key } = body;

    if (!company_id || !rawQrCode) return new Response(JSON.stringify({ error: 'company_id and qr_code are required' }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

    const qr_code = rawQrCode.trim().replace(/[\r\n\t]/g, '').replace(/[\u200B-\u200D\uFEFF\u00A0]/g, '');

    // Get Pix config for cash-out (admin client to bypass RLS)
    const supabaseAdmin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

    // ---- SERVER-SIDE PENDENCY CHECK ----
    {
      const { data: completedTxs } = await supabaseAdmin
        .from('transactions')
        .select('id, receipts(id, ocr_data)')
        .eq('created_by', userId)
        .eq('company_id', company_id)
        .eq('status', 'completed')
        .gt('amount', 0.01)
        .gte('created_at', '2026-04-01T00:00:00Z')
        .limit(50);

      if (completedTxs) {
        const hasPending = completedTxs.some((tx: any) => {
          const receipts = Array.isArray(tx.receipts) ? tx.receipts : [];
          return !receipts.some((r: any) => !r?.ocr_data?.auto_generated);
        });
        if (hasPending) {
          return new Response(JSON.stringify({
            error: 'Você possui comprovante(s) pendente(s). Anexe a nota fiscal antes de realizar um novo pagamento.',
            code: 'PENDING_RECEIPT',
          }), { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
        }
      }
    }

    let config: any = null;
    const { data: cashOutConfig } = await supabaseAdmin.from('pix_configs').select('*').eq('company_id', company_id).eq('is_active', true).eq('purpose', 'cash_out').single();
    config = cashOutConfig;
    if (!config) { const { data: bothConfig } = await supabaseAdmin.from('pix_configs').select('*').eq('company_id', company_id).eq('is_active', true).eq('purpose', 'both').single(); config = bothConfig; }
    if (!config) return new Response(JSON.stringify({ error: 'Pix configuration not found' }), { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

    // Decode QR code info locally
    const qrcInfoResponse = await fetch(`${Deno.env.get('SUPABASE_URL')}/functions/v1/pix-qrc-info`, {
      method: 'POST', headers: { 'Authorization': authHeader, 'Content-Type': 'application/json' },
      body: JSON.stringify({ company_id, qr_code }),
    });
    if (!qrcInfoResponse.ok) {
      const errorText = await qrcInfoResponse.text();
      return new Response(JSON.stringify({ error: 'Failed to decode QR Code', details: errorText }), { status: 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    const qrcInfo = await qrcInfoResponse.json();
    const qrType = qrcInfo.type;
    const qrEmbeddedAmount = Number(qrcInfo.amount || 0);
    const hasEmbeddedAmount = Number.isFinite(qrEmbeddedAmount) && qrEmbeddedAmount > 0;
    const paymentAmount = (qrType === 'dynamic' && hasEmbeddedAmount) ? qrEmbeddedAmount : (valor || qrEmbeddedAmount || 0);

    const MAX_PAYMENT_VALUE = 1_000_000;
    if (paymentAmount <= 0 || paymentAmount > MAX_PAYMENT_VALUE) return new Response(JSON.stringify({ error: 'Valor inválido.' }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

    const destKey = qrcInfo.pix_key;

    // IDEMPOTENCY CHECK
    if (idempotency_key) {
      const supabaseAdmin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
      const fiveMinAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString();
      const { data: existing } = await supabaseAdmin.from('transactions')
        .select('id, status').eq('company_id', company_id).eq('pix_copia_cola', qr_code).eq('created_by', userId)
        .gte('created_at', fiveMinAgo).in('status', ['pending', 'completed']).limit(1).maybeSingle();
      if (existing) {
        console.log(`[pix-pay-qrc] Duplicate blocked. Existing tx: ${existing.id}`);
        return new Response(JSON.stringify({ success: true, transaction_id: existing.id, duplicate: true, status: existing.status }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }
    }

    // STATIC QR CODE: For ONZ, try QRC endpoint with full EMV first (preserves txid/context)
    // For other providers, delegate to pix-pay-dict as before
    if (qrType !== 'dynamic') {
      if (!destKey && !qr_code) return new Response(JSON.stringify({ error: 'Could not extract Pix key from QR Code' }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

      if (config.provider === 'onz') {
        // ONZ: send full EMV via /pix/payments/qrc even for static QR codes
        // This preserves transaction context (txid, creditor info) that DICT loses
        console.log('[pix-pay-qrc] Static QR + ONZ - sending full EMV via QRC endpoint');

        const authResponse2 = await fetch(`${Deno.env.get('SUPABASE_URL')}/functions/v1/pix-auth`, {
          method: 'POST', headers: { 'Authorization': authHeader, 'Content-Type': 'application/json', 'apikey': Deno.env.get('SUPABASE_ANON_KEY')! },
          body: JSON.stringify({ company_id, purpose: 'cash_out' }),
        });
        if (!authResponse2.ok) return new Response(JSON.stringify({ error: 'Failed to authenticate with provider' }), { status: 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
        const { access_token: staticToken } = await authResponse2.json();

        const idempKey = generateIdempotencyKey();
        const onzHeaders: Record<string, string> = {
          'Authorization': `Bearer ${staticToken}`,
          'Content-Type': 'application/json',
          'x-idempotency-key': idempKey,
        };
        if (config.provider_company_id) onzHeaders['X-Company-ID'] = config.provider_company_id;

        const onzPayload = {
          qrCode: qr_code,
          payment: { amount: Number(paymentAmount.toFixed(2)), currency: 'BRL' },
          description: descricao || 'Pagamento via QR Code',
        };

        let result = await callOnzViaProxy(`${config.base_url}/api/v2/pix/payments/qrc`, 'POST', onzHeaders, JSON.stringify(onzPayload));

        // Token retry
        if (result.status === 401 || result.data?.type === 'onz-0018') {
          console.log('[pix-pay-qrc] Static QR token rejected, retrying...');
          const retryAuth = await fetch(`${Deno.env.get('SUPABASE_URL')}/functions/v1/pix-auth`, {
            method: 'POST', headers: { 'Authorization': authHeader, 'Content-Type': 'application/json', 'apikey': Deno.env.get('SUPABASE_ANON_KEY')! },
            body: JSON.stringify({ company_id, purpose: 'cash_out', force_new: true }),
          });
          const { access_token: newToken } = await retryAuth.json();
          onzHeaders['Authorization'] = `Bearer ${newToken}`;
          result = await callOnzViaProxy(`${config.base_url}/api/v2/pix/payments/qrc`, 'POST', onzHeaders, JSON.stringify(onzPayload));
        }

        // If QRC fails, fallback to DICT
        if (result.status >= 400) {
          console.log('[pix-pay-qrc] Static QR via QRC failed, falling back to DICT. Error:', JSON.stringify(result.data));
          if (destKey) {
            const dictResponse = await fetch(`${Deno.env.get('SUPABASE_URL')}/functions/v1/pix-pay-dict`, {
              method: 'POST', headers: { 'Authorization': authHeader, 'Content-Type': 'application/json' },
              body: JSON.stringify({ company_id, pix_key: destKey, valor: paymentAmount, descricao: descricao || 'Pagamento via QR Code' }),
            });
            const dictResult = await dictResponse.json();
            if (dictResult.transaction_id) {
              const sa = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
              await sa.from('transactions').update({ pix_type: 'qrcode', pix_copia_cola: qr_code }).eq('id', dictResult.transaction_id);
            }
            return new Response(JSON.stringify({ ...dictResult, amount: paymentAmount, qr_info: qrcInfo, fallback: 'dict' }), { status: dictResponse.status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
          }
          return new Response(JSON.stringify({ error: 'Falha no pagamento via QR Code', details: result.data }), { status: 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
        }

        // Success - save transaction
        const paymentData = result.data;
        const e2eId = paymentData.e2eId || paymentData.endToEndId || '';
        const onzId = paymentData.correlationID || paymentData.id || '';
        const externalId = `onz:${onzId}:${e2eId}`;

        console.log('[pix-pay-qrc] Static QR via QRC succeeded:', JSON.stringify(paymentData));

        const supabaseAdmin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
        const { data: transaction, error: txError } = await supabaseAdmin.from('transactions').insert({
          company_id, created_by: userId, amount: paymentAmount,
          description: descricao || 'Pagamento via QR Code', pix_type: 'qrcode',
          pix_copia_cola: qr_code, pix_key: destKey,
          pix_e2eid: e2eId || null,
          external_id: externalId, beneficiary_name: qrcInfo.merchant_name || null,
          status: 'pending', pix_provider_response: paymentData,
        }).select('id').single();

        if (txError) console.error('[pix-pay-qrc] Static QR transaction insert error:', txError);

        return new Response(JSON.stringify({
          success: true, transaction_id: transaction?.id || null,
          amount: paymentAmount, qr_info: qrcInfo, provider_response: paymentData,
        }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }

      // Non-ONZ providers: delegate to pix-pay-dict as before
      if (!destKey) return new Response(JSON.stringify({ error: 'Could not extract Pix key from QR Code' }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      console.log('[pix-pay-qrc] Static QR - delegating to pix-pay-dict');
      const payResponse = await fetch(`${Deno.env.get('SUPABASE_URL')}/functions/v1/pix-pay-dict`, {
        method: 'POST', headers: { 'Authorization': authHeader, 'Content-Type': 'application/json' },
        body: JSON.stringify({ company_id, pix_key: destKey, valor: paymentAmount, descricao: descricao || 'Pagamento via QR Code' }),
      });
      const payResult = await payResponse.json();
      if (!payResponse.ok) return new Response(JSON.stringify(payResult), { status: payResponse.status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      if (payResult.transaction_id) {
        const supabaseAdmin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
        await supabaseAdmin.from('transactions').update({ pix_type: 'qrcode', pix_copia_cola: qr_code }).eq('id', payResult.transaction_id);
      }
      return new Response(JSON.stringify({ ...payResult, amount: paymentAmount, qr_info: qrcInfo }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    // DYNAMIC QR CODE
    console.log('[pix-pay-qrc] Dynamic QR - processing');

    // Get auth token
    const authResponse = await fetch(`${Deno.env.get('SUPABASE_URL')}/functions/v1/pix-auth`, {
      method: 'POST', headers: { 'Authorization': authHeader, 'Content-Type': 'application/json', 'apikey': Deno.env.get('SUPABASE_ANON_KEY')! },
      body: JSON.stringify({ company_id, purpose: 'cash_out' }),
    });
    if (!authResponse.ok) return new Response(JSON.stringify({ error: 'Failed to authenticate with provider' }), { status: 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    const { access_token } = await authResponse.json();

    let paymentData: any;
    let externalId: string;

    if (config.provider === 'onz') {
      // ========== ONZ: POST /pix/payments/qrc ==========
      const idempKey = generateIdempotencyKey();
      const onzHeaders: Record<string, string> = {
        'Authorization': `Bearer ${access_token}`,
        'Content-Type': 'application/json',
        'x-idempotency-key': idempKey,
      };
      if (config.provider_company_id) onzHeaders['X-Company-ID'] = config.provider_company_id;

      const onzPayload = {
        qrCode: qr_code,
        payment: { amount: Number(paymentAmount.toFixed(2)), currency: 'BRL' },
        description: descricao || 'Pagamento via QR Code',
      };

      // Use body_raw to avoid double serialization of EMV
      let result = await callOnzViaProxy(`${config.base_url}/api/v2/pix/payments/qrc`, 'POST', onzHeaders, JSON.stringify(onzPayload));

      // Token retry
      if (result.status === 401 || result.data?.type === 'onz-0018') {
        console.log('[pix-pay-qrc] Token rejected, retrying...');
        const retryAuth = await fetch(`${Deno.env.get('SUPABASE_URL')}/functions/v1/pix-auth`, {
          method: 'POST', headers: { 'Authorization': authHeader, 'Content-Type': 'application/json', 'apikey': Deno.env.get('SUPABASE_ANON_KEY')! },
          body: JSON.stringify({ company_id, purpose: 'cash_out', force_new: true }),
        });
        const { access_token: newToken } = await retryAuth.json();
        onzHeaders['Authorization'] = `Bearer ${newToken}`;
        result = await callOnzViaProxy(`${config.base_url}/api/v2/pix/payments/qrc`, 'POST', onzHeaders, JSON.stringify(onzPayload));
      }

      // If QRC fails with onz-0010 and we have a key, fallback to dict
      if (result.status >= 400) {
        if ((result.data?.type === 'onz-0010' || result.data?.code === 'onz-0010') && destKey) {
          console.log('[pix-pay-qrc] ONZ QRC rejected, falling back to pix-pay-dict');
          const dictResponse = await fetch(`${Deno.env.get('SUPABASE_URL')}/functions/v1/pix-pay-dict`, {
            method: 'POST', headers: { 'Authorization': authHeader, 'Content-Type': 'application/json' },
            body: JSON.stringify({ company_id, pix_key: destKey, valor: paymentAmount, descricao: descricao || 'Pagamento via QR Code' }),
          });
          const dictResult = await dictResponse.json();
          if (dictResult.transaction_id) {
            const sa = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
            await sa.from('transactions').update({ pix_type: 'qrcode', pix_copia_cola: qr_code }).eq('id', dictResult.transaction_id);
          }
          return new Response(JSON.stringify({ ...dictResult, amount: paymentAmount, qr_info: qrcInfo, fallback: 'dict' }), { status: dictResponse.status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
        }

        console.error('[pix-pay-qrc] ONZ error:', JSON.stringify(result.data));
        return new Response(JSON.stringify({ error: 'Falha no pagamento via QR Code', details: result.data }), { status: 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }

      paymentData = result.data;
      const e2eId = paymentData.e2eId || paymentData.endToEndId || '';
      const onzId = paymentData.correlationID || paymentData.id || '';
      externalId = `onz:${onzId}:${e2eId}`;
    } else {
      // ========== TRANSFEERA: batch with EMV ==========
      const apiBase = config.is_sandbox ? 'https://api-sandbox.transfeera.com' : 'https://api.transfeera.com';
      const idempotencyKey = crypto.randomUUID();
      const batchPayload = {
        name: `QRC_${Date.now()}`, type: 'TRANSFERENCIA', auto_close: true,
        transfers: [{ value: Number(paymentAmount.toFixed(2)), idempotency_key: idempotencyKey, pix_description: descricao || 'Pagamento via QR Code', emv: qr_code }],
      };

      try {
        const batchResponse = await fetch(`${apiBase}/batch`, {
          method: 'POST', headers: { 'Authorization': `Bearer ${access_token}`, 'Content-Type': 'application/json', 'User-Agent': 'PixContabil (contato@pixcontabil.com.br)' },
          body: JSON.stringify(batchPayload),
        });
        paymentData = await batchResponse.json();
        if (!batchResponse.ok) {
          console.error('[pix-pay-qrc] Transfeera error:', JSON.stringify(paymentData));
          if (destKey) {
            console.log('[pix-pay-qrc] Falling back to pix-pay-dict');
            const dictResponse = await fetch(`${Deno.env.get('SUPABASE_URL')}/functions/v1/pix-pay-dict`, {
              method: 'POST', headers: { 'Authorization': authHeader, 'Content-Type': 'application/json' },
              body: JSON.stringify({ company_id, pix_key: destKey, valor: paymentAmount, descricao: descricao || 'Pagamento via QR Code' }),
            });
            const dictResult = await dictResponse.json();
            if (dictResult.transaction_id) {
              const sa = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
              await sa.from('transactions').update({ pix_type: 'qrcode', pix_copia_cola: qr_code }).eq('id', dictResult.transaction_id);
            }
            return new Response(JSON.stringify({ ...dictResult, amount: paymentAmount, qr_info: qrcInfo, fallback: 'dict' }), { status: dictResponse.status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
          }
          return new Response(JSON.stringify({ error: 'Falha no pagamento via QR Code', details: paymentData }), { status: 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
        }
      } catch (e) {
        return new Response(JSON.stringify({ error: 'Falha na conexão com Transfeera', details: e.message }), { status: 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }

      const batchId = paymentData.id;
      const transferId = paymentData.transfers?.[0]?.id || '';
      externalId = `${batchId}:${transferId}`;
    }

    console.log('[pix-pay-qrc] Payment created:', JSON.stringify(paymentData));

    // Reutiliza supabaseAdmin já declarado no início do try block
    const { data: transaction, error: txError } = await supabaseAdmin.from('transactions').insert({
      company_id, created_by: userId, amount: paymentAmount,
      description: descricao || 'Pagamento via QR Code dinâmico', pix_type: 'qrcode',
      pix_copia_cola: qr_code, pix_txid: qrcInfo.txid || null,
      pix_e2eid: paymentData.e2eId || paymentData.endToEndId || null,
      external_id: externalId, beneficiary_name: qrcInfo.merchant_name || null,
      status: 'pending', pix_provider_response: paymentData,
    }).select('id').single();

    if (txError) console.error('[pix-pay-qrc] Transaction insert error:', txError);

    return new Response(JSON.stringify({
      success: true, transaction_id: transaction?.id || null,
      amount: paymentAmount, qr_info: qrcInfo, provider_response: paymentData,
    }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

  } catch (error) {
    console.error('[pix-pay-qrc] Error:', error);
    return new Response(JSON.stringify({ error: 'Internal server error', details: error.message }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }
});
