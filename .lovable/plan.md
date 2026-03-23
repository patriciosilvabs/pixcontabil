

## Corrigir leitor de código de barras — câmera traseira no smartphone

### Problema
O `facingMode: { ideal: "environment" }` é uma constraint "suave" — o navegador pode ignorá-la e entregar a câmera frontal. Em muitos smartphones (especialmente Samsung e iOS), isso resulta na câmera errada sendo usada.

### Correção

**Arquivo: `src/components/payment/BarcodeScanner.tsx`**

1. **Forçar câmera traseira** — trocar `{ ideal: "environment" }` por `{ exact: "environment" }` no fallback do scanner, com fallback para `ideal` caso o dispositivo não suporte `exact`
2. **Adicionar lógica de retry com enumeração de câmeras** — se a primeira tentativa falhar, usar `navigator.mediaDevices.enumerateDevices()` para encontrar a câmera traseira explicitamente pelo label (geralmente contém "back", "rear", "traseira", "environment")
3. **Aplicar resolução adequada** — manter `width/height ideal` para garantir foco e nitidez no barcode

**Arquivos: `src/components/dashboard/MobileDashboard.tsx`, `src/components/dashboard/AdminDashboard.tsx`, `src/components/dashboard/OperatorDashboard.tsx`**

4. **Mesmo ajuste no pre-acquired stream** — trocar `{ ideal: "environment" }` por `{ exact: "environment" }` com fallback, nos 3 dashboards que pré-adquirem o stream para iOS

### Lógica de seleção de câmera (pseudocódigo)
```text
1. Tentar getUserMedia com facingMode: { exact: "environment" }
2. Se falhar → enumerateDevices() e buscar deviceId da câmera traseira
3. Se encontrar → getUserMedia com deviceId: { exact: id }
4. Se não encontrar → getUserMedia com facingMode: { ideal: "environment" } (fallback atual)
```

### Resultado esperado
- No smartphone, sempre abre a câmera traseira
- Se o dispositivo não tiver câmera traseira (ex: desktop), degrada graciosamente para qualquer câmera disponível

