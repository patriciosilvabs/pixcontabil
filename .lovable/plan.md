

## Diagnóstico: Por que o onz-0010 persiste

### Evidência dos logs

O log confirma que o endpoint QRC da ONZ **sempre rejeita** nossos requests, e o pagamento cai no fallback dict (P2P):

```text
[pix-pay-qrc] ONZ response status: 400 data: {"detail":"Invalid QrCode"...}
[pix-pay-qrc] ONZ rejected QR format, falling back to pix-pay-dict with key: 17f4a620...
[pix-pay-dict] Payment initiated: {"endToEndId":"E828423...","status":"PENDING"...}
```

O pagamento "bem-sucedido" anterior nunca foi via QRC -- foi P2P via dict, que transfere o valor mas **não dá baixa na maquininha**.

### Causa raiz identificada: dupla serialização JSON no proxy

Nosso payload passa por **duas serializações JSON**:

```text
Edge Function (Deno):  JSON.stringify({body: onzPayload})  → envia ao proxy
Proxy (Node.js):       express.json() parse → JSON.stringify(body) → envia à ONZ
```

Essa ida-e-volta (parse → re-stringify) pode alterar sutilmente o payload:
- **Ordem de campos JSON** pode mudar entre V8 Deno e V8 Node.js
- **Precisão numérica**: `2.5` vs `2.50` — o COBV retorna `"2.50"` (string), mas `parseFloat("2.50")` = `2.5`, e `JSON.stringify(2.5)` = `"2.5"` (sem trailing zero)
- **Caracteres especiais** no QR code podem ser re-escaped diferentemente

O cURL funcional da ONZ envia o JSON **diretamente** sem intermediário.

### Plano de correção

**Arquivo: `supabase/functions/pix-pay-qrc/index.ts`**

#### 1. Usar `body_raw` no proxy (eliminar dupla serialização)

Em vez de enviar `body: onzPayload` (objeto que o proxy re-serializa), enviar `body_raw: JSON.stringify(onzPayload)` (string pré-serializada que o proxy envia direto):

```typescript
// ANTES (dupla serialização):
body: JSON.stringify({
  url: qrcPaymentUrl,
  method: 'POST',
  headers: onzHeaders,
  body: onzPayload,        // objeto → proxy faz JSON.stringify(body) novamente
})

// DEPOIS (serialização única):
body: JSON.stringify({
  url: qrcPaymentUrl,
  method: 'POST',
  headers: onzHeaders,
  body_raw: JSON.stringify(onzPayload),  // string → proxy usa direto
})
```

O proxy já suporta isso (linha 67 do `docs/onz-proxy/index.js`):
```javascript
const requestBody = body_raw ? body_raw : (body ? JSON.stringify(body) : undefined);
```

#### 2. Formatar amount com 2 casas decimais

Garantir que o valor no JSON tenha 2 casas decimais, compatível com o formato que a ONZ espera:

```typescript
const formattedAmount = Number(paymentAmount.toFixed(2));
```

#### 3. Formato do idempotency key compatível com ONZ

O cURL funcional usa `cashout-{uuid}`. Nosso código gera 35 chars aleatórios. Alterar para usar o mesmo padrão:

```typescript
const idempotencyKey = `cashout-${crypto.randomUUID()}`;
```

#### 4. Tentar sem o objeto `payment` para QR dinâmicos

Para QR codes dinâmicos, o valor já está embutido no QR. Tentar enviar SEM o campo `payment` primeiro. Se a ONZ rejeitar, enviar com `payment` como retry:

```typescript
// Tentativa 1: sem payment (QR dinâmico já tem valor embutido)
const onzPayloadNoAmount = {
  qrCode: qr_code,
  description: 'Pagamento via QR Code',
  paymentFlow: 'INSTANT',
};

// Tentativa 2 (se falhar): com payment
const onzPayloadWithAmount = {
  ...onzPayloadNoAmount,
  payment: { currency: 'BRL', amount: formattedAmount },
};
```

#### 5. Logging detalhado do raw body

Logar o JSON exato que será enviado ao proxy para diagnóstico:

```typescript
const rawBody = JSON.stringify(onzPayload);
console.log('[pix-pay-qrc] Raw body to proxy (first 300):', rawBody.substring(0, 300));
```

### Resumo das mudanças

| Aspecto | Antes | Depois |
|---------|-------|--------|
| Serialização | Dupla (Deno → Node.js) | Única via `body_raw` |
| Amount | `2.5` | `2.50` (2 casas) |
| Idempotency key | 35 chars aleatórios | `cashout-{uuid}` |
| Payment object | Sempre enviado | Primeiro sem, depois com (retry) |

