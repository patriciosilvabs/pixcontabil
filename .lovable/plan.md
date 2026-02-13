

# Proxy intermediario para conexao ONZ

## Problema
O certificado TLS do servidor ONZ (`cashout.infopago.com.br`) nao possui a extensao SubjectAltName (SAN). O runtime Deno (rustls) nas Edge Functions rejeita a conexao independentemente dos certificados do cliente. Nao ha workaround possivel no codigo.

## Solucao proposta: Proxy com Node.js

Criar um servidor proxy simples que roda em uma plataforma que usa **OpenSSL** (que aceita CN sem SAN). As Edge Functions se conectam ao proxy, e o proxy repassa a requisicao para a ONZ com mTLS.

```text
Edge Functions (Deno/rustls)
        |
        | HTTPS (certificado valido com SAN)
        v
  Proxy Node.js (OpenSSL)
        |
        | mTLS (aceita CN sem SAN)
        v
  cashout.infopago.com.br
```

## Opcoes de hospedagem do proxy

1. **VPS simples** (DigitalOcean, Vultr, etc.) - ~5 USD/mes
   - Servidor Node.js ou nginx com OpenSSL
   - Controle total

2. **AWS Lambda / Google Cloud Function** - custo por uso
   - Funcao serverless com Node.js (usa OpenSSL)
   - Sem servidor para manter

3. **Railway / Render / Fly.io** - plano gratuito disponivel
   - Deploy facil de um servidor Node.js
   - Menor complexidade operacional

## Implementacao

### Passo 1 - Criar o servidor proxy (externo ao Lovable)
Um servidor Node.js simples que:
- Recebe requisicoes HTTPS das Edge Functions
- Faz a conexao mTLS com a ONZ usando os certificados do cliente
- Repassa headers e body sem modificacao
- Retorna a resposta da ONZ

### Passo 2 - Configurar os certificados no proxy
- Upload dos certificados mTLS (.crt e .key) para o servidor proxy
- Configurar o certificado CA da ONZ

### Passo 3 - Atualizar as Edge Functions
- Alterar o bloco ONZ em todas as 7 Edge Functions para apontar para o proxy em vez de `cashout.infopago.com.br`
- Adicionar secret `ONZ_PROXY_URL` com a URL do proxy
- Remover a logica de mTLS das Edge Functions (o proxy cuida disso)

### Passo 4 - Seguranca do proxy
- Autenticacao via API key entre Edge Functions e proxy
- HTTPS obrigatorio
- Rate limiting

## Alternativa recomendada
Antes de implementar o proxy, **enviar um email/ticket para a ONZ** solicitando a correcao do certificado. A correcao e simples (adicionar SAN) e elimina a necessidade do proxy. Se desejar, posso redigir o texto do email.

## O que o Lovable pode fazer
- Atualizar as Edge Functions para usar o proxy (Passo 3)
- O proxy em si precisa ser hospedado **fora do Lovable** em uma das plataformas listadas acima

