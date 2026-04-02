

## Problema Identificado

O pagamento QR Code foi **concluído com sucesso** (status LIQUIDATED). O problema é que após a confirmação, a tela `PaymentStatusScreen` no fluxo QR Code **não oferece os botões de Compartilhar/Salvar o comprovante oficial do provedor** — ela só mostra "Anexar Comprovante" (upload manual de foto) e "Voltar ao Início".

Isso acontece porque o `PixQrPaymentDrawer` passa `redirectToReceiptCapture={true}` ao `PaymentStatusScreen`, que suprime os botões de download/share do comprovante PDF.

## Solução

Adicionar os botões "Compartilhar" e "Salvar no Aparelho" na tela de sucesso do `PaymentStatusScreen` **também** quando `redirectToReceiptCapture` está ativo. Assim o fluxo QR Code fica:

1. Pagamento confirmado ✅
2. Botões: **Compartilhar** | **Salvar no Aparelho** | **Anexar Comprovante** | Voltar ao Início

## Alterações

### 1. `src/components/pix/PaymentStatusScreen.tsx`
No bloco `redirectToReceiptCapture` (linhas 168-187), adicionar os botões de Compartilhar e Salvar **antes** do botão "Anexar Comprovante":

```
Compartilhar (shareReceipt)
Salvar no Aparelho (saveReceiptAsFile)  
Anexar Comprovante (navega para /pix/receipt/:id)
Voltar ao Início
```

Isso reutiliza as funções `shareReceipt` e `saveReceiptAsFile` que já existem no hook `usePixPayment` e já funcionam para o provider ONZ (buscam PDF via `pix-receipt` → proxy `/recibo/pix/:id`).

