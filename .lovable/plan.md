

## Correção: Tags Rápidas não filtradas por tipo de pagamento nos drawers mobile

### Problema identificado

1. **`PixKeyDialog.tsx`** (mobile Pix por Chave): chama `useQuickTags()` **sem** passar `"key"`, mostrando todas as tags independentemente da configuração `visible_in`.

2. **`PixCopyPasteDrawer.tsx`** (mobile Copia e Cola): não usa quick tags.

3. **`PixQrPaymentDrawer.tsx`** (mobile QR Code): não usa quick tags.

4. **`BoletoPaymentDrawer.tsx`** (mobile Boleto): não usa quick tags.

5. **`CashPaymentDrawer.tsx`** (mobile Dinheiro): não usa quick tags.

### Alterações

**1. `src/components/pix/PixKeyDialog.tsx`**
- Corrigir chamada: `useQuickTags("key")` em vez de `useQuickTags()`
- Isso filtra corretamente as tags que têm `"key"` no array `visible_in`

**2. `src/components/pix/PixCopyPasteDrawer.tsx`**
- Adicionar `useQuickTags("copy_paste")`
- Adicionar estados para tag selecionada, nº do pedido e descrição configurável
- Renderizar seção de Quick Tags + campo de descrição/pedido no step de confirmação (antes de pagar)
- Incluir tag/descrição na chamada de pagamento

**3. `src/components/pix/PixQrPaymentDrawer.tsx`**
- Adicionar `useQuickTags("qrcode")`
- Adicionar estados e UI de Quick Tags no step de confirmação
- Incluir tag/descrição na chamada de pagamento

**4. `src/components/payment/BoletoPaymentDrawer.tsx`**
- Adicionar `useQuickTags("boleto")`
- Adicionar estados e UI de Quick Tags no step de confirmação (antes de pagar)
- Incluir tag/descrição na chamada de pagamento

**5. `src/components/payment/CashPaymentDrawer.tsx`**
- Adicionar `useQuickTags("cash")`
- Adicionar estados e UI de Quick Tags no formulário
- Incluir tag/descrição na inserção da transação

### Padrão de UI reutilizado

Em cada drawer, a seção de Quick Tags seguirá o mesmo padrão visual já implementado no `PixKeyDialog` e `NewPayment`:
- Chips arredondados com seleção toggle
- Campo de descrição com placeholder configurável por tag
- Campo de Nº do Pedido condicional (quando `request_order_number = true`)
- Validação obrigatória de tag quando há tags disponíveis para o tipo

