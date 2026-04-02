

# Refatoração: Migrar para Proxy Dedicado com Endpoints Específicos

## Contexto

O sistema atual usa um proxy genérico (`/proxy`) que recebe a URL completa da ONZ e faz o forward com mTLS. O novo proxy em `http://72.61.25.92:3000` já gerencia OAuth internamente e expõe endpoints de negócio diretos, eliminando a necessidade de gerenciar tokens no backend.

## Novos Endpoints do Proxy

| Método | Rota | Uso |
|--------|------|-----|
| GET | `/saldo` | Saldo da conta |
| POST | `/pix/pagar` | Pagamento Pix por chave |
| POST | `/billets/pagar` | Pagamento de boleto |
| GET | `/status/:tipo/:id` | Status de Pix ou Boleto |
| GET | `/recibo/:tipo/:id` | Comprovante PDF (base64) |

**Headers obrigatórios:** `x-proxy-key` (secret) + `x-idempotency-key` (para pagamentos)

## Plano de Execução

### Passo 1 — Salvar secrets
- Salvar `NEW_PROXY_URL` = `http://72.61.25.92:3000`
- Salvar `NEW_PROXY_KEY` = credencial fornecida
- Manter os secrets antigos (`ONZ_PROXY_URL`, `ONZ_PROXY_API_KEY`) pois o Transfeera e operações não cobertas (QR Code, webhook) ainda usam o proxy genérico

### Passo 2 — Criar helper compartilhado
Substituir `callOnzViaProxy` por uma nova função `callNewProxy` em cada edge function afetada:

```text
callNewProxy(path, method, body?)
  → fetch(NEW_PROXY_URL + path)
  → headers: x-proxy-key, x-idempotency-key (se POST), Content-Type
  → retorna { status, data }
```

### Passo 3 — Refatorar Edge Functions (branch ONZ apenas)

| Edge Function | Antes | Depois |
|---|---|---|
| `pix-balance` | `pix-auth` + `callOnzViaProxy(base_url/api/v2/accounts/balances/)` | `GET /saldo` direto |
| `pix-pay-dict` | `pix-auth` + `callOnzViaProxy(base_url/api/v2/pix/payments/dict)` | `POST /pix/pagar` com `{chavePix, valor, descricao}` |
| `billet-pay` | `pix-auth` + `callOnzViaProxy(base_url/api/v2/billets/payments)` | `POST /billets/pagar` com `{linhaDigitavel, valor, descricao}` |
| `pix-check-status` | `pix-auth` + `callOnzViaProxy(base_url/api/v2/pix/payments/:id)` | `GET /status/pix/:id` |
| `billet-check-status` | `pix-auth` + `callOnzViaProxy(...)` | `GET /status/billet/:id` |
| `pix-receipt` | `pix-auth` + `callOnzViaProxy(base_url/api/v2/pix/payments/receipt/:id)` | `GET /recibo/pix/:id` |
| `billet-receipt` | `pix-auth` + `callOnzViaProxy(...)` | `GET /recibo/billet/:id` |
| `batch-pay` | Loop com `pix-auth` + `callOnzViaProxy` | Loop com `POST /pix/pagar` ou `POST /billets/pagar` |

**Nota:** `pix-auth` continua existindo para Transfeera. A chamada a `pix-auth` é removida apenas no branch `provider === 'onz'`.

### Passo 4 — Consulta de boleto (`billet-consult`)
O branch ONZ atualmente faz um POST com `paymentFlow: "APPROVAL_REQUIRED"` para simular consulta. Com o novo proxy, verificar se `POST /billets/pagar` retorna dados suficientes para pré-visualização, ou manter o proxy genérico para essa operação específica.

### Passo 5 — QR Code (`pix-pay-qrc`, `pix-qrc-info`)
O novo proxy não tem endpoint para QR Code. Essas funções continuam usando o proxy genérico (`callOnzViaProxy` com `/proxy`) até que novos endpoints sejam adicionados.

### Passo 6 — Webhook (`register-transfeera-webhook`)
Não coberto pelo novo proxy. Continua usando o proxy genérico.

## O que NÃO muda
- Todo o fluxo **Transfeera** permanece idêntico
- `pix-auth` continua funcionando para Transfeera
- `pix-pay-qrc`, `pix-qrc-info`, `register-transfeera-webhook` mantêm o proxy genérico
- Frontend não precisa de alteração (as edge functions mantêm a mesma interface)
- RLS, transactions, audit_logs — tudo igual

## Mapeamento de erros do novo proxy
- 400 → mensagem do proxy (ex: "Chave Pix Inválida", "Saldo Insuficiente")
- 401 → "Falha de autenticação com o proxy"
- 500 → "Erro de conexão com o banco"

## Arquivos modificados

| Arquivo | Tipo de alteração |
|---|---|
| `supabase/functions/pix-balance/index.ts` | ONZ branch → `GET /saldo` |
| `supabase/functions/pix-pay-dict/index.ts` | ONZ branch → `POST /pix/pagar` |
| `supabase/functions/billet-pay/index.ts` | ONZ branch → `POST /billets/pagar` |
| `supabase/functions/pix-check-status/index.ts` | ONZ branch → `GET /status/pix/:id` |
| `supabase/functions/billet-check-status/index.ts` | ONZ branch → `GET /status/billet/:id` |
| `supabase/functions/pix-receipt/index.ts` | ONZ branch → `GET /recibo/pix/:id` |
| `supabase/functions/billet-receipt/index.ts` | ONZ branch → `GET /recibo/billet/:id` |
| `supabase/functions/batch-pay/index.ts` | ONZ loops → novos endpoints |

