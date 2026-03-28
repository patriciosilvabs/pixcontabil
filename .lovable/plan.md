
# Corrigir comprovante Pix sem nome do beneficiário

## Diagnóstico

Confirmei o problema no banco para a transação `6cb83921-7554-4c56-9bb6-ba7d981624c4`:

- `transactions.status = completed`
- `transactions.beneficiary_name = null`
- `receipts.ocr_data.beneficiary = "-"`

Mas a resposta salva do provedor já contém o nome:

```text
pix_provider_response.creditorAccount.name = "Patricio Barbosa da Silva"
pix_provider_response.creditorAccount.document = "00904831388"
```

Ou seja: o nome existe no retorno da ONZ, porém o sistema não está extraindo esse campo.

## Causa raiz

Os extratores atuais de beneficiário nas funções backend olham apenas para campos como:

- `creditParty`
- `creditor`
- `receiver`
- `beneficiary`
- `receiverName`
- `creditorName`

No payload real da ONZ desse caso, o nome veio em:

- `creditorAccount.name`
- `creditorAccount.document`

Como esse formato não está coberto:
- a transação é marcada como `completed`
- o nome do beneficiário continua vazio
- o `generate-pix-receipt` gera o comprovante com `Beneficiário: -`

## Implementação proposta

### 1. Ampliar a extração de beneficiário para ONZ
Atualizar os helpers de extração nestes arquivos para incluir `creditorAccount`:

- `supabase/functions/pix-pay-dict/index.ts`
- `supabase/functions/pix-check-status/index.ts`
- `supabase/functions/pix-webhook-gateway/index.ts`
- `supabase/functions/internal-payment-webhook/index.ts`
- `supabase/functions/pix-webhook/index.ts`

Nova prioridade de leitura:
```text
creditParty / creditor / receiver / beneficiary
→ creditorAccount.name
→ receiverName / creditorName
```

E para documento:
```text
creditParty.taxId / creditor.taxId / receiver.taxId / beneficiary.document
→ creditorAccount.document
→ receiverDocument / creditorTaxId
```

### 2. Corrigir a função `pix-webhook`
No arquivo `supabase/functions/pix-webhook/index.ts`, há uso de `extractBeneficiaryFromOnz(data)`, mas o helper precisa estar consistente com os demais e cobrir `creditorAccount`.

Vou padronizar essa extração para evitar divergência entre webhook, polling e gateway.

### 3. Garantir backfill do nome antes do comprovante
Manter o fluxo atual, mas com a extração corrigida:
- `pix-check-status` salva `beneficiary_name`
- depois dispara `generate-pix-receipt`

Assim o comprovante novo já nasce com o nome correto.

### 4. Regenerar comprovantes incompletos também quando o status já estiver correto
Hoje `generate-pix-receipt` já aceita regeneração se o receipt auto-gerado estiver sem beneficiário.
Vou preservar essa lógica e garantir que ela continue funcionando com o novo backfill:
- receipt existente com `beneficiary = "-"` deve ser recriado
- novo receipt deve usar `transaction.beneficiary_name`

## Resultado esperado

Para pagamentos Pix por chave via ONZ:

```text
Pagamento por chave
→ ONZ retorna LIQUIDATED com creditorAccount.name
→ backend extrai e salva beneficiary_name
→ comprovante é gerado/regenerado
→ campo “Beneficiário” passa a mostrar o nome real
```

## Arquivos que vou ajustar

- `supabase/functions/pix-pay-dict/index.ts`
- `supabase/functions/pix-check-status/index.ts`
- `supabase/functions/pix-webhook-gateway/index.ts`
- `supabase/functions/internal-payment-webhook/index.ts`
- `supabase/functions/pix-webhook/index.ts`
- validar `supabase/functions/generate-pix-receipt/index.ts` sem alterar o fluxo principal

## Validação após implementação

Vou validar estes pontos:
1. Pix por chave ONZ salva `beneficiary_name` a partir de `creditorAccount.name`
2. comprovante novo sai com nome do beneficiário
3. comprovante antigo com `Beneficiário: -` é regenerado corretamente
4. QR Code e outros provedores continuam funcionando sem regressão

## Detalhe técnico

O problema não é da tela nem do anexo em si. O erro está no parsing do payload do provedor no backend. O dado existe, mas está em outra estrutura do JSON da ONZ do que a função esperava.
