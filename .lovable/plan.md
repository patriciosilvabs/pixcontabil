
# Corrigir Edge Functions de Boleto conforme documentacao oficial ONZ

## Problemas encontrados

Comparando o codigo atual com a documentacao oficial da API ONZ Billets, ha as seguintes divergencias:

### 1. `billet-pay/index.ts` - Payload incompleto
- **Problema**: O campo `description` e **obrigatorio** na API ONZ, mas o codigo atual nao o envia no payload.
- **Problema**: O campo `payment` (objeto com `currency` e `amount`) existe na API mas nao esta sendo enviado.
- **Problema**: A extracao do `amount` da resposta usa `paymentData.amount` mas a API retorna `paymentData.payment.amount`.
- **Problema**: O `external_id` salvo deve usar `paymentData.id` (number int64 conforme docs).

**Correcao**:
```typescript
const onzPayload: any = {
  digitableCode: codigo_barras,
  description: descricao || 'Pagamento de boleto',
};
if (payment_flow) {
  onzPayload.paymentFlow = payment_flow;
}
// Opcional: se o valor for informado, enviar no payload
if (valor) {
  onzPayload.payment = { currency: 'BRL', amount: valor };
}
```

E para extrair o valor da resposta:
```typescript
const externalId = String(paymentData.id || idempotencyKey);
const amount = paymentData.payment?.amount || valor || 0;
```

### 2. `billet-check-status/index.ts` - Mapeamento de status incorreto
- **Problema**: O mapa de status usa valores incorretos. A API ONZ retorna: `CANCELED`, `PROCESSING`, `LIQUIDATED`, `REFUNDED`, `PARTIALLY_REFUNDED` (com virgulas nos nomes no enum da doc, provavelmente sem virgula na pratica).
- **Problema**: O codigo mapeia `PAID` e `COMPLETED` que nao existem na API ONZ.

**Correcao do mapa de status**:
```typescript
const statusMap: Record<string, string> = {
  'LIQUIDATED': 'completed',
  'PROCESSING': 'pending',
  'CANCELED': 'failed',
  'REFUNDED': 'refunded',
  'PARTIALLY_REFUNDED': 'refunded',
};
```

Alem disso, a resposta deve incluir campos da API como `billetInfo`, `creditorAccount`, `debtorAccount` para enriquecer os dados.

### 3. `billet-receipt/index.ts` - Caminho de extracao do PDF incorreto
- **Problema**: O codigo extrai o PDF como `data.pdf || data.receipt`, mas a documentacao mostra que a resposta e `{ data: { pdf: "base64..." } }`.

**Correcao**:
```typescript
// A resposta da API e: { data: { pdf: "base64string" } }
const receiptData = data.data || data;
const pdfBase64 = receiptData.pdf || receiptData.receipt;
```

## Resumo das alteracoes

| Arquivo | Alteracao |
|---|---|
| `billet-pay/index.ts` | Adicionar `description` ao payload ONZ, enviar `payment` opcional, corrigir extracao de `amount` e `id` da resposta |
| `billet-check-status/index.ts` | Corrigir mapeamento de status para usar `LIQUIDATED`, `PROCESSING`, `CANCELED`, `REFUNDED`; incluir `is_completed` no retorno |
| `billet-receipt/index.ts` | Corrigir caminho de extracao do PDF para `data.data.pdf` |

## Deploy

Apos as correcoes, deploy das 3 funcoes: `billet-pay`, `billet-check-status`, `billet-receipt`.
