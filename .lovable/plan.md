

## Corrigir parsing de valores monetarios em todo o sistema

### Problema identificado

O valor "5.303.986.540.579,90" apareceu porque o sistema nao trata corretamente numeros formatados no padrao brasileiro (pontos como separador de milhar, virgula como decimal). Isso afeta tanto o backend (extracao de valor do EMV) quanto o frontend (campos de valor e exibicao).

### Alteracoes

#### 1. Criar funcao `parseLocalizedNumber` em `src/lib/utils.ts`

Adicionar uma funcao robusta de parsing que:
- Remove separadores de milhar (pontos no formato BR)
- Converte virgula decimal para ponto
- Auto-detecta o formato baseado na posicao do ultimo ponto vs ultima virgula
- Retorna 0 para valores invalidos

#### 2. Corrigir parsing do EMV tag 54 em `supabase/functions/pix-qrc-info/index.ts`

Substituir a regex gulosa na linha 93:
```
const amountMatch = qr_code.match(/54(\d{2})(\d+\.\d{2})/);
```

Por um parser TLV correto que:
- Percorre as tags do EMV sequencialmente (Tag 2 chars + Length 2 chars + Value)
- Extrai APENAS o valor da tag 54 com o comprimento correto
- Evita capturar digitos de tags adjacentes (53, 58, etc.)

#### 3. Aplicar `parseLocalizedNumber` em todos os drawers de pagamento

Substituir `parseFloat(amount.replace(",", "."))` por `parseLocalizedNumber(amount)` nos seguintes arquivos:
- `src/components/pix/PixCopyPasteDrawer.tsx` (linhas 103, 112, 125, 243)
- `src/components/pix/PixQrPaymentDrawer.tsx` (linhas 74, 83, 96, 179)
- `src/components/pix/PixKeyDialog.tsx` (linhas 51, 60, 73, 175)
- `src/components/payment/BoletoPaymentDrawer.tsx` (se aplicavel)

#### 4. Adicionar validacao de limite de valor

Nos drawers e nas edge functions, adicionar uma verificacao de sanidade:
- Frontend: antes de confirmar, validar se o valor esta entre R$ 0,01 e R$ 999.999,99 (ou limite configuravel)
- Edge functions (`pix-pay-qrc`, `pix-pay-dict`): rejeitar valores acima de um teto razoavel (ex: R$ 1.000.000,00), retornando erro claro

### Detalhes tecnicos

**Funcao parseLocalizedNumber:**
```text
parseLocalizedNumber("5.303.986,90")  -> 5303986.90 (corrige formato BR)
parseLocalizedNumber("79,90")         -> 79.90
parseLocalizedNumber("2.00")          -> 2.00 (formato US preservado)
parseLocalizedNumber("1234.56")       -> 1234.56
```

**Parser TLV para EMV:**
```text
Em vez de regex, percorrer o EMV tag por tag:
  pos=0: tag="00", len=02, val="01" -> avanca
  pos=4: tag="01", len=02, val="12" -> avanca
  ...
  pos=N: tag="54", len=05, val="79.90" -> EXTRAI AMOUNT
  ...
Isso garante que o valor extraido respeita o comprimento da tag.
```

**Validacao de teto:**
- Frontend exibe alerta: "O valor R$ X parece incorreto. Deseja continuar?"
- Backend rejeita com erro 400: "Valor acima do limite permitido"

