

# Tags = Sem Comprovante Manual

## Resumo

Quando uma Quick Tag é utilizada na transação, o comprovante manual (foto de NF) não deve ser exigido. O auto-comprovante da API é suficiente. Isso se aplica a **todas** as tags, pois representam pagamentos a pessoas físicas (motoboy, gás, etc.) onde não há nota fiscal.

## Alterações

### 1. `src/components/pix/PixKeyDialog.tsx`
- Quando qualquer tag é selecionada, forçar `receiptRequired = false` (ignorar o campo `receipt_required` da tag)
- Remover lógica que lê `tag.receipt_required` para definir `receiptRequired`

### 2. `src/pages/NewPayment.tsx`
- Mesma lógica: ao selecionar uma tag, forçar `receiptRequired = false`

### 3. `src/pages/QuickTags.tsx` (admin)
- Remover o switch "Exige Comprovante" (`receipt_required`) do formulário de criação/edição de tags, já que agora todas as tags dispensam comprovante por definição

### 4. Comportamento resultante
- Após pagamento confirmado, a tela de status mostra apenas "Voltar ao Início" (sem botão "Anexar Comprovante")
- A transaction é salva com `receipt_required = false`
- O auto-comprovante da API permanece acessível normalmente

## Arquivos modificados

| Arquivo | Alteração |
|---|---|
| `src/components/pix/PixKeyDialog.tsx` | Tag selecionada → `receiptRequired = false` sempre |
| `src/pages/NewPayment.tsx` | Idem |
| `src/pages/QuickTags.tsx` | Remover switch "Exige Comprovante" |

