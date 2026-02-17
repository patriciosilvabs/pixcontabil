

## Corrigir scanner de QR Code no iPhone

### Problema

No iOS Safari, a API de camera (`getUserMedia`) so funciona quando chamada **diretamente** dentro de um evento de toque do usuario. O codigo atual chama a camera dentro de um `useEffect` com um `setTimeout` de 500ms, o que quebra a cadeia de gesto no iOS. No Android isso nao e um problema porque o Chrome e mais permissivo.

### Causa raiz

```text
Usuario toca "PAGAR QR CODE"
  -> setQrScannerOpen(true)          // setState
  -> React re-render
  -> useEffect detecta isOpen=true   // gesto ja perdido
  -> setTimeout(500ms)               // mais delay
  -> Html5Qrcode.start()             // getUserMedia falha no iOS
```

### Solucao

Reestruturar o `BarcodeScanner` para que no modo QR Code, a camera seja iniciada de forma que o iOS consiga manter a cadeia de gesto. Existem duas estrategias complementares:

#### 1. Remover o `setTimeout` de 500ms no modo QR

O delay de 500ms existe para garantir que o container DOM esteja pronto. Em vez disso, usar um `MutationObserver` ou `requestAnimationFrame` para detectar quando o elemento esta no DOM, sem quebrar a cadeia de gesto.

#### 2. Pre-iniciar a camera com `getUserMedia` direto no click

No `MobileDashboard.tsx`, ao clicar em "PAGAR QR CODE", chamar `navigator.mediaDevices.getUserMedia` **imediatamente** no handler do click (mantendo a cadeia de gesto), guardar o stream em um ref, e passa-lo ao `BarcodeScanner` como prop. O scanner entao usa esse stream em vez de solicitar a camera por conta propria.

#### 3. Adicionar atributo `playsinline` no html5-qrcode

O iOS Safari exige `playsinline` no elemento `<video>` para reproduzir inline. O html5-qrcode pode nao adicionar isso automaticamente. Vamos garantir que o container tenha as configuracoes corretas.

### Alteracoes em arquivos

#### `src/components/dashboard/MobileDashboard.tsx`

- No handler do click de "PAGAR QR CODE", chamar `getUserMedia({ video: { facingMode: "environment" } })` imediatamente
- Armazenar o `MediaStream` em um `useRef`
- Passar o stream como prop `preAcquiredStream` ao `BarcodeScanner`
- Fazer o mesmo para o botao de "BOLETO" (modo barcode)

#### `src/components/payment/BarcodeScanner.tsx`

- Adicionar prop opcional `preAcquiredStream?: MediaStream`
- No modo QR: se `preAcquiredStream` existir, passar o stream diretamente para o `Html5Qrcode` em vez de deixa-lo chamar `getUserMedia`
- Remover o `setTimeout(500ms)` e substituir por `requestAnimationFrame` + checagem de elemento no DOM
- Garantir que o video element tenha `playsinline` e `webkit-playsinline` (necessarios no iOS)
- No modo barcode: se `preAcquiredStream` existir, usar `videoEl.srcObject = stream` diretamente em vez de `decodeFromConstraints`

#### Fallback

- Se o `getUserMedia` no click falhar (por exemplo, permissao negada), exibir o erro imediatamente em vez de abrir o scanner vazio
- Se `preAcquiredStream` nao for fornecido (compatibilidade), manter o comportamento atual como fallback

### Detalhes tecnicos

O `Html5Qrcode` aceita um `cameraIdOrConfig` no metodo `start()`. Porem, ele nao aceita um `MediaStream` diretamente. A alternativa e usar o metodo `Html5Qrcode.scanStream()` ou substituir por decodificacao manual via canvas + ZXing (similar ao que ja e feito no modo barcode).

A abordagem mais limpa para o modo QR:
1. Obter o stream no click
2. Criar um `<video>` com o stream
3. Usar `BrowserMultiFormatReader` do ZXing com `QR_CODE` format para decodificar (unificando as duas bibliotecas)

Isso simplifica o codigo e resolve o problema do iOS em ambos os modos.
