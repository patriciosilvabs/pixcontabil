

# Puxar valor correto com juros antes do pagamento (ONZ)

## Problema

Para o provedor ONZ, a API **não possui endpoint de consulta de boleto**. Atualmente o sistema faz parsing local do código de barras (extrai valor original e vencimento), mas não consegue mostrar o valor atualizado com juros/multa antes do pagamento.

## Solução: Usar `paymentFlow: 'APPROVAL_REQUIRED'`

A API ONZ suporta dois fluxos: `INSTANT` (executa imediatamente) e `APPROVAL_REQUIRED` (cria o pagamento pendente sem executar). Ao usar `APPROVAL_REQUIRED` na etapa de consulta, a ONZ retorna o valor ajustado (com juros e multa) sem efetuar o pagamento.

### Fluxo proposto

```text
[1] Usuário escaneia boleto
        │
[2] billet-consult (ONZ)
    POST /billets/payments  { paymentFlow: "APPROVAL_REQUIRED" }
    → ONZ retorna valor ajustado + billet ID
        │
[3] Frontend exibe valor com juros para confirmação
        │
[4] billet-pay (ONZ)
    POST /billets/payments  { paymentFlow: "INSTANT" }  (novo pagamento)
    → Pagamento executado com o valor correto
```

O pagamento APPROVAL_REQUIRED criado na consulta ficará pendente e expirará automaticamente (não é executado).

## Alterações

### 1. `supabase/functions/billet-consult/index.ts` (ONZ path)

- Em vez de apenas parsing local, chamar `POST {base_url}/billets/payments` com `paymentFlow: 'APPROVAL_REQUIRED'` e o digitableCode
- Extrair da resposta ONZ: `amount` (valor ajustado com juros), `payment.amount`, `dueDate`, `creditor`
- Retornar `total_updated_value` com o valor ajustado da ONZ, `value` com o valor original do parser local, e `fine_value`/`interest_value` se disponíveis
- Manter o fallback do parser local caso a chamada falhe (por ex. boleto de convênio)
- Retornar `recipient_name` e `recipient_document` do creditor da ONZ

### 2. `src/components/payment/BoletoPaymentDrawer.tsx`

- Remover o warning genérico de "juros serão calculados automaticamente" (não será mais necessário pois o valor já virá correto)
- Quando `total_updated_value` existir e for diferente de `value`, mostrar o valor original, o acréscimo (juros+multa), e o valor final atualizado
- Calcular `interest+fine = total_updated_value - value` quando os campos individuais não vierem separados

### 3. `src/hooks/useBilletPayment.ts`

- Adicionar campos `is_overdue`, `provider`, `note` ao tipo `BilletConsultResult` para consistência com o que o backend retorna

## Resultado

- Boletos vencidos mostram o **valor real com juros** calculado pela ONZ antes da confirmação
- Usuário vê breakdown: valor original + encargos = valor final
- Boletos em dia continuam funcionando normalmente (valor original = valor ajustado)

