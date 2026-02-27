

# Plano: Migrar de ONZ para Transfeera como Provedor Unico

## Resumo

Migrar completamente todas as 13 edge functions e o frontend de ONZ Infopago para Transfeera. A Transfeera tem uma API REST direta (sem necessidade de proxy mTLS), usa autenticação JWT com token de 30 minutos, e opera com conceito de **lotes** (batches) para pagamentos.

## Diferenças Arquiteturais Criticas

```text
ONZ (atual)                         Transfeera (novo)
─────────────────────────────────   ──────────────────────────────────
Proxy mTLS obrigatório              API REST direta (HTTPS + Bearer)
OAuth2 url-encoded                  POST JSON /authorization
Token ~1h                           Token 30 min
Pagamento unitário direto           Pagamento via Lote (batch)
  POST /pix/payments/dict             1. POST /batch (criar lote)
                                      2. POST /batch/{id}/transfer
                                      3. POST /batch/{id}/close
Boleto unitário direto              Boleto via Lote
  POST /billets/payments              1. POST /batch (type=BOLETO)
                                      2. POST /batch/{id}/billet
                                      3. POST /batch/{id}/close
QR info: /pix/payments/qrc/info     POST /pix/qrcode/parse (EMV)
Saldo: /accounts/balances/          GET /statement/balance
Comprovante: /pix/payments/receipt  receipt_url no webhook/transfer
Refund: PUT /pix/payments/refund    POST /pix/cashin/{e2eid}/refund
Webhook: formato ONZ+BCB            Webhook: Transfer/TransferRefund
```

## Novos Secrets Necessarios

Antes de implementar, o usuario precisa fornecer:
- **TRANSFEERA_CLIENT_ID** - Client ID da conta Transfeera
- **TRANSFEERA_CLIENT_SECRET** - Client Secret da conta Transfeera

Os secrets ONZ_PROXY_URL e ONZ_PROXY_API_KEY nao serao mais necessarios (podem ser removidos depois).

## Etapas de Implementacao

### 1. Database Migration
- Atualizar constraint `pix_configs_provider_check` para aceitar `'transfeera'`
- Ou remover a constraint e adicionar `'transfeera'` como valor valido

### 2. Edge Function: `pix-auth` (reescrever)
- Autenticacao via `POST https://login-api.transfeera.com/authorization` (sandbox: `login-api-sandbox`)
- Body JSON: `{ grant_type: "client_credentials", client_id, client_secret }`
- Token expira em 30 min (cache com margem de 2 min)
- Remover toda logica de proxy mTLS
- Header obrigatorio: `User-Agent: PixContabil (email)`

### 3. Edge Function: `pix-balance` (reescrever)
- `GET https://api.transfeera.com/statement/balance` (sandbox: `api-sandbox.transfeera.com`)
- Retorna saldo diretamente, sem proxy
- Headers: `Authorization: Bearer {token}`, `User-Agent`

### 4. Edge Function: `pix-pay-dict` (reescrever)
- Fluxo de lote com `auto_close: true`:
  1. `POST /batch` com `type: "TRANSFERENCIA"`, `auto_close: true`, contendo 1 transfer com `destination_bank_account.pix_key` e `value`
- Mapeamento de campos:
  - `pix_key` -> `destination_bank_account.pix_key`
  - `pix_key_type` -> mapeado para enum Transfeera (EMAIL, CPF, CNPJ, TELEFONE, CHAVE_ALEATORIA)
  - `valor` -> `value`
  - `descricao` -> `pix_description`
  - `idempotency_key` -> `idempotency_key`
- Salvar `batch_id` e `transfer_id` no external_id da transaction

### 5. Edge Function: `pix-pay-qrc` (reescrever)
- QR Code copia e cola: `POST /pix/qrcode/parse` para obter info do EMV
- Pagamento via lote com transfer contendo campo `emv` do QR Code
- Static QR: delegar para pix-pay-dict (manter logica)
- Dynamic QR: criar transfer com campo `emv` no lote

### 6. Edge Function: `pix-qrc-info` (manter + adicionar Transfeera)
- Manter parsing local EMV (funciona independente do provedor)
- Opcionalmente chamar `POST /pix/qrcode/parse` da Transfeera para validacao

