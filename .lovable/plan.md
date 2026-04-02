

## Problema

O `billet-check-status` envia o **payment ID** (retornado pelo `/billets/pagar`) para a rota `/status/billet/:id` do proxy. O proxy agora chama `/billets/{id}` da ONZ, que espera um **billet ID** (ID do boleto), não um **payment ID**. Por isso retorna 404.

O ID armazenado no banco (`external_id = onz:13313188`) é o ID do **pagamento**, não do boleto.

## Solução

Duas ações necessárias:

### 1. Proxy: Corrigir endpoint na rota `/status/billet/:id`

A rota deve chamar **`/billets/payments/{id}`** (status do pagamento) em vez de `/billets/{id}` (consulta do boleto):

```javascript
// ERRADO (atual):
const res = await axios.get(`${process.env.URL_CASHOUT}/billets/${id}`, ...);

// CORRETO:
const res = await axios.get(`${process.env.URL_CASHOUT}/billets/payments/${id}`, ...);
```

### 2. Edge Function `billet-check-status`: Sem alteração necessária

A edge function já extrai corretamente o payment ID do `external_id` (`onz:13313188` → `13313188`) e chama `/status/billet/13313188`. O problema é apenas no proxy que está usando o endpoint errado da ONZ.

### 3. Edge Function `billet-receipt`: Verificar consistência

A edge function chama `/recibo/billet/:id` — o proxy já usa `/billets/payments/receipt/{id}` conforme informado. Isso está correto pois usa o mesmo payment ID.

## Ação do usuário

Corrigir no proxy a rota `/status/billet/:id` para chamar `/billets/payments/:id` em vez de `/billets/:id`.

