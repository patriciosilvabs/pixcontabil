
## Remover Proxy ONZ e Usar mTLS Direto nas Edge Functions

Com base na documentacao tecnica que voce compartilhou, o proxy no Railway nao e necessario. O certificado mTLS pode ser usado diretamente nas Edge Functions via `Deno.createHttpClient`, da mesma forma que ja funciona para EFI Pay e Banco Inter.

### O que muda

Todas as 5 Edge Functions que usam o proxy ONZ serao atualizadas para fazer chamadas diretas a API ONZ, usando o certificado e chave privada armazenados na tabela `pix_configs`.

### Funcoes afetadas

1. **pix-auth** - Autenticacao OAuth (POST /oauth/token)
2. **pix-balance** - Consulta de saldo (GET /accounts/balances/)
3. **pix-pay-dict** - Pagamento por chave (POST /pix/payments/dict)
4. **pix-pay-qrc** - Pagamento por QR Code (POST /pix/payments/qrcode)
5. **pix-qrc-info** - Decodificacao de QR Code (POST /pix/qrcode/decode)
6. **pix-receipt** - Comprovante (GET /pix/receipts/)

### Padrao de substituicao

Em cada funcao, o bloco ONZ que faz:
```text
proxy_url -> /proxy -> { url, method, headers, body }
```

Sera substituido por:
```text
Deno.createHttpClient({ cert, key }) -> fetch(url, { client: httpClient })
```

Seguindo exatamente o mesmo padrao ja usado para EFI e Inter.

### Detalhes tecnicos

**Antes (via proxy):**
```text
1. Edge Function envia request ao proxy Railway
2. Proxy faz a chamada mTLS com Node.js https.Agent
3. Proxy retorna { status, data } para a Edge Function
```

**Depois (direto):**
```text
1. Edge Function le cert/key do pix_configs
2. Cria Deno.createHttpClient({ cert, key })
3. Faz fetch direto para a API ONZ
```

**Tratamento do certificado:**
- Usa as funcoes `decodeCert()` e `normalizePem()` ja existentes em cada funcao
- Le `certificate_encrypted` e `certificate_key_encrypted` do registro `pix_configs`
- Se o certificado nao estiver configurado, retorna erro claro

**Cabecalhos ONZ necessarios:**
- `Authorization: Bearer {token}`
- `Content-Type: application/json`
- `X-Company-ID: {provider_company_id}` (quando disponivel)

### Notas

- Os secrets `ONZ_PROXY_URL` e `ONZ_PROXY_API_KEY` nao serao mais necessarios apos esta mudanca
- O proxy no Railway pode ser desativado depois que tudo estiver funcionando
- O `client_id` atual (`00011264217396579000156`) sera mantido conforme esta no banco -- se a ONZ retornar "Application not found", o problema e com as credenciais no painel ONZ, nao com o codigo
