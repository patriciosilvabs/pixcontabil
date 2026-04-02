

## Correção: Confirmação automática de boletos via webhook

### Problema
Boletos pagos não estão sendo confirmados automaticamente. Três falhas identificadas:

### 1. Status `PAID` não reconhecido no Gateway
Em `pix-webhook-gateway/index.ts`, as funções `mapOnzEventType` (linha 93) e `mapOnzStatus` (linha 112) não incluem o status `PAID`, que a ONZ pode retornar para boletos liquidados. Resultado: o evento é normalizado como `payment.updated` com status `pending` em vez de `payment.confirmed` com status `completed`.

**Correção**: Adicionar `PAID` nos dois mapeamentos.

### 2. Busca por ID com prefixo `onz:` no webhook interno
Em `internal-payment-webhook/index.ts`, a função `handlePaymentConfirmed` (linha 121) usa comparação estrita:
```
query.or(`pix_txid.eq.${txid},external_id.eq.${txid}`)
```
Mas o `external_id` é salvo como `onz:<id>` (ex: `onz:abc123`), enquanto o webhook envia apenas `abc123`. A busca nunca encontra a transação.

**Correção**: Usar `ilike` com wildcard para `external_id`, igual ao que já é feito no gateway (linha 153):
```
external_id.ilike.%${txid}%
```
Aplicar a mesma correção em `handlePaymentFailed` (linha 177).

### 3. Status `PAID` também ausente no `COMPLETED` check do gateway
A função `mapOnzEventType` linha 96 verifica `LIQUIDATED` e `COMPLETED` mas não `PAID`. Mesma lacuna no `mapOnzStatus`.

### Arquivos alterados (APENAS boleto-related)
- **`supabase/functions/pix-webhook-gateway/index.ts`** — Adicionar `PAID` nos mapeamentos `mapOnzEventType` e `mapOnzStatus`
- **`supabase/functions/internal-payment-webhook/index.ts`** — Usar `ilike` com wildcard na busca por `external_id` em `handlePaymentConfirmed` e `handlePaymentFailed`

### O que NÃO será alterado
- Nenhuma função de Pix (pix-pay-qrc, pix-pay-dict, etc.)
- Nenhuma função de QR Code
- Nenhum arquivo frontend
- Nenhuma tabela ou política RLS

### Resultado esperado
- Webhook com status `PAID` será reconhecido como `completed`
- Busca por transaction_id encontrará boletos salvos com prefixo `onz:`
- Confirmação automática + geração de comprovante funcionarão para boletos

