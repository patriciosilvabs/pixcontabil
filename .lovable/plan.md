

## Diagnóstico: Duas Causas Raiz Identificadas

Analisei a documentação oficial da ONZ que você colou junto com o código atual e os logs, e identifiquei **dois problemas críticos** que explicam por que o `onz-0010` persiste em todos os QR codes dinâmicos.

---

### Problema 1: Formato do x-idempotency-key inválido

A documentação ONZ especifica:
```
x-idempotency-key required string [a-zA-Z0-9]{1,50}
```

Isto significa: **apenas caracteres alfanuméricos, máximo 50 caracteres, sem hífens**.

Nosso código gera:
```
cashout-550e8400-e29b-41d4-a716-446655440000
```

Isso viola a regra por conter **hífens** (`-`). A ONZ pode estar rejeitando a requisição inteira por cabeçalho inválido, mas retornando um erro genérico `onz-0010`.

Curiosamente, a função `pix-pay-dict` usa `generateIdEnvio()` que gera corretamente 35 caracteres alfanuméricos — e funciona.

### Problema 2: Não estamos usando o endpoint de consulta QRC da própria ONZ

A documentação ONZ mostra um endpoint dedicado:
```
POST /pix/payments/qrc/info
Body: { "qrCode": "string" }
Header: x-idempotency-key (obrigatório)
```

Este endpoint retorna dados validados pela ONZ, incluindo um **`endToEndId`** e **`statusCode`**. Atualmente decodificamos o QR localmente na `pix-qrc-info`, mas a ONZ pode exigir que o QR seja primeiro **consultado/registrado** pelo seu próprio sistema antes de poder ser pago via `/pix/payments/qrc`.

---

### Plano de Correção

#### 1. Corrigir formato do x-idempotency-key (ambas as funções)

**Arquivo: `supabase/functions/pix-pay-qrc/index.ts`**

Substituir:
```typescript
const idempotencyKey = `cashout-${crypto.randomUUID()}`;
```
Por:
```typescript
// ONZ requires [a-zA-Z0-9]{1,50} — no hyphens
function generateIdempotencyKey(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let result = '';
  for (let i = 0; i < 35; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}
const idempotencyKey = generateIdempotencyKey();
```

Fazer o mesmo para a `idempotencyKey2` no retry.

#### 2. Usar endpoint ONZ `/pix/payments/qrc/info` antes de pagar

**Arquivo: `supabase/functions/pix-pay-qrc/index.ts`**

Antes de chamar `/pix/payments/qrc`, chamar `/pix/payments/qrc/info` via proxy para:
- Validar o QR code no sistema ONZ
- Obter o `endToEndId` retornado pela ONZ
- Confirmar que o QR é válido e ativo (`statusCode: 200`)

```typescript
// Step 1: Consult QR via ONZ's own endpoint
const qrcInfoUrl = `${baseUrl}/pix/payments/qrc/info`;
const infoPayload = { qrCode: qr_code };
const infoIdempotencyKey = generateIdempotencyKey();

// Call ONZ /pix/payments/qrc/info via proxy
const infoResult = await callOnzEndpoint(qrcInfoUrl, infoPayload, infoIdempotencyKey);

// Step 2: Use returned data for payment
// The payment may need the endToEndId from the info response
```

#### 3. Simplificar a estratégia de retry

Com a consulta prévia via ONZ e o idempotency key correto, a lógica de tentativas fica mais simples:
- **Única tentativa** com o EMV string original + `payment` object (obrigatório pela doc)
- Se falhar com `onz-0010`, fallback para `pix-pay-dict` com a chave extraída

---

### Resumo das Mudanças

| Aspecto | Antes | Depois |
|---------|-------|--------|
| Idempotency key | `cashout-{uuid}` (com hífens) | 35 chars alfanuméricos (sem hífens) |
| Consulta QR | Decodificação local apenas | Consulta via ONZ `/qrc/info` + local |
| Tentativas de pagamento | 2 (EMV + URL) | 1 (EMV + payment) após consulta ONZ |

