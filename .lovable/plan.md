
# Consulta de Saldo do Provedor Pix

## Resumo
Criar uma Edge Function `pix-balance` que consulta o saldo da conta no provedor Pix configurado, e exibir esse saldo no Dashboard (substituindo o valor mock atual).

## Endpoints por Provedor

| Provedor | Endpoint | Resposta |
|----------|----------|----------|
| Woovi (OpenPix) | `GET /api/v1/subaccount/{pixKey}` | `{ SubAccount: { balance: 100 } }` (centavos) |
| ONZ Infopago | `GET /api/v2/accounts/balances/` | Retorna saldo disponivel |
| Transfeera | Sem endpoint publico de saldo na API | Sera retornado como "indisponivel" |
| EFI Pay | `GET /v2/gn/saldo/` | `{ saldo: "100.00" }` |

## Arquivos a criar/modificar

### 1. Nova Edge Function: `supabase/functions/pix-balance/index.ts`
- Recebe `company_id` no body
- Busca `pix_configs` para obter o provedor e credenciais
- Chama `pix-auth` internamente (via Supabase Functions) para obter o token
- Faz dispatch por provedor:
  - **Woovi**: `GET {base_url}/api/v1/subaccount/{pix_key}` com header `Authorization: {appID}` e retorna `balance / 100` (centavos para reais)
  - **ONZ**: `GET {base_url}/accounts/balances/` com header `Authorization: Bearer {token}`
  - **EFI**: `GET {base_url}/v2/gn/saldo/` com mTLS e header `Authorization: Bearer {token}`
  - **Transfeera**: Retorna `{ success: true, balance: null, available: false, message: "Saldo nao disponivel via API Transfeera" }`
- Resposta padronizada: `{ success: true, balance: 125430.50, provider: "woovi", available: true }`

### 2. Novo hook: `src/hooks/usePixBalance.ts`
- Hook que chama a Edge Function `pix-balance`
- Faz fetch ao montar o componente e a cada 60 segundos (polling)
- Expoe: `balance`, `isLoading`, `isAvailable`, `provider`, `refetch()`

### 3. Modificar: `src/components/dashboard/AdminDashboard.tsx`
- Importar `usePixBalance`
- Substituir `mockSummary.totalBalance` pelo saldo real do provedor
- Mostrar indicador de loading enquanto busca
- Mostrar mensagem quando saldo nao esta disponivel (ex: Transfeera)
- Mostrar nome do provedor junto ao saldo

### 4. Modificar: `src/components/dashboard/MobileDashboard.tsx`
- Receber `balance`, `isLoading`, `isAvailable` como props
- Substituir o "R$ 0,00" fixo pelo saldo real
- Mostrar skeleton/loading enquanto busca

### 5. Modificar: `src/components/dashboard/OperatorDashboard.tsx`
- Se admin, passar o saldo real para o MobileDashboard
- Operadores continuam vendo "Saldo oculto"

## Fluxo de dados

```text
Dashboard monta
  -> usePixBalance() dispara
    -> chama edge function pix-balance
      -> busca pix_configs (provedor + credenciais)
      -> chama pix-auth (obtem token)
      -> GET saldo no provedor
      -> retorna saldo normalizado
    -> atualiza state no hook
  -> Dashboard exibe saldo real
  -> polling a cada 60s atualiza
```

## Detalhes tecnicos

- A Edge Function `pix-balance` vai chamar a funcao `pix-auth` via fetch interno do Supabase para reutilizar a logica de autenticacao existente
- Para EFI, precisa mTLS (mesmo padrao do pix-auth)
- Woovi retorna valores em centavos, entao dividimos por 100
- Transfeera nao tem endpoint de saldo publico, entao retornamos gracefully
- O polling de 60s evita chamadas excessivas mas mantem o saldo atualizado
