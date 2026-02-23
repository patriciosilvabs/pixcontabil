

## Adicionar campos de certificado mTLS para o provedor ONZ

O problema e simples: na configuracao do provedor ONZ (linha 98 do `PixIntegration.tsx`), o campo `showCertificate` esta definido como `false`. Isso impede que os campos de certificado e chave privada aparecam na interface.

O provedor ONZ utiliza autenticacao mTLS (certificado de cliente), mas a UI atual nao exibe os campos para inserir essas credenciais.

### Alteracao

**Arquivo:** `src/pages/settings/PixIntegration.tsx`

- Alterar `showCertificate: false` para `showCertificate: true` na configuracao do provedor `onz` (linha 98)
- Atualizar a descricao de credenciais para mencionar o certificado mTLS: `"Credenciais OAuth2 (Client Credentials) + Certificado mTLS"`

### Impacto

Apos essa alteracao, ao selecionar o provedor "ONZ Infopago", a interface passara a exibir:
- Campo "Certificado mTLS - PEM (Base64)" (textarea)
- Campo "Chave Privada do Certificado - PEM (Base64, opcional)" (textarea)

A logica de salvamento ja contempla esses campos quando `showCertificate` e `true` (linhas 259-262), entao nao e necessaria nenhuma outra alteracao.

