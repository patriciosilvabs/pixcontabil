

# Corrigir geração automática de comprovante para todos os pagamentos Pix por chave (desktop)

## Problema

No fluxo desktop (`NewPayment.tsx`), após o pagamento Pix por chave digitada, o sistema navega imediatamente para `/` sem esperar a confirmação do provedor. A geração do comprovante é disparada apenas quando o status muda para `completed` — via polling em `pix-check-status`. Como não há polling no desktop, o comprovante nunca é gerado para essas transações.

No mobile (`PixKeyDialog.tsx`), o fluxo funciona corretamente porque utiliza `PaymentStatusScreen` (step 6), que faz polling a cada 2 segundos e dispara a geração do recibo ao detectar `completed`.

## Correção

### `src/pages/NewPayment.tsx`

Em vez de navegar para `/` imediatamente após `payByKey`, salvar o `transaction_id` retornado e exibir o componente `PaymentStatusScreen` — igual ao mobile.

1. Adicionar estado `realTransactionId` para armazenar o ID da transação principal
2. Na `handleConfirmAfterProbe`, ao invés de `navigate("/")`, salvar o `result.transaction_id` no estado
3. Renderizar `PaymentStatusScreen` quando `realTransactionId` estiver preenchido, com `redirectToReceiptCapture={false}`
4. Importar `PaymentStatusScreen` de `@/components/pix/PaymentStatusScreen`

```typescript
// handleConfirmAfterProbe - substituir navigate("/") por:
if (result) {
  invalidateDashboardCache();
  setRealTransactionId(result.transaction_id);
}
```

```tsx
// No JSX, renderizar PaymentStatusScreen quando realTransactionId existir
{realTransactionId && (
  <PaymentStatusScreen
    transactionId={realTransactionId}
    amount={parseFloat(pixData.amount?.replace(",", ".") || "0")}
    beneficiaryName={probeBeneficiaryName || pixData.key || ""}
    onClose={() => navigate("/")}
    redirectToReceiptCapture={false}
  />
)}
```

Isso garante que o polling rode para todas as transações Pix por chave no desktop, disparando a geração automática do comprovante assim que o status mudar para `completed`.

