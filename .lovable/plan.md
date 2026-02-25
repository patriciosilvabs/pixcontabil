

## Diagnóstico: Comparação entre o cURL funcional da ONZ e nosso código

Comparando o cURL que a equipe da ONZ enviou (que funciona) com o payload que nosso código envia, identifiquei **duas diferenças**:

### Diferenças encontradas

**1. Campo `paymentFlow: "INSTANT"` ausente (CRÍTICO)**

O cURL funcional da ONZ envia:
```text
{
    "description": "Pagamento via QR Code",
    "paymentFlow": "INSTANT",          ← NOSSO CÓDIGO NÃO ENVIA ISSO
    "qrCode": "00020101...",
    "payment": { "currency": "BRL", "amount": 0.01 }
}
```

Nosso código envia (linhas 175-182 de `pix-pay-qrc/index.ts`):
```text
{
    "qrCode": qr_code,
    "description": "Pagamento via QR Code",
    "payment": { "amount": paymentAmount, "currency": "BRL" }
}
```

O campo `paymentFlow` está faltando. Sem ele, a API da ONZ pode não saber como processar o QR Code e rejeitar com `onz-0010`.

**2. Header `Accept: application/json` ausente**

O cURL inclui `Accept: application/json`. Nosso código não envia esse header na requisição ao proxy. Isso pode afetar o formato da resposta.

### Plano de correção

Arquivo: `supabase/functions/pix-pay-qrc/index.ts`

1. **Adicionar `paymentFlow: "INSTANT"` ao payload** (linha 175-182):
```typescript
const onzPayload: any = {
  qrCode: qr_code,
  description: descricao || 'Pagamento via QR Code',
  paymentFlow: 'INSTANT',
  payment: {
    amount: paymentAmount,
    currency: 'BRL',
  },
};
```

2. **Adicionar header `Accept: application/json`** (linha 193-197):
```typescript
const onzHeaders: Record<string, string> = {
  'Content-Type': 'application/json',
  'Accept': 'application/json',
  'Authorization': `Bearer ${accessToken}`,
  'x-idempotency-key': idempotencyKey,
};
```

Estas são as únicas diferenças entre o cURL funcional e nosso código. O `paymentFlow: "INSTANT"` é muito provavelmente a causa raiz do erro `onz-0010`.

