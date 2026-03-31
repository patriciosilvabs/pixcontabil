

# Corrigir tela branca após várias transações

## Diagnóstico

O erro `"Should have a queue"` é um bug interno do React que ocorre quando o estado dos hooks fica corrompido — geralmente após navegações intensas ou acúmulo de estado em memória. O problema é agravado porque o projeto **não possui ErrorBoundary** — qualquer crash no React resulta em tela branca irrecuperável, obrigando o usuário a recarregar manualmente.

Fatores contribuintes:
- **Sem ErrorBoundary**: crash em qualquer componente = tela branca total
- **Cache em memória no `useDashboardData`**: variável global `dashboardCache` acumula dados entre navegações
- **`OperatorDashboard` ainda instancia `usePixBalance` sem usar refetch**: chamada desnecessária de Edge Function

## Alterações

### 1. Criar `src/components/ErrorBoundary.tsx`

- Class component com `componentDidCatch` que captura erros de renderização
- Exibe mensagem amigável ("Algo deu errado") com botão "Recarregar página"
- Faz `window.location.reload()` ao clicar

### 2. Envolver o app com ErrorBoundary em `src/App.tsx`

- Adicionar `<ErrorBoundary>` ao redor das `<Routes>` dentro do `<Suspense>`
- Garante que qualquer crash mostra tela de recuperação em vez de branco

### 3. Limpar cache do dashboard ao navegar para fora

- Em `useDashboardData`, chamar `invalidateDashboardCache()` no cleanup do `useEffect` (return) para evitar acúmulo de dados stale
- Reduzir TTL do cache de 3 min para 1 min

### 4. Corrigir `OperatorDashboard` — remover `usePixBalance` quando não há `canViewBalance`

- Só chamar `usePixBalance()` quando o operador tem permissão de ver saldo (mover para condicional ou lazy)

## Resultado

- Crashes do React mostram tela de recuperação com botão de recarregar (nunca mais tela branca)
- Menor acúmulo de memória no cache do dashboard
- Menos chamadas desnecessárias de Edge Functions para operadores sem permissão de saldo

