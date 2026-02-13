

# Corrigir Exibicao de Status nas Transacoes

## O Que Significa "Pendente"

O badge "Pendente" se refere ao **status do pagamento** (campo `status` na tabela `transactions`), e nao ao comprovante anexado. Os status possiveis sao:

- **Concluido**: pagamento confirmado pelo provedor Pix
- **Pendente**: pagamento ainda nao confirmado
- **Falhou**: pagamento rejeitado
- **Cancelado**: pagamento cancelado

Anexar um comprovante nao altera esse status. Sao informacoes independentes.

## Problema Identificado

As transacoes estao sendo criadas com status `pending` e nunca sao atualizadas para `completed`, mesmo apos o pagamento ser processado. Isso pode significar que:

1. O fluxo de pagamento Pix nao esta atualizando o status da transacao apos confirmacao
2. Ou o webhook de confirmacao nao esta funcionando

## Solucao Proposta

Duas acoes:

### 1. Atualizar transacoes existentes

Executar uma query para marcar como `completed` as transacoes que ja possuem comprovante anexado (indicando que o pagamento foi de fato realizado):

```sql
UPDATE transactions 
SET status = 'completed', paid_at = NOW()
WHERE id IN (SELECT DISTINCT transaction_id FROM receipts)
AND status = 'pending';
```

### 2. Atualizar o fluxo de captura de comprovante

No arquivo `src/pages/ReceiptCapture.tsx`, ao salvar um comprovante com sucesso, tambem atualizar o status da transacao para `completed` (ja que o usuario esta confirmando que o pagamento foi feito ao anexar o comprovante):

```
await supabase.from("transactions")
  .update({ status: "completed", paid_at: new Date().toISOString() })
  .eq("id", transactionId);
```

Isso faz sentido porque no fluxo do sistema, o usuario so anexa comprovante apos confirmar que o pagamento foi realizado.

### Resultado Esperado

- Transacoes com comprovante anexado mostrarao "Concluido" (badge verde)
- Transacoes sem comprovante continuarao como "Pendente" com o botao "Anexar"
- A filtragem por status `pending` mostrara apenas transacoes que realmente precisam de acao

