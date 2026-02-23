
# Corrigir formato da requisição OAuth para ONZ

## Problema identificado
As credenciais da ONZ estao corretas no banco de dados, mas o `pix-auth` envia o body da autenticacao OAuth em formato **camelCase** (`clientId`, `clientSecret`, `grantType`) como JSON. Muitas APIs OAuth (incluindo possivelmente a ONZ/Infopago) esperam o formato padrao **snake_case** (`client_id`, `client_secret`, `grant_type`), potencialmente como `application/x-www-form-urlencoded`. O erro `404: Application not found` pode ser a resposta generica do servidor quando nao consegue identificar a aplicacao devido ao formato incorreto dos campos.

## Solucao

Alterar a secao ONZ do `pix-auth` para tentar o formato padrao OAuth2 primeiro:

### Arquivo: `supabase/functions/pix-auth/index.ts`

Na secao ONZ (~linha 163), alterar o `requestBody` e o `Content-Type`:

**De (atual):**
```javascript
const requestBody = {
  clientId: pixConfig.client_id,
  clientSecret: pixConfig.client_secret_encrypted,
  grantType: 'client_credentials',
};
// headers: { 'Content-Type': 'application/json' }
```

**Para:**
```javascript
const requestBody = {
  client_id: pixConfig.client_id,
  client_secret: pixConfig.client_secret_encrypted,
  grant_type: 'client_credentials',
};
// headers: { 'Content-Type': 'application/json' }
```

Manter JSON como Content-Type, mas usar snake_case nos campos. Se ainda falhar, a proxima iteracao testara `application/x-www-form-urlencoded`.

### Tambem adicionar log no proxy para debug

No proxy (`docs/onz-proxy/index.js`), adicionar log do body enviado (sem secrets) para facilitar diagnostico futuro.

## Detalhes tecnicos

- A alteracao e minima: apenas renomear 3 campos no objeto `requestBody` na secao ONZ do `pix-auth`
- Nao afeta nenhum outro provedor (EFI, Inter, Transfeera, Paggue, Woovi)
- O proxy nao precisa de alteracao pois ele apenas repassa o body como recebido
