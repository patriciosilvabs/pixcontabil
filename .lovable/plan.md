

# Inteligência de Tags — Dispensa de Comprovante por Tag

## Resumo

Adicionar campo `receipt_required` à tabela `quick_tags` e usá-lo para dispensar automaticamente a obrigatoriedade de foto em transações marcadas com tags que não exigem comprovante (ex: "Troco Cliente"). Isso elimina pendências eternas para pagamentos triviais.

## 1. Banco de Dados — Migration

```sql
ALTER TABLE public.quick_tags
  ADD COLUMN receipt_required boolean NOT NULL DEFAULT true;
```

Adicionar também a coluna `receipt_required` na tabela `transactions` para registrar a decisão no momento do pagamento:

```sql
ALTER TABLE public.transactions
  ADD COLUMN receipt_required boolean NOT NULL DEFAULT true;
```

## 2. Admin — `QuickTags.tsx` + `useQuickTags.ts`

- Adicionar checkbox "Exige Comprovante (Foto)" no formulário de criação/edição de tags (default: true)
- Atualizar o hook `useQuickTagsAdmin` para incluir o novo campo em `createTag` e `updateTag`
- Atualizar a interface `QuickTag` com o campo `receipt_required`

## 3. Fluxo de Pagamento — `PixKeyDialog.tsx`

- Rastrear no state se a tag selecionada tem `receipt_required = false`
- Passar essa informação para `handleConfirmRealPayment`
- Ao enviar o pagamento, incluir `receipt_required` nos dados enviados ao backend (via description metadata ou campo direto na transação)
- Após pagamento confirmado, se `receipt_required = false`: marcar `classified_at = now()` na transação via UPDATE direto

## 4. Tela de Status — `PaymentStatusScreen.tsx`

- Adicionar prop `skipReceiptCapture?: boolean`
- Quando `skipReceiptCapture = true` e status é "completed": NÃO mostrar botão "Anexar Comprovante", mostrar apenas "Voltar ao Início"
- Aplicar em todos os callers: `PixKeyDialog`, `PixCopyPasteDrawer`, `PixQrPaymentDrawer`, `NewPayment`

## 5. Pendências — `usePendingReceipts.ts`

- Alterar a query de transações completadas para filtrar apenas `receipt_required = true`
- Adicionar `.eq("receipt_required", true)` nas duas queries (completed e stuck)

## 6. Edge Functions — Server-side pendency check

Atualizar as 4 edge functions (`pix-pay-dict`, `pix-pay-qrc`, `billet-pay`, `batch-pay`) para incluir `.eq("receipt_required", true)` no check de pendências server-side, garantindo que transações dispensadas não bloqueiem novos pagamentos.

## Arquivos modificados

| Arquivo | Alteração |
|---|---|
| Migration SQL | `ALTER TABLE quick_tags ADD COLUMN receipt_required`; `ALTER TABLE transactions ADD COLUMN receipt_required` |
| `src/hooks/useQuickTags.ts` | Incluir `receipt_required` na interface e CRUD |
| `src/pages/QuickTags.tsx` | Checkbox "Exige Comprovante" no form |
| `src/components/pix/PixKeyDialog.tsx` | Rastrear `receipt_required` da tag selecionada, passar para status screen, marcar transação como dispensada |
| `src/components/pix/PaymentStatusScreen.tsx` | Nova prop `skipReceiptCapture`, condicionar botão "Anexar Comprovante" |
| `src/components/pix/PixCopyPasteDrawer.tsx` | Passar `skipReceiptCapture` quando aplicável |
| `src/components/pix/PixQrPaymentDrawer.tsx` | Passar `skipReceiptCapture` quando aplicável |
| `src/pages/NewPayment.tsx` | Passar `skipReceiptCapture` quando aplicável |
| `src/hooks/usePendingReceipts.ts` | Filtrar `.eq("receipt_required", true)` |
| `supabase/functions/pix-pay-dict/index.ts` | Filtrar `receipt_required = true` na pendency check |
| `supabase/functions/pix-pay-qrc/index.ts` | Idem |
| `supabase/functions/billet-pay/index.ts` | Idem |
| `supabase/functions/batch-pay/index.ts` | Idem |

## Resultado esperado

- Tags como "Troco Cliente" dispensam foto automaticamente
- Transações dispensadas não geram pendência e não bloqueiam novos pagamentos
- Tela de confirmação mostra apenas "Voltar ao Início" para transações dispensadas
- Admin controla quais tags exigem ou não comprovante

