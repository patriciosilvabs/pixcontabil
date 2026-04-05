

## Ticket Médio de Entrada e Saída no Relatório

### Situação atual

- A tabela `transactions` registra **apenas saídas** (pagamentos feitos).
- O saldo (`pix-balance`) retorna um valor único, sem detalhamento de entradas.
- Os webhooks PIX recebem notificações de entrada, mas ficam apenas em `webhook_events` como logs brutos — não são processados como transações de crédito.

### O que precisa ser feito

#### 1. Criar suporte a transações de entrada no banco

- Adicionar coluna `direction` (tipo `text`, valores `in` / `out`, default `out`) na tabela `transactions`.
- Migrar dados existentes: todas as transações atuais recebem `direction = 'out'`.

#### 2. Processar webhooks de entrada como transações

- Atualizar a Edge Function `pix-webhook` para, ao receber um evento de PIX recebido (cash-in), criar automaticamente uma transação com `direction = 'in'` na tabela `transactions`, registrando valor, pagador, e2eid, etc.

#### 3. Atualizar o relatório com ticket médio de entrada e saída

- No `Reports.tsx`, separar transações por `direction`:
  - **Saídas**: `direction = 'out'` — total e ticket médio (já existe, adaptar filtro)
  - **Entradas**: `direction = 'in'` — total recebido e ticket médio
- Adicionar 2 novos cards:
  - **Total Entradas** — soma dos recebimentos no período
  - **Ticket Médio Entrada** — total entradas / quantidade

Layout dos cards:
```text
| Total Saídas | Custos    | Despesas   |
| TM Geral     | TM Custos | TM Despesas|
| Total Entradas | TM Entrada |           |
```

### Arquivos alterados

- **Migração SQL**: adicionar coluna `direction` em `transactions`
- **`supabase/functions/pix-webhook/index.ts`**: criar transação `in` ao receber PIX
- **`src/pages/Reports.tsx`**: cards de entrada + ticket médio entrada
- **`src/types/database.ts`**: adicionar campo `direction` ao tipo `Transaction`

### Observação importante

Até que entradas comecem a ser registradas (via webhook), os cards de entrada aparecerão zerados. Dados históricos de entrada não existem no banco atual.

