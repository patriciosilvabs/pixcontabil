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

function isValidCpf(cpf: string): boolean {
  if (!/^\d{11}$/.test(cpf) || /^(\d)\1+$/.test(cpf)) return false;
  let sum = 0;
  for (let i = 0; i < 9; i++) sum += Number(cpf[i]) * (10 - i);
  let cd = (sum * 10) % 11; if (cd === 10) cd = 0;
  if (cd !== Number(cpf[9])) return false;
  sum = 0;
  for (let i = 0; i < 10; i++) sum += Number(cpf[i]) * (11 - i);
  cd = (sum * 10) % 11; if (cd === 10) cd = 0;
  return cd === Number(cpf[10]);
}

function isValidCnpj(cnpj: string): boolean {
  if (!/^\d{14}$/.test(cnpj) || /^(\d)\1+$/.test(cnpj)) return false;
  const calc = (base: string, w: number[]) => {
    const s = base.split('').reduce((a, d, i) => a + Number(d) * w[i], 0);
    const r = s % 11; return r < 2 ? 0 : 11 - r;
  };
  return calc(cnpj.slice(0, 12), [5,4,3,2,9,8,7,6,5,4,3,2]) === Number(cnpj[12])
    && calc(cnpj.slice(0, 13), [6,5,4,3,2,9,8,7,6,5,4,3,2]) === Number(cnpj[13]);
}

function normalizePhonePixKey(raw: string): string {
  const trimmed = raw.trim();
  const digits = trimmed.replace(/\D/g, '');
  if (trimmed.startsWith('+')) return `+${digits}`;
  if (digits.length === 10 || digits.length === 11) return `+55${digits}`;
  if ((digits.length === 12 || digits.length === 13) && digits.startsWith('55')) return `+${digits}`;
  return digits.length > 0 ? `+${digits}` : trimmed;
}

function detectPixKeyType(key: string): string {
  const trimmed = key.trim();
  const d = trimmed.replace(/\D/g, '');
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) return 'EMAIL';
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(trimmed)) return 'CHAVE_ALEATORIA';
  if (/^\d{11}$/.test(d) && isValidCpf(d)) return 'CPF';
  if (/^\d{14}$/.test(d) && isValidCnpj(d)) return 'CNPJ';
  if (/^\+?\d{10,13}$/.test(trimmed.replace(/[^\d+]/g, ''))) return 'TELEFONE';
  if (/^\d{11}$/.test(d) || /^\d{14}$/.test(d)) return 'TELEFONE';
  return 'CHAVE_ALEATORIA';
}

function mapPixKeyType(type: string | undefined, key: string): string {
  if (type) {
    const map: Record<string, string> = { cpf: 'CPF', cnpj: 'CNPJ', email: 'EMAIL', phone: 'TELEFONE', random: 'CHAVE_ALEATORIA' };
    if (map[type.toLowerCase()]) return map[type.toLowerCase()];
  }
  return detectPixKeyType(key);
}

function normalizePixKeyByType(key: string, keyType: string): string {
  if (keyType === 'TELEFONE') return normalizePhonePixKey(key);
  return key.trim();
}

function resolveOnzPriority(explicitPriority: string | undefined, beneficiaryDocument: string): 'HIGH' | 'NORM' {
  if (!beneficiaryDocument) return 'NORM';
  return explicitPriority === 'NORM' ? 'NORM' : 'HIGH';
}

