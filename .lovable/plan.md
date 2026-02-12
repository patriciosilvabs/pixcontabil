

# Corrigir Consulta de Saldo para Transfeera

## Problema

O codigo atual na edge function `pix-balance` retorna imediatamente "Saldo nao disponivel via API Transfeera" (linhas 59-64) sem consultar a API. Porem, a documentacao oficial da Transfeera confirma que existe o endpoint:

```text
GET https://api.transfeera.com/statement/balance
```

## Correcao

### Arquivo: `supabase/functions/pix-balance/index.ts`

1. Remover o bloco que retorna "indisponivel" para Transfeera (linhas 58-64)
2. Mover a secao de autenticacao (`pix-auth`) para ANTES dos blocos de provedor, para que Transfeera tambem obtenha o token
3. Adicionar bloco Transfeera que faz `GET {base_url}/statement/balance` com header `Authorization: Bearer {access_token}`
4. Parsear a resposta para extrair o saldo disponivel

### Fluxo Corrigido

```text
1. Buscar pix_configs para a empresa
2. Obter token de autenticacao via pix-auth (para TODOS os provedores)
3. Switch por provedor:
   - transfeera: GET /statement/balance
   - woovi: GET /api/v1/subaccount/{pixKey}
   - onz: GET /accounts/balances/
   - efi: GET /v2/gn/saldo (com mTLS)
4. Retornar saldo
```

### Detalhes Tecnicos

O endpoint da Transfeera retorna o saldo da conta. O request sera:

```text
GET {base_url}/statement/balance
Authorization: Bearer {access_token}
```

O saldo sera extraido do campo retornado pela API (provavelmente `balance` ou `available`). Logs serao adicionados para registrar a resposta completa na primeira execucao, facilitando debug caso o formato seja diferente do esperado.

