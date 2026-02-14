

## Corrigir scanner de codigo de barras (boleto)

### Problemas identificados

1. **Interface quebrada**: A camera ocupa apenas parte da tela (lado esquerdo) porque a biblioteca html5-qrcode cria um elemento de video interno que nao esta sendo forcado a preencher toda a tela. Faltam estilos CSS para o container do video.

2. **Nao le codigos de barras**: A area de escaneamento (`qrbox`) esta sendo calculada com dimensoes que podem ser maiores que o proprio video, o que faz a biblioteca ignorar os frames silenciosamente.

### Correcoes

**Arquivo: `src/components/payment/BarcodeScanner.tsx`**

1. **Adicionar CSS global para forcar video fullscreen**: Usar estilos inline ou uma classe para que os elementos internos criados pelo html5-qrcode (`video`, `#qr-shaded-region`) preencham 100% do container:
   - O elemento `video` precisa de `width: 100%; height: 100%; object-fit: cover`
   - O container `#qr-shaded-region` precisa estar absolutamente posicionado cobrindo tudo

2. **Usar funcao dinamica para `qrbox`**: Em vez de calcular o tamanho uma unica vez antes do video iniciar (quando as dimensoes podem estar erradas), passar uma funcao que calcula o tamanho com base nas dimensoes reais do video:
   ```
   qrbox: (viewfinderWidth, viewfinderHeight) => {
     return { width: ..., height: ... };
   }
   ```

3. **Reduzir formatos no modo boleto**: Limitar os formatos suportados a apenas ITF e CODE_128 (usados em boletos brasileiros) para melhorar a velocidade e precisao da leitura, em vez de tentar todos os 17 formatos simultaneamente.

4. **Aumentar tolerancia da area de captura**: Usar uma area de escaneamento mais proporcional (85% largura, 20% altura do video) para capturar melhor os codigos de barras de boletos.

**Arquivo: `src/index.css`**

5. **Adicionar estilos CSS para o scanner**: Incluir regras CSS que forcam os elementos internos do html5-qrcode a preencher o container corretamente no modo tela cheia.

