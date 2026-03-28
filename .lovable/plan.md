

# Pular tela de anexo de comprovante para pagamentos Pix por chave

## Problema

Quando o pagamento é feito por chave Pix digitada, o sistema já obtém o comprovante automaticamente da API ONZ. Não faz sentido exigir que o usuário tire foto ou anexe um arquivo manualmente.

## Correção

Alterar o `PixKeyDialog.tsx` para **não redirecionar** para a tela de captura de comprovante (`/pix/receipt/:id`). Em vez disso, após a confirmação do pagamento, exibir as opções de compartilhar/salvar o comprovante gerado automaticamente pela API.

### Arquivo: `src/components/pix/PixKeyDialog.tsx`
- Remover `redirectToReceiptCapture` do `PaymentStatusScreen` (ou passar `false`)
- Isso fará o componente exibir os botões "Compartilhar" e "Salvar no Aparelho" em vez de "Anexar Comprovante"

### Alteração mínima — 1 arquivo, 1 linha

