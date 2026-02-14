

## Correcao da Extracao da Chave Pix do QR Code EMV

### Problema Identificado

O parser EMV no `pix-qrc-info` usa uma regex que procura por `52`, `53` ou `54` como terminador da chave Pix. Porem, a propria chave `+559298468405` contem `52` no meio (posicoes 12-13), fazendo a regex parar cedo demais.

- Chave real: `+559298468405` (14 caracteres)
- Chave extraida: `+55929846840` (12 caracteres, truncada)
- Resultado: Woovi rejeita com "Chave Pix de destino nao encontrada"

### Solucao

Alterar o parser para usar o campo de comprimento (length) do TLV do EMV diretamente, em vez de depender de um terminador regex. O formato EMV ja informa o tamanho exato da chave no campo `01XX`, onde `XX` e o comprimento.

### Arquivo Alterado

**`supabase/functions/pix-qrc-info/index.ts`** (linhas 86-90)

Substituir a regex atual:
```
const pixKeyMatch = qr_code.match(/0014br\.gov\.bcb\.pix01(\d{2})(.+?)(?:52|53|54)/i);
if (pixKeyMatch) {
  const keyLen = parseInt(pixKeyMatch[1]);
  qrcInfo.pix_key = pixKeyMatch[2].substring(0, keyLen);
}
```

Pela abordagem baseada em posicao:
```
const pixTagMatch = qr_code.match(/0014br\.gov\.bcb\.pix01(\d{2})/i);
if (pixTagMatch) {
  const keyLen = parseInt(pixTagMatch[1]);
  const startIndex = pixTagMatch.index + pixTagMatch[0].length;
  qrcInfo.pix_key = qr_code.substring(startIndex, startIndex + keyLen);
}
```

Isso extrai exatamente o numero correto de caracteres apos o campo de comprimento, sem depender de encontrar um terminador que pode existir dentro da propria chave.

### Resultado Esperado

- Chave extraida corretamente: `+559298468405`
- Woovi recebe a chave completa e processa o pagamento normalmente

