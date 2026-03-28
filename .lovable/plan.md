
# Corrigir autoanexo de comprovante Pix saindo sem beneficiário e como “Pendente”

## O que encontrei

- Não encontrei entradas recentes nos logs das funções consultadas, então a análise foi feita pelo fluxo do código.
- O problema principal está claro no código:
  1. `src/hooks/usePixPayment.ts` chama `generate-pix-receipt` imediatamente após criar a transação.
  2. Nesse momento a transação ainda está `pending` e muitas vezes ainda sem `beneficiary_name`.
  3. `supabase/functions/generate-pix-receipt/index.ts` gera o arquivo com os dados atuais da transação e depois fica idempotente: se já existir receipt, ele não recria.
  4. Quando o webhook/polling depois atualiza a transação para `completed` e preenche o beneficiário, o comprovante já ruim continua anexado.
- Há mais dois pontos que agravam isso:
  - `pix-webhook-gateway` atualiza status, mas não enriquece `beneficiary_name`/`beneficiary_document` antes de disparar o comprovante.
  - `internal-payment-webhook` até extrai beneficiário, mas chama `generate-pix-receipt` com payload errado (`transactionId` em vez de `transaction_id` + `company_id`).

## Correção proposta

### 1. Parar de gerar comprovante cedo demais
Remover o disparo imediato em `src/hooks/usePixPayment.ts`.

Novo comportamento:
- o comprovante automático só será gerado depois que o backend confirmar `completed`
- a confirmação poderá vir por:
  - `pix-webhook`
  - `pix-webhook-gateway`
  - `pix-check-status` (fallback quando o polling confirma antes do webhook)

### 2. Garantir que o backend preencha beneficiário antes do comprovante
Padronizar a extração de beneficiário nos fluxos ONZ antes de chamar `generate-pix-receipt`:

- `supabase/functions/pix-webhook/index.ts`
- `supabase/functions/pix-webhook-gateway/index.ts`
- `supabase/functions/pix-check-status/index.ts`

Objetivo:
- salvar `beneficiary_name`
- salvar `beneficiary_document`
- salvar `pix_e2eid`
- só então gerar o comprovante

### 3. Tornar `generate-pix-receipt` resistente a comprovante “ruim”
Ajustar `supabase/functions/generate-pix-receipt/index.ts` para não congelar um comprovante incompleto.

Regras:
- se a transação ainda estiver `pending`, não gerar o comprovante automático
- se já existir receipt auto-gerado com:
  - status pendente
  - beneficiário vazio / `-`
  então permitir regeneração quando a transação já estiver `completed` e com dados melhores
- manter idempotência real para não duplicar comprovantes corretos

### 4. Corrigir o fluxo interno que hoje chama a função com payload incorreto
Em `supabase/functions/internal-payment-webhook/index.ts`:
- enviar `transaction_id` e `company_id` no formato esperado
- evitar encerrar cedo demais sem tentar gerar/backfill do comprovante quando a transação já estiver confirmada

### 5. Fazer o polling também corrigir o comprovante, não só o status
Em `supabase/functions/pix-check-status/index.ts`:
- quando o polling detectar `completed` e preencher beneficiário, também disparar a geração/regeneração do comprovante
- isso cobre os casos em que o webhook atrasa ou falha

## Resultado esperado

Fluxo final:
```text
Pagamento criado
→ transação fica pending
→ NÃO gera comprovante ainda
→ webhook ou polling confirma completed
→ backend salva beneficiário + e2e + paid_at
→ generate-pix-receipt roda com dados finais
→ receipt anexa com nome do beneficiário e status Confirmado
```

## Arquivos que vou ajustar

- `src/hooks/usePixPayment.ts`
- `supabase/functions/generate-pix-receipt/index.ts`
- `supabase/functions/pix-webhook/index.ts`
- `supabase/functions/pix-webhook-gateway/index.ts`
- `supabase/functions/pix-check-status/index.ts`
- `supabase/functions/internal-payment-webhook/index.ts`

## Validação após implementar

Vou validar estes cenários:
1. Pix ONZ por chave cria transação `pending` sem anexar comprovante prematuro
2. quando virar `completed`, o comprovante é autoanexado com beneficiário real
3. se o polling confirmar antes do webhook, o comprovante ainda sai correto
4. comprovante antigo incompleto é regenerado
5. não há duplicação de receipts corretos
