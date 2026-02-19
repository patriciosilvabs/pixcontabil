

# Plano de Integracao do Banco Inter como Provedor

## Visao Geral

Adicionar o **Banco Inter** como novo provedor Pix no sistema, seguindo o padrao arquitetural existente (multi-provider com switch/case por `provider`). O Inter usa OAuth2 com `client_credentials` e autenticacao via certificado mTLS (similar ao EFI Pay).

## Contexto Tecnico

O Banco Inter expoe 3 grupos de APIs relevantes:
- **API Pix** (`/pix/v2/`): Cobranças imediatas (cob), com vencimento (cobv), devoluções, webhooks
- **API Banking** (`/banking/v2/`): Saldo, extrato, pagamentos Pix (cash-out), pagamentos boleto
- **API Cobranca** (`/cobranca/v3/`): Boleto com Pix (emissao, consulta, cancelamento)

**URLs Base:**
- Producao: `https://cdpj.partners.bancointer.com.br`
- Sandbox: `https://cdpj-sandbox.partners.uatinter.co`

**Autenticacao:** OAuth2 `client_credentials` via `POST /oauth/v2/token` com `client_id`, `client_secret`, `scope` e certificado mTLS obrigatorio. Token valido por 60 minutos.

---

## Etapas de Implementacao

### 1. UI - Adicionar "Banco Inter" na lista de provedores

**Arquivo:** `src/pages/settings/PixIntegration.tsx`

- Adicionar `{ value: "inter", label: "Banco Inter" }` ao array `PIX_PROVIDERS`
- Adicionar configuracao no `PROVIDER_CONFIG`:

```text
inter: {
  clientIdLabel: 'Client ID',
  clientIdPlaceholder: 'Obtido na tela de aplicacoes do IB',
  clientIdHelp: 'Obtido no Internet Banking > API > Aplicacoes.',
  showClientSecret: true,
  clientSecretLabel: 'Client Secret',
  clientSecretHelp: 'Obtido no Internet Banking > API > Aplicacoes.',
  showCertificate: true,    // Inter exige mTLS
  showCompanyId: true,       // x-conta-corrente
  credentialsTitle: 'Credenciais Banco Inter',
  credentialsDescription: 'Credenciais OAuth2 + Certificado mTLS obrigatorio',
  urls: {
    production: 'https://cdpj.partners.bancointer.com.br',
    sandbox: 'https://cdpj-sandbox.partners.uatinter.co',
  },
}
```

- O campo `provider_company_id` sera usado para armazenar o numero da conta corrente (`x-conta-corrente`), reutilizando o campo existente com label "Conta Corrente" quando o provedor for `inter`

### 2. Edge Function - pix-auth (Autenticacao)

**Arquivo:** `supabase/functions/pix-auth/index.ts`

Adicionar bloco `else if (provider === 'inter')`:

- Autenticacao via `POST /oauth/v2/token` com `Content-Type: application/x-www-form-urlencoded`
- Body: `client_id`, `client_secret`, `grant_type=client_credentials`, `scope` (escopos necessarios: `cob.write cob.read cobv.write cobv.read pix.write pix.read pagamento-pix.write pagamento-pix.read pagamento-boleto.write pagamento-boleto.read extrato.read`)
- Certificado mTLS obrigatorio (mesmo padrao do EFI: `Deno.createHttpClient({ cert, key })`)
- Token expira em 3600 segundos (1h)
- Cache no `pix_tokens` com margem de 60 segundos

### 3. Edge Function - pix-pay-dict (Pagamento Pix via Chave)

**Arquivo:** `supabase/functions/pix-pay-dict/index.ts`

Adicionar bloco `else if (provider === 'inter')`:

- Endpoint: `POST /banking/v2/pix`
- Header: `x-conta-corrente` (do `provider_company_id`)
- Header: `x-id-idempotente` (UUID gerado)
- Body:
```text
{
  "valor": 123.45,
  "descricao": "Pagamento Pix",
  "destinatario": {
    "tipo": "CHAVE",
    "chave": "<pix_key>"
  }
}
```
- Certificado mTLS obrigatorio
- Response: mapear `codigoSolicitacao` como `external_id` e `endToEnd` quando disponivel

### 4. Edge Function - pix-pay-qrc (Pagamento via QR Code / Copia e Cola)

**Arquivo:** `supabase/functions/pix-pay-qrc/index.ts`

Adicionar bloco `else if (provider === 'inter')`:

- Endpoint: `POST /banking/v2/pix`
- Body com destinatario tipo Copia e Cola:
```text
{
  "valor": 123.45,
  "descricao": "Pagamento via QR Code",
  "destinatario": {
    "tipo": "PIX_COPIA_E_COLA",
    "pixCopiaECola": "<emv_string>"
  }
}
```
- Certificado mTLS obrigatorio
- Headers: `x-conta-corrente`, `x-id-idempotente`

### 5. Edge Function - pix-balance (Consulta de Saldo)

**Arquivo:** `supabase/functions/pix-balance/index.ts`

Adicionar bloco `else if (provider === 'inter')`:

- Endpoint: `GET /banking/v2/saldo`
- Header: `x-conta-corrente`
- Certificado mTLS obrigatorio
- Response: mapear `data.disponivel` como balance

### 6. Edge Function - pix-check-status (Consulta de Status)

**Arquivo:** `supabase/functions/pix-check-status/index.ts`

Adicionar bloco `else if (provider === 'inter')`:

