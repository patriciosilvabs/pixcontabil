

# Atualizar Secret ONZ_CA_CERT com o Certificado CA Extraido

## Resumo
O certificado CA privado da ONZ Infopago foi extraido com sucesso do arquivo `.pfx`. Agora precisamos codifica-lo em Base64 e atualizar o secret `ONZ_CA_CERT` para resolver o erro `UnknownIssuer` na conexao mTLS.

## O que sera feito

1. **Atualizar o secret `ONZ_CA_CERT`** com o certificado PEM codificado em Base64
2. **Redeployar a Edge Function `pix-auth`** para que ela use o novo certificado CA
3. **Testar a conexao** chamando a funcao de autenticacao para verificar se o erro `UnknownIssuer` foi resolvido

## Detalhes tecnicos

O certificado CA extraido:
- **CN (Common Name):** ONZ-SECURE-AREA-INFOP
- **Validade:** 2025-03-12 ate 2035-03-10
- **Tipo:** CA raiz auto-assinada (flag CA:TRUE)

A Edge Function `pix-auth` ja possui o codigo preparado para ler o secret `ONZ_CA_CERT`, decodificar de Base64 e injetar no campo `caCerts` do `Deno.createHttpClient`. Nenhuma alteracao de codigo e necessaria - apenas a atualizacao do secret.

## Resultado esperado
Apos a atualizacao, a conexao mTLS com `cashout.infopago.com.br` deve funcionar sem o erro `UnknownIssuer`, permitindo autenticacao OAuth2 e operacoes Pix com o provedor ONZ.

