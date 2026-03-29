

# Adicionar filtro por usuário na página de Relatórios

## Alteração

Adicionar um `Select` de filtro por usuário (quem criou a transação) na barra de filtros do relatório, ao lado dos filtros de período e classificação.

### `src/pages/Reports.tsx`

1. Adicionar estado `userFilter` (default `"all"`)
2. Gerar lista de usuários a partir do `profileMap` já carregado
3. Adicionar `<Select>` com opção "Todos os Usuários" + cada usuário do `profileMap`
4. Aplicar filtro no `filteredTransactions` — encadear com o filtro de classificação existente, filtrando por `t.created_by === userFilter`
5. Também aplicar o filtro de usuário nos cálculos de totais (`totalAmount`, `totalCosts`, `totalExpenses`) e nos gráficos (`byCategory`, `pieData`)

### Posição do filtro

Na barra de filtros (linha 212-242), entre o select de classificação e o botão Exportar:

```tsx
<Select value={userFilter} onValueChange={setUserFilter}>
  <SelectTrigger className="w-full sm:w-[200px]"><SelectValue /></SelectTrigger>
  <SelectContent>
    <SelectItem value="all">Todos os Usuários</SelectItem>
    {Object.entries(profileMap).map(([uid, name]) => (
      <SelectItem key={uid} value={uid}>{name}</SelectItem>
    ))}
  </SelectContent>
</Select>
```

### Lógica de filtragem

O `filteredTransactions` passará a considerar ambos os filtros (classificação + usuário). Os cards de resumo e gráficos também usarão os dados filtrados para manter consistência visual.

