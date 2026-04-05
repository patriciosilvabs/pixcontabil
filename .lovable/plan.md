

## Reorganizar Relatório: Filtros no topo + Total de transações + Ticket Médio configurável

### Problema atual

Os filtros de período e classificação ficam **abaixo** dos cards de resumo. O usuário quer primeiro escolher o período e depois ver os resultados. Além disso, falta mostrar o **total de transações** (quantidade) e os tickets médios devem responder ao período escolhido (já respondem, mas a UX precisa deixar isso claro).

### Alterações em `src/pages/Reports.tsx`

#### 1. Mover filtros para ANTES dos cards

Mover toda a barra de filtros (período, classificação, usuário, tag, tipo pgto, status, busca, exportar) — atualmente nas linhas 345-436 — para logo após o título (linha 178), antes do bloco de cards de resumo.

Isso permite ao usuário configurar o período e filtros antes de ver os números.

#### 2. Adicionar card "Total de Transações"

Novo card mostrando a quantidade total de transações no período, separada em entradas e saídas:

```text
Total de Transações
  152 transações
  140 saídas · 12 entradas
```

Será adicionado como um card extra na primeira linha de resumo (grid passa de 3 para 4 colunas em desktop).

#### 3. Substituir período "custom" por seletor de intervalo (date range)

Atualmente "Data Específica" permite escolher apenas **um dia**. Para ser realmente configurável, trocar por um seletor de intervalo com data início e data fim:

- Adicionar novo tipo de período `"custom_range"` 
- Usar dois date pickers: "De" e "Até"
- Manter as opções rápidas (Hoje, Semana, Mês, 3 Meses) como atalhos

#### 4. Layout final dos cards

```text
Linha 1: | Total Saídas | Custos | Despesas | Total Transações |
Linha 2: | Total Entradas | TM Entrada |
Linha 3: | TM Geral Saída | TM Custos | TM Despesas |
```

### Arquivo alterado

- `src/pages/Reports.tsx` — mover filtros, adicionar card de total, substituir date picker por range