- Endpoint: `GET /banking/v2/pix/{codigoSolicitacao}`
- Header: `x-conta-corrente`
- Certificado mTLS obrigatorio
- Mapear status do Inter para status interno:
  - `PROCESSADO` / `EFETIVADO` -> `completed`
  - `EMPROCESSAMENTO` / `APROVACAO` -> `pending`
  - `CANCELADO` / `DEVOLVIDO` -> `failed` / `refunded`

### 7. Edge Function - pix-receipt (Comprovante)

**Arquivo:** `supabase/functions/pix-receipt/index.ts`

Adicionar bloco `else if (provider === 'inter')`:

- Usar dados ja salvos em `pix_provider_response` (mesmo padrao dos outros provedores)
- Mapear campos do Inter para formato padronizado

### 8. Edge Function - pix-refund (Devolucao)

**Arquivo:** `supabase/functions/pix-refund/index.ts`

Adicionar bloco `else if (provider === 'inter')`:

- Endpoint: `PUT /pix/v2/pix/{e2eId}/devolucao/{id}`
- Body: `{ "valor": "10.00" }`
- Certificado mTLS obrigatorio
- Header: `x-conta-corrente`

### 9. Edge Function - pix-webhook (Recebimento de Webhooks)

**Arquivo:** `supabase/functions/pix-webhook/index.ts`

Adicionar deteccao do formato Inter e handler:

- **Deteccao:** O Inter usa o padrao BCB (mesmo formato do EFI com array `pix`), mas os webhooks de pagamento (Banking) tem formato proprio com campos como `endToEnd`, `status`, `codigoSolicitacao`
- Reutilizar o handler EFI existente para webhooks do padrao BCB (`pix` array) - ja funciona
- Adicionar handler para callbacks do Banking (`codigoSolicitacao`, `status`)

### 10. Edge Function - billet-pay (Pagamento de Boleto) - Reativar

**Arquivo:** `supabase/functions/billet-pay/index.ts`

Reativar a funcao com suporte ao Banco Inter:

- Endpoint: `POST /banking/v2/pagamento`
- Body:
```text
{
  "codBarraLinhaDigitavel": "<codigo_barras>",
  "valorPagar": "26.80",
  "dataPagamento": "2024-01-15",
  "dataVencimento": "2024-01-15"
}
```
- Certificado mTLS obrigatorio
- Header: `x-conta-corrente`
- Response: mapear `codigoTransacao` e `statusPagamento`

### 11. Edge Function - pix-qrc-info (Decodificar QR Code)

**Arquivo:** `supabase/functions/pix-qrc-info/index.ts`

O Banco Inter nao expoe um endpoint de decode de EMV. O QR Code sera decodificado localmente (parser EMV ja existente no sistema) ou enviado diretamente como `pixCopiaECola` no pagamento. Nenhuma alteracao necessaria aqui.

---

## Padrao de Implementacao mTLS (Reutilizado do EFI)

Todos os endpoints do Inter exigem certificado mTLS. O padrao sera identico ao EFI:

```text
// Ler certificado da config (armazenado em Base64)
const certPem = atob(config.certificate_encrypted);
const keyPem = config.certificate_key_encrypted 
  ? atob(config.certificate_key_encrypted) 
  : certPem;
const httpClient = Deno.createHttpClient({ cert: certPem, key: keyPem });

// Usar em todas as requests
const response = await fetch(url, { ...options, client: httpClient });
httpClient.close();
```

---

## Configuracao no config.toml

Nenhuma alteracao necessaria - todas as edge functions ja estao com `verify_jwt = false`.

---

## Escopos Necessarios no Token

O token sera gerado com todos os escopos necessarios em uma unica chamada:

```text
cob.write cob.read cobv.write cobv.read pix.write pix.read 
pagamento-pix.write pagamento-pix.read pagamento-boleto.write 
pagamento-boleto.read extrato.read webhook-banking.write webhook-banking.read
```

---

## Resumo de Arquivos a Modificar

| Arquivo | Alteracao |
|---------|-----------|
| `src/pages/settings/PixIntegration.tsx` | Adicionar provider "inter" na UI |
| `supabase/functions/pix-auth/index.ts` | OAuth2 + mTLS para Inter |
| `supabase/functions/pix-pay-dict/index.ts` | Pagamento Pix via chave |
| `supabase/functions/pix-pay-qrc/index.ts` | Pagamento via Copia e Cola |
| `supabase/functions/pix-balance/index.ts` | Consulta de saldo |
| `supabase/functions/pix-check-status/index.ts` | Consulta de status |
| `supabase/functions/pix-receipt/index.ts` | Comprovante |
| `supabase/functions/pix-refund/index.ts` | Devolucao Pix |
| `supabase/functions/pix-webhook/index.ts` | Handler de webhooks |
| `supabase/functions/billet-pay/index.ts` | Pagamento de boleto (reativar) |

**Total: 10 arquivos modificados, 0 novos arquivos, 0 migracao de banco**

---

## Consideracoes Importantes

- **Certificado mTLS**: O usuario precisara gerar o certificado no Internet Banking do Inter e colar em Base64 na configuracao (mesmo fluxo do EFI Pay)
- **Conta Corrente**: O campo `provider_company_id` sera reutilizado para armazenar o numero da conta corrente (necessario no header `x-conta-corrente`)
- **Rate Limits**: O Inter tem limites de 120 chamadas/minuto em producao e 10/minuto em sandbox
- **Pagamento de boleto**: Sera a primeira implementacao funcional de boleto no sistema, reativando a edge function que estava desabilitada

