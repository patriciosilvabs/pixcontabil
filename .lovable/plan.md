
# Substituir Dados Fictícios por Dados Reais no Dashboard

## Problema
O card de saldo ja esta conectado ao provedor real (mostrando "Indisponivel" para Transfeera). Porem, os demais cards e secoes do dashboard ainda exibem dados mock hardcoded:
- Card "Hoje": R$ 73.980,00 (ficticio)
- Card "Custos": R$ 45.230,00 (ficticio)
- Card "Despesas": R$ 28.750,00 (ficticio)
- Grafico de categorias: dados fixos
- Transacoes recentes: 3 transacoes ficticias
- Alerta de comprovantes pendentes: "3 pendentes" (ficticio)

O banco de dados possui as tabelas `transactions`, `categories` e `receipts`, mas atualmente com 0 registros.

## Solucao

Criar um hook `useDashboardData` que busca dados reais das tabelas `transactions`, `categories` e `receipts`, e substituir todos os dados mock no `AdminDashboard`.

### 1. Criar hook `src/hooks/useDashboardData.ts`
- Buscar transacoes do mes atual da empresa (`transactions` filtrado por `company_id` e `created_at` no mes corrente)
- Calcular totais de custos e despesas com base na classificacao da categoria vinculada
- Buscar transacoes de hoje para o card "Hoje"
- Buscar as 5 transacoes mais recentes para a lista
- Contar comprovantes pendentes (transacoes sem `category_id` ou com status pendente)
- Agrupar valores por categoria para o grafico de pizza
- Retornar tudo com estados de loading

### 2. Modificar `src/components/dashboard/AdminDashboard.tsx`
- Remover todas as constantes mock (`mockSummary`, `mockCategoryData`, `mockRecentTransactions`)
- Importar e usar `useDashboardData`
- Substituir valores fixos pelos dados do hook
- Mostrar estados vazios quando nao houver dados (em vez de dados fictícios)
- Usar `date-fns` para formatar tempos relativos nas transacoes recentes
- Mostrar skeleton loading enquanto os dados carregam

### 3. Modificar `src/components/dashboard/MobileDashboard.tsx`
- Receber transacoes recentes como props
- Exibir transacoes reais ou estado vazio

## Detalhes Tecnicos

### Queries no hook `useDashboardData`:

```text
1. Transacoes do mes (com join em categories):
   SELECT t.*, c.name as category_name, c.classification
   FROM transactions t
   LEFT JOIN categories c ON t.category_id = c.id
   WHERE t.company_id = X AND t.created_at >= inicio_do_mes

2. Calculos:
   - totalCosts = SUM(amount) WHERE classification = 'custo'
   - totalExpenses = SUM(amount) WHERE classification = 'despesa'
   - transactionsToday = COUNT WHERE created_at >= inicio_do_dia
   - pendingReceipts = COUNT WHERE category_id IS NULL

3. Categorias para grafico:
   - GROUP BY category_name, SUM(amount)

4. Transacoes recentes:
   - ORDER BY created_at DESC LIMIT 5
```

### Cores do grafico de categorias:
- Gerar cores automaticamente com base no indice da categoria usando uma paleta pre-definida

### Estados vazios:
- Quando nao ha transacoes: mostrar mensagem "Nenhuma transacao este mes" nos cards
- Quando nao ha categorias: ocultar o grafico de pizza ou mostrar estado vazio
- Cards de custos/despesas: mostrar R$ 0,00 quando nao ha dados
