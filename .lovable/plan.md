

# Tags Obrigatórias + Seleção sem preencher descrição

## Problema atual

1. Ao clicar numa tag, o sistema concatena o nome da tag no campo Descrição — o usuário quer que a tag seja apenas uma **seleção** (chip marcado), sem alterar o campo de texto
2. Tags não são obrigatórias — o usuário pode prosseguir sem selecionar nenhuma

## Solução

### 1. Estado de tag selecionada — `PixKeyDialog.tsx`

- Adicionar state `selectedTagId: string | null` (apenas uma tag por vez)
- Ao clicar numa tag: marcar como selecionada (highlight visual), aplicar `receipt_required`, `suggested_classification`, `showOrderInput` e `descriptionPlaceholder` — **sem** concatenar o nome da tag no campo Descrição
- Clicar novamente na mesma tag desmarca
- Visual: tag selecionada fica com fundo sólido `bg-primary text-white`, as demais ficam `bg-primary/10`

### 2. Obrigatoriedade — `PixKeyDialog.tsx`

- No `handleStep2`, validar que `selectedTagId` não é null quando há tags disponíveis (`quickTags.length > 0`)
- Se nenhuma tag foi selecionada, exibir `toast.error("Selecione uma tag")`
- Atualizar o `disabled` do botão "Continuar" para incluir essa validação

### 3. Limpar ao desmarcar

- Ao desmarcar uma tag, resetar `receiptRequired = true`, `suggestedClassification = null`, `showOrderInput = false`, `descriptionPlaceholder` para valor padrão

## Arquivos modificados

| Arquivo | Alteração |
|---|---|
| `src/components/pix/PixKeyDialog.tsx` | State `selectedTagId`, lógica de toggle, validação obrigatória, visual de seleção |

