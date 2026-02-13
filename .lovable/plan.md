

# Resolver erro NotValidForName na conexao mTLS com ONZ

## Diagnostico
O certificado TLS do servidor `cashout.infopago.com.br` possui o hostname correto no campo CN (Common Name), porem **nao possui a extensao SubjectAltName (SAN)**. Desde 2017 (RFC 6125 / CA/Browser Forum), bibliotecas TLS modernas exigem SAN e ignoram o CN. O runtime Deno (rustls) segue esse padrao estritamente.

## Resultado das tentativas de workaround

### Passo 1 - Tentativas realizadas (TODAS FALHARAM)

1. **`Deno.connectTls` com `unsafelyDisableHostnameVerification: true`**: A flag é ignorada pelo Supabase Edge Functions (Deno Deploy). O handshake TLS é lazy — `connectTls` retorna sucesso mas o erro `NotValidForName` ocorre no primeiro `write`.

2. **`node:https` com `checkServerIdentity` customizado**: O shim `node:https` no Supabase Edge Functions redireciona internamente para `fetch` do Deno (rustls). A opção `checkServerIdentity` é completamente ignorada. O erro mudou para `UnknownIssuer` porque os `caCerts` não são repassados corretamente pelo shim.

### Conclusão
**Não existe workaround possível no código** dentro do ambiente Supabase Edge Functions. O runtime usa rustls que exige SAN estritamente, e nenhuma API disponível permite desabilitar a verificação de hostname.

## Próximos passos (requer ação externa)

### Passo 2 - Solicitar correção à ONZ Infopago (RECOMENDADO)
A ONZ precisa atualizar o certificado do servidor `cashout.infopago.com.br` para incluir a extensão SubjectAltName:
```
DNS:cashout.infopago.com.br
```
Isso é um padrão obrigatório desde 2017. A correção deve ser simples para a equipe de infraestrutura.

### Passo 3 - Proxy intermediário (alternativa temporária)
Configurar um servidor proxy (ex: VPS com nginx + OpenSSL) que:
1. Aceite conexões HTTPS com certificado válido (com SAN)
2. Faça proxy reverso para `cashout.infopago.com.br` usando OpenSSL (que aceita CN sem SAN)
3. As Edge Functions se conectam ao proxy em vez do servidor ONZ diretamente
