

# Descrição Obrigatória/Opcional por Tag

## Resumo

Adicionar campo `description_required` (boolean) na tabela `quick_tags` para que o gestor escolha, ao criar/editar cada tag, se o preenchimento da descrição será obrigatório ou não. No fluxo de pagamento, validar conforme essa configuração.

## Alterações

### 1. Migration SQL
```sql
ALTER TABLE public.quick_tags
  ADD COLUMN description_required boolean NOT NULL DEFAULT true;
```

### 2. `src/hooks/useQuickTags.ts`
- Adicionar `description_required: boolean` na interface `QuickTag`
- Incluir no `createTag` e `updateTag`

### 3. `src/pages/QuickTags.tsx`
- Novo state `formDescriptionRequired` (default `true`)
- Switch no formulário: "Descrição obrigatória?"
- Passar no `createTag` / `updateTag`

### 4. `src/components/pix/PixKeyDialog.tsx`
- Ao selecionar uma tag, ler `description_required` e guardar em state
- Na validação do step (handleStep2/handleConfirm), só exigir descrição preenchida se `descriptionRequired === true`
- Indicar visualmente no campo se é obrigatório (ex: label "Descrição *" vs "Descrição (opcional)")

## Arquivos modificados

| Arquivo | Alteração |
|---|---|
| Migration SQL | `ADD COLUMN description_required boolean DEFAULT true` |
| `src/hooks/useQuickTags.ts` | Campo na interface + CRUD |
| `src/pages/QuickTags.tsx` | Switch "Descrição obrigatória" no form |
| `src/components/pix/PixKeyDialog.tsx` | Validação condicional da descrição |

