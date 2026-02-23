
## Corrigir URLs da API ONZ nas Edge Functions

O erro de DNS (`Name or service not known`) ocorre porque o `base_url` salvo no banco (`https://secureapi.bancodigital.onz.software/api/v2`) esta incorreto -- esse dominio nao existe mais.

De acordo com a documentacao oficial da ONZ (imagem enviada), as URLs corretas sao:

- **Contas (cash-out):** `https://cashout.infopago.com.br/api/v2`
- **QRCodes (cash-in):** `https://api.pix.infopago.com.br`

### Problema adicional

A ONZ usa **dois dominios diferentes** para operacoes distintas. O sistema atual suporta apenas um `base_url` por registro `pix_configs`. Como o registro atual tem `purpose: both`, precisamos lidar com isso nas Edge Functions.

### Plano

**1. Atualizar o `base_url` no banco de dados**

Alterar o registro existente para usar a URL de cash-out (que e a mais usada -- auth, balance, payments, receipts):

```text
base_url: https://cashout.infopago.com.br/api/v2
```

**2. Hardcode da URL do QRCodes nas funcoes que precisam**

Nas Edge Functions que fazem operacoes de QR Code (cash-in), usar `https://api.pix.infopago.com.br` diretamente quando o provider for `onz`, ja que essa URL e fixa e documentada.

### Funcoes afetadas e suas URLs

| Funcao | Operacao | URL correta |
|---|---|---|
| pix-auth | OAuth token | `cashout.infopago.com.br/api/v2/oauth/token` |
| pix-balance | Saldo | `cashout.infopago.com.br/api/v2/accounts/balances/` |
| pix-pay-dict | Pagamento por chave | `cashout.infopago.com.br/api/v2/pix/payments/dict` |
| pix-pay-qrc | Pagamento por QR | `cashout.infopago.com.br/api/v2/pix/payments/qrcode` |
| pix-qrc-info | Decodificar QR | `cashout.infopago.com.br/api/v2/pix/qrcode/decode` |
| pix-receipt | Comprovante | `cashout.infopago.com.br/api/v2/pix/receipts/` |
| pix-check-status | Status | `cashout.infopago.com.br/api/v2/pix/` |

Todas as operacoes atuais usam a Accounts API (cash-out), entao basta corrigir o `base_url` no banco. Nenhuma funcao precisa do dominio `api.pix.infopago.com.br` no momento.

### Alteracoes

1. **SQL Update** -- Atualizar `base_url` no `pix_configs` de `https://secureapi.bancodigital.onz.software/api/v2` para `https://cashout.infopago.com.br/api/v2`

2. **Nenhuma alteracao em codigo** -- As Edge Functions ja usam `${config.base_url}/...` corretamente. Basta corrigir o dado no banco.

### Detalhes tecnicos

A autenticacao OAuth sera chamada em:
```text
POST https://cashout.infopago.com.br/api/v2/oauth/token
Body: { clientId, clientSecret, grantType: "client_credentials" }
```

O certificado mTLS continuara sendo usado via `Deno.createHttpClient({ cert, key })` como ja implementado.
