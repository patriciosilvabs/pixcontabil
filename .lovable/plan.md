

## Corrigir scanner de codigo de barras - 4 problemas

### 1. Bug principal: constraints HD ignorados

O codigo atual define `config.videoConstraints` com resolucao HD, mas passa `{ facingMode: "environment" }` como primeiro parametro do `scanner.start()`. A biblioteca usa o primeiro parametro para abrir a camera, ignorando o `videoConstraints` do config. Resultado: camera abre em baixa resolucao e nao consegue ler barras densas.

**Correcao**: Passar as constraints HD diretamente no primeiro parametro do `scanner.start()`, e remover do `config.videoConstraints`. Usar `ideal` em vez de `min` para evitar falha em dispositivos modestos.

```
const constraints = isBarcode
  ? {
      facingMode: { ideal: "environment" },
      width: { ideal: 1920 },
      height: { ideal: 1080 },
    }
  : { facingMode: "environment" };

await scanner.start(constraints, config, ...);
```

### 2. stopScanner sem await

O `stop()` e `clear()` sao chamados sem await, o que pode deixar a lib em estado ruim em reaberturas rapidas.

**Correcao**: Tornar `stopScanner` async com await interno, chamar com `void stopScanner()` onde necessario.

### 3. Formatos incompletos

Faltam `EAN_8`, `UPC_A` e `UPC_E` na lista de formatos suportados para barcode.

**Correcao**: Adicionar esses formatos ao array `barcodeFormats`.

### 4. Remover videoConstraints redundante do config

Remover o bloco que seta `config.videoConstraints` pois as constraints agora vao no primeiro parametro.

---

### Detalhes tecnicos

**Arquivo**: `src/components/payment/BarcodeScanner.tsx`

- Linhas 20-26: Adicionar `EAN_8`, `UPC_A`, `UPC_E` ao array `barcodeFormats`
- Linhas 40-47: Tornar `stopScanner` async com `await s.stop()` e `await s.clear()`
- Linhas 120-127: Remover bloco `config.videoConstraints`
- Linhas 129-140: Passar constraints HD no primeiro parametro de `scanner.start()` para modo barcode
- Linha 137: Usar `void stopScanner()` no callback de sucesso

**Arquivo**: `src/index.css` - Sem alteracoes necessarias (o CSS do `barcode-fullscreen` ja esta correto)

