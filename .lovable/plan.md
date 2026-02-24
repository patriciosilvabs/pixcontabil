

# Fix: Usar endpoint correto `/pix/payments/qrc` para liquidar QR Codes dinamicos

## Problema
O pagamento via QR Code dinamico esta usando o endpoint `/pix/payments/dict` (pagamento por chave Pix), que faz uma transferencia P2P simples. Isso significa que o dinheiro chega ao destinatario, mas **nao liquida o QR Code na maquininha** -- por isso a confirmacao nao aparece no terminal.

A documentacao da ONZ confirma que existe o endpoint dedicado `POST /pix/payments/qrc` que aceita o EMV completo (copia-e-cola) e liquida corretamente o QR Code.

## Solucao
Para QR Codes **dinamicos**, chamar diretamente o endpoint `/pix/payments/qrc` da ONZ via proxy mTLS, enviando o EMV completo. QR Codes **estaticos** continuam usando `/pix/payments/dict` (que ja funciona).

## Alteracoes

### 1. `supabase/functions/pix-pay-qrc/index.ts`
Substituir o bloco de QR Code dinamico (linhas 149-182) que delega ao `pix-pay-dict` por uma chamada direta ao endpoint `/pix/payments/qrc` da ONZ via proxy:

- Obter token de autenticacao via `pix-auth`
- Montar payload conforme documentacao: `{ qrCode, payment: { amount, currency }, description }`
- Enviar via proxy mTLS para `{base_url}/pix/payments/qrc`
- Salvar transacao no banco com `pix_type: 'qrcode'`, `pix_copia_cola`, e `pix_txid`

### Fluxo corrigido

```text
QR Code escaneado
       |
  pix-qrc-info (decodifica EMV localmente)
       |
  pix-pay-qrc
       |
       +-- Estatico --> pix-pay-dict (/pix/payments/dict) --> OK
       |
       +-- Dinamico --> ONZ /pix/payments/qrc (EMV completo) --> Liquida na maquininha
```

### Detalhes tecnicos

**Payload para ONZ `/pix/payments/qrc`:**
```json
{
  "qrCode": "<EMV string completa>",
  "description": "Pagamento via QR Code",
  "payment": {
    "amount": 10.50,
    "currency": "BRL"
  }
}
```

**Headers obrigatorios:**
- `Authorization: Bearer {access_token}`
- `Content-Type: application/json`
- `x-idempotency-key: {id_unico}`
- `X-Company-ID: {provider_company_id}` (se configurado)

**Resposta esperada (202 Accepted):**
```json
{
  "endToEndId": "string",
  "eventDate": "2019-08-24T14:15:22Z",
  "id": 0,
  "payment": { "currency": "BRL", "amount": 10.50 },
  "type": "string"
}
```

- O `endToEndId` da resposta sera salvo como `pix_e2eid` na transacao
- O EMV original sera salvo em `pix_copia_cola`
- O `txid` extraido pelo `pix-qrc-info` sera salvo em `pix_txid`

