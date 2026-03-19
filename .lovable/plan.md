

# Plano de Migração: Transfeera → ONZ Infopago

## Contexto

O sistema atualmente usa **Transfeera** como provedor exclusivo. A migração para **ONZ Infopago** afeta **14 Edge Functions**, a **página de configuração**, o **banco de dados** e o **webhook**. O projeto já possui documentação prévia da ONZ (`docs/ONZ_INFOPAGO_INTEGRATION.md`) e um proxy mTLS funcional (`docs/onz-proxy/`).

A API ONZ requer **mTLS** (certificado cliente), o que não funciona nativamente no Deno/Supabase. Por isso, todas as chamadas à API ONZ passam pelo **proxy mTLS Node.js** já existente no projeto.

---

## Diferenças Fundamentais entre os Provedores

| Aspecto | Transfeera | ONZ Infopago |
|---------|-----------|-------------|
| Auth URL | `login-api.transfeera.com/authorization` | `cashout.infopago.com.br/api/v2/oauth/token` |
| Auth format | `grant_type`, `client_id`, `client_secret` | `clientId`, `clientSecret`, `grantType`, `scope` |
| Token field | `access_token` | `accessToken` |
| Pix por chave | `POST /batch` (batch model) | `POST /pix/payments/dict` (direto) |
| Pix por QR | `POST /batch` (EMV no batch) | `POST /pix/payments/qrc` (direto) |
| Boleto pay | `POST /batch` (batch BOLETO) | `POST /billets/payments` (direto) |
| Status Pix | `GET /transfer/{id}` e `GET /batch/{id}/transfer` | `GET /pix/payments/{endToEndId}` |
| Status Boleto | `GET /billet/{id}` | `GET /billets/{id}` |
| Comprovante Pix | `GET /transfer/{id}` → receipt_url | `GET /pix/payments/receipt/{e2eId}` → `data.pdf` (base64) |
| Comprovante Boleto | `GET /billet-receipt/{id}` | `GET /billets/payments/receipt/{id}` → `data.pdf` (base64) |
| Saldo | `GET /statement/balance` | `GET /accounts/balances/` |
| QR Info | Local EMV parse | `POST /pix/payments/qrc/info` (API) |
| DICT Lookup | `GET /pix/dict_key/{key}` | Não documentado (usar consulta via pagamento) |
| Idempotency | Batch-level | Header `x-idempotency-key` |
| external_id | `batchId:transferId` | `onzId:endToEndId` |
| Status mapping | FINALIZADO, CRIADO, FALHA... | LIQUIDATED, PROCESSING, CANCELED... |
| Webhook format | `{ object, data }` | `{ type, data }` com types: TRANSFER, RECEIVE, CASHOUT |
| mTLS | Não necessário | Obrigatório (via proxy Node.js) |

---

## Etapas de Implementação

### 1. Atualizar banco de dados
- Alterar constraint `pix_configs_provider_check` para aceitar `'onz'` além de `'transfeera'`
- Adicionar colunas `certificate_encrypted` e `certificate_key_encrypted` se necessário para armazenar certs mTLS

### 2. Reescrever `pix-auth` (autenticação)
- Mudar endpoint para ONZ: `POST /api/v2/oauth/token`
- Enviar via proxy mTLS: `POST {ONZ_PROXY_URL}/proxy`
- Mapear request body: `clientId`, `clientSecret`, `grantType: "client_credentials"`, `scope: "pix.read pix.write billets.read billets.write"`
- Mapear response: `accessToken` → `access_token`

### 3. Reescrever `pix-pay-dict` (pagamento por chave)
- Endpoint ONZ: `POST /api/v2/pix/payments/dict`
- Body: `{ pixKey, payment: { currency: "BRL", amount }, description, paymentFlow: "INSTANT" }`
- Header: `x-idempotency-key`
- Response: `{ id, endToEndId, payment }` — armazenar como `external_id = "onz:{id}:{endToEndId}"`

### 4. Reescrever `pix-pay-qrc` (pagamento por QR Code)
- Endpoint ONZ: `POST /api/v2/pix/payments/qrc`
- Body: `{ qrCode, payment: { currency: "BRL", amount }, paymentFlow: "INSTANT" }`
- Header: `x-idempotency-key`
- Manter fallback para `pix-pay-dict` em QR estático

