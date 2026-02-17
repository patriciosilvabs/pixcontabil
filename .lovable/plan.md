

## Ocultar card de saldo completamente quando sem permissao

### Problema

Atualmente, quando `canViewBalance` e `false`, o sistema mostra um card placeholder com "---" e "Saldo oculto". O correto e nao mostrar nenhum card de saldo.

### Alteracoes

#### 1. `src/components/dashboard/AdminDashboard.tsx`

- Linhas 96-130: Remover o bloco `else` (card com "---") e renderizar o card de saldo apenas quando `canViewBalance` e `true`
- O grid de 4 cards continuara funcionando normalmente com 3 cards quando o saldo estiver oculto

#### 2. `src/components/dashboard/OperatorDashboard.tsx`

- Linhas 87-119: Remover o bloco `else` (card com "---" e "Saldo oculto para operadores") e renderizar apenas quando `canViewBalance` e `true`

#### 3. `src/components/dashboard/MobileDashboard.tsx`

- Linhas 72-92: Envolver o card de saldo inteiro em `{canViewBalance && (...)}` para que ele nao apareca quando a permissao estiver desativada

### Resultado

Sem permissao de saldo, o card simplesmente nao aparece no dashboard -- nenhum indicativo visual de que existe um saldo.

