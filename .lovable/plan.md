
# Simplificar Etapa 2: Apenas Custo ou Despesa (sem dropdown)

## Resumo

Na etapa 2 do Novo Pagamento, substituir o dropdown de categorias por dois botoes grandes: **CUSTO** e **DESPESA**. A categoria especifica (ex: Insumos, Embalagens) sera selecionada depois, na tela de anexo do comprovante (que ja tem esse fluxo implementado).

## O que muda

### Arquivo: `src/pages/NewPayment.tsx`

1. **Remover** o estado `categories`, o `useEffect` de fetch de categorias, e as variaveis `costCategories`, `expenseCategories`, `selectedCategory`
2. **Substituir `categoryId`** no `PaymentData` por `classification?: "cost" | "expense"`
3. **Etapa 2**: Remover o `Select` dropdown e colocar dois botoes lado a lado:
   - Botao **CUSTO** (com icone DollarSign, estilo gradient quando selecionado)
   - Botao **DESPESA** (com icone TrendingUp, estilo vermelho quando selecionado)
   - Subtitulo: "Classificacao" em vez de "Categoria"
4. **Etapa 3 (confirmacao)**: Mostrar "Custo" ou "Despesa" em vez do nome da categoria
5. **`handleConfirmPayment`**: Passar a classificacao como descricao do pagamento (ex: "Custo" ou "Despesa")
6. **Remover imports** desnecessarios: `SelectGroup`, `SelectLabel` (se nao usados em outro lugar do arquivo)

### Layout da Etapa 2 (Mobile e Desktop)

```text
+------------------------------------------+
|  Informacao do pagamento                 |
|  Informe o valor e a classificacao       |
|                                          |
|  Valor (R$)                              |
|  +--------------------------------------+|
|  | R$  3,55                             ||
|  +--------------------------------------+|
|                                          |
|  Classificacao                           |
|  +------------------+  +---------------+|
|  |    $             |  |    ^          ||
|  |   CUSTO          |  |   DESPESA     ||
|  +------------------+  +---------------+|
+------------------------------------------+
```

### Fluxo completo atualizado

```text
Etapa 1: Tipo de pagamento (chave, copia e cola, QR, boleto)
Etapa 2: Valor + Classificacao (Custo ou Despesa) -- botoes, sem dropdown
Etapa 3: Confirmacao
  -> Apos confirmacao: Tela de comprovante (onde escolhe a categoria especifica)
```

### Detalhes Tecnicos

- Os botoes usam o mesmo estilo ja existente na tela `ReceiptCapture.tsx` (CUSTO com `bg-gradient-primary`, DESPESA com `bg-destructive`)
- A classificacao sera passada na descricao do pagamento para registro
- A categoria especifica continua sendo escolhida na tela de anexo do comprovante, que ja possui esse fluxo com subcategorias
- Importar `DollarSign` e `TrendingUp` do lucide-react (ja disponivel no projeto)
