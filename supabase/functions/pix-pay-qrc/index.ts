import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

async function delegateQrToPixPayDict({
  authHeader,
  companyId,
  qrCode,
  paymentAmount,
  descricao,
  idempotencyKey,
  qrcInfo,
  creditorDocument,
  priority,
  paymentFlow,
}: {
  authHeader: string;
  companyId: string;
  qrCode: string;
  paymentAmount: number;
  descricao?: string;
  idempotencyKey?: string;
  qrcInfo: any;
  creditorDocument?: string;
  priority?: string;
  paymentFlow?: string;
}) {
  const destKey = qrcInfo?.pix_key;

  if (!destKey) {
    return {
      status: 400,
      body: { error: 'Could not extract Pix key from QR Code' },
    };
  }

  const dictResponse = await fetch(`${Deno.env.get('SUPABASE_URL')}/functions/v1/pix-pay-dict`, {
    method: 'POST',
    headers: { 'Authorization': authHeader, 'Content-Type': 'application/json', 'apikey': Deno.env.get('SUPABASE_ANON_KEY')! },
    body: JSON.stringify({
      company_id: companyId,
      pix_key: destKey,
      valor: paymentAmount,
      descricao: descricao || 'Pagamento via QR Code',
      idempotency_key: idempotencyKey,
      creditor_document: creditorDocument,
      priority,
      payment_flow: paymentFlow,
    }),
  });

  const dictText = await dictResponse.text();
  let dictResult: any;

  try {
    dictResult = dictText ? JSON.parse(dictText) : {};
  } catch {
    dictResult = { error: dictText || 'Falha ao iniciar pagamento Pix' };
  }

  if (dictResult?.transaction_id) {
    const supabaseAdmin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
    const txUpdate: Record<string, any> = {
      pix_type: 'qrcode',
      pix_copia_cola: qrCode,
    };

    if (qrcInfo?.txid) txUpdate.pix_txid = qrcInfo.txid;
    if (qrcInfo?.merchant_name) txUpdate.beneficiary_name = qrcInfo.merchant_name;
    if (qrcInfo?.pix_key) txUpdate.pix_key = qrcInfo.pix_key;

    await supabaseAdmin.from('transactions').update(txUpdate).eq('id', dictResult.transaction_id);
  }

  return {
    status: dictResponse.status,
    body: {
      ...dictResult,
      amount: paymentAmount,
      qr_info: qrcInfo,
      delegated: 'dict',
    },
  };
}

async function callOnzViaProxy(url: string, method: string, headers: Record<string, string>, bodyRaw?: string) {
  const proxyUrl = Deno.env.get('ONZ_PROXY_URL');
  const proxyApiKey = Deno.env.get('ONZ_PROXY_API_KEY');

  if (!proxyUrl || !proxyApiKey) {
    throw new Error('ONZ proxy is not configured');
  }

  const proxyBody: Record<string, unknown> = { url, method, headers };
  if (bodyRaw !== undefined) proxyBody.body_raw = bodyRaw;

  const resp = await fetch(`${proxyUrl}/proxy`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Proxy-API-Key': proxyApiKey,
    },
    body: JSON.stringify(proxyBody),
  });

  const text = await resp.text();
  let data: any;

  try {
    data = JSON.parse(text);
  } catch {
    throw new Error(`Proxy returned non-JSON response (HTTP ${resp.status})`);
  }

  return {
    proxyStatus: resp.status,
    status: data?.status ?? resp.status,
    data: data?.data ?? data,
  };
}

