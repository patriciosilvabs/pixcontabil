

# Remover polling de saldo e adicionar botão manual de atualização

## Resumo

Remover o `setInterval` de 60s do `usePixBalance` e adicionar um botão de "Atualizar Saldo" nos cards de saldo (mobile e desktop). O saldo só será buscado na montagem inicial e quando o usuário clicar no botão.

## Alterações

### 1. `src/hooks/usePixBalance.ts`

- Remover o `setInterval` do `useEffect` — manter apenas a chamada inicial `fetchBalance()`
- Adicionar estado `isRefetching` para diferenciar loading inicial de refresh manual
- Expor `isRefetching` no retorno do hook

### 2. `src/components/dashboard/MobileDashboard.tsx` — Card de saldo mobile

- Adicionar prop `onRefreshBalance` e `balanceRefetching`
- Ao lado do título "Saldo Disponível", adicionar um botão com ícone `RefreshCw` que chama `onRefreshBalance`
- Mostrar ícone girando (`animate-spin`) quando `balanceRefetching` for true

### 3. `src/components/dashboard/AdminDashboard.tsx` — Card de saldo desktop

- Obter `refetch` e `isRefetching` do `usePixBalance()`
- No card de saldo desktop, adicionar botão `RefreshCw` similar ao mobile
- Passar `onRefreshBalance={refetch}` e `balanceRefetching={isRefetching}` para `MobileDashboard`

## Resultado

- Zero chamadas automáticas de saldo após o carregamento inicial
- Usuário com permissão `can_view_balance` atualiza manualmente clicando no botão
- Redução significativa no consumo de Edge Functions

