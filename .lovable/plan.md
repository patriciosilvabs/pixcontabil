

# Arquitetura Multi-Provedor Pix: ONZ Infopago, Woovi (OpenPix) e Transfeera

## Resumo
Refatorar todas as Edge Functions Pix para suportar multiplos provedores de forma dinamica, baseado no campo `provider` da tabela `pix_configs`. Cada provedor tem autenticacao e endpoints diferentes, entao a logica sera isolada em blocos condicionais dentro de cada function.

## Provedores e suas caracteristicas

| Aspecto | ONZ Infopago | Woovi (OpenPix) | Transfeera | EFI Pay |
|---------|-------------|-----------------|------------|---------|
| Autenticacao | OAuth2 JSON body | AppID no header Authorization | OAuth2 client_credentials | Basic Auth + mTLS |
| Token endpoint | `/oauth/token` | N/A (sem token) | `POST /auth` | `/oauth/token` |
| Auth header | `Bearer {token}` | `{appID}` | `Bearer {token}` | `Basic base64(id:secret)` |
| Base URL prod | `secureapi.bancodigital.onz.software/api/v2` | `api.openpix.com.br` | `api.transfeera.com` | `pix.api.efipay.com.br` |
| Base URL sandbox | `secureapi.bancodigital.hmg.onz.software/api/v2` | `api.openpix.com.br` (mesma) | `api-sandbox.transfeera.com` | `pix-h.api.efipay.com.br` |
| Certificado mTLS | Nao | Nao | Nao | Obrigatorio |
| Cobranca Pix | N/A | `POST /api/v1/charge` | `POST /pix/transfer` | `PUT /v2/cob/:txid` |
| Webhook | Custom | `POST /api/v1/webhook` | Configuravel no painel | `PUT /v2/webhook/:chave` |

## Migracao de banco de dados

### 1. Atualizar CHECK constraint do provider
Adicionar `woovi`, `transfeera` e `onz` a lista de provedores permitidos:

```text
ALTER TABLE pix_configs DROP CONSTRAINT pix_configs_provider_check;
ALTER TABLE pix_configs ADD CONSTRAINT pix_configs_provider_check 
  CHECK (provider = ANY (ARRAY[
    'woovi', 'transfeera', 'onz', 'efi', 
    'inter', 'gerencianet', 'itau', 'bradesco', 
    'santander', 'sicredi', 'sicoob', 'outros'
  ]));
```

## Arquitetura das Edge Functions

A estrategia e usar um **pattern de dispatch por provedor** dentro de cada Edge Function. A funcao `pix-auth` retorna o token (ou AppID) e o tipo de provedor, e as demais funcoes usam isso para rotear para o endpoint correto.

```text
pix-auth
  |-- provider === 'woovi'     -> retorna AppID direto (sem OAuth)
  |-- provider === 'onz'       -> OAuth2 JSON body
  |-- provider === 'transfeera'-> OAuth2 client_credentials
  |-- provider === 'efi'       -> Basic Auth + mTLS
```

## Arquivos a modificar

### 1. `supabase/functions/pix-auth/index.ts`
- Adicionar dispatch por `config.provider`
- **Woovi**: Retorna `client_id` (AppID) como access_token sem chamar endpoint externo
- **ONZ**: POST `/oauth/token` com JSON body `{clientId, clientSecret, grantType: "client_credentials"}`
- **Transfeera**: POST `https://login-api.transfeera.com/authorization` com `{grant_type: "client_credentials", client_id, client_secret}`
- **EFI**: Manter logica atual (Basic Auth + mTLS)
- Retornar tambem o `provider` na resposta para as outras functions saberem o tipo

### 2. `supabase/functions/pix-pay-dict/index.ts`
- **Woovi**: `POST /api/v1/subaccount/withdraw` ou usar Pix Out API
- **ONZ**: `POST /pix/payments/dict` com payload ONZ
- **Transfeera**: `POST /pix/transfer` com payload Transfeera
- **EFI**: Manter `PUT /v2/gn/pix/:idEnvio`

### 3. `supabase/functions/pix-pay-qrc/index.ts`
- **Woovi**: Decodificar QR e usar Pix Out
- **ONZ**: Usar endpoint ONZ de QR Code
- **Transfeera**: Decodificar e pagar via transfer
- **EFI**: Manter logica de decode + pay

### 4. `supabase/functions/pix-qrc-info/index.ts`
- **Woovi**: Decodificar localmente (EMV padrao) ou endpoint Woovi
- **ONZ**: Endpoint ONZ
- **Transfeera**: Endpoint Transfeera
- **EFI**: `POST /v2/gn/qrcode/decode`

