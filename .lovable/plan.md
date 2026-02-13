

# Salvar Certificados ONZ no Banco de Dados

## Situacao Atual
- Temos 2 conjuntos de certificados: INFOPAGO_70 e INFOPAGO_70-2
- Os arquivos .crt (certificado publico) estao em formato PEM e podem ser usados diretamente
- Os arquivos .pfx contem a chave privada, mas sao binarios e precisam ser convertidos

## Passo 1 - Usuario extrai a chave privada (no seu computador)
O Deno.createHttpClient precisa de dois parametros: `cert` (certificado) e `key` (chave privada). A chave privada esta dentro do arquivo .pfx.

Execute no terminal do seu computador:

```text
openssl pkcs12 -in INFOPAGO_70.pfx -nocerts -nodes -out key.pem
```

A senha do certificado e: `Xfbfvi.tyja4biGL4QQgqokmHKBNK_yE4oPztxNn.d!bq*zkbL_CwtvbWrMzhkwY`

Depois, codifique em Base64:

```text
base64 -w0 key.pem
```

Cole o resultado aqui no chat.

## Passo 2 - Salvar certificado e chave no banco
Depois que o usuario fornecer a chave em Base64:

1. Codificar o conteudo do arquivo .crt em Base64 (ja temos o conteudo)
2. Executar UPDATE na tabela pix_configs para o provider 'onz':
   - certificate_encrypted = Base64 do .crt
   - certificate_key_encrypted = Base64 da chave privada

## Passo 3 - Testar a conexao
Chamar a Edge Function pix-auth para verificar se a autenticacao mTLS funciona com o endpoint `https://cashout.infopago.com.br/api/v2`

## Duvida para o usuario
Qual conjunto de certificado usar? INFOPAGO_70 ou INFOPAGO_70-2? (Provavelmente INFOPAGO_70 e para o Cash-out API baseado no nome)

