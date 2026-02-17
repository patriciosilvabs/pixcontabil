

## Drawer "Copia e Cola" direto no Dashboard

### Objetivo

Ao clicar no icone "COPIA E COLA" no dashboard, abrir um drawer (bottom sheet) com campo de texto para colar o codigo Pix EMV, incluindo um botao "Colar" para facilitar. O pagamento sera concluido sem sair do dashboard, seguindo o mesmo padrao dos fluxos "COM CHAVE", "PAGAR QR CODE" e "BOLETO".

### Fluxo do Drawer

1. **Etapa 1** - Campo de texto + botao "Colar" (cola automaticamente do clipboard)
2. **Etapa 2** - Carregamento dos dados do codigo (usa `getQRCodeInfo`)
3. **Etapa 3** - Valor (se nao veio fixo no codigo)
4. **Etapa 4** - Confirmacao e pagamento (usa `payByQRCode`)

### Alteracoes

#### 1. Novo componente `src/components/pix/PixCopyPasteDrawer.tsx`

- Drawer com 3-4 etapas, seguindo o padrao visual do `PixQrPaymentDrawer`
- Etapa 1: campo `textarea` para colar o codigo EMV + botao "Colar" que usa `navigator.clipboard.readText()` para preencher automaticamente + botao "Continuar"
- Ao continuar, chama `getQRCodeInfo` para extrair dados (recebedor, valor, chave)
- Se o codigo ja tiver valor fixo, pula direto para confirmacao
- Se nao, exibe etapa de valor
- Etapa final: resumo com recebedor, chave, valor e botao "Confirmar Pagamento"
- Usa `payByQRCode` do hook `usePixPayment` para processar

#### 2. Alterar `src/components/dashboard/MobileDashboard.tsx`

- Adicionar estados `copyPasteOpen` e `copyPasteCode`
- Importar `PixCopyPasteDrawer`
- No bloco de acoes rapidas, tratar "COPIA E COLA" como botao (igual "COM CHAVE", "PAGAR QR CODE", "BOLETO") em vez de Link
- Ao clicar, abrir o drawer `PixCopyPasteDrawer`
- Adicionar o componente `PixCopyPasteDrawer` no JSX junto aos demais drawers

### Detalhes tecnicos

- O botao "Colar" usara `navigator.clipboard.readText()` com fallback para toast de erro caso a permissao seja negada
- O componente reutiliza `usePixPayment` (funcoes `getQRCodeInfo` e `payByQRCode`) ja existentes
- Layout segue o padrao dos outros drawers: header com seta voltar, indicador de etapas, e botoes full-width
