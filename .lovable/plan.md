

# Corrigir Links de Comprovantes e Melhorar Tamanho no PDF

## Problemas Identificados

1. **"Bucket not found" nos links da planilha**: O bucket `receipts` e **privado**, mas o codigo usa `getPublicUrl()` que gera URLs publicas que nao funcionam. Precisa usar URLs assinadas (signed URLs) com tempo de expiracao.

2. **Imagens muito pequenas no PDF**: O `addImage` usa largura fixa de 180mm mas altura automatica (`0`), o que pode resultar em imagens ilegíveis dependendo da proporcao.

## Alteracoes

### 1. Corrigir Upload - Salvar caminho relativo (`src/pages/ReceiptCapture.tsx`)

- Substituir `getPublicUrl()` por salvar apenas o **caminho relativo** do arquivo (ex: `companyId/transactionId/timestamp_file.png`) no campo `file_url` da tabela `receipts`
- Isso permite gerar signed URLs sob demanda, em vez de salvar uma URL publica que nao funciona

### 2. Gerar Signed URLs nos Relatorios (`src/utils/reportExports.ts`)

- Importar o cliente Supabase
- Criar funcao auxiliar `getSignedReceiptUrl(filePath)` que chama `supabase.storage.from("receipts").createSignedUrl(filePath, 3600)` (1h de validade)
- No `mapTransactions`, gerar signed URLs para os comprovantes antes de montar CSV/XLSX
- No `exportPDF`, usar signed URLs para buscar as imagens
- As funcoes `exportCSV`, `exportXLSX` e `exportPDF` passam a ser `async`

### 3. Melhorar Tamanho das Imagens no PDF (`src/utils/reportExports.ts`)

- Carregar a imagem em um elemento `Image` do HTML para obter as dimensoes reais (largura x altura)
- Calcular a proporcao para preencher a pagina A4 de forma legivel:
  - Largura maxima: 180mm (margem de 14mm em cada lado)
  - Altura maxima: 250mm (deixando espaco para o cabecalho da pagina)
  - Manter proporcao original (aspect ratio)
- Isso garante que a imagem ocupe o maximo de espaco possivel na pagina sem distorcer

### 4. Corrigir exibicao em outros locais que usam receipt URLs

- Na pagina de Relatorios (`src/pages/Reports.tsx`) e qualquer lugar que exiba imagens de comprovantes, usar signed URLs em vez de URLs publicas

## Detalhes Tecnicos

- `createSignedUrl(path, expiresIn)` retorna uma URL temporaria que funciona mesmo com bucket privado
- Para os dados ja salvos no banco com URL publica completa, extrair o caminho relativo removendo o prefixo do storage URL
- Funcao auxiliar para extrair o path: pegar tudo apos `/object/public/receipts/`
- As signed URLs nos CSV/XLSX terao validade de 1 hora -- suficiente para a contabilidade acessar apos exportar

