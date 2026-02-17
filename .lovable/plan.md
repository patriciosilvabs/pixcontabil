

## Exibir nome do usuario e data/hora em todas as transacoes

### Objetivo

Incluir o nome do usuario que realizou cada transacao (campo `created_by`) junto com data e hora em todos os locais da aplicacao que exibem transacoes: Relatorios, Historico de Transacoes e Resumo Diario.

### Como funciona hoje

- A query de transacoes usa `select("*, categories(...), receipts(...)")` mas **nao faz join com profiles** para buscar o nome do usuario
- Nenhuma tela exibe quem fez a transacao

### Alteracoes

#### 1. `src/pages/Reports.tsx`

- Alterar a query para incluir o join com profiles: `profiles!transactions_created_by_fkey(full_name)`
- Passar os dados de profile junto com as transacoes para o componente `DailyTransactionSummary`

#### 2. `src/components/reports/DailyTransactionSummary.tsx`

- Atualizar a interface `Transaction` para incluir `profiles?: { full_name: string } | null`
- Exibir o nome do usuario e o horario (HH:mm) em cada linha de transacao, abaixo da descricao ou ao lado da categoria
- Formato: "por Fulano as 14:32"

#### 3. `src/pages/Transactions.tsx`

- Alterar a query para incluir: `profiles!transactions_created_by_fkey(full_name)`
- Adicionar campo `createdBy` no mapeamento de `TransactionRow`
- Exibir o nome do usuario na listagem, junto com a data/hora ja existente
- Formato: "por Fulano - 17/02/2026 14:32"

#### 4. `src/components/payment/RecentPayments.tsx`

- Alterar a query para incluir `profiles!transactions_created_by_fkey(full_name)`
- Exibir o nome do usuario abaixo de cada pagamento recente

### Detalhes tecnicos

- A tabela `transactions` tem o campo `created_by` (uuid) que referencia `auth.users`
- A tabela `profiles` tem `user_id` que corresponde ao `created_by`
- O join sera feito via foreign key hint: `profiles!transactions_created_by_fkey(full_name)` -- se a FK nao existir diretamente, usaremos uma subquery ou criaremos a FK via migracao
- Nenhuma alteracao de schema e necessaria se usarmos o campo `created_by` com um join manual via `profiles` usando `user_id`
- Alternativa: buscar profiles separadamente e fazer o match no frontend pelo `created_by` = `profiles.user_id`

### Abordagem escolhida

Como a FK de `transactions.created_by` aponta para `auth.users` (e nao para `profiles`), faremos o match no frontend:
1. Buscar `profiles` da empresa (admins ja tem acesso via RLS)
2. Criar um map `userId -> fullName`
3. Usar esse map para exibir o nome em cada transacao

Isso evita criar migracoes e funciona com as RLS policies existentes.

