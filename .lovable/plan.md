

# Corrigir Parsing do Saldo Transfeera

## Problema

A API da Transfeera retorna o saldo no campo `value`, mas o codigo atual tenta ler `balance`, `available` ou `amount` -- nenhum deles existe na resposta. Por isso o saldo sempre retorna 0.

Resposta real da API:
```text
{"value": 51.72, "waiting_value": 0}
```

Codigo atual:
```text
balance = parseFloat(data?.balance ?? data?.available ?? data?.amount ?? '0');
```

## Correcao

### Arquivo: `supabase/functions/pix-balance/index.ts`

Alterar a linha de parsing do saldo Transfeera para incluir o campo `value` como primeira opcao:

```text
balance = parseFloat(data?.value ?? data?.balance ?? data?.available ?? data?.amount ?? '0');
```

Isso e uma correcao de uma unica linha.

