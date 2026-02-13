

# Implementar Camera para QR Code e Codigo de Barras

## Problema
Os botoes "Abrir Camera" na pagina de Novo Pagamento nao fazem nada. Eles nao tem nenhum evento `onClick` conectado - sao apenas botoes visuais sem funcionalidade.

## Solucao
Implementar leitura de QR Code e codigo de barras usando a camera do dispositivo com a biblioteca `html5-qrcode`, que suporta tanto QR Codes quanto codigos de barras (incluindo ITF usado em boletos brasileiros).

## Etapas

### 1. Instalar dependencia
- Adicionar `html5-qrcode` - biblioteca leve que usa a camera do dispositivo para decodificar QR Codes e codigos de barras sem necessidade de servidor

### 2. Criar componente de Scanner (`src/components/payment/BarcodeScanner.tsx`)
- Componente reutilizavel que abre a camera traseira do dispositivo
- Suporta dois modos: `qrcode` e `barcode`
- Usa `Html5Qrcode` para decodificar em tempo real
- Renderiza dentro de um Dialog/modal para facilitar o uso
- Callback `onScan(result: string)` retorna o valor decodificado
- Callback `onClose()` para fechar o scanner
- Tratamento de erros (camera nao disponivel, permissao negada)

### 3. Integrar no NewPayment.tsx
- Na aba **QR Code**: ao clicar "Abrir Camera", abrir o scanner no modo `qrcode`. O resultado preenchera o campo `copyPaste` (Copia e Cola) e mudara o tipo para `copy_paste`, ja que o QR Code Pix e um codigo Copia e Cola
- Na aba **Boleto**: ao clicar "Abrir Camera", abrir o scanner no modo `barcode`. O resultado preenchera o campo `boletoCode` (linha digitavel)
- Apos escanear com sucesso, fechar o scanner automaticamente

## Detalhes Tecnicos

### Componente BarcodeScanner
```text
Props:
- mode: "qrcode" | "barcode"
- isOpen: boolean
- onScan: (result: string) => void
- onClose: () => void

Formatos suportados:
- QR Code: QR_CODE
- Boleto: ITF, CODE_128 (codigos de barras bancarios)

Ciclo de vida:
- Ao abrir: solicita permissao da camera, inicia decodificacao
- Ao escanear: chama onScan, para a camera
- Ao fechar: para a camera, limpa recursos
```

### Mudancas no NewPayment.tsx
```text
- Adicionar estado: scannerMode e scannerOpen
- Botao "Abrir Camera" do QR Code -> abre scanner modo qrcode
- Botao "Abrir Camera" do Boleto -> abre scanner modo barcode
- onScan preenche os campos corretos automaticamente
```

### Arquivos afetados
- `src/components/payment/BarcodeScanner.tsx` (novo)
- `src/pages/NewPayment.tsx` (editar)
- `package.json` (nova dependencia: html5-qrcode)

