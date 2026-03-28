

# Mover botão "Continuar" para antes dos Pagamentos Recentes

## O que será feito

No arquivo `src/pages/NewPayment.tsx`, reorganizar a ordem dos elementos no step 1 para que o bloco de ações (botão "Continuar") apareça **antes** da lista de pagamentos recentes.

## Alteração

**Arquivo**: `src/pages/NewPayment.tsx`

Ordem atual:
1. Card do formulário de pagamento
2. `<RecentPayments />` (linha 592)
3. Botão "Continuar" (linha 709)

Nova ordem:
1. Card do formulário de pagamento
2. Botão "Continuar" — mover o bloco de ações (linhas 709-751) para logo após o fechamento do Card do step 1 (linha 590), **dentro** da condição `step === 1`
3. `<RecentPayments />` — mantido abaixo do botão

Na prática, o bloco `{/* Actions */}` será movido de sua posição atual (depois de todos os steps) para ficar entre o Card e o RecentPayments, condicionado ao step 1. Para os demais steps (2 e 3), o botão permanece na posição original abaixo dos respectivos Cards.

