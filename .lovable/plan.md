

## Problema

O BoletoPaymentDrawer usa a função `billet-check-status` para fazer polling de confirmação. Essa função recebe 404 do proxy e retorna 502, sem nenhuma lógica de recuperação. O polling fica eternamente em "processando".

Enquanto isso, a função `pix-check-status` já possui toda a lógica robusta para boletos:
- Roteamento correto (`/status/billet/:id` vs `/status/pix/:id`)
- Recuperação de 404 (marca como `failed` se transação > 10min)
- Unwrapping de respostas aninhadas do proxy
- Atualização automática da transação no banco

Existem duas funções fazendo a mesma coisa de forma divergente.

## Correção

**Consolidar o polling de boleto para usar `pix-check-status` em vez de `billet-check-status`.**

### 1. Alterar `BoletoPaymentDrawer.tsx`
- Trocar a chamada de `checkBilletStatus(txId, true)` por uma invocação direta de `pix-check-status` com `transaction_id`
- Usar `supabase.functions.invoke('pix-check-status', { body: { transaction_id: txId } })` diretamente no polling
- Remover dependência de `checkBilletStatus` do hook `useBilletPayment` neste componente

### 2. Tratar resposta no formato de `pix-check-status`
- O retorno já tem `internal_status`, `is_completed`, `status` -- mesmo formato esperado pelo polling atual
- Ajustar o catch para lidar com 502 sem travar (continuar polling até MAX_POLL_ATTEMPTS)

### Arquivos alterados
- `src/components/payment/BoletoPaymentDrawer.tsx`: trocar polling para `pix-check-status`

### Resultado
- Boletos passam a usar a mesma lógica de status que Pix (já testada e funcional)
- Se o proxy retornar 404 para transação antiga, ela será marcada como `failed` automaticamente
- O polling para de ficar preso em "processando" indefinidamente

