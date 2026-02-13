
# Remover Dados Fictícios da Pagina de Transacoes

## Problema

A pagina `src/pages/Transactions.tsx` e a unica que ainda usa dados fictícios (mock data). Ela tem um array `mockTransactions` hardcoded com 5 transacoes falsas (Moinho Santa Clara, CEMIG, etc.) em vez de buscar do banco de dados.

Todas as outras paginas (Dashboard, Relatorios, Empresas, Usuarios, Categorias, Configuracoes) ja buscam dados reais.

## Solucao

Refatorar `Transactions.tsx` para buscar transacoes reais da tabela `transactions` com join na tabela `categories`, usando o mesmo padrao das outras paginas.

## Alteracoes

### Arquivo: `src/pages/Transactions.tsx`

1. Remover o array `mockTransactions` (linhas 31-80)
2. Adicionar imports: `useEffect` do React, `useAuth` do contexto, `supabase` do client, `Loader2` do lucide, `formatDistanceToNow`/`format` do date-fns
3. Dentro do componente:
   - Buscar `currentCompany` do `useAuth()`
   - Adicionar estados `transactions` (array), `isLoading` (boolean)
   - Criar funcao `fetchTransactions` que faz:
     ```
     supabase.from("transactions")
       .select("*, categories(name, classification), receipts(id)")
       .eq("company_id", currentCompany.id)
       .order("created_at", { ascending: false })
       .limit(100)
     ```
   - Mapear os dados retornados para o formato usado no template (beneficiary, amount, classification, category, status, hasReceipt, createdAt, createdBy)
4. Aplicar filtros de `statusFilter` e `classificationFilter` nos dados reais
5. Ler o parametro `status` da URL (query param) para pre-selecionar o filtro de status (ja que o Dashboard linka para `/transactions?status=pending`)
6. Mostrar um loading spinner enquanto carrega
7. Manter toda a UI existente (cards, badges, filtros) -- so muda a fonte dos dados

### Detalhes tecnicos

- A tabela `transactions` tem os campos: `beneficiary_name`, `amount`, `status`, `created_at`, `category_id`
- O join com `categories` traz `name` e `classification`
- O join com `receipts` permite saber se tem comprovante (`hasReceipt = receipts.length > 0`)
- A RLS ja garante que so transacoes da empresa do usuario sao retornadas
- O parametro `?status=pending` da URL sera lido com `useSearchParams` do react-router-dom
