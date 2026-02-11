

# Atualizar autenticacao ONZ para suportar ambos os formatos

## Contexto
A documentacao da ONZ (`accounts-api_2.yaml`) revelou que:
1. O campo `clientId` deve ter **formato UUID**, nao CNPJ
2. A API suporta dois Content-Types: `application/json` (camelCase) e `application/x-www-form-urlencoded` (snake_case)

O erro `onz-0001` pode estar ocorrendo porque o `clientId` armazenado no banco nao esta no formato correto (UUID).

## Mudancas

### 1. Atualizar `supabase/functions/pix-auth/index.ts`
- Tentar autenticacao primeiro com `application/json` (camelCase) -- formato atual
- Se falhar com erro `onz-0001`, tentar automaticamente com `application/x-www-form-urlencoded` (snake_case: `client_id`, `client_secret`, `grant_type`)
- Adicionar log indicando qual formato funcionou para facilitar debug futuro

### 2. Atualizar `src/pages/settings/PixIntegration.tsx`
- Adicionar texto de ajuda no campo `Client ID` informando que deve estar no **formato UUID** (ex: `xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx`)
- Adicionar validacao basica de formato UUID no campo antes de salvar

## Detalhes Tecnicos

### Fallback de formato no pix-auth:

```text
// Tentativa 1: JSON com camelCase (formato principal da ONZ)
POST /oauth/token
Content-Type: application/json
{ "clientId": "...", "clientSecret": "...", "grantType": "client_credentials", "scope": "..." }

// Se falhar com onz-0001, Tentativa 2: form-urlencoded com snake_case
POST /oauth/token
Content-Type: application/x-www-form-urlencoded
client_id=...&client_secret=...&grant_type=client_credentials&scope=...
```

### Arquivos afetados
1. `supabase/functions/pix-auth/index.ts` - Adicionar fallback de formato
2. `src/pages/settings/PixIntegration.tsx` - Hint de UUID e validacao

