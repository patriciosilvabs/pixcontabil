
# Migrar de ONZ para EFI (Efi Pay) como provedor Pix

## Resumo
Substituir toda a integracao com a API ONZ pela API Pix da Efi Pay (antigo Gerencianet). A EFI segue o padrao BCB mais de perto e usa autenticacao via **Basic Auth** com certificado mTLS obrigatorio.

## Diferencas principais entre ONZ e EFI

| Aspecto | ONZ | EFI |
|---------|-----|-----|
| Autenticacao | JSON body com clientId/clientSecret | Basic Auth (base64 de client_id:client_secret) |
| Token endpoint | `/oauth/token` | `/oauth/token` |
| Body do token | `{"clientId":"...", "grantType":"client_credentials"}` | `{"grant_type": "client_credentials"}` |
| Token response | `accessToken`, `expiresAt` (unix) | `access_token`, `expires_in` (seconds) |
| Base URL prod | `secureapi.bancodigital.onz.software/api/v2` | `pix.api.efipay.com.br` |
| Base URL sandbox | `secureapi.bancodigital.hmg.onz.software/api/v2` | `pix-h.api.efipay.com.br` |
| Envio Pix | `POST /pix/payments/dict` (custom) | `PUT /v2/gn/pix/:idEnvio` (padrao BCB) |
| Cobranca | N/A | `PUT /v2/cob/:txid` |
| Consulta Pix | `GET /pix/payments/:e2eid` | `GET /v2/pix/:e2eId` |
| Devolucao | `PUT /pix/:e2eid/devolucao/:id` | `PUT /v2/pix/:e2eId/devolucao/:id` (igual BCB) |
| Webhook | Custom payload | `PUT /v2/webhook/:chave` + callbacks BCB |
| Certificado | .crt + .key separados | .p12 ou .pem (cert+key junto ou separados) |

## Arquivos a modificar

### 1. `supabase/functions/pix-auth/index.ts` -- Reescrever autenticacao
- Remover logica ONZ (JSON body, fallback form-urlencoded)
- Implementar **Basic Auth**: header `Authorization: Basic base64(client_id:client_secret)`
- Body: `{"grant_type": "client_credentials"}`
- Parsear resposta EFI: `access_token`, `token_type`, `expires_in`, `scope`
- Calcular `expires_at` a partir de `expires_in` (segundos)
- Manter mTLS com certificado

### 2. `supabase/functions/pix-pay-dict/index.ts` -- Reescrever envio Pix por chave
- Endpoint EFI: `PUT /v2/gn/pix/:idEnvio`
- Gerar `idEnvio` unico (alfanumerico, ate 35 chars)
- Payload EFI:
```text
{
  "valor": "12.34",
  "pagador": {
    "chave": "chave-pix-da-empresa",
    "infoPagador": "descricao"
  },
  "favorecido": {
    "chave": "chave-pix-destino"
  }
}
```
- Parsear resposta EFI (e2eId, status, etc.)

### 3. `supabase/functions/pix-pay-qrc/index.ts` -- Adaptar pagamento por QR Code
- EFI nao tem endpoint direto de pagamento por QR Code como ONZ
- Opcao: decodificar QR code via `POST /v2/gn/qrcode/decode` e pagar via `/v2/gn/pix/:idEnvio`
- Ajustar payload e resposta

### 4. `supabase/functions/pix-qrc-info/index.ts` -- Consulta info QR Code
- Endpoint EFI: `POST /v2/gn/qrcode/decode` (se disponivel)
- Ajustar payload: `{"qrcode": "..."}`
- Parsear resposta

### 5. `supabase/functions/pix-check-status/index.ts` -- Consultar status
- Consulta Pix enviado: `GET /v2/gn/pix/enviados/:e2eId`
- Mapear status EFI para status interno
- Remover referencias a `idempotencyKey` do ONZ

### 6. `supabase/functions/pix-refund/index.ts` -- Devolucao
- Endpoint EFI: `PUT /v2/pix/:e2eId/devolucao/:id` (mesmo padrao BCB, quase igual)
- Payload: `{"valor": "10.00"}`
- Parsear resposta EFI

### 7. `supabase/functions/pix-receipt/index.ts` -- Comprovante
- Endpoint EFI: `GET /v2/gn/receipts/:e2eId` (scope `gn.receipts.read`)
- Ajustar parsing da resposta

### 8. `supabase/functions/pix-webhook/index.ts` -- Webhook
- Adaptar para formato de callback BCB/EFI
- EFI envia: `POST /webhook-url` com payload `{"pix": [{"endToEndId": "...", "txid": "...", "valor": "...", ...}]}`
- Registrar webhook: `PUT /v2/webhook/:chave` com `{"webhookUrl": "https://..."}`

### 9. `supabase/functions/billet-pay/index.ts` -- Boleto (remover/desabilitar)
- A EFI tem API de boletos mas com endpoints diferentes
- Por ora, desabilitar pagamento de boletos ou adaptar para API de boletos EFI separadamente

### 10. `src/pages/settings/PixIntegration.tsx` -- Tela de configuracao
- Trocar provedor "ONZ / Infopago" por "EFI / Efi Pay"
- Atualizar URLs base padrao (prod/sandbox)
- Ajustar textos de ajuda (Client ID, Client Secret, certificado .p12/.pem)
- Remover referencia a "portal ONZ"
- Certificado: campo unico para .pem (cert+key combinado) OU manter dois campos separados para .crt e .key

### 11. `src/hooks/usePixPayment.ts` -- Sem mudancas significativas
- O hook chama as edge functions que serao atualizadas. A interface permanece a mesma.

## Detalhes Tecnicos

### Autenticacao EFI (pix-auth):
```text
POST https://pix-h.api.efipay.com.br/oauth/token
Authorization: Basic base64(client_id:client_secret)
Content-Type: application/json
Certificate: mTLS obrigatorio

Body: {"grant_type": "client_credentials"}

Response: {
  "access_token": "eyJ...",
  "token_type": "Bearer",
  "expires_in": 3600,
  "scope": "cob.write cob.read pix.write pix.read ..."
}
```

### Envio Pix EFI (pix-pay-dict):
```text
PUT https://pix-h.api.efipay.com.br/v2/gn/pix/{idEnvio}
Authorization: Bearer {access_token}
Content-Type: application/json
Certificate: mTLS

Body: {
  "valor": "100.00",
  "pagador": {
    "chave": "{chave-pix-empresa}",
    "infoPagador": "Pagamento ref XYZ"
  },
  "favorecido": {
    "chave": "{chave-pix-destino}"
  }
}
```

### Certificado mTLS
- EFI fornece certificado no formato `.p12`
- Para usar em Deno, converter para `.pem` (cert + key)
- O campo `certificate_encrypted` armazena o PEM em base64
- O campo `certificate_key_encrypted` armazena a chave privada em base64
- Alternativamente, se o PEM contiver ambos, usar apenas `certificate_encrypted`

## Ordem de implementacao
1. Atualizar `pix-auth` (autenticacao EFI)
2. Atualizar `PixIntegration.tsx` (UI de configuracao)
3. Atualizar `pix-pay-dict` (envio Pix)
4. Atualizar `pix-check-status` (consulta)
5. Atualizar `pix-refund` (devolucao)
6. Atualizar `pix-receipt` (comprovante)
7. Atualizar `pix-webhook` (callbacks)
8. Atualizar `pix-qrc-info` e `pix-pay-qrc` (QR Code)
9. Desabilitar/adaptar `billet-pay` (boletos ficam para fase futura)
