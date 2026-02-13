
# Substituir "Descricao opcional" por Selecao de Categoria (Custo/Despesa)

## Resumo

Na etapa 2 do fluxo de Novo Pagamento, substituir o campo de texto "Descricao (opcional)" por um seletor de categoria que busca as categorias cadastradas da empresa, agrupadas por classificacao (Custo ou Despesa). Tambem renomear o titulo da secao para "Informacao do pagamento".

## Alteracoes

### Arquivo: `src/pages/NewPayment.tsx`

1. **Importar `useAuth` e `useEffect`** para buscar categorias da empresa
2. **Adicionar estado** para lista de categorias e categoria selecionada (`categoryId`)
3. **Buscar categorias** da tabela `categories` filtradas por `company_id` e `is_active = true`
4. **Atualizar o `PaymentData` interface**: trocar `description?: string` por `categoryId?: string`
5. **Etapa 2 - Substituir o campo Textarea** por:
   - Label: "Informacao do pagamento"
   - Um `Select` com as categorias agrupadas por classificacao:
     - Grupo "Custo" com as categorias de classificacao `cost`
     - Grupo "Despesa" com as categorias de classificacao `expense`
6. **Etapa 3 (confirmacao)**: mostrar o nome da categoria selecionada e sua classificacao em vez da descricao livre
7. **Atualizar `handleConfirmPayment`**: passar o `category_id` na criacao da transacao em vez de `descricao`

### Fluxo Atualizado

```text
Etapa 1: Tipo de pagamento (chave, copia e cola, QR, boleto)
Etapa 2: Valor + Categoria (Custo ou Despesa) -- era "Valor e Descricao"
Etapa 3: Confirmacao
  -> Apos confirmacao: Tela de captura de comprovante (ja existente)
```

### Detalhes Tecnicos

- A query de categorias usa `supabase.from("categories").select("id, name, classification").eq("company_id", currentCompany.id).eq("is_active", true).order("name")`
- O `Select` usa `SelectGroup` com `SelectLabel` para separar visualmente "Custos" e "Despesas"
- O campo `description` no `PaymentData` sera mantido internamente como o nome da categoria selecionada (para compatibilidade com o fluxo de pagamento existente), mas a interface mostrara o seletor
- A `categoryId` sera passada para a transacao no `handleConfirmPayment` para vincular a categoria ao pagamento
- Se nao houver categorias cadastradas, exibir uma mensagem orientando o usuario a cadastrar categorias primeiro
