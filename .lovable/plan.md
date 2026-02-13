
# Corrigir Permissoes e Isolamento de Dados

## Problemas Identificados

1. **Configuracoes aparecendo sem permissao**: A pagina "Menu" no mobile mostra "Configuracoes" para todos os usuarios, sem verificar se o usuario tem acesso.

2. **Menu mobile nao filtra por permissoes**: O menu mobile so verifica se o usuario e admin, mas nao usa `hasPageAccess` para filtrar os itens visiveis para operadores.

3. **Historico mostrando dados de outros usuarios**: A pagina de Transacoes busca todas as transacoes da empresa (`company_id`), sem filtrar por `created_by` para operadores. Apenas admins devem ver todas as transacoes.

## Plano de Implementacao

### 1. Corrigir MobileMenu.tsx
- Importar `hasPageAccess` do `useAuth`
- Filtrar os itens do menu usando `hasPageAccess` para cada item que tenha um `pageKey`
- Adicionar `pageKey` aos itens do menu (ex: `settings` para Configuracoes)
- Manter "Configuracoes" condicionada a `hasPageAccess("settings")`

### 2. Corrigir Transactions.tsx - Isolamento de dados por usuario
- Importar `isAdmin` e `user` do `useAuth`
- Para operadores: adicionar filtro `.eq("created_by", user.id)` na query
- Para admins: manter a query atual (ver todas as transacoes da empresa)

### 3. Revisar MainLayout.tsx (sidebar desktop)
- Ja esta usando `hasPageAccess` corretamente na sidebar - nenhuma alteracao necessaria.

## Detalhes Tecnicos

### MobileMenu.tsx - Mudancas
```text
- Adicionar pageKey a cada item de menu
- Usar hasPageAccess para filtrar itens
- Operadores verao apenas itens que tem permissao
```

### Transactions.tsx - Mudancas
```text
- Se isAdmin: query por company_id (todas da empresa)
- Se operador: query por company_id + created_by = user.id (so as proprias)
```

### Arquivos afetados
- `src/pages/MobileMenu.tsx`
- `src/pages/Transactions.tsx`
