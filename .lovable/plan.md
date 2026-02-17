

## Botao "Excluir" usuario -- remocao completa do banco

### O que sera feito

Adicionar um botao "Excluir" ao lado de "Editar" e "Desativar" na tabela de usuarios. Ao clicar, um dialogo de confirmacao aparece. Ao confirmar, o usuario sera **completamente removido** do sistema (auth + todas as tabelas relacionadas).

### Arquivos a criar/modificar

#### 1. Criar `supabase/functions/delete-user/index.ts` -- Nova Edge Function

Necessaria porque deletar usuarios do auth requer `service_role_key` (Admin API).

A funcao ira:
- Verificar que o chamador e admin (mesmo padrao do `create-user`)
- Receber `user_id` no body
- Impedir que o admin delete a si mesmo
- Deletar na ordem correta (respeitar dependencias):
  1. `user_page_permissions` (where user_id)
  2. `user_roles` (where user_id)
  3. `company_members` (where user_id)
  4. `profiles` (where user_id)
  5. `supabase.auth.admin.deleteUser(user_id)` -- remove do auth (cascata)
- Retornar sucesso ou erro

#### 2. Modificar `src/pages/Users.tsx`

- Adicionar estados: `deleteDialog` (boolean), `deletingMember` (MemberRow | null), `isDeleting` (boolean)
- Adicionar funcao `handleDeleteUser`:
  - Chama a edge function `delete-user` com o `user_id`
  - Exibe toast de sucesso/erro
  - Recarrega a lista
- Adicionar botao "Excluir" (vermelho/destructive) na coluna de acoes de cada linha
- Adicionar `AlertDialog` de confirmacao com mensagem "Tem certeza? Esta acao e irreversivel"
- Impedir exclusao do proprio usuario logado

### Fluxo

```text
Admin clica "Excluir" na linha do usuario
  -> AlertDialog: "Tem certeza que deseja excluir [nome]? Esta acao e irreversivel."
  -> [Cancelar] [Excluir]
  -> Chama edge function delete-user
  -> Remove user_page_permissions, user_roles, company_members, profiles, auth.user
  -> Toast "Usuario excluido"
  -> Lista atualizada
```

