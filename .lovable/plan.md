

# Remover Tags dos Fluxos QR Code e Copia e Cola

## Resumo

Tags devem aparecer **apenas** no fluxo Pix por Chave (`PixKeyDialog`). Os drawers de QR Code e Copia e Cola devem ter toda a lógica de tags removida, voltando ao comportamento simples (descrição livre, sempre exige comprovante).

## Alterações

### 1. `src/components/pix/PixCopyPasteDrawer.tsx`

- Remover import e uso de `useQuickTags`
- Remover states: `selectedTagId`, `descriptionPlaceholder`, `orderNumber`, `showOrderInput`, `receiptRequired`
- Remover seção de Quick Tags e Nº do Pedido do Step 3
- Remover validação de tag obrigatória no `handleConfirm`
- Manter campo Descrição com placeholder fixo `"Ex: Pagamento fornecedor"`
- `receiptRequired` volta a ser sempre `true` (hardcoded)
- Remover atualização de `receipt_required` no update da transaction (sempre true)

### 2. `src/components/pix/PixQrPaymentDrawer.tsx`

- Mesmas remoções: `useQuickTags`, states de tag, UI de tags, validação de tag
- Descrição com placeholder fixo, `receiptRequired` sempre `true`

## Arquivos modificados

| Arquivo | Alteração |
|---|---|
| `src/components/pix/PixCopyPasteDrawer.tsx` | Remover toda lógica de tags |
| `src/components/pix/PixQrPaymentDrawer.tsx` | Remover toda lógica de tags |

