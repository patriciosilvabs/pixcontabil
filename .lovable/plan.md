

## Novos Filtros no Relatório: Tag, Descrição, Tipo de Pagamento e Status

### Situação atual

A página de Relatórios possui filtros por: **período**, **classificação** (custo/despesa) e **usuário**. Não há filtros por tag, descrição, tipo de pagamento ou status.

**Problema importante**: As tags rápidas selecionadas durante o pagamento **não são salvas na transação**. A tabela `transactions` não possui campo `quick_tag_id` ou `quick_tag_name`. Isso significa que para filtrar por tag, primeiro precisamos persistir essa informação.

### Alterações

**1. Migração: adicionar coluna `quick_tag_name` na tabela `transactions`**

Adicionar um campo `text` nullable para guardar o nome da tag selecionada no momento do pagamento. Usar o nome (não o ID) para que o relatório funcione mesmo que a tag seja renomeada ou excluída depois.

```sql
ALTER TABLE public.transactions ADD COLUMN quick_tag_name text;
```

**2. Atualizar todos os fluxos de pagamento para salvar a tag**

Nos componentes e hooks que criam transações (`usePixPayment`, `useBilletPayment`, `CashPaymentDrawer`, etc.), incluir o `quick_tag_name` no insert quando uma tag foi selecionada.

**3. Adicionar novos filtros na página `Reports.tsx`**

Novos selects/inputs na barra de filtros:

| Filtro | Tipo | Valores |
|---|---|---|
| Tag | Select | Tags únicas extraídas das transações carregadas |
| Descrição | Input de texto | Busca parcial (contains) no campo `description` |
| Tipo de pagamento | Select | Pix Chave, QR Code, Copia e Cola, Boleto, Dinheiro |
| Status | Select | Concluído, Pendente, Falhou, Cancelado |
| Categoria | Select | Categorias da empresa (já carregadas, mas sem filtro dedicado) |

**4. Atualizar `filteredTransactions` no `useMemo`**

Aplicar todos os novos filtros sequencialmente sobre as transações já carregadas (filtragem client-side para manter a simplicidade):
- `tagFilter`: match em `quick_tag_name`
- `descriptionFilter`: match parcial case-insensitive em `description`
- `pixTypeFilter`: match em `pix_type`
- `statusFilter`: match em `status`
- `categoryFilter`: match em `category_id`

**5. Layout responsivo dos filtros**

Reorganizar a barra de filtros em grid responsivo para acomodar os novos campos sem quebrar o layout mobile. Usar 2 colunas no mobile, wrap automático no desktop.

### Onde aparece

- Página `/reports` — barra de filtros expandida acima do resumo diário
- Os filtros afetam tanto os cards de resumo quanto o gráfico e a lista de transações

### Arquivos alterados

- Nova migração SQL (coluna `quick_tag_name`)
- `src/pages/Reports.tsx` — novos filtros e lógica de filtragem
- `src/hooks/usePixPayment.ts` — salvar tag name na transação
- `src/hooks/useBilletPayment.ts` — salvar tag name na transação
- `src/components/payment/CashPaymentDrawer.tsx` — salvar tag name na transação
- Demais drawers que criam transações diretamente

