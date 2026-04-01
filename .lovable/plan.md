

# Placeholder Customizável por Tag

## Resumo

Adicionar campo `description_placeholder` à tabela `quick_tags` para que o admin defina um texto orientativo (ex: "Digite o nome do motoboy") que aparece no campo Descrição quando a tag é selecionada no fluxo de pagamento.

## 1. Banco de Dados — Migration

```sql
ALTER TABLE public.quick_tags
  ADD COLUMN description_placeholder text DEFAULT NULL;
```

## 2. Admin — `QuickTags.tsx` + `useQuickTags.ts`

- Adicionar campo `description_placeholder` à interface `QuickTag`
- Adicionar input "Placeholder da Descrição" no formulário de criar/editar tag, com hint: "Texto de orientação exibido no campo Descrição ao usar esta tag"
- Incluir no `createTag` e `updateTag`

## 3. Fluxo de Pagamento — `PixKeyDialog.tsx`

- Criar state `descriptionPlaceholder` (default: `"Ex: Pagamento fornecedor"`)
- Ao clicar numa tag que tenha `description_placeholder` preenchido, atualizar o placeholder do `<Textarea>` de descrição com esse valor
- Se múltiplas tags forem clicadas, usar o placeholder da última tag que tem o campo preenchido

## Arquivos modificados

| Arquivo | Alteração |
|---|---|
| Migration SQL | `ADD COLUMN description_placeholder text` |
| `src/hooks/useQuickTags.ts` | Campo na interface + CRUD |
| `src/pages/QuickTags.tsx` | Input "Placeholder da Descrição" no form |
| `src/components/pix/PixKeyDialog.tsx` | Placeholder dinâmico no Textarea |

