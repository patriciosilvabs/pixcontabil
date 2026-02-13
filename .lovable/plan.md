
# Adicionar Filtros de Data e Classificacao acima do Resumo Diario

## O que muda

Mover os controles de filtro (periodo + novo filtro de classificacao) para uma barra de filtros logo acima do componente "Resumo por Dia", tornando a consulta mais acessivel e permitindo filtrar por Custo, Despesa ou Todos.

## Alteracoes

### 1. `src/pages/Reports.tsx`

- Adicionar novo estado `classificationFilter` com opcoes: `"all"`, `"cost"`, `"expense"`
- Mover o `Select` de periodo e o botao de exportacao para uma barra de filtros posicionada entre os graficos e o resumo diario (acima do card "Resumo por Dia")
- Adicionar um segundo `Select` para classificacao com opcoes: "Todos", "Custos", "Despesas"
- Filtrar as transacoes passadas ao `DailyTransactionSummary` com base no `classificationFilter` selecionado (filtrando por `categories.classification`)
- Os cards de resumo e graficos continuam usando todas as transacoes do periodo (sem filtro de classificacao), pois mostram a visao geral
- O filtro de classificacao aplica-se apenas ao resumo diario com comprovantes

### 2. Layout da barra de filtros

```text
+------------------------------------------------------------------+
|  Periodo: [Este Mes v]   Classificacao: [Todos v]   [Exportar v] |
+------------------------------------------------------------------+
|  Resumo por Dia (X transacoes)                                    |
|  ...                                                              |
+------------------------------------------------------------------+
```

- Barra com `flex` responsiva: em mobile os selects ficam empilhados, em desktop ficam lado a lado
- O header da pagina (titulo "Relatorios") fica limpo, sem controles

### Detalhes tecnicos

- Novo estado: `const [classificationFilter, setClassificationFilter] = useState<"all" | "cost" | "expense">("all")`
- Transacoes filtradas: `const filteredTransactions = useMemo(() => classificationFilter === "all" ? transactions : transactions.filter(t => t.categories?.classification === classificationFilter), [transactions, classificationFilter])`
- Passar `filteredTransactions` para `DailyTransactionSummary` em vez de `transactions`
- Os totais dos cards e graficos continuam usando `transactions` (sem filtro)
