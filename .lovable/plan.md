

# Isenção de Transações de Verificação (R$ 0,01) do Sistema de Pendências

## Resumo

Transações de R$ 0,01 (probe de verificação de beneficiário) serão excluídas de toda lógica de pendência, bloqueio e obrigatoriedade de foto. Serão ocultadas por padrão no extrato.

## Alterações

### 1. `src/hooks/usePendingReceipts.ts` — Filtrar R$ 0,01

Adicionar filtro `.gt("amount", 0.01)` nas duas queries (completed e stuck) para excluir probes da contagem de pendências.

### 2. `src/hooks/useDashboardData.ts` — Filtrar R$ 0,01

No `eligibleForManualReceipt`, adicionar condição `Number(t.amount) > 0.01` para excluir probes da lista de missing receipts e dos totais do dashboard.

### 3. Edge Functions (`pix-pay-dict`, `pix-pay-qrc`, `billet-pay`) — Filtrar R$ 0,01 no check server-side

Na query de pendência server-side, adicionar `.gt('amount', 0.01)` para que probes não bloqueiem novos pagamentos.

### 4. `src/pages/Transactions.tsx` — Ocultar probes por padrão

Adicionar filtro no `filteredTransactions` para esconder transações com `amount <= 0.01` por padrão. Adicionar toggle/checkbox "Mostrar verificações" para exibi-las quando necessário.

### 5. `src/pages/ReceiptCapture.tsx` — Skip para probes

Se a transação carregada tiver `amount <= 0.01`, redirecionar automaticamente de volta (não exigir captura).

## Sobre a classificação automática

A classificação automática com categoria "Verificação de Dados" exigiria criar essa categoria no banco para cada empresa. Em vez disso, os probes simplesmente serão ignorados pelo sistema de pendências (não precisam de categoria nem foto). Isso é mais simples e robusto.

## Sobre transferência do nome do beneficiário

O nome capturado no probe já é persistido na transação de R$ 0,01 (`beneficiary_name`). O fluxo existente (PixKeyDialog) já copia esse nome para a transação principal no Step 4 — não requer alteração.

## Arquivos modificados

| Arquivo | Alteração |
|---|---|
| `src/hooks/usePendingReceipts.ts` | `.gt("amount", 0.01)` nas queries |
| `src/hooks/useDashboardData.ts` | Filtro `amount > 0.01` no eligibleForManualReceipt |
| `supabase/functions/pix-pay-dict/index.ts` | `.gt('amount', 0.01)` no check |
| `supabase/functions/pix-pay-qrc/index.ts` | `.gt('amount', 0.01)` no check |
| `supabase/functions/billet-pay/index.ts` | `.gt('amount', 0.01)` no check |
| `src/pages/Transactions.tsx` | Ocultar probes + toggle "Mostrar verificações" |
| `src/pages/ReceiptCapture.tsx` | Redirect automático se amount ≤ 0.01 |

