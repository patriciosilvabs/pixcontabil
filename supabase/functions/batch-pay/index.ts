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
  const text = await resp.text();
  let data: any;
  try { data = JSON.parse(text); } catch {
    throw new Error(`Proxy returned non-JSON response (HTTP ${resp.status})`);
  }
  return { status: resp.status, data };
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
  if (/^\d{11}$/.test(d)) return 'CPF';
  if (/^\d{14}$/.test(d)) return 'CNPJ';
  if (/^\+?\d{10,13}$/.test(trimmed.replace(/[^\d+]/g, ''))) return 'TELEFONE';
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

interface BatchItem {
  type: 'pix_key' | 'boleto';
  pix_key?: string;
  pix_key_type?: string;
  codigo_barras?: string;
  valor: number;
  descricao?: string;
}

interface BatchResult {
  index: number;
  success: boolean;
  transaction_id?: string;
  error?: string;
}

const MAX_ITEMS = 50;
const MAX_PAYMENT_VALUE = 1_000_000;

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      return new Response(JSON.stringify({ error: 'Não autorizado' }), { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, { global: { headers: { Authorization: authHeader } } });
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) return new Response(JSON.stringify({ error: 'Token inválido' }), { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

    const userId = user.id;
    const body = await req.json();
    const { company_id, items } = body as { company_id: string; items: BatchItem[] };

    if (!company_id || !items || !Array.isArray(items) || items.length === 0) {
      return new Response(JSON.stringify({ error: 'company_id e items são obrigatórios' }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    if (items.length > MAX_ITEMS) {
      return new Response(JSON.stringify({ error: `Máximo de ${MAX_ITEMS} itens por lote` }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    // Validate all items upfront
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      if (!item.type || !['pix_key', 'boleto'].includes(item.type)) {
        return new Response(JSON.stringify({ error: `Item ${i + 1}: tipo inválido (use pix_key ou boleto)` }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }
      if (item.type === 'pix_key' && !item.pix_key) {
        return new Response(JSON.stringify({ error: `Item ${i + 1}: pix_key é obrigatório` }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }
      if (item.type === 'boleto' && !item.codigo_barras) {
        return new Response(JSON.stringify({ error: `Item ${i + 1}: codigo_barras é obrigatório` }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }
      if (!item.valor || item.valor <= 0 || item.valor > MAX_PAYMENT_VALUE) {
        return new Response(JSON.stringify({ error: `Item ${i + 1}: valor inválido` }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }
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
    if (!config) return new Response(JSON.stringify({ error: 'Configuração Pix não encontrada' }), { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

    const results: BatchResult[] = [];
    let successCount = 0;
    let failedCount = 0;

    // Process items sequentially
    for (let i = 0; i < items.length; i++) {
      const item = items[i];

      try {
        if (config.provider === 'onz') {
          // ========== ONZ via novo proxy ==========
          let result: any;
          let paymentData: any;
          let externalId: string;
          let pixType: string;

          if (item.type === 'pix_key') {
            const resolvedType = mapPixKeyType(item.pix_key_type, item.pix_key!);
            const normalizedKey = normalizePixKeyByType(item.pix_key!, resolvedType);

            result = await callNewProxy('/pix/pagar', 'POST', {
              chavePix: normalizedKey,
              valor: Number(item.valor.toFixed(2)),
              descricao: item.descricao || 'Pagamento Pix em lote',
            });

            if (result.status >= 400) {
              throw new Error(result.data?.message || result.data?.title || 'Falha no pagamento Pix');
            }

            paymentData = result.data;
            const e2eId = paymentData.e2eId || paymentData.endToEndId || '';
            const onzId = paymentData.correlationID || paymentData.id || '';
            externalId = `onz:${onzId}:${e2eId}`;
            pixType = 'key';
          } else {
            // Boleto
            const cleanBarcode = item.codigo_barras!.replace(/[\s.\-]/g, '');

            result = await callNewProxy('/billets/pagar', 'POST', {
              linhaDigitavel: cleanBarcode,
              valor: Number(item.valor.toFixed(2)),
              descricao: item.descricao || 'Pagamento de boleto em lote',
            });

            if (result.status >= 400) {
              throw new Error(result.data?.message || result.data?.title || 'Falha no pagamento de boleto');
            }

            paymentData = result.data;
            const onzId = paymentData.id || '';
            externalId = `onz:${onzId}`;
            pixType = 'boleto';
          }

          // Save transaction
          const txData: any = {
            company_id, created_by: userId, amount: item.valor, status: 'pending',
            pix_type: pixType as any, description: item.descricao || `Pagamento em lote #${i + 1}`,
            external_id: externalId, pix_provider_response: paymentData,
          };
          if (item.type === 'pix_key') {
            txData.pix_key = item.pix_key;
            txData.pix_e2eid = paymentData.e2eId || paymentData.endToEndId || null;
          } else {
            txData.boleto_code = item.codigo_barras;
          }

          const { data: newTx, error: insertError } = await supabaseAdmin.from('transactions').insert(txData).select('id').single();
          if (insertError) throw new Error('Falha ao salvar transação');

          await supabaseAdmin.from('audit_logs').insert({
            user_id: userId, company_id, entity_type: 'transaction', entity_id: newTx.id,
            action: 'batch_payment_item', new_data: { index: i, provider: config.provider, externalId, valor: item.valor },
          });

          results.push({ index: i, success: true, transaction_id: newTx.id });
          successCount++;
        } else {
          throw new Error('Pagamento em lote só é suportado com o provedor ONZ');
        }
      } catch (err: any) {
        console.error(`[batch-pay] Item ${i} failed:`, err.message);
        results.push({ index: i, success: false, error: err.message });
        failedCount++;
      }
    }

    // Audit log for the batch itself
    await supabaseAdmin.from('audit_logs').insert({
      user_id: userId, company_id, entity_type: 'batch_payment', action: 'batch_payment_executed',
      new_data: { total: items.length, success_count: successCount, failed_count: failedCount },
    });

    return new Response(JSON.stringify({
      results,
      summary: { total: items.length, success_count: successCount, failed_count: failedCount },
    }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

  } catch (error: any) {
    console.error('[batch-pay] Error:', error);
    return new Response(JSON.stringify({ error: 'Erro interno do servidor', details: error.message }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }
});
