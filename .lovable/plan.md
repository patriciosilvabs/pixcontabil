
# Corrigir Navegacao Mobile para Usuarios com Permissoes Limitadas

## Problema
A usuario `julietedmb@gmail.com` tem acesso apenas a "Novo Pagamento" e "Transacoes", mas:
- A barra inferior (BottomTabBar) nao tem um tab para "Novo Pagamento"
- O tab "Home" (Dashboard) desaparece porque ela nao tem permissao, deixando apenas "Menu" e "Transacoes"
- Nao ha como acessar "Novo Pagamento" pelo mobile

## Solucao

### 1. Atualizar BottomTabBar (`src/components/layout/BottomTabBar.tsx`)
- Adicionar o tab "Novo Pagamento" com icone `PlusCircle` e pageKey `new_payment`
- Reorganizar os tabs para: Home | Novo Pagamento | Menu | Transacoes
- O filtro `hasPageAccess` ja esta implementado, entao tabs sem permissao serao ocultados automaticamente

### 2. Atualizar MobileMenu (`src/pages/MobileMenu.tsx`)
- Adicionar "Novo Pagamento" como item do menu mobile tambem, com pageKey `new_payment`
- Garantir que o usuario veja todas as paginas que tem acesso

## Detalhes Tecnicos

### BottomTabBar - Tabs atualizados
```text
Tabs disponiveis (filtrados por permissao):
- Home (/) -> pageKey: dashboard
- Novo Pagamento (/pix/new) -> pageKey: new_payment  [NOVO]
- Menu (/menu) -> sem pageKey (sempre visivel)
- Transacoes (/transactions) -> pageKey: transactions
```

### Arquivos afetados
- `src/components/layout/BottomTabBar.tsx` - adicionar tab Novo Pagamento
- `src/pages/MobileMenu.tsx` - adicionar item Novo Pagamento no menu
