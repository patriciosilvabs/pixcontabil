
## ✅ Proxy ONZ Removido — mTLS Direto nas Edge Functions

Todas as Edge Functions ONZ foram migradas para usar `Deno.createHttpClient({ cert, key })` diretamente, eliminando a dependência do proxy Railway.

### Funções atualizadas

1. **pix-auth** — Autenticação OAuth direto via mTLS
2. **pix-balance** — Consulta de saldo direto via mTLS
3. **pix-pay-dict** — Pagamento por chave direto via mTLS
4. **pix-pay-qrc** — Pagamento por QR Code direto via mTLS
5. **pix-qrc-info** — Decodificação de QR Code direto via mTLS
6. **pix-receipt** — Comprovante direto via mTLS
7. **pix-check-status** — Consulta de status direto via mTLS

### Secrets que podem ser removidos

- `ONZ_PROXY_URL`
- `ONZ_PROXY_API_KEY`

### Pré-requisito

O certificado mTLS e chave privada devem estar configurados nos campos `certificate_encrypted` e `certificate_key_encrypted` da tabela `pix_configs` para o provedor ONZ.
