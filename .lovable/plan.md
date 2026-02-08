

# Adicionar botao de camera na aba Boleto

## Resumo
Adicionar uma opcao de escanear codigo de barras com a camera na aba Boleto, similar ao que ja existe na aba QR Code.

## Alteracao

### Arquivo: `src/pages/NewPayment.tsx`

Na aba Boleto (linhas 258-273), adicionar uma secao com botao "Abrir Camera" acima do campo de digitacao manual, seguindo o mesmo padrao visual da aba QR Code:

1. Adicionar import do icone `Camera` do lucide-react (ou reutilizar `QrCode`)
2. Inserir um bloco com borda tracejada, icone de camera/codigo de barras, texto explicativo e botao "Abrir Camera" antes do campo "Linha Digitavel"
3. Adicionar um separador visual com texto "ou digite manualmente" entre o botao da camera e o input

### Layout final da aba Boleto
```text
┌─────────────────────────────────────┐
│        [icone codigo de barras]     │
│                                     │
│   Escaneie o codigo de barras       │
│   com a camera do seu dispositivo   │
│                                     │
│        [ Abrir Camera ]             │
├─────────────────────────────────────┤
│      ─── ou digite manualmente ───  │
├─────────────────────────────────────┤
│  Linha Digitavel                    │
│  [ 00000.00000 00000.000000 ... ]   │
│  47 ou 48 digitos                   │
└─────────────────────────────────────┘
```

### Icone
Usar o icone `ScanBarcode` do lucide-react (mais adequado para codigo de barras) -- adicionar ao import existente.