### 7. Edge Function: `pix-check-status` (reescrever)
- `GET /transfer/{id}` para consultar status de transferencia
- Mapeamento de status Transfeera:
  - `FINALIZADO` -> `completed`
  - `CRIADO`, `TRANSFERENCIA_CRIADA`, `TRANSFERENCIA_REALIZADA` -> `pending`
  - `FALHA`, `DEVOLVIDO` -> `failed`/`refunded`

### 8. Edge Functions: `billet-pay` (reescrever)
- Consulta CIP: `GET /billet/consult?code={barcode}`
- Pagamento: criar lote tipo BOLETO com `auto_close: true`
  - `POST /batch` com `type: "BOLETO"`, `billets: [{ barcode, payment_date, description }]`
- Salvar batch_id e billet_id

### 9. Edge Function: `billet-check-status` (reescrever)
- `GET /billet/{id}` para consultar status
- Status: CRIADA, AGENDADO, PAGO, FALHA, DEVOLVIDO

### 10. Edge Function: `pix-receipt` (reescrever)
- Transfeera retorna `receipt_url` no objeto transfer
- `GET /transfer/{id}` -> campo `receipt_url` ou `bank_receipt_url`
- Baixar PDF da URL e retornar como base64

### 11. Edge Function: `billet-receipt` (reescrever)
- Similar: consultar billet e usar receipt_url

### 12. Edge Function: `pix-refund` (reescrever)
- Devoluçao de cash-in: `POST /pix/cashin/{end2endId}/refund`
- Body: `{ value, integration_id }`

### 13. Edge Function: `pix-webhook` (reescrever)
- Webhook da Transfeera envia eventos com formato:
  ```json
  { "id": "...", "object": "Transfer", "data": { "status": "FINALIZADO", ... } }
  ```
- Tratar objetos: `Transfer`, `TransferRefund`, `Billet`, `PixKey`, `CashIn`
- URL de webhook registrada via API: `POST /webhook` (ou plataforma)

### 14. Frontend: `PixIntegration.tsx`
- Trocar `PIX_PROVIDERS` para `[{ value: "transfeera", label: "Transfeera" }]`
- Atualizar `PROVIDER_CONFIG` com URLs Transfeera:
  - Producao API: `https://api.mtls.transfeera.com`
  - Producao Auth: `https://login-api.transfeera.com`
  - Sandbox API: `https://api-sandbox.transfeera.com`
  - Sandbox Auth: `https://login-api-sandbox.transfeera.com`
- Remover campos de certificado mTLS (Transfeera nao usa no sandbox, e em producao usa mTLS mas de forma diferente)
- Ajustar labels e placeholders

### 15. Limpeza
- Remover referencias a ONZ no `docs/` e proxy
- Atualizar `docs/ONZ_INFOPAGO_INTEGRATION.md` -> `docs/TRANSFEERA_INTEGRATION.md`

## Detalhes Tecnicos

### Autenticacao Transfeera
```
POST https://login-api.transfeera.com/authorization
Content-Type: application/json
{
  "grant_type": "client_credentials",
  "client_id": "...",
  "client_secret": "..."
}
Response: { "access_token": "...", "token_type": "Bearer" }
```

### Pagamento Pix via Lote (auto_close)
```
POST https://api.transfeera.com/batch
{
  "name": "PIX_1234567890",
  "type": "TRANSFERENCIA",
  "auto_close": true,
  "transfers": [{
    "value": 15.50,
    "idempotency_key": "unique-key",
    "pix_description": "Pagamento",
    "destination_bank_account": {
      "pix_key_type": "EMAIL",
      "pix_key": "email@example.com"
    }
  }]
}
```

### Saldo
```
GET https://api.transfeera.com/statement/balance
Response: { "value": 1500.00 }
```

### Proxy mTLS
- Em sandbox: NAO necessario (chamadas diretas HTTPS)
- Em producao: a Transfeera usa mTLS (`api.mtls.transfeera.com`), que precisa de certificado - pode continuar usando o proxy existente OU configurar diretamente

### Ordem de Implementacao
1. Secrets (TRANSFEERA_CLIENT_ID, TRANSFEERA_CLIENT_SECRET)
2. DB migration (provider constraint)
3. pix-auth (base para todas as outras)
4. pix-balance (mais simples para testar)
5. pix-pay-dict + pix-check-status
6. pix-pay-qrc + pix-qrc-info
7. billet-pay + billet-check-status
8. pix-receipt + billet-receipt
9. pix-refund
10. pix-webhook
11. Frontend (PixIntegration.tsx)
12. Limpeza

