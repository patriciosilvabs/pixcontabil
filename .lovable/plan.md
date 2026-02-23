

# Corrigir exibicao do saldo ONZ no Dashboard

## Problema identificado

Os logs mostram claramente o bug:

```
ONZ response: [{"eventDate":"...","balanceAmount":{"currency":"BRL","available":56.22,...}}]
Balance: 0
```

A API ONZ retorna um **array** de objetos, onde o saldo esta dentro de `balanceAmount.available`. O codigo atual (linha 265) faz:

```javascript
balance = parseFloat(data?.available ?? data?.balance ?? data?.saldo ?? '0');
```

Isso resulta em `parseFloat('0')` porque `data` e um array, nao tem propriedade `available`.

## Correcao

Alterar a linha 265 do arquivo `supabase/functions/pix-balance/index.ts` para extrair o saldo corretamente da estrutura retornada pela API ONZ v2:

```javascript
// Se data for array, pegar o primeiro elemento
const balanceEntry = Array.isArray(data) ? data[0] : data;
balance = parseFloat(
  balanceEntry?.balanceAmount?.available 
  ?? balanceEntry?.available 
  ?? balanceEntry?.balance 
  ?? balanceEntry?.saldo 
  ?? '0'
);
```

## Resultado esperado

O saldo de R$ 56,22 sera exibido corretamente no card do Dashboard, tanto na versao desktop quanto mobile.

## Arquivos alterados

- `supabase/functions/pix-balance/index.ts` (linha 265) - corrigir parsing da resposta ONZ

## Deploy

A funcao `pix-balance` sera reimplantada automaticamente apos a alteracao.
