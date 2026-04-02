

# Plano: Migrar integração PIX para o Proxy mTLS customizado (pixmobile.com.br)

## Situação Atual

O projeto possui **duas** arquiteturas de proxy coexistindo:

1. **Proxy Dedicado (NEW_PROXY_URL)** — usado em 9 Edge Functions (pix-pay-dict, pix-pay-qrc, pix-balance, pix-check-status, pix-receipt, billet-pay, billet-check-status, billet-receipt, batch-pay). Chama endpoints simplificados como `/pix/pagar`, `/saldo`. O proxy gerencia OAuth internamente.

2. **Proxy Legado (ONZ_PROXY_URL)** — usado em 5 Edge Functions (pix-auth, pix-refund, pix-dict-lookup, billet-consult, register-transfeera-webhook). Usa formato passthrough (`url`, `method`, `headers`, `body_raw`) via `/proxy`.

## O que será feito

Substituir **ambos** os proxies pelo novo proxy mTLS em `https://pixmobile.com.br/proxy`, usando o formato passthrough que você especificou.

### Formato da requisição para o novo proxy:
```
POST https://pixmobile.com.br/proxy
Header: x-proxy-api-key: domhelder11!!@@
Body: { url, method, headers, body }
```

## Detalhes Técnicos

### 1. Adicionar novo secret
- Adicionar `PIXMOBILE_PROXY_API_KEY` com valor `domhelder11!!@@`
- A URL do proxy (`https://pixmobile.com.br/proxy`) será hardcoded pois é fixa

### 2. Criar função helper unificada
Todas as 14 Edge Functions que chamam a ONZ passarão a usar uma única função `callPixMobileProxy`:

```typescript
async function callPixMobileProxy(
  url: string,       // URL final do banco (ex: cashout.infopago.com.br/...)
  method: string,    // GET, POST
  headers: Record<string, string>,
  body?: any
) {
  const resp = await fetch('https://pixmobile.com.br/proxy', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-proxy-api-key': Deno.env.get('PIXMOBILE_PROXY_API_KEY')!,
    },
    body: JSON.stringify({ url, method, headers, body }),
  });
  const data = await resp.json();
  return { status: resp.status, data };
}
```

### 3. Edge Functions a atualizar (14 arquivos)

**Grupo A — Atualmente com `callNewProxy` (proxy dedicado):**
Estas funções usam endpoints simplificados (`/pix/pagar`, `/saldo`, etc.) onde o proxy gerencia OAuth. Com o novo proxy passthrough, precisarão:
- Obter token OAuth via `pix-auth` antes de cada chamada
- Construir a URL final completa da ONZ (ex: `https://cashout.infopago.com.br/api/v2/pix/payments/dict`)
- Enviar headers de autenticação (`Authorization: Bearer <token>`)

| Função | Endpoint ONZ que será chamado |
|--------|-------------------------------|
| `pix-pay-dict` | `POST /api/v2/pix/payments/dict` |
| `pix-pay-qrc` | `POST /api/v2/pix/payments/qrc` |
| `pix-balance` | `GET /api/v2/accounts/balance` |
| `pix-check-status` | `GET /api/v2/pix/payments/{id}` |
| `pix-receipt` | `GET /api/v2/pix/receipts/{id}` |
| `billet-pay` | `POST /api/v2/billets/payments` |
| `billet-check-status` | `GET /api/v2/billets/payments/{id}` |
| `billet-receipt` | `GET /api/v2/billets/receipts/{id}` |
| `batch-pay` | `POST /api/v2/pix/payments/dict` + `POST /api/v2/billets/payments` |

**Grupo B — Atualmente com `callOnzViaProxy` (proxy legado):**
Estas já usam formato passthrough similar, precisam apenas trocar URL e header:

| Função | Uso |
|--------|-----|
| `pix-auth` | OAuth token (`POST /api/v2/oauth/token`) |
| `pix-refund` | Devolução Pix (`POST /api/v2/pix/payments/refund`) |
| `pix-dict-lookup` | Consulta DICT (retorna info básica sem endpoint dedicado) |
| `billet-consult` | Consulta boleto com APPROVAL_REQUIRED |
| `register-transfeera-webhook` | Registro de webhooks ONZ |

### 4. Remover referências a certificados .pem/.key
Remover qualquer lógica de anexação de certificados mTLS no frontend/edge functions — o proxy gerencia isso.

### 5. Deploy
Redeployar todas as 14 Edge Functions afetadas.

## Nota importante
Os endpoints exatos da API ONZ (base_url + paths) já estão configurados na tabela `pix_configs` (campo `base_url`). O sistema continuará usando esse campo para construir as URLs finais. O fluxo Transfeera permanece inalterado.

