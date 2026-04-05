

## Adicionar Ticket Médio ao Relatório

### Contexto

Atualmente o relatório mostra apenas totais (Saídas, Custos, Despesas). O usuário quer ver o **ticket médio** — o valor médio por transação.

Como o sistema registra apenas pagamentos (saídas), o ticket médio será calculado por classificação:

- **Ticket Médio Geral**: total de saídas / quantidade de transações
- **Ticket Médio Custos**: total custos / quantidade de transações de custo
- **Ticket Médio Despesas**: total despesas / quantidade de transações de despesa

### Alteração

**`src/pages/Reports.tsx`** — adicionar uma segunda linha de cards abaixo dos totais existentes (linha ~216), com 3 novos cards mostrando os tickets médios.

Cálculos a adicionar (após linha 124):
```
ticketMedioGeral = totalAmount / filteredTransactions.length
ticketMedioCustos = totalCosts / qtdCustos
ticketMedioDespesas = totalExpenses / qtdDespesas
```

Layout: grid de 3 cards com ícone, label "Ticket Médio [tipo]" e valor formatado em R$.

### Arquivo alterado
- `src/pages/Reports.tsx`