function generateOnzIdempotencyKey(rawKey?: string): string {
  const sanitized = String(rawKey || '').replace(/[^a-zA-Z0-9]/g, '');

  if (sanitized.length >= 8) {
    return sanitized.slice(0, 50);
  }

  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let result = '';
  for (let i = 0; i < 35; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

function resolveOnzPriority(explicitPriority: string | undefined, creditorDocument: string): 'HIGH' | 'NORM' {
  if (!creditorDocument) return 'NORM';
  return explicitPriority === 'NORM' ? 'NORM' : 'HIGH';
}

function getProviderErrorType(payload: any): string | null {
  return payload?.type || payload?.error?.type || payload?.provider_error?.type || null;
}

function getProviderErrorMessage(payload: any, fallback: string): string {
  if (typeof payload === 'string' && payload.trim()) return payload;

  const detail = payload?.detail || payload?.error?.detail || payload?.provider_error?.detail;
  if (Array.isArray(detail)) {
    const joined = detail
      .map((item: any) => item?.message || item?.field || String(item))
      .filter(Boolean)
      .join('; ');

    if (joined) return joined;
  }

  const candidates = [
    payload?.message,
    payload?.title,
    payload?.error,
    payload?.details,
    payload?.error?.message,
    payload?.error?.title,
    payload?.provider_error?.message,
    payload?.provider_error?.title,
  ];

  for (const candidate of candidates) {
    if (typeof candidate === 'string' && candidate.trim()) {
      return candidate;
    }
  }

  return fallback;
}

async function getOnzAccessToken(authHeader: string, companyId: string, forceNew = false): Promise<string> {
  const authResponse = await fetch(`${Deno.env.get('SUPABASE_URL')}/functions/v1/pix-auth`, {
    method: 'POST',
    headers: {
      'Authorization': authHeader,
      'Content-Type': 'application/json',
      'apikey': Deno.env.get('SUPABASE_ANON_KEY')!,
    },
    body: JSON.stringify({
      company_id: companyId,
      purpose: 'cash_out',
      force_new: forceNew,
    }),
  });

  if (!authResponse.ok) {
    throw new Error(await authResponse.text() || 'Failed to authenticate with provider');
  }

  const authData = await authResponse.json();
  if (!authData?.access_token) {
    throw new Error('Provider token was not returned');
  }

  return authData.access_token;
}

function buildOnzHeaders(accessToken: string, onzIdempotencyKey: string, providerCompanyId?: string | null) {
  const headers: Record<string, string> = {
    'Authorization': `Bearer ${accessToken}`,
    'Content-Type': 'application/json',
    'x-idempotency-key': onzIdempotencyKey,
  };

  if (providerCompanyId) {
    headers['X-Company-ID'] = providerCompanyId;
  }

  return headers;
}

async function callOnzQrcWithTokenRetry({
  authHeader,
  companyId,
  config,
  payload,
  onzIdempotencyKey,
}: {
  authHeader: string;
  companyId: string;
  config: any;
  payload: Record<string, any>;
  onzIdempotencyKey: string;
}) {
  const url = `${config.base_url}/api/v2/pix/payments/qrc`;

  let accessToken = await getOnzAccessToken(authHeader, companyId, false);
  let result = await callOnzViaProxy(
    url,
    'POST',
    buildOnzHeaders(accessToken, onzIdempotencyKey, config.provider_company_id),
    JSON.stringify(payload),
  );
  let normalizedData = result.data?.data ?? result.data;

  if (result.status === 401 || getProviderErrorType(normalizedData) === 'onz-0018') {
    accessToken = await getOnzAccessToken(authHeader, companyId, true);
    result = await callOnzViaProxy(
      url,
      'POST',
      buildOnzHeaders(accessToken, onzIdempotencyKey, config.provider_company_id),
      JSON.stringify(payload),
    );
    normalizedData = result.data?.data ?? result.data;
  }

  return {
    status: result.status,
    data: normalizedData,
  };
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
    const { company_id, qr_code: rawQrCode, valor, descricao, idempotency_key, creditor_document, priority, payment_flow } = body;

    if (!company_id || !rawQrCode) return new Response(JSON.stringify({ error: 'company_id and qr_code are required' }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

    const qr_code = rawQrCode.trim().replace(/[\r\n\t]/g, '').replace(/[\u200B-\u200D\uFEFF\u00A0]/g, '');

    // Get Pix config for cash-out (admin client to bypass RLS)
    const supabaseAdmin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

    // ---- SERVER-SIDE PENDENCY CHECK (respects company setting) ----
    {
      const { data: companyData } = await supabaseAdmin
        .from('companies')
        .select('block_on_pending_receipt')
        .eq('id', company_id)
        .single();
      const shouldBlock = companyData?.block_on_pending_receipt !== false;

      if (shouldBlock) {
        const { data: completedTxs } = await supabaseAdmin
          .from('transactions')
          .select('id, receipts(id, ocr_data)')
          .eq('created_by', userId)
          .eq('company_id', company_id)
          .eq('status', 'completed')
          .eq('receipt_required', true)
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

    if (config.provider === 'onz' && qrType === 'dynamic') {
      console.log('[pix-pay-qrc] ONZ dynamic QR - calling proxy /pix/pagar-qrc (QRC endpoint)');

      const newProxyUrl = Deno.env.get('NEW_PROXY_URL');
      const newProxyKey = Deno.env.get('NEW_PROXY_KEY');

      if (!newProxyUrl || !newProxyKey) {
        console.error('[pix-pay-qrc] NEW_PROXY_URL or NEW_PROXY_KEY not configured');
        return new Response(JSON.stringify({ error: 'Proxy not configured for QRC payments' }), {
          status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      const qrcIdempotencyKey = idempotency_key || `qrc-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

      try {
        const qrcResponse = await fetch(`${newProxyUrl}/pix/pagar-qrc`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-proxy-key': newProxyKey,
            'x-idempotency-key': qrcIdempotencyKey,
          },
          body: JSON.stringify({
            emv: qr_code,
            valor: paymentAmount,
            descricao: descricao || 'Pagamento via QR Code',
          }),
        });

        const qrcText = await qrcResponse.text();
        let qrcResult: any;
        try { qrcResult = qrcText ? JSON.parse(qrcText) : {}; } catch { qrcResult = { raw: qrcText }; }

        console.log('[pix-pay-qrc] QRC proxy response:', JSON.stringify({ status: qrcResponse.status, body: qrcResult }));

        // Normalize nested data
        const normalizedData = qrcResult?.data ?? qrcResult;

        if (!qrcResponse.ok) {
          console.warn('[pix-pay-qrc] QRC endpoint failed, falling back to pix-pay-dict');
          // Fallback to dict
          const resolvedCreditorDoc = creditor_document || qrcInfo?.creditor_document || '';
          const delegated = await delegateQrToPixPayDict({
            authHeader, companyId: company_id, qrCode: qr_code, paymentAmount,
            descricao, idempotencyKey: idempotency_key, qrcInfo,
            creditorDocument: resolvedCreditorDoc, priority, paymentFlow: payment_flow,
          });
          return new Response(JSON.stringify({ ...delegated.body, amount: paymentAmount, qr_info: qrcInfo, fallback: 'dict' }), {
            status: delegated.status, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          });
        }

        // Success - create transaction in DB
        const e2eid = normalizedData?.endToEndId || normalizedData?.e2eId || normalizedData?.e2eid || null;
        const providerTxId = normalizedData?.id || normalizedData?.transactionId || null;
        const providerStatus = normalizedData?.status || '';

        const mappedStatus = ['LIQUIDATED', 'REALIZADO', 'CONFIRMED', 'COMPLETED'].includes(providerStatus?.toUpperCase?.())
          ? 'completed' : 'pending';

        const { data: transaction, error: txError } = await supabaseAdmin.from('transactions').insert({
          company_id, created_by: userId, amount: paymentAmount,
          description: descricao || 'Pagamento via QR Code dinâmico',
          pix_type: 'qrcode', pix_copia_cola: qr_code,
          pix_txid: qrcInfo?.txid || null, pix_e2eid: e2eid,
          external_id: providerTxId, beneficiary_name: qrcInfo?.merchant_name || null,
          pix_key: qrcInfo?.pix_key || null,
          status: mappedStatus, pix_provider_response: normalizedData,
          paid_at: mappedStatus === 'completed' ? new Date().toISOString() : null,
        }).select('id').single();

        if (txError) console.error('[pix-pay-qrc] Transaction insert error:', txError);

        return new Response(JSON.stringify({
          success: true, transaction_id: transaction?.id || null,
          amount: paymentAmount, qr_info: qrcInfo, provider_response: normalizedData,
          status: mappedStatus,
        }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

      } catch (networkErr: any) {
        console.error('[pix-pay-qrc] QRC proxy network error, falling back to dict:', networkErr.message);
        const resolvedCreditorDoc = creditor_document || qrcInfo?.creditor_document || '';
        const delegated = await delegateQrToPixPayDict({
          authHeader, companyId: company_id, qrCode: qr_code, paymentAmount,
          descricao, idempotencyKey: idempotency_key, qrcInfo,
          creditorDocument: resolvedCreditorDoc, priority, paymentFlow: payment_flow,
        });
        return new Response(JSON.stringify({ ...delegated.body, amount: paymentAmount, qr_info: qrcInfo, fallback: 'dict' }), {
          status: delegated.status, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
    }

    if (config.provider === 'onz') {
      console.log('[pix-pay-qrc] ONZ static QR - delegating to pix-pay-dict using decoded Pix key');
      const delegated = await delegateQrToPixPayDict({
        authHeader,
        companyId: company_id,
        qrCode: qr_code,
        paymentAmount,
        descricao,
        idempotencyKey: idempotency_key,
        qrcInfo,
        creditorDocument: creditor_document,
        priority,
        paymentFlow: payment_flow,
      });

      return new Response(JSON.stringify(delegated.body), {
        status: delegated.status,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // STATIC QR CODE for non-ONZ providers: delegate to pix-pay-dict
    if (qrType !== 'dynamic') {
      // Non-ONZ providers: delegate to pix-pay-dict as before
      const destKey = qrcInfo.pix_key;
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

    let paymentData: any;

    // ========== TRANSFEERA: batch with EMV ==========
    // Get auth token for Transfeera
    const authResponse = await fetch(`${Deno.env.get('SUPABASE_URL')}/functions/v1/pix-auth`, {
      method: 'POST', headers: { 'Authorization': authHeader, 'Content-Type': 'application/json', 'apikey': Deno.env.get('SUPABASE_ANON_KEY')! },
      body: JSON.stringify({ company_id, purpose: 'cash_out' }),
    });
    if (!authResponse.ok) return new Response(JSON.stringify({ error: 'Failed to authenticate with provider' }), { status: 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    const { access_token } = await authResponse.json();

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
        const destKey = qrcInfo.pix_key;
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
    const externalId = `${batchId}:${transferId}`;

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
