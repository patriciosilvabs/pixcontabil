

# Exigir foto para TODOS os tipos de pagamento (incluindo PIX Chave)

## Resumo

Revogar a exceção do PIX por chave digitada: agora TODAS as transações exigem foto de nota fiscal. O comprovante automático da API continua sendo gerado, mas não substitui a foto manual. A lógica de contingência (pendência impeditiva) permanece.

## Alterações

### 1. `src/hooks/usePendingReceipts.ts` — Incluir PIX key na pendência
- Remover `.neq("pix_type", "key")` da query
- Atualizar comentário do JSDoc
- Agora TODAS as transações completed sem receipt manual geram pendência

### 2. `src/hooks/useDashboardData.ts` (linha ~141) — Incluir PIX key no missingReceipts
- Remover filtro `t.pix_type !== "key"` de `eligibleForManualReceipt`

### 3. `src/pages/Transactions.tsx` (linha ~122) — Unificar verificação de receipt
- Remover tratamento especial `pix_type === "key"` — todos os tipos exigem receipt manual (`hasManualReceipt`)

### 4. `src/components/pix/PixKeyDialog.tsx` (linha ~521) — Redirecionar para captura
- Mudar `redirectToReceiptCapture={false}` para `redirectToReceiptCapture={true}`
- Após PIX por chave, redireciona para tela de comprovante (com opção de contingência)

### 5. `src/pages/NewPayment.tsx` (linha ~393) — Redirecionar para captura
- Mudar `redirectToReceiptCapture={false}` para `redirectToReceiptCapture={true}`

## Resultado
- Toda transação sem foto manual gera pendência, independente do método
- PIX por chave agora redireciona para tela de comprovante após confirmação
- Contingência continua funcionando: pode salvar sem foto, mas fica bloqueado para próxima transação

