
# Adicionar Funcao de Remover Categorias

## O que sera feito

Adicionar um botao de lixeira (Trash) em cada linha da tabela de categorias, com um dialog de confirmacao antes de deletar permanentemente a categoria do banco de dados.

## Alteracoes

### Arquivo: `src/pages/Categories.tsx`

1. Importar o icone `Trash2` do lucide-react
2. Importar os componentes `AlertDialog` (`AlertDialog`, `AlertDialogAction`, `AlertDialogCancel`, `AlertDialogContent`, `AlertDialogDescription`, `AlertDialogFooter`, `AlertDialogHeader`, `AlertDialogTitle`)
3. Adicionar estados `deletingId` (string | null) e `confirmDeleteOpen` (boolean)
4. Criar funcao `handleDelete` que:
   - Faz `supabase.from("categories").delete().eq("id", deletingId)`
   - Mostra toast de sucesso ou erro
   - Recarrega a lista com `fetchCategories()`
5. Adicionar botao com icone `Trash2` na coluna de acoes de cada linha, ao lado dos botoes existentes (editar e ativar/desativar)
6. Adicionar um `AlertDialog` de confirmacao com mensagem "Tem certeza que deseja remover esta categoria permanentemente? Esta acao nao pode ser desfeita."

### Detalhes Tecnicos

- A tabela `categories` nao possui foreign keys apontando para ela, entao a exclusao e segura
- A politica RLS `Admins can manage categories` (comando ALL) ja permite DELETE para admins
- O dialog de confirmacao evita exclusoes acidentais
