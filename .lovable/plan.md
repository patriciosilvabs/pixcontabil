

# Guia Pratico: Deploy do Proxy ONZ

## O que voce vai precisar

- Uma conta no [Railway](https://railway.app) (login com GitHub, gratuito)
- Uma conta no [GitHub](https://github.com) (gratuita)
- Os certificados mTLS da ONZ que voce ja tem (os mesmos valores que estao no banco de dados nos campos `certificate_encrypted` e `certificate_key_encrypted`)

## Passo a Passo

### 1. Criar um repositorio no GitHub

1. Acesse [github.com/new](https://github.com/new)
2. Nome do repositorio: `onz-proxy` (ou qualquer nome)
3. Marque como **Private**
4. Clique em **Create repository**
5. Faca upload de 2 arquivos que ja estao no seu projeto Lovable na pasta `docs/onz-proxy/`:
   - `index.js`
   - `package.json`
6. Pode copiar o conteudo desses arquivos diretamente do editor de codigo do Lovable

### 2. Fazer deploy no Railway

1. Acesse [railway.app](https://railway.app) e faca login com sua conta GitHub
2. Clique em **New Project**
3. Selecione **Deploy from GitHub Repo**
4. Escolha o repositorio `onz-proxy` que voce acabou de criar
5. O Railway vai detectar automaticamente que e um projeto Node.js

### 3. Configurar as variaveis de ambiente no Railway

No painel do Railway, va em **Variables** e adicione:

| Variavel | De onde vem o valor |
|---|---|
| `PROXY_API_KEY` | Invente uma senha longa. Pode gerar uma no terminal com `openssl rand -hex 32` ou usar qualquer gerador de senhas online |
| `ONZ_CLIENT_CERT_B64` | E o mesmo valor que esta no campo `certificate_encrypted` da tabela `pix_configs` no seu banco de dados |
| `ONZ_CLIENT_KEY_B64` | E o mesmo valor que esta no campo `certificate_key_encrypted` da tabela `pix_configs` |
| `ONZ_CA_CERT_B64` | (Opcional) Se voce tiver o certificado CA da ONZ em Base64 |

### 4. Fazer deploy

1. Apos adicionar as variaveis, o Railway faz deploy automaticamente
2. Va em **Settings** do servico e procure a secao **Networking**
3. Clique em **Generate Domain** para obter uma URL publica (algo como `https://onz-proxy-production-xxxx.up.railway.app`)
4. Teste acessando no navegador: `https://sua-url.up.railway.app/health` -- deve retornar `{"status":"ok"}`

### 5. Voltar ao Lovable com os dados

Apos o deploy funcionar, voce precisa me fornecer dois valores:

1. **URL do proxy** -- a URL que o Railway gerou (ex: `https://onz-proxy-production-xxxx.up.railway.app`)
2. **API Key** -- a senha que voce definiu em `PROXY_API_KEY`

Com esses valores, vou atualizar todas as 7 Edge Functions para rotear o trafego ONZ pelo proxy.

## Resumo do fluxo

```text
Voce ja tem                    Voce precisa criar              Depois volta aqui
--------------                 -------------------             -----------------
Certificados ONZ     --->      Repo GitHub + Railway    --->   Me passa URL + Key
(no banco de dados)            (deploy do proxy)               (atualizo as funcoes)
```

## Secao Tecnica

### O que sera atualizado nas Edge Functions

Todas as 7 funcoes que fazem chamadas para a ONZ serao modificadas:
- `pix-auth` -- autenticacao OAuth2
- `pix-balance` -- consulta de saldo
- `pix-pay-dict` -- pagamento por chave
- `pix-pay-qrc` -- pagamento por QR Code
- `pix-check-status` -- consulta de status
- `pix-receipt` -- comprovante
- `pix-refund` -- estorno
- `pix-qrc-info` -- decodificacao de QR Code

Em cada uma, o bloco ONZ deixara de criar conexao mTLS direta e passara a enviar a requisicao para o proxy via POST, que repassa para a ONZ com mTLS via OpenSSL.

Dois novos secrets serao adicionados ao projeto:
- `ONZ_PROXY_URL` -- URL do proxy no Railway
- `ONZ_PROXY_API_KEY` -- chave de autenticacao do proxy

### Custo estimado

O Railway oferece um plano gratuito com 500 horas/mes (suficiente para um servico leve). Apos isso, o custo e de aproximadamente 5 USD/mes.

