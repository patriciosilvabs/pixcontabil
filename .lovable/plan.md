

## Corrigir extração de dados por IA (OCR)

### Problema
A tela de anexo de comprovante **nunca chama a função de OCR**. Em vez disso, usa dados falsos fixos no codigo (mock):
- CNPJ: 12.345.678/0001-90
- Valor: R$ 2.450,00
- Data: 2024-01-15

### Solucao

Substituir o bloco mock em `src/pages/ReceiptCapture.tsx` por uma chamada real a edge function `process-ocr`, que ja existe e funciona com Lovable AI (Gemini).

### Alteracoes

**Arquivo: `src/pages/ReceiptCapture.tsx`**

1. Remover o `setTimeout` e o objeto `mockOcrData` (linhas 139-148)
2. Converter a imagem para base64 e enviar para a edge function `process-ocr` via `supabase.functions.invoke`
3. Mapear a resposta da IA (`cnpj`, `valor_total`, `data_emissao`, `classificacao_sugerida`, `categoria_sugerida`) para o estado `ocrData`
4. Usar `classificacao_sugerida` da IA para pre-selecionar Custo/Despesa
5. Usar `categoria_sugerida` para pre-selecionar a categoria se existir match
6. Tratar erros (429, 402, falhas) com toast informativo

### Detalhes tecnicos

```text
Fluxo atual (quebrado):
  Imagem -> setTimeout 2s -> dados mock fixos

Fluxo corrigido:
  Imagem -> base64 -> supabase.functions.invoke("process-ocr") -> dados reais da IA
```

A funcao `process-ocr` ja retorna:
- `data.cnpj` - CNPJ real do documento
- `data.valor_total` - Valor real extraido
- `data.data_emissao` - Data real
- `data.classificacao_sugerida` - "cost" ou "expense"
- `data.categoria_sugerida` - Nome da categoria sugerida
- `data.chave_acesso` - Chave de acesso NFe

O mapeamento sera:
- `ocrData.cnpj` = `data.cnpj`
- `ocrData.value` = formatado de `data.valor_total`
- `ocrData.date` = `data.data_emissao`
- `ocrData.accessKey` = `data.chave_acesso`
- `ocrData.suggestedCategory` = `data.categoria_sugerida`
- `classification` pre-selecionado = `data.classificacao_sugerida`

