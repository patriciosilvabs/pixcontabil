

## Exibir apenas as categorias mais usadas (com opcao de ver todas)

### O que muda

Na tela de Anexar Comprovante (`ReceiptCapture`), a lista de categorias atualmente mostra **todas** as categorias de uma vez, ocupando muito espaco na tela. A mudanca fara o seguinte:

1. **Carregar a contagem de uso** de cada categoria a partir da tabela `transactions` (quantas vezes cada `category_id` foi usado pela empresa)
2. **Exibir inicialmente apenas as 8 categorias mais usadas** (ou todas, se houver 8 ou menos)
3. **Adicionar um botao "Ver todas"** que expande a lista completa
4. **Manter a busca funcionando normalmente** -- ao digitar no campo de busca, todas as categorias sao pesquisadas (nao apenas as top 8)
5. Categorias que nunca foram usadas aparecem por ordem alfabetica apos as mais usadas

### Como funciona para o usuario

- Ao abrir a tela, ve apenas as categorias que mais usa no dia a dia
- Se precisar de outra categoria, pode clicar em "Ver todas" ou digitar no campo de busca
- Todas as categorias continuam no banco de dados, nada e removido

### Detalhes tecnicos

**Arquivo: `src/pages/ReceiptCapture.tsx`**

- Adicionar estado `showAllCategories` (boolean, default `false`)
- Adicionar estado `categoryUsageCounts` (mapa de category_id para contagem)
- No `useEffect` de carregamento, fazer uma query adicional agrupando transacoes por `category_id` para obter contagens de uso:
  ```sql
  SELECT category_id, count(*) FROM transactions
  WHERE company_id = ? AND category_id IS NOT NULL
  GROUP BY category_id
  ```
- Ordenar as categorias filtradas por contagem de uso (decrescente), depois alfabetico
- Quando `showAllCategories` e `false` e nao ha texto de busca, exibir apenas as 8 primeiras
- Quando `showAllCategories` e `true` ou ha texto de busca, exibir todas
- Adicionar botao "Ver todas (X)" / "Ver menos" abaixo da lista de categorias
- Resetar `showAllCategories` para `false` ao trocar entre Custo/Despesa