function extractBeneficiary(payload: any): { name: string; doc: string } {
  const p = payload || {};
  const name = p?.creditParty?.name || p?.creditor?.name || p?.receiver?.name
    || p?.beneficiary?.name || p?.creditorAccount?.name
    || p?.receiverName || p?.creditorName || '';
  const doc = p?.creditParty?.taxId || p?.creditor?.taxId || p?.receiver?.taxId
    || p?.beneficiary?.document || p?.creditorAccount?.document || p?.creditorAccount?.taxId
    || p?.receiverDocument || p?.creditorTaxId || '';
  return { name: String(name).trim(), doc: String(doc).trim() };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, { global: { headers: { Authorization: authHeader } } });
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) return new Response(JSON.stringify({ error: 'Invalid token' }), { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

    const userId = user.id;
    const body = await req.json();
    const { company_id, pix_key, pix_key_type, valor, descricao, idempotency_key, receipt_required } = body;

    if (!company_id || !pix_key || !valor) {
      return new Response(JSON.stringify({ error: 'company_id, pix_key and valor are required' }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    const MAX_PAYMENT_VALUE = 1_000_000;
    if (valor <= 0 || valor > MAX_PAYMENT_VALUE) {
      return new Response(JSON.stringify({ error: `Valor inválido. O valor deve estar entre R$ 0,01 e R$ ${MAX_PAYMENT_VALUE.toLocaleString('pt-BR')}.` }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

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
    if (!config) {
      const { data: bothConfig } = await supabaseAdmin.from('pix_configs').select('*').eq('company_id', company_id).eq('is_active', true).eq('purpose', 'both').single();
      config = bothConfig;
    }
    if (!config) return new Response(JSON.stringify({ error: 'Pix configuration not found' }), { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

    // IDEMPOTENCY CHECK
    if (idempotency_key) {
      const fiveMinAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString();
      const { data: existing } = await supabaseAdmin.from('transactions')
        .select('id, status').eq('company_id', company_id).eq('pix_key', pix_key).eq('amount', valor).eq('created_by', userId)
        .gte('created_at', fiveMinAgo).in('status', ['pending', 'completed']).limit(1).maybeSingle();
      if (existing) {
        console.log(`[pix-pay-dict] Duplicate blocked. Existing tx: ${existing.id}`);
        return new Response(JSON.stringify({ success: true, transaction_id: existing.id, duplicate: true, status: existing.status }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }
    }

    const resolvedPixKeyType = mapPixKeyType(pix_key_type, pix_key);
    const normalizedPixKey = normalizePixKeyByType(pix_key, resolvedPixKeyType);

    let paymentData: any;
    let externalId: string;

    if (config.provider === 'onz') {
      // ========== ONZ via novo proxy: POST /pix/pagar ==========
      console.log(`[pix-pay-dict] ONZ proxy: key_type=${resolvedPixKeyType}, key=${normalizedPixKey}, valor=${valor}`);

      // Build payload for the dedicated proxy.
      // ONZ exige creditorDocument quando a prioridade é HIGH,
      // então forçamos NORM para chaves sem CPF/CNPJ extraível.
      const amountValue = Number(valor.toFixed(2));
      const beneficiaryDocument = body?.creditor_document
        ? String(body.creditor_document).replace(/\D/g, '')
        : ((resolvedPixKeyType === 'CPF' || resolvedPixKeyType === 'CNPJ')
            ? normalizedPixKey.replace(/\D/g, '')
            : '');
      const paymentPriority = resolveOnzPriority(body?.priority, beneficiaryDocument);

      const pixPayload: Record<string, any> = {
        chavePix: normalizedPixKey,
        valor: amountValue,
        descricao: descricao || 'Pagamento Pix',
      };

      // CRITICAL: ONZ requires creditorDocument when priority=HIGH.
      // Only set HIGH when we actually have a document; otherwise always NORM.
      if (beneficiaryDocument) {
        pixPayload.creditorDocument = beneficiaryDocument;
        pixPayload.priority = paymentPriority;
      } else {
        pixPayload.priority = 'NORM';
      }
      
      console.log(`[pix-pay-dict] priority=${pixPayload.priority}, hasDoc=${!!beneficiaryDocument}`);

      if (body?.payment_flow) {
        pixPayload.paymentFlow = body.payment_flow;
      }

      console.log('[pix-pay-dict] Sending to proxy:', JSON.stringify(pixPayload));
      const result = await callNewProxy('/pix/pagar', 'POST', pixPayload);

      if (result.status >= 400) {
        // Extract a string error message (detail can be an array of objects)
        let errorMsg = result.data?.title || result.data?.message || 'Failed to initiate Pix payment';
        if (Array.isArray(result.data?.detail)) {
          errorMsg = result.data.detail.map((d: any) => d?.message || d?.field || String(d)).join('; ');
        } else if (typeof result.data?.detail === 'string') {
          errorMsg = result.data.detail;
        }
        console.error('[pix-pay-dict] Proxy error:', JSON.stringify(result.data));
        return new Response(JSON.stringify({ error: errorMsg, provider_error: result.data }), { status: 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }

      // Proxy may wrap response in { data: { ... } } — unwrap if needed
      const rawPaymentData = result.data;
      paymentData = rawPaymentData?.data && typeof rawPaymentData.data === 'object' && !Array.isArray(rawPaymentData.data)
        ? rawPaymentData.data
        : rawPaymentData;
      const e2eId = paymentData.e2eId || paymentData.endToEndId || '';
      const onzId = paymentData.correlationID || paymentData.id || '';
      externalId = `onz:${onzId}:${e2eId}`;
    } else {
      // ========== TRANSFEERA (unchanged) ==========
      const authResponse = await fetch(`${Deno.env.get('SUPABASE_URL')}/functions/v1/pix-auth`, {
        method: 'POST', headers: { 'Authorization': authHeader, 'Content-Type': 'application/json', 'apikey': Deno.env.get('SUPABASE_ANON_KEY')! },
        body: JSON.stringify({ company_id, purpose: 'cash_out' }),
      });
      if (!authResponse.ok) return new Response(JSON.stringify({ error: 'Failed to authenticate with provider' }), { status: 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      const { access_token } = await authResponse.json();

      const apiBase = config.is_sandbox ? 'https://api-sandbox.transfeera.com' : 'https://api.transfeera.com';
      const idempotencyKey = crypto.randomUUID();
      const batchPayload = {
        name: `PIX_${Date.now()}`, type: 'TRANSFERENCIA', auto_close: true,
        transfers: [{ value: Number(valor.toFixed(2)), idempotency_key: idempotencyKey, pix_description: descricao || 'Pagamento Pix', destination_bank_account: { pix_key_type: resolvedPixKeyType, pix_key: normalizedPixKey } }],
      };

      console.log(`[pix-pay-dict] Transfeera: key_type=${resolvedPixKeyType}, key=${normalizedPixKey}, valor=${valor}`);

      try {
        const batchResponse = await fetch(`${apiBase}/batch`, {
          method: 'POST', headers: { 'Authorization': `Bearer ${access_token}`, 'Content-Type': 'application/json', 'User-Agent': 'PixContabil (contato@pixcontabil.com.br)' },
          body: JSON.stringify(batchPayload),
        });
        paymentData = await batchResponse.json();
        if (!batchResponse.ok) {
          console.error('[pix-pay-dict] Transfeera error:', JSON.stringify(paymentData));
          return new Response(JSON.stringify({ error: paymentData?.message || 'Failed to initiate Pix payment', provider_error: paymentData }), { status: 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
        }
      } catch (e) {
        return new Response(JSON.stringify({ error: 'Falha na conexão com Transfeera', details: e.message }), { status: 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }

      const batchId = paymentData.id;
      const transferId = paymentData.transfers?.[0]?.id || '';
      externalId = `${batchId}:${transferId}`;
    }

    console.log('[pix-pay-dict] Payment created:', JSON.stringify(paymentData));

    const ben = extractBeneficiary(paymentData);
    const { data: newTransaction, error: insertError } = await supabaseAdmin.from('transactions').insert({
      company_id, created_by: userId, amount: valor, status: 'pending', pix_type: 'key' as const,
      pix_key, description: descricao, external_id: externalId,
      pix_e2eid: paymentData.e2eId || paymentData.endToEndId || null,
      pix_provider_response: paymentData,
      receipt_required: receipt_required ?? true,
      ...(ben.name ? { beneficiary_name: ben.name } : {}),
      ...(ben.doc ? { beneficiary_document: ben.doc } : {}),
    }).select('id').single();

    if (insertError) {
      console.error('[pix-pay-dict] Failed to create transaction:', insertError);
      return new Response(JSON.stringify({ error: 'Failed to save transaction' }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    await supabaseAdmin.from('audit_logs').insert({
      user_id: userId, company_id, entity_type: 'transaction', entity_id: newTransaction.id,
      action: 'pix_payment_initiated',
      new_data: { provider: config.provider, externalId, valor, pix_key, status: 'pending' },
    });

    return new Response(JSON.stringify({
      success: true, transaction_id: newTransaction.id, id_envio: externalId,
      end_to_end_id: paymentData.e2eId || paymentData.endToEndId || null,
      status: paymentData.status || 'PROCESSING',
    }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

  } catch (error) {
    console.error('[pix-pay-dict] Error:', error);
    return new Response(JSON.stringify({ error: 'Internal server error', details: error.message }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }
});
