

## Auditoria: Chamadas diretas à API ONZ vs Novo Proxy

### Resultado da auditoria

Busquei em todas as Edge Functions por dois padrões:
1. **`callNewProxy`** (NEW_PROXY_URL) — padrão correto, proxy dedicado na VPS
2. **`callOnzViaProxy`** (ONZ_PROXY_URL) — padrão legado, proxy antigo

### Funções já migradas para o Novo Proxy (OK)

| Função | Endpoint do proxy usado |
|--------|------------------------|
| `pix-balance` | `/saldo` |
| `pix-pay-dict` | `/pix/pagar` |
| `pix-pay-qrc` | `/pix/pagar-qrc` |
| `pix-check-status` | `/status/pix/:id`, `/status/billet/:id` |
| `pix-receipt` | `/recibo/pix/:id` |
| `billet-pay` | `/billets/pagar` |
| `billet-check-status` | `/status/billet/:id` |
| `billet-receipt` | `/recibo/billet/:id` |
| `batch-pay` | `/pix/pagar`, `/billets/pagar` |

### Funções ainda usando o proxy LEGADO (`callOnzViaProxy` + `ONZ_PROXY_URL`)

| Função | O que faz com ONZ | Impacto em boletos? |
|--------|-------------------|---------------------|
| **`billet-consult`** | Consulta boleto via `APPROVAL_REQUIRED` | **SIM — diretamente** |
| `pix-auth` | Obtém token OAuth da ONZ | Indireto (usado por `billet-consult`) |
| `pix-refund` | Estorna Pix | Não (Pix, não boleto) |
| `pix-dict-lookup` | Tem função mas não chama ONZ para lookup | Não |
| `pix-pay-qrc` | Tem `callOnzViaProxy` como fallback legado | Não (já usa novo proxy) |
| `register-transfeera-webhook` | Registro de webhook ONZ | Não |

### Plano de correção (APENAS boletos)

Conforme a instrução do usuário, **não alterar nada que já funciona** (Pix, QR Code, etc).

#### Arquivo: `supabase/functions/billet-consult/index.ts`

**Problema**: A consulta de boletos ONZ (linhas 186-195) usa `callOnzViaProxy` para chamar `${config.base_url}/api/v2/billets/payments` com `APPROVAL_REQUIRED`. Isso passa pelo proxy legado, que por sua vez tenta acessar a API ONZ. O novo proxy na VPS já gerencia mTLS e OAuth internamente.

**Correção**:
1. Substituir `callOnzViaProxy` por `callNewProxy` (usando `NEW_PROXY_URL` + `x-proxy-key`)
2. Chamar `/billets/pagar` no novo proxy com o payload `paymentFlow: APPROVAL_REQUIRED`
3. Remover a chamada desnecessária para `pix-auth` no fluxo ONZ (o novo proxy gerencia OAuth internamente)
4. Manter o fluxo Transfeera 100% inalterado

**Antes**:
```typescript
// Obtém token via pix-auth
const authResponse = await fetch('.../pix-auth', ...);
const { access_token } = await authResponse.json();
// Chama ONZ via proxy legado
const result = await callOnzViaProxy(
  `${config.base_url}/api/v2/billets/payments`, 'POST',
  { 'Authorization': `Bearer ${access_token}`, ... },
  JSON.stringify({ digitableCode, paymentFlow: 'APPROVAL_REQUIRED' })
);
```

**Depois**:
```typescript
// Chama novo proxy diretamente (auth gerenciada pelo proxy)
const result = await callNewProxy('/billets/pagar', 'POST', {
  digitableCode: digitableCode,
  description: 'Consulta de boleto',
  paymentFlow: 'APPROVAL_REQUIRED',
});
```

### O que NÃO será alterado
- `pix-auth` (usado por outras funções Pix que já funcionam)
- `pix-refund` (Pix, não boleto)
- `pix-dict-lookup` (Pix, não boleto)
- `pix-pay-qrc` (Pix QR, já usa novo proxy)
- `register-transfeera-webhook` (Transfeera, não ONZ boleto)
- `generate-pix-receipt` (não faz chamadas externas)
- Nenhum arquivo frontend

### Resultado esperado
- Consulta de boletos ONZ passa pelo novo proxy (mTLS + OAuth automáticos)
- Eliminação de erros por tokens expirados ou certificados ausentes na consulta
- Todo o fluxo de boletos (consulta → pagamento → status → recibo) usa o novo proxy

