

## Problema

Quando o usuario rotaciona o smartphone para landscape durante a leitura de um boleto, a largura da tela ultrapassa 768px. O hook `useIsMobile()` retorna `false`, fazendo o `AdminDashboard` e `OperatorDashboard` desmontarem o `MobileDashboard` e renderizarem o layout desktop. Isso destrói o componente `BarcodeScanner` junto com sua stream de camera.

## Causa raiz

Em `AdminDashboard.tsx` (linha 32-46) e `OperatorDashboard.tsx` (linha 32-46):

```text
if (isMobile) {
  return <MobileDashboard ... />  ← contém BarcodeScanner
}
return <div> ... desktop layout ... </div>
```

Quando `isMobile` muda de `true` para `false` (rotação), o `MobileDashboard` é desmontado, matando o scanner.

## Solução

Elevar o estado do `BarcodeScanner` (modo barcode) e do `BoletoPaymentDrawer` para fora do condicional mobile/desktop, de modo que eles existam independentemente da mudança de layout. Ambos componentes já renderizam em fullscreen (`fixed inset-0 z-[100]`) ou como drawer, então funcionam em qualquer viewport.

### Arquivos alterados

**1. `src/components/dashboard/MobileDashboard.tsx`**
- Receber callbacks do pai para abrir o scanner de boleto em vez de gerenciar o estado internamente
- Novas props: `onOpenBarcodeScanner` (callback que dispara `acquireStreamAndOpen`)
- Remover o `BarcodeScanner mode="barcode"` e `BoletoPaymentDrawer` deste componente

**2. `src/components/dashboard/AdminDashboard.tsx`**
- Mover os estados `barcodeScannerOpen`, `scannedBarcode`, `boletoPaymentOpen` e `preAcquiredStreamRef` para este nível
- Renderizar `BarcodeScanner mode="barcode"` e `BoletoPaymentDrawer` fora do condicional `if (isMobile)`
- Passar callback `onOpenBarcodeScanner` para `MobileDashboard`

**3. `src/components/dashboard/OperatorDashboard.tsx`**
- Mesma alteração do AdminDashboard: elevar estados do scanner de boleto e renderizar fora do condicional

### Fluxo resultante

```text
AdminDashboard / OperatorDashboard
├── if (isMobile) → MobileDashboard (botão BOLETO chama onOpenBarcodeScanner)
├── else → Desktop layout
├── BarcodeScanner mode="barcode"   ← sempre montado, não depende de isMobile
└── BoletoPaymentDrawer             ← sempre montado, não depende de isMobile
```

Com isso, mesmo que `isMobile` mude durante o scan, o `BarcodeScanner` permanece montado e a camera continua aberta.

## Detalhes técnicos

- A função `acquireStreamAndOpen` (que faz `getUserMedia` no contexto do clique para iOS) também será elevada para o componente pai
- O `preAcquiredStreamRef` precisa existir no pai para manter a referencia do stream
- Os componentes QR Code e Pix Key podem continuar dentro do `MobileDashboard` pois o QR dialog fecha antes de qualquer rotação ser provável, mas se desejado podem ser elevados futuramente
- Nenhuma alteração de banco de dados ou edge function necessária

