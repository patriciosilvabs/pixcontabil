
## Corrigir overflow do preco e botao "Anexar" no card de transacao (mobile)

### Problema

No mobile, o layout do card de transacao usa `flex justify-between` horizontal, fazendo com que o preco (R$ 12,00), o badge de status ("Pendente") e o botao "Anexar" transbordem para fora do card.

### Solucao

Alterar o layout do card em `src/pages/Transactions.tsx` (linhas 195-250) para empilhar verticalmente no mobile:

1. **Container principal**: Trocar `flex items-start justify-between gap-4` por `flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3`
2. **Bloco de info (esquerda)**: Adicionar `min-w-0` para permitir truncamento
3. **Bloco de valor/status (direita)**: Trocar `text-right` por `flex items-center justify-between sm:flex-col sm:items-end sm:text-right` para ficar em linha no mobile e empilhado no desktop

Isso fara com que no mobile o preco e os botoes aparecam abaixo do nome do beneficiario, dentro do card, sem transbordar.
