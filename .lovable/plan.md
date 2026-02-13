
# Adicionar Categorias em Lote

## Funcionalidade

Adicionar um botao "Importar em Lote" na pagina de Categorias que abre um dialog onde o usuario pode digitar varias categorias de uma vez, uma por linha, com a classificacao (custo/despesa) aplicada a todas.

## Como vai funcionar

1. Um novo botao "Importar em Lote" aparece ao lado do botao "Nova Categoria"
2. Ao clicar, abre um dialog com:
   - Um campo de texto grande (textarea) onde o usuario digita os nomes das categorias, um por linha
   - Um seletor de classificacao (Custo ou Despesa) que sera aplicado a todas
   - Um campo opcional de keywords (aplicado a todas)
3. Ao confirmar, todas as categorias sao inseridas de uma vez no banco de dados usando um unico `insert` com array
4. Categorias duplicadas ou linhas vazias sao ignoradas automaticamente
5. Um toast mostra quantas categorias foram criadas com sucesso

## Alteracoes

### Arquivo: `src/pages/Categories.tsx`

- Adicionar estado `batchDialogOpen` e `batchForm` (texto multilinha + classificacao)
- Adicionar funcao `handleBatchSave` que:
  - Faz split do texto por `\n`
  - Remove linhas vazias e duplicatas
  - Monta array de objetos `{ name, classification, keywords, company_id }`
  - Faz um unico `supabase.from("categories").insert(array)`
  - Mostra toast com quantidade criada
- Adicionar botao "Importar em Lote" no header (icone `List` ou `FileUp`)
- Adicionar segundo Dialog para o formulario em lote

### Exemplo de uso

O usuario digita no textarea:
```text
Aluguel
Energia
Agua
Internet
Material de escritorio
```

Seleciona "Despesa" e clica "Criar Todas". As 5 categorias sao criadas de uma vez.
