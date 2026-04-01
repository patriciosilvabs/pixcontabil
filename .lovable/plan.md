

# Fluxo de Classificação com Contingência e Trava de Pendência

## Resumo

Implementar: (1) PIX por chave digitada pula obrigatoriedade de foto, (2) contingência permite salvar sem foto mas cria pendência, (3) trava impede nova transação com 1+ pendência, (4) badge de pendência no header.

## O que já existe

- `pix_type === "key"` já pula a tela de receipt (memória receipt-skip-logic)
- `useDashboardData` já calcula `missingReceipts` filtrando `pix_type !== "key"`
- `classificar_insumo` / `classificar_despesa` já existem nas feature_permissions
- `ReceiptCapture.tsx` já tem lógica de classificação granular

## Alterações

### 1. `src/pages/ReceiptCapture.tsx` — Contingência (pular foto)

- Adicionar botão "Salvar sem comprovante" quando `pix_type !== "key"` (boleto, cash, copy_paste, qrcode)
- Ao clicar, salvar apenas a classificação (custo/despesa + subcategoria) sem foto obrigatória
- A transação fica marcada como "sem comprovante manual" — já está rastreada em `missingReceipts`
- Remover o texto "Você não pode sair desta tela sem anexar" e substituir por aviso de pendência
- Buscar o `pix_type` da transação para decidir se mostra ou não a opção

### 2. `src/pages/NewPayment.tsx` — Trava de pendência antes de novo pagamento

- No `useEffect` inicial (ou antes de executar pagamento), consultar `missingReceipts` ou fazer query direta: transações `completed` do usuário atual sem receipt manual (`pix_type !== 'key'`)
- Se houver 1+ pendência, bloquear e redirecionar para `/pix/receipt/{pending_tx_id}`
- Mostrar toast explicativo: "Finalize o comprovante da transação anterior antes de iniciar uma nova"

### 3. `src/components/dashboard/MobileDashboard.tsx` — Badge de pendência

- Se `missingReceipts.length > 0`, exibir badge discreto "⚠ X pendência(s)" no topo do dashboard ou junto ao card de ações rápidas
- Ao clicar, redirecionar para o primeiro comprovante pendente

### 4. `src/components/layout/MobileHeader.tsx` — Indicador no header

- Receber `pendingReceiptsCount` como prop
- Se > 0, mostrar um badge vermelho/warning pequeno junto ao ícone de notificação (Bell)

### 5. `src/components/pix/PaymentStatusScreen.tsx` — Ajuste para contingência

- Para `pix_type === 'key'`: manter comportamento atual (não redireciona para receipt)
- Para outros tipos: manter redirecionamento para receipt, mas agora o receipt permite "salvar sem foto"

### 6. `src/components/pix/PixKeyDialog.tsx` + `BoletoPaymentDrawer.tsx` + `CashPaymentDrawer.tsx`

- Passar a informação de pendências para os drawers de pagamento mobile
- Se houver pendência, ao tentar abrir novo pagamento, bloquear e redirecionar

## Detalhes técnicos

- Query de pendência: `transactions` com `status = 'completed'`, `pix_type != 'key'`, `created_by = user.id`, sem receipt manual (LEFT JOIN receipts WHERE ocr_data->auto_generated IS DISTINCT FROM true)
- A trava verifica pendência no momento de iniciar pagamento, não bloqueia navegação geral
- O `pix_type` da transação é determinado no momento da criação e já está armazenado corretamente no banco (`key`, `copy_paste`, `boleto`, `cash`)

## Resultado

- PIX por chave digitada: zero obrigatoriedade de foto (já funciona)
- Outros pagamentos: foto não é mais bloqueante, mas gera pendência
- Com 1+ pendência: operador não pode iniciar novo pagamento até resolver
- Badge visual discreto avisa sobre pendências

