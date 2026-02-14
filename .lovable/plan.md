

## Corrigir leitura de codigos de barras densos (boletos)

### Causa raiz

Codigos de barras de boletos brasileiros (ITF-14, 44 digitos) tem barras muito finas e proximas. A camera esta sendo solicitada com resolucao padrao (geralmente 480p), onde cada barra ocupa menos de 1 pixel -- impossivel de decodificar. Codigos com barras mais "espaçadas" (como EAN-13 de produtos) funcionam porque precisam de menos resolucao.

### Correcao

**Arquivo: `src/components/payment/BarcodeScanner.tsx`**

1. **Solicitar resolucao HD da camera**: Em vez de passar apenas `{ facingMode: "environment" }`, passar constraints avancados que pedem resolucao alta (ideal 1920x1080, minimo 1280x720). Isso garante que barras finas tenham pixels suficientes:
   ```
   videoConstraints: {
     facingMode: "environment",
     width: { min: 1280, ideal: 1920 },
     height: { min: 720, ideal: 1080 },
     aspectRatio: { ideal: 1.7777 }
   }
   ```

2. **Aumentar FPS de escaneamento**: Subir de 10 para 15 fps no modo barcode para ter mais tentativas de leitura por segundo, aumentando a chance de capturar um frame nitido.

3. **Desabilitar flip de imagem**: Forcar `disableFlip: true` no modo barcode para evitar processamento desnecessario que pode reduzir a qualidade do frame analisado.

Nenhuma outra alteracao e necessaria. O problema e exclusivamente de resolucao da camera.

