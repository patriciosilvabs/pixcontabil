

# Corrigir delete-user e garantir CRUD completo de usuários

## Problema

A edge function `delete-user` retorna 400. A causa provável é que ela não limpa a tabela `user_feature_permissions` antes de deletar o usuário (essa tabela tem FK implícita via user_id), e a tabela `profiles` não permite DELETE via RLS (mesmo com service role, convém garantir). Além disso, o `adminClient.auth.admin.deleteUser` pode falhar se ainda houver registros dependentes.

## Correções

### 1. Edge Function `delete-user/index.ts`

Adicionar limpeza de `user_feature_permissions` antes das outras tabelas, e adicionar logs para diagnóstico:

```
await adminClient.from("user_feature_permissions").delete().eq("user_id", user_id);
await adminClient.from("user_page_permissions").delete().eq("user_id", user_id);
await adminClient.from("user_roles").delete().eq("user_id", user_id);
await adminClient.from("company_members").delete().eq("user_id", user_id);
await adminClient.from("profiles").delete().eq("user_id", user_id);
```

Também adicionar `console.log` em pontos estratégicos para facilitar debug futuro.

### 2. Verificação do CRUD existente

O CRUD atual já cobre:
- **Create**: `create-user` edge function + dialog "Adicionar" ✅
- **Read**: `fetchMembers` com listagem em tabela ✅
- **Update**: `handleSave` com edição de role, limite, permissões ✅
- **Delete**: `delete-user` edge function + dialog de confirmação ✅ (com bug)

O sistema já tem CRUD completo — o problema é apenas o bug no delete. A correção é adicionar a limpeza da tabela `user_feature_permissions` que foi criada depois da função de delete.

### Arquivos alterados

| Arquivo | Alteração |
|---|---|
| `supabase/functions/delete-user/index.ts` | Adicionar delete de `user_feature_permissions` + logs de diagnóstico |

