

# Corrigir Orientacao de Fotos Capturadas no Mobile

## Problema

Quando o usuario tira uma foto pelo celular, a camera salva a imagem com metadados EXIF de orientacao (ex: rotacao de 90 graus). Porem, ao fazer upload direto do arquivo, esses metadados sao ignorados pelo storage e pelo jsPDF, resultando em imagens exibidas na horizontal em vez de na vertical.

## Solucao

Processar a imagem atraves de um Canvas antes do upload, aplicando a orientacao correta. Isso "fixa" a rotacao diretamente nos pixels da imagem, eliminando a dependencia dos metadados EXIF.

## Alteracoes

### Arquivo: `src/pages/ReceiptCapture.tsx`

Na funcao `handleFileSelect`, antes de fazer o upload:

1. Carregar o arquivo em um `createImageBitmap` com a opcao `imageOrientation: "from-image"` -- isso faz o navegador aplicar automaticamente a rotacao EXIF
2. Desenhar o bitmap num Canvas com as dimensoes corretas (largura x altura ja rotacionadas)
3. Exportar o Canvas como Blob (JPEG com qualidade 0.9)
4. Usar esse Blob corrigido como o arquivo a ser enviado ao storage
5. Atualizar o preview para usar o Canvas corrigido tambem

### Arquivo: `src/utils/reportExports.ts`

Nenhuma alteracao necessaria -- ao corrigir a imagem no momento da captura, o PDF ja recebera a imagem com orientacao correta.

## Detalhes Tecnicos

- `createImageBitmap(file, { imageOrientation: "from-image" })` e suportado em todos os navegadores modernos (Chrome, Safari, Firefox)
- O Canvas automaticamente recebe as dimensoes corretas (ex: uma foto retrato 3000x4000 em vez de 4000x3000)
- A conversao para JPEG com qualidade 0.9 mantem boa qualidade visual e reduz o tamanho do arquivo
- O nome do arquivo original e preservado, apenas a extensao muda para `.jpg` se necessario
- Fotos ja salvas incorretamente no storage nao serao corrigidas retroativamente -- apenas novas capturas

