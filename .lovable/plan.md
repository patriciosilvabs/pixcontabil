

## Corrigir extracao automatica de valor no Pix Copia e Cola

### Problema

Quando o usuario cola um codigo Pix EMV no campo "Copia e Cola", o sistema **nao consulta** o valor automaticamente. O mesmo codigo, quando escaneado via camera (QR Code), extrai o valor corretamente usando a funcao `getQRCodeInfo`. Isso e uma inconsistencia grave pois obriga o usuario a digitar o valor manualmente, podendo gerar erros.

### Comparacao do comportamento atual

| Metodo | Extrai valor? | Como? |
|--------|--------------|-------|
| QR Code (camera) | Sim | Chama `getQRCodeInfo` apos escanear |
| Boleto (digitado) | Sim | Chama `parseBoleto` no onChange |
| Copia e Cola | **Nao** | Apenas armazena o texto |

### Solucao

Adicionar logica no campo "Copia e Cola" para detectar quando o usuario cola um codigo EMV valido e automaticamente:

1. Chamar `getQRCodeInfo` para consultar os detalhes (valor, nome do recebedor, etc.)
2. Preencher o valor automaticamente no formulario
3. Mostrar feedback visual (toast com valor e nome do recebedor)
4. Avancar para a etapa 2 se o valor for encontrado

### Detalhes tecnicos

**Arquivo:** `src/pages/NewPayment.tsx`

1. Adicionar estado de loading para consulta do copia e cola (`isConsultingPaste`)
2. No `onChange` do Textarea do "Copia e Cola":
   - Detectar se o texto colado parece um codigo EMV valido (comeca com `0002` ou tem tamanho minimo ~50 chars)
   - Chamar `getQRCodeInfo({ qr_code: codigocolado })`
   - Se retornar valor, preencher `amount` e mostrar toast
   - Se nao retornar valor, informar que o usuario deve digitar manualmente
3. Mostrar indicador de loading enquanto consulta

O fluxo sera identico ao que ja existe para o scanner de QR Code (linhas 548-573 do arquivo atual), reutilizando a mesma funcao `getQRCodeInfo` que ja esta disponivel no componente.

