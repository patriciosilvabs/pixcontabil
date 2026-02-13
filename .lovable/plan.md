
# Corrigir Consulta de Saldo para Todos os Provedores

## Problema Identificado

Ao trocar para Woovi (OpenPix), o saldo aparece como R$ 0,00 porque:

1. O endpoint de saldo da Woovi esta errado no codigo: usa `/api/v1/subaccount/{pixKey}` (subconta), mas o correto e `/api/v1/balance` (saldo da conta principal)
2. O campo `pix_key` esta vazio na configuracao atual, o que gera uma URL invalida

## Correcao

### Arquivo: `supabase/functions/pix-balance/index.ts`

Corrigir o bloco Woovi para usar o endpoint correto da API OpenPix:

**De (errado):**
```
const pixKey = config.pix_key;
const balanceUrl = `${config.base_url}/api/v1/subaccount/${encodeURIComponent(pixKey)}`;
// Header: Authorization: accessToken
```

**Para (correto):**
```
const balanceUrl = `${config.base_url}/api/v1/balance`;
// Header: Authorization: accessToken
```

A resposta da API OpenPix retorna o saldo no campo `balance.total` ou `balance.available` (em centavos). Ajustar o parse para buscar o campo correto e dividir por 100.

**Mudanca no parse:**
```
// Antes:
balance = (data?.SubAccount?.balance ?? data?.subAccount?.balance ?? 0) / 100;

// Depois:
balance = (data?.balance?.available ?? data?.balance?.total ?? 0) / 100;
```

### Arquivo unico alterado

Apenas `supabase/functions/pix-balance/index.ts` precisa ser corrigido. Nenhuma alteracao no frontend, pois o hook `usePixBalance` ja trata a resposta corretamente.

### Validacao dos 3 provedores no mesmo codigo

Apos a correcao, o fluxo de cada provedor sera:

- **Transfeera**: `GET /statement/balance` -- campo `value` (ja funciona, retorna R$ 11,91)
- **Woovi**: `GET /api/v1/balance` -- campo `balance.available` em centavos, dividido por 100
- **ONZ**: `GET /accounts/balances/` -- campo `available` (ja implementado)
- **EFI**: `GET /v2/gn/saldo` -- campo `saldo` com mTLS (ja implementado)
