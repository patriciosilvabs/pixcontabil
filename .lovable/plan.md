
# Relatorios com Exportacao CSV, XLSX e PDF com Comprovantes

## Resumo

Atualizar a pagina de Relatorios para suportar tres formatos de exportacao (CSV, XLSX, PDF), onde cada transacao inclui o link para o comprovante anexado. No PDF, as imagens dos comprovantes serao exibidas visualmente. No CSV e XLSX, uma coluna com a URL do comprovante sera incluida.

## Alteracoes

### 1. Instalar dependencias

- `xlsx` (SheetJS) -- para gerar arquivos XLSX
- `jspdf` + `jspdf-autotable` -- para gerar PDFs formatados com tabelas

### 2. Atualizar a query de dados (`src/pages/Reports.tsx`)

A query atual busca `transactions` com join em `categories`, mas nao busca `receipts`. Atualizar para:

```
.select("*, categories(name, classification), receipts(file_url, file_name)")
```

Isso traz a URL do comprovante junto com cada transacao.

### 3. Adicionar botoes de exportacao

Substituir o botao unico "CSV" por um dropdown ou tres botoes:
- CSV
- XLSX
- PDF

### 4. Exportacao CSV

Adicionar coluna "Comprovante" com a URL publica do arquivo. Formato:

```
Data,Descricao,Valor,Categoria,Classificacao,Status,Comprovante
15/01/2025,Insumos,2450.00,Insumos,Custo,completed,https://...url...
```

### 5. Exportacao XLSX

Usar a biblioteca `xlsx` para gerar uma planilha com as mesmas colunas do CSV, incluindo a coluna "Comprovante" com a URL. A URL sera clicavel no Excel.

### 6. Exportacao PDF

Usar `jspdf` + `jspdf-autotable` para gerar um PDF contendo:

1. **Cabecalho**: Nome da empresa, periodo do relatorio, data de geracao
2. **Resumo**: Total de saidas, custos, despesas (cards resumo)
3. **Tabela**: Data | Favorecido | Valor | Categoria | Classificacao | Status | Comprovante
4. **Paginas de comprovantes**: Apos a tabela, cada comprovante que for imagem (JPG/PNG) sera inserido em uma pagina separada com o titulo da transacao acima da imagem

Para inserir as imagens no PDF:
- Buscar cada imagem via `fetch()` da URL publica do storage
- Converter para base64
- Inserir com `doc.addImage()`
- Cada comprovante em uma pagina separada com legenda (data, valor, favorecido)

### 7. Arquivo: `src/pages/Reports.tsx`

Alteracoes especificas:
- Importar `jsPDF` e `autoTable` das novas dependencias
- Importar `utils` do `xlsx`
- Atualizar o `useEffect` para incluir `receipts` no select
- Criar funcao `exportXLSX()` -- gera planilha com SheetJS
- Criar funcao `exportPDF()` -- gera PDF com cabecalho, resumo, tabela e imagens
- Atualizar funcao `exportCSV()` -- adicionar coluna de comprovante
- Substituir botao unico por dropdown com tres opcoes

### Detalhes Tecnicos

- As imagens dos comprovantes ja estao no bucket `receipts` (publico), entao podem ser acessadas via URL publica
- O join `receipts(file_url, file_name)` retorna um array (uma transacao pode ter multiplos comprovantes); usaremos o primeiro
- Para o PDF, imagens serao carregadas via `fetch` e convertidas para base64 com `FileReader`/`canvas`
- PDFs e comprovantes que nao sao imagem terao apenas o link no PDF, sem preview visual
- O XLSX usa a funcao `HYPERLINK` para tornar URLs clicareis
