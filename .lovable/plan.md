
# Corrigir Exibicao do Saldo em Tempo Real

## Problema Identificado

O saldo ja esta sendo buscado corretamente via `usePixBalance`, mas ha dois problemas:

1. **Provedor Transfeera**: A Transfeera nao oferece endpoint de consulta de saldo. A edge function retorna corretamente `available: false`. Neste caso, o dashboard mostra "Indisponivel" -- isso e o comportamento esperado para este provedor.

2. **OperatorDashboard ainda com dados mock**: O dashboard do operador (`OperatorDashboard.tsx`) nao usa nem `usePixBalance` nem `useDashboardData`. Continua com `mockOperatorData` hardcoded (5 transacoes, 2 pendentes, transacoes ficticias).

3. **MobileDashboard para operador sem saldo**: Quando o `OperatorDashboard` renderiza o `MobileDashboard`, nao passa nenhuma prop de saldo, o que faz com que ele fique sem dados.

## Plano de Correcao

### 1. Atualizar `OperatorDashboard.tsx`
- Remover `mockOperatorData`
- Importar e usar `useDashboardData` para transacoes reais, contagem de pendentes e pagamentos do dia
- Importar e usar `usePixBalance` para exibir o saldo real (ou "oculto" conforme regra de negocio)
- Passar todas as props necessarias ao `MobileDashboard` na versao mobile

### 2. Verificar `AdminDashboard.tsx`
- Ja esta correto. Usa `usePixBalance` e `useDashboardData`
- O saldo mostra "Indisponivel" porque a Transfeera nao suporta consulta de saldo
- Para ver um saldo real, o usuario precisa conectar um provedor que suporte saldo (Woovi, ONZ ou EFI)

## Resultado Esperado

- Com Transfeera: o saldo mostra "Indisponivel" (comportamento correto, pois a API nao oferece esse recurso)
- Com Woovi/ONZ/EFI: o saldo aparecera em tempo real com polling a cada 60 segundos
- Todos os outros dados (transacoes, custos, despesas) refletem dados reais do banco -- se estiverem zerados e porque nao ha transacoes registradas

## Detalhes Tecnicos

### Arquivo: `src/components/dashboard/OperatorDashboard.tsx`
- Importar `usePixBalance` e `useDashboardData`
- Remover constante `mockOperatorData`
- Usar `summary.transactionsToday` e `summary.pendingReceipts` nos cards de estatisticas
- Usar `recentTransactions` da hook `useDashboardData` na lista de pagamentos
- Passar `balance`, `balanceLoading`, `balanceAvailable`, `provider`, `recentTransactions`, `dataLoading` ao `MobileDashboard`