### 5. Reescrever `pix-qrc-info` (decodificação QR)
- Endpoint ONZ: `POST /api/v2/pix/payments/qrc/info`
- Body: `{ qrCode }` → Response com `type`, `merchantName`, `transactionAmount`, `chave`, `endToEndId`
- Manter parser EMV local como fallback

### 6. Reescrever `pix-check-status` (status de pagamento)
- Endpoint ONZ: `GET /api/v2/pix/payments/{endToEndId}`
- Mapear status: `LIQUIDATED` → `completed`, `PROCESSING` → `pending`, `CANCELED` → `failed`, `REFUNDED` → `refunded`

### 7. Reescrever `pix-receipt` (comprovante Pix)
- Endpoint ONZ: `GET /api/v2/pix/payments/receipt/{endToEndId}`
- Response: `{ data: { pdf: "base64..." } }` — retornar diretamente

### 8. Reescrever `pix-balance` (saldo)
- Endpoint ONZ: `GET /api/v2/accounts/balances/`
- Response: `{ data: [{ balanceAmount: { amount, currency } }] }`

### 9. Reescrever `pix-dict-lookup` (consulta DICT)
- ONZ não tem endpoint DICT dedicado na documentação
- Opção: usar o `pix-pay-dict` com `paymentFlow: "APPROVAL_REQUIRED"` para consultar sem pagar, ou remover esta funcionalidade

### 10. Reescrever `pix-refund` (reembolso)
- Verificar na documentação ONZ o endpoint de refund (provavelmente via infrações ou endpoint dedicado)

### 11. Reescrever funções de boleto
- **`billet-consult`**: Não há endpoint de consulta prévia na ONZ; a ONZ paga com valor ajustado automaticamente (conforme doc: "Payment will always be made using an adjusted amount")
- **`billet-pay`**: `POST /api/v2/billets/payments` com `{ digitableCode, description, paymentFlow: "INSTANT" }`
- **`billet-check-status`**: `GET /api/v2/billets/{id}`
- **`billet-receipt`**: `GET /api/v2/billets/payments/receipt/{id}`

### 12. Reescrever `pix-webhook` 
- Adaptar formato de payload ONZ: `{ type: "TRANSFER"|"RECEIVE"|"CASHOUT", data: { endToEndId, status, ... } }`
- Mapear tipos de webhook e statuses
- Remover lógica de batch/transfer do Transfeera

### 13. Reescrever `register-transfeera-webhook` → `register-onz-webhook`
- Endpoint ONZ: `POST /api/v2/webhooks/transfer` e `POST /api/v2/webhooks/receive`
- Registrar ambos os tipos de webhook

### 14. Atualizar página de configuração (`PixIntegration.tsx`)
- Adicionar `onz` ao `PIX_PROVIDERS`
- Configurar campos para ONZ: Client ID (UUID), Client Secret, Certificado (.crt base64), Chave privada (.key base64)
- Mostrar campos de proxy URL
- Atualizar URLs de produção/sandbox

### 15. Criar helper centralizado para chamadas via proxy
- Função utilitária reutilizável em todas as Edge Functions para chamar o proxy mTLS
- Abstrai `ONZ_PROXY_URL` e `ONZ_PROXY_API_KEY`

---

## Pré-requisitos do Usuário

Antes de iniciar a implementação, será necessário confirmar:
1. O proxy mTLS já está deployado e funcionando? (Railway/Render)
2. Os secrets `ONZ_PROXY_URL` e `ONZ_PROXY_API_KEY` já estão configurados?
3. As credenciais ONZ (Client ID, Client Secret) já estão disponíveis?
4. O ambiente é sandbox ou produção?

---

## Ordem de Execução

A migração será feita em 5 blocos sequenciais:

1. **DB + Config UI**: constraint do banco + tela de configuração com ONZ
2. **Auth + Helper proxy**: `pix-auth` + função centralizada de proxy
3. **Pagamentos**: `pix-pay-dict`, `pix-pay-qrc`, `billet-pay`, `pix-qrc-info`
4. **Status + Comprovantes**: `pix-check-status`, `pix-receipt`, `billet-check-status`, `billet-receipt`, `pix-balance`
5. **Webhook + Extras**: `pix-webhook`, `register-onz-webhook`, `pix-refund`, `pix-dict-lookup`

