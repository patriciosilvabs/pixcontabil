

# Marco Zero (Cut-off) para Comprovantes

## Resumo

Criar uma constante `RECEIPT_CUTOFF_DATE` e aplicá-la em todos os pontos de verificação de pendência (frontend e server-side), ignorando transações anteriores a essa data.

## Alterações

### 1. `src/constants/app.ts` — Constante de cut-off

Adicionar:
```typescript
export const RECEIPT_CUTOFF_DATE = '2025-05-22T00:00:00Z';
```

### 2. `src/hooks/usePendingReceipts.ts` — Filtro por cut-off

Substituir `.gte("created_at", thirtyDaysAgo)` por `.gte("created_at", RECEIPT_CUTOFF_DATE)` nas duas queries (completed e stuck). O filtro de 30 dias se torna redundante se o cut-off for mais recente; manter o `Math.max` entre ambos para futuro-proofing.

### 3. `src/hooks/useDashboardData.ts` — Filtro por cut-off

No `eligibleForManualReceipt`, adicionar condição `new Date(t.created_at) >= new Date(RECEIPT_CUTOFF_DATE)` para excluir transações antigas dos missing receipts do dashboard.

### 4. Edge Functions (`pix-pay-dict`, `pix-pay-qrc`, `billet-pay`) — Filtro server-side

Adicionar `.gte('created_at', '2025-05-22T00:00:00Z')` na query de pendência de cada função, para que transações antigas não bloqueiem novos pagamentos.

### 5. Toast de boas-vindas (opcional) — `src/components/dashboard/MobileDashboard.tsx`

Exibir toast uma única vez (flag no `localStorage`) informando: "Sistema atualizado. Novas regras de comprovação ativas a partir de hoje."

## Arquivos modificados

| Arquivo | Alteração |
|---|---|
| `src/constants/app.ts` | Adicionar `RECEIPT_CUTOFF_DATE` |
| `src/hooks/usePendingReceipts.ts` | Usar cut-off no `.gte()` |
| `src/hooks/useDashboardData.ts` | Filtrar eligibleForManualReceipt por cut-off |
| `supabase/functions/pix-pay-dict/index.ts` | `.gte('created_at', CUTOFF)` na query |
| `supabase/functions/pix-pay-qrc/index.ts` | Mesmo filtro |
| `supabase/functions/billet-pay/index.ts` | Mesmo filtro |
| `src/components/dashboard/MobileDashboard.tsx` | Toast one-time de atualização |

