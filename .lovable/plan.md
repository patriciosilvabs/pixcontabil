

# Resolver erro UnknownIssuer - Extrair CA do .pfx da ONZ

## O problema
O Deno nao confia no servidor `cashout.infopago.com.br` porque ele usa uma CA (Autoridade Certificadora) privada. Precisamos do certificado dessa CA para o Deno aceitar a conexao.

## O que voce tem
- `INFOPAGO_70.crt` - certificado do cliente (ja configurado)
- `INFOPAGO_70.key` - chave privada (ja configurada)
- `INFOPAGO_70.csr` - requisicao de assinatura (nao usado)
- `INFOPAGO_70.pfx` - pacote que contem tudo (cliente + CA + chave)

## O que falta
O certificado CA que esta **dentro** do .pfx precisa ser extraido e configurado como secret.

## Passo a passo para voce

### 1. Abrir o Prompt de Comando na pasta dos certificados
Navegue ate a pasta onde estao os arquivos INFOPAGO_70 e abra um terminal (CMD ou PowerShell).

### 2. Extrair o CA do .pfx (um unico comando)
Para Cash-out:
```
openssl pkcs12 -in INFOPAGO_70.pfx -cacerts -nokeys -out ca-onz.pem -passin pass:Xfbfvi.tyja4biGL4QQgqokmHKBNK_yE4oPztxNn.d!bq*zkbL_CwtvbWrMzhkwY
```

### 3. Verificar o resultado
Abra o arquivo `ca-onz.pem` com o Bloco de Notas. Ele deve comecar com `-----BEGIN CERTIFICATE-----`.

- **Se o arquivo estiver vazio ou nao existir**: o .pfx nao contem o CA separado. Nesse caso, use o comando alternativo abaixo para capturar direto do servidor:
```
openssl s_client -connect cashout.infopago.com.br:443 -showcerts < nul 2>nul
```
Copie o ULTIMO bloco `-----BEGIN CERTIFICATE-----` ate `-----END CERTIFICATE-----` e salve como `ca-onz.pem`.

### 4. Me enviar o conteudo
Cole aqui o conteudo do arquivo `ca-onz.pem` (o texto que comeca com `-----BEGIN CERTIFICATE-----`).

## O que farei com o certificado CA
1. Codificar em Base64 e atualizar o secret `ONZ_CA_CERT`
2. A Edge Function `pix-auth` ja esta preparada para usar esse secret
3. A conexao mTLS deve funcionar sem o erro `UnknownIssuer`

## Alteracao de codigo (se necessario)
Se o .pfx nao contiver CA separado e o comando do servidor tambem nao funcionar, modificarei a Edge Function para tentar uma abordagem alternativa de captura dinamica do certificado do servidor.