### 5. `supabase/functions/pix-check-status/index.ts`
- **Woovi**: `GET /api/v1/charge/{id}` ou `GET /api/v1/payment/{id}`
- **ONZ**: `GET /pix/payments/:e2eid`
- **Transfeera**: `GET /pix/transfer/{id}`
- **EFI**: `GET /v2/pix/:e2eId`

### 6. `supabase/functions/pix-refund/index.ts`
- **Woovi**: `POST /api/v1/charge/{id}/refund`
- **ONZ**: `PUT /pix/:e2eId/devolucao/:id`
- **Transfeera**: Endpoint Transfeera de devolucao
- **EFI**: `PUT /v2/pix/:e2eId/devolucao/:id`

### 7. `supabase/functions/pix-receipt/index.ts`
- **Woovi**: Gerar comprovante a partir dos dados da transacao (Woovi nao tem endpoint de PDF)
- **ONZ**: Endpoint ONZ de comprovante
- **Transfeera**: Endpoint Transfeera
- **EFI**: `GET /v2/gn/receipts/:e2eId`

### 8. `supabase/functions/pix-webhook/index.ts`
- Detectar formato do payload e rotear:
  - **Woovi**: payload com `event: "OPENPIX:TRANSACTION_RECEIVED"` e campo `charge`
  - **ONZ**: formato custom ONZ
  - **Transfeera**: formato Transfeera
  - **EFI**: formato BCB com array `pix[]`

### 9. `src/pages/settings/PixIntegration.tsx`
- Adicionar provedores no select: Woovi (OpenPix), ONZ Infopago, Transfeera, EFI Pay
- Mostrar/ocultar campos conforme provedor:
  - **Woovi**: Mostrar apenas AppID (sem client_secret, sem certificado mTLS)
  - **ONZ**: Client ID + Client Secret (sem certificado)
  - **Transfeera**: Client ID + Client Secret (sem certificado)
  - **EFI**: Client ID + Client Secret + Certificado mTLS
- Atualizar URLs base padrao por provedor
- Textos de ajuda contextuais por provedor
- Labels dinamicos (ex: "AppID" para Woovi, "Client ID" para outros)

### 10. `src/hooks/usePixPayment.ts`
- Sem mudancas significativas (chama as edge functions que fazem o dispatch interno)

## Ordem de implementacao

1. Migracao do banco (CHECK constraint)
2. `pix-auth` (dispatch multi-provedor)
3. `PixIntegration.tsx` (UI multi-provedor)
4. `pix-pay-dict` (pagamento por chave)
5. `pix-check-status` (consulta status)
6. `pix-refund` (devolucao)
7. `pix-receipt` (comprovante)
8. `pix-webhook` (callbacks)
9. `pix-qrc-info` e `pix-pay-qrc` (QR Code)

## Detalhes tecnicos por provedor

### Woovi (OpenPix)
- Autenticacao simples: header `Authorization: {appID}` (sem OAuth, sem token)
- Base URL unica: `https://api.openpix.com.br`
- Cobranca: `POST /api/v1/charge` com `{correlationID, value (centavos), comment}`
- Pagamento (Pix Out): `POST /api/v1/subaccount/withdraw` (requer funcionalidade ativa)
- Webhook: payload com `event: "OPENPIX:TRANSACTION_RECEIVED"`
- Valor sempre em **centavos** (inteiro)

### ONZ Infopago
- OAuth2: POST `/oauth/token` com body JSON `{clientId, clientSecret, grantType: "client_credentials"}`
- Resposta: `{accessToken, expiresAt (unix timestamp)}`
- Base URL prod: `https://secureapi.bancodigital.onz.software/api/v2`
- Base URL sandbox: `https://secureapi.bancodigital.hmg.onz.software/api/v2`
- Pagamento: `POST /pix/payments/dict`
- Sem mTLS

### Transfeera
- OAuth2: POST `https://login-api.transfeera.com/authorization` (prod) ou `https://login-api-sandbox.transfeera.com/authorization` (sandbox)
- Body: `{grant_type: "client_credentials", client_id, client_secret}`
- Base URL prod: `https://api.transfeera.com`
- Base URL sandbox: `https://api-sandbox.transfeera.com`
- Pagamento Pix: `POST /pix/transfer`
- Boleto: `GET /billet/consult` (consulta CIP)
- Sem mTLS

### EFI Pay (manter existente)
- Basic Auth + mTLS obrigatorio
- Manter toda logica atual como esta

