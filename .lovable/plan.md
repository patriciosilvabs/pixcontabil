

# Pular tela de anexo de comprovante para pagamentos Pix por chave digitada

## Problema

Quando um pagamento Pix é feito por **chave digitada** (CPF, CNPJ, email, celular), o sistema já gera o comprovante automaticamente via `generate-pix-receipt`. Porém, no fluxo **desktop** (`NewPayment.tsx`), após o pagamento por chave, o usuário é redirecionado para a tela "Anexar Comprovante" — que fica travada em "Aguardando confirmação" (imagem enviada).

No mobile (`PixKeyDialog`), isso já está correto: `redirectToReceiptCapture={false}`.

## Correção

### `src/pages/NewPayment.tsx`

Na função `handleConfirmAfterProbe` (~linha 222), em vez de redirecionar para `/pix/receipt/...`, mostrar a tela de status (`PaymentStatusScreen`) com polling — igual ao mobile. Ou, de forma mais simples, redirecionar para o dashboard com toast de sucesso:

```typescript
// Linha 222: trocar navigate(`/pix/receipt/...`) por navigate("/") + toast de sucesso
if (result) {
  invalidateDashboardCache();
  toast({ title: "Pagamento enviado!", description: "O comprovante será gerado automaticamente." });
  navigate("/");
}
```

Isso alinha o desktop com o comportamento do mobile, onde pagamentos por chave digitada **nunca** pedem anexo manual — o comprovante é recuperado automaticamente do provedor.

