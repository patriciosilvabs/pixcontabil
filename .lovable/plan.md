

## Corrigir zoom excessivo da câmera no scanner de boleto

### Problema
A resolução `width: { ideal: 1920 }, height: { ideal: 1080 }` força muitos smartphones a usar zoom digital para atingir essa resolução, resultando em imagem ampliada demais para escanear códigos de barras.

### Correção

**Arquivo: `src/utils/cameraHelper.ts`**
- Reduzir resolução para `width: { ideal: 1280 }, height: { ideal: 720 }`
- Adicionar `zoom: 1.0` e `resizeMode: "none"` nas constraints para evitar zoom digital automático

Essas constraints são suficientes para leitura de barcode/QR e evitam que o navegador aplique crop ou zoom digital.

