

# Resolver erro NotValidForName na conexao mTLS com ONZ

## Diagnostico
O certificado TLS do servidor `cashout.infopago.com.br` possui o hostname correto no campo CN (Common Name), porem **nao possui a extensao SubjectAltName (SAN)**. Desde 2017 (RFC 6125 / CA/Browser Forum), bibliotecas TLS modernas exigem SAN e ignoram o CN. O runtime Deno (rustls) segue esse padrao estritamente.

## Plano de acao

### Passo 1 - Tentar workaround no codigo
Verificar se o Deno Edge Functions permite alguma configuracao de relaxamento de validacao de hostname no `Deno.createHttpClient`. Possibilidades a testar:
- Opcao de custom `ServerCertVerifier` (se disponivel no runtime)
- Fallback via `node:tls` com `checkServerIdentity` customizado

### Passo 2 - Se workaround nao funcionar
Nao ha como desabilitar a verificacao de hostname no runtime do Supabase Edge Functions (Deno Deploy). Nesse caso, a unica solucao e:

**Solicitar a ONZ Infopago** que atualize o certificado do servidor `cashout.infopago.com.br` para incluir a extensao SubjectAltName com:
```
DNS:cashout.infopago.com.br
```

Isso e um padrao obrigatorio desde 2017 e a correcao deve ser simples para a equipe de infraestrutura da ONZ.

### Passo 3 - Solucao alternativa temporaria (proxy)
Caso a ONZ demore para corrigir, uma opcao seria:
- Configurar um servidor proxy intermediario (ex: um VPS com nginx) que faca a conexao mTLS com a ONZ (usando OpenSSL que aceita CN) e exponha a API via um certificado valido para as Edge Functions consumirem. Isso adiciona complexidade e custo, entao so e recomendado como ultimo recurso.

## Detalhes tecnicos

O certificado do servidor ONZ retorna:
```
subject=CN=cashout.infopago.com.br
No extensions in certificate
```

O runtime Deno usa **rustls** internamente, que segue estritamente a RFC 6125 e exige SAN. Nao ha flag para desabilitar hostname verification em `Deno.createHttpClient` nem no Supabase Edge Functions (que roda sobre Deno Deploy).

O proximo passo imediato e implementar o Passo 1 (tentar workaround no codigo) e, se nao funcionar, orientar o contato com a ONZ.

