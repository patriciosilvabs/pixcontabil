
Problema real

Do I know what the issue is? Sim.

O app está misturando duas coisas diferentes como se fossem a mesma “pendência”:

1. transação concluída sem comprovante manual;
2. transação antiga ainda `pending` porque a sincronização de status falhou.

Hoje o loop é este:
- `usePendingReceipts` inclui transações `pending` com mais de 5 minutos.
- `NewPayment` e `MobileDashboard` bloqueiam novo pagamento com base nesse total.
- o usuário é jogado para `/pix/receipt/:id`.
- `ReceiptCapture` só libera anexar se `status === completed`.
- nessa transação, `pix-check-status` está retornando `502` com detalhe `404`, então ela nunca sai de `pending`.
- resultado: bloqueio circular. O usuário não consegue anexar, nem sair do estado de espera, nem iniciar outro pagamento.

Arquivos onde o problema está concentrado
- `src/hooks/usePendingReceipts.ts`
- `src/pages/NewPayment.tsx`
- `src/components/dashboard/MobileDashboard.tsx`
- `src/components/layout/MainLayout.tsx`
- `src/pages/ReceiptCapture.tsx`
- `src/hooks/usePixPayment.ts`
- `supabase/functions/pix-check-status/index.ts`

Plano de correção

1. Separar “comprovante pendente” de “status travado”
- Refatorar `usePendingReceipts` para devolver dois grupos:
  - `blockingReceipts`: só transações `completed` com comprovante manual faltando.
  - `stuckTransactions`: transações antigas ainda `pending`, que precisam só de reconciliação de status.
- O contador que bloqueia ações deve usar apenas `blockingReceipts`.

2. Alinhar o frontend com a regra já usada no backend
- Em `NewPayment.tsx` e `MobileDashboard.tsx`, bloquear novo pagamento apenas quando houver `blockingReceipts`.
- Se houver apenas `stuckTransactions`, mostrar aviso de sincronização, não redirecionar para “Anexar comprovante”.
- Ajustar a UI para não chamar isso de “comprovante pendente” quando ainda nem existe confirmação do pagamento.

3. Tirar o usuário do loop na tela `/pix/receipt/:id`
- Em `ReceiptCapture.tsx`, substituir o spinner infinito por um estado de recuperação quando a consulta de status falhar repetidamente.
- Exibir ações explícitas:
  - “Tentar sincronizar novamente”
  - “Voltar ao início”
- Parar o polling automático após algumas falhas consecutivas, para não ficar batendo no backend sem fim.

4. Fazer a consulta de status expor erro útil
- Em `usePixPayment.ts`, parar de transformar toda falha em `null`.
- Propagar a mensagem da função de backend para a tela.
- A `ReceiptCapture` deve conseguir distinguir:
  - ainda pendente,
  - erro temporário de consulta,
  - transação não encontrada no provedor.

5. Normalizar `404` do provedor como falha final quando fizer sentido
- Em `supabase/functions/pix-check-status/index.ts`, quando a consulta por `transaction_id` receber `404` do proxy/provedor:
  - carregar a transação e verificar idade/status atual;
  - se já passou da janela inicial de processamento, atualizar a transação para `failed`;
  - salvar o payload do provedor no histórico;
  - responder com `success: true` e `internal_status: "failed"` em vez de manter `502`.
- Manter `502` só para erro real de infraestrutura (`5xx`, timeout, proxy indisponível).

6. Ajustar badges e mensagens para não induzir erro
- `MainLayout` e `MobileDashboard` hoje usam o mesmo contador para tudo.
- Separar:
  - badge de comprovante realmente pendente;
  - alerta de transação travada/sincronização pendente.

Resultado esperado
- Um pagamento anterior que falhou ou não foi localizado no provedor não trava mais o usuário na tela de anexo.
- Novo pagamento só é bloqueado quando existe realmente um comprovante manual obrigatório de uma transação concluída.
- A tela de comprovante deixa de ficar presa em “Aguardando confirmação do pagamento”.
- Transações inválidas/travadas deixam de ficar eternamente `pending`.

Detalhes técnicos importantes
- O backend já está mais correto que o frontend: as funções de pagamento bloqueiam novas saídas só para transações `completed` sem comprovante manual.
- O comentário de `usePendingReceipts` diz uma coisa, mas o código hoje mistura “completed sem comprovante” com “pending travado”; essa é a inconsistência principal.
- Atualizar `docs/ONZ_INFOPAGO_INTEGRATION.md` depois do ajuste é importante para evitar regressão futura nos fluxos de status.
