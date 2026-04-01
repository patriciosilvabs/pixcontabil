
# Corrigir bug: transação com tag ainda vira “comprovante pendente”

## O bug real encontrado
A regra da tag hoje está aplicada só na interface, não na persistência:

- `src/pages/NewPayment.tsx` esconde o botão “Anexar Comprovante”, mas não salva a transação com `receipt_required = false`
- `src/components/pix/PixKeyDialog.tsx` tenta corrigir isso depois do pagamento com um `update`, mas isso é frágil e não pode ser a regra principal
- `supabase/functions/pix-pay-dict/index.ts` cria a transação sem informar `receipt_required`, então o banco usa o padrão `true`

Por isso, na próxima transação, o sistema lê a transação anterior como pendente. O `usePendingReceipts` não está errado; ele só está lendo um dado salvo errado.

## Plano de correção
1. `src/hooks/usePixPayment.ts`
   - ampliar `payByKey` para aceitar `receipt_required?: boolean`
   - enviar esse campo para a function `pix-pay-dict`

2. `supabase/functions/pix-pay-dict/index.ts`
   - ler `receipt_required` do body
   - salvar a transação já no `insert` com `receipt_required: receipt_required ?? true`
   - manter `true` como padrão para pagamentos sem tag

3. `src/pages/NewPayment.tsx`
   - no pagamento real com tag, chamar `payByKey(..., receipt_required: false)`
   - não enviar esse campo na transação de verificação de R$ 0,01
   - manter um fallback silencioso pós-retorno do `transaction_id` para atualizar `receipt_required = false`, cobrindo duplicate/retry

4. `src/components/pix/PixKeyDialog.tsx`
   - aplicar a mesma regra do desktop
   - deixar de depender só do `update` pós-pagamento
   - usar o `update` local apenas como proteção extra, não como fonte principal da regra

5. Consistência administrativa
   - `src/pages/QuickTags.tsx`
   - `src/hooks/useQuickTags.ts`
   - remover o uso real de `receipt_required` no cadastro/edição de tags, porque hoje toda tag dispensa comprovante manual por definição
   - isso evita nova confusão entre configuração da tag e comportamento real do sistema

## Resultado esperado
- pagamento com tag nasce no banco com `receipt_required = false`
- a tela final continua sem “Anexar Comprovante”
- ao iniciar um novo pagamento, o sistema não bloqueia nem cobra o comprovante da transação anterior
- `usePendingReceipts` e os bloqueios do backend passam a funcionar corretamente sem gambiarra

## Detalhes técnicos
- não precisa migration: a coluna `transactions.receipt_required` já existe
- não vou mexer no `usePendingReceipts`, porque ele já está correto
- fluxo afetado: Pix por chave com Quick Tag

## Observação importante
Isso corrige a causa do bug para as próximas transações. A transação já criada com o flag errado pode continuar pendente, porque hoje ela não guarda qual tag foi usada; então esse histórico antigo não dá para corrigir automaticamente com segurança.
