
## Adicionar campo de descrição ao pagamento Pix por chave

### O que muda
Adicionar um campo opcional "Descrição" no Step 2 (valor) do `PixKeyDialog`, que será enviado ao `payByKey` e exibido na tela de confirmação (Step 3).

### Alterações em `src/components/pix/PixKeyDialog.tsx`
1. Novo estado `description` (string, inicializado vazio, resetado no `handleClose`)
2. No Step 2: adicionar um `Textarea` abaixo do campo de valor, com placeholder "Ex: Pagamento fornecedor" e limite de 140 caracteres
3. No Step 3 (confirmação): exibir a descrição quando preenchida
4. No `handleConfirm`: passar `descricao: description.trim() || undefined` ao `payByKey`

### Nenhuma mudança no backend
O hook `usePixPayment` já aceita `descricao` no `PayDictParams`, e a edge function `pix-pay-dict` já repassa esse campo ao provedor.
