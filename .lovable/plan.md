

# Corrigir acesso de operadores a pagamentos no desktop

## Problema

Operadores não conseguem acessar a página de pagamento (`/pix/new`) no desktop. A causa raiz está na função `hasPageAccess` no `AuthContext`:

```typescript
// Código atual
const hasPageAccess = (pageKey: string): boolean => {
  if (!permissionsLoaded) return false;
  if (isAdmin) return true;
  return pagePermissions.includes(pageKey); // ← PROBLEMA
};
```

Quando um operador **não tem nenhum registro** na tabela `user_page_permissions`, o array `pagePermissions` fica vazio e `includes("new_payment")` retorna `false`. O `AuthGuard` redireciona o operador para `/` antes mesmo de carregar a página.

Compare com `hasFeatureAccess` que **já tem a lógica correta**:

```typescript
const hasFeatureAccess = (featureKey: string): boolean => {
  if (isAdmin) return true;
  if (featurePermissions.length === 0) return true; // ← sem restrição = acesso total
  return featurePermissions.includes(featureKey);
};
```

## Correção

Aplicar a mesma lógica em `hasPageAccess`: se nenhuma permissão de página foi configurada para o operador (array vazio), ele tem acesso total por padrão.

### `src/contexts/AuthContext.tsx`

Na função `hasPageAccess` (~linha 263), adicionar a verificação de array vazio:

```typescript
const hasPageAccess = useCallback((pageKey: string): boolean => {
  if (!permissionsLoaded) return false;
  if (isAdmin) return true;
  if (pagePermissions.length === 0) return true; // sem restrição = acesso total
  return pagePermissions.includes(pageKey);
}, [isAdmin, pagePermissions, permissionsLoaded]);
```

Nenhuma outra alteração necessária.

