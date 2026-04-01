

# Blindagem Server-Side + Reconciliação + Melhorias de Pendência

## Resumo

5 correções: (1) trava server-side nas Edge Functions de pagamento, (2) reconciliação de transações stuck, (3) remoção do limite de 10, (4) identificação visual reforçada, (5) `classified_at` no salvamento sem foto.

## Alterações

### 1. Trava Server-Side — Edge Functions `pix-pay-dict`, `pix-pay-qrc`, `billet-pay`

Antes de disparar o pagamento no provedor, adicionar verificação com `supabaseAdmin`:

```sql
SELECT id FROM transactions
WHERE created_by = $userId AND company_id = $company_id
  AND status = 'completed'
  AND id NOT IN (
    SELECT transaction_id FROM receipts
    WHERE ocr_data->>'auto_generated' IS DISTINCT FROM 'true'
  )
LIMIT 1
```

Se retornar resultado → responder **403 Forbidden** com mensagem clara:
`"Você possui comprovante(s) pendente(s). Anexe a nota fiscal antes de realizar um novo pagamento."`

Isso será implementado como uma query direta via `supabaseAdmin` em cada uma das 3 funções, logo após a validação de autenticação e antes de qualquer chamada ao provedor.

### 2. Reconciliação de Transações Stuck — `usePendingReceipts.ts`

- Expandir a query para incluir também `status = 'pending'` com `created_at < 5 minutos atrás`
- Adicionar campo `status` à interface `PendingReceipt`
- No `MobileDashboard.tsx`, adicionar botão "Sincronizar" que chama `pix-check-status` para cada transação stuck e depois faz `refresh()`

### 3. Remoção do `.limit(10)` — `usePendingReceipts.ts`

- Substituir `.limit(10)` por `.limit(100)` para visibilidade total
- Adicionar filtro de data: últimos 30 dias (`.gte("created_at", thirtyDaysAgo)`)

### 4. Identificação Visual Reforçada — `ReceiptCapture.tsx`

O card de identificação já existe (beneficiary_name + amount + created_at). Reforçar:
- Aumentar tamanho da fonte do nome do beneficiário (`text-lg font-bold`)
- Destacar valor com cor primária e tamanho maior
- Adicionar ícone visual de atenção

### 5. `classified_at` no `handleSaveWithoutReceipt` — `ReceiptCapture.tsx`

O `classified_at` já é preenchido quando há subcategoria selecionada (linha 290). Corrigir para **sempre** preencher quando salvando sem foto, mesmo sem subcategoria:

```typescript
updateData.classified_at = new Date().toISOString();
```

Mover essa linha para fora do bloco condicional `if (receiptData.subcategory)`.

## Arquivos modificados

| Arquivo | Alteração |
|---|---|
| `supabase/functions/pix-pay-dict/index.ts` | Adicionar check de pendência antes do pagamento |
| `supabase/functions/pix-pay-qrc/index.ts` | Mesmo check de pendência |
| `supabase/functions/billet-pay/index.ts` | Mesmo check de pendência |
| `src/hooks/usePendingReceipts.ts` | Incluir stuck, remover limit(10), adicionar filtro 30 dias |
| `src/components/dashboard/MobileDashboard.tsx` | Botão "Sincronizar" para transações stuck |
| `src/pages/ReceiptCapture.tsx` | Visual reforçado + `classified_at` sempre preenchido |

## Detalhes técnicos

- A query server-side usa LEFT JOIN implícito: busca transações completed onde NÃO existe receipt com `auto_generated != true`
- O check é feito com `supabaseAdmin` (service role) para bypass de RLS
- Transações "stuck" = `status = 'pending'` + `created_at < now() - 5min`
- O botão Sincronizar itera sobre stuck pendentes chamando `pix-check-status` sequencialmente

