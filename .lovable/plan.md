

## Mostrar descrição do pagamento no relatório diário

### Problema

No componente `DailyTransactionSummary.tsx`, linha 269, a lógica atual é:
```
t.description || t.beneficiary_name || "Sem descrição"
```
Isso mostra **apenas um** dos dois campos. O usuário quer ver a descrição personalizada que informou durante o pagamento.

### Alteração

**`src/components/reports/DailyTransactionSummary.tsx`** — reorganizar a seção de info (linhas 267-284) para:

1. **Linha principal**: `beneficiary_name` (nome do favorecido)
2. **Linha secundária**: `description` quando existir e for diferente do beneficiary_name (ex: "Pagamento de refeição produção japiim")
3. Manter categoria, classificação e autor/hora como já estão

Layout resultante por transação:
```text
Pagamento 99moto               ← beneficiary_name
Pagamento de 99moto.           ← description (se diferente)
Manutenção · Despesa           ← categoria + classificação
por AFRANIO ASSIS às 13:39     ← autor + hora
```

Se `description` for igual a `beneficiary_name` ou não existir, não duplica — mostra apenas o nome do beneficiário.

### Arquivo alterado
- `src/components/reports/DailyTransactionSummary.tsx` — seção de info do card de transação

