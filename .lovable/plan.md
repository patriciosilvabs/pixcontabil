

# Capturar Nome do Beneficiário da API ONZ

## Situação Atual

Quando um pagamento Pix por chave é feito via ONZ, a resposta inicial (`pix-pay-dict`) retorna apenas `e2eId`, `correlationID` e `status` — sem dados do beneficiário. O campo `beneficiary_name` fica vazio na transação, e os "Últimos Pagamentos" mostram apenas a chave mascarada.

Porém, quando o `pix-check-status` consulta `GET /pix/payments/{e2eId}`, a ONZ retorna o payload completo do pagamento, que provavelmente inclui dados do beneficiário (nome, documento). Esse payload já é salvo em `pix_provider_response`, mas os campos `beneficiary_name` e `beneficiary_document` não são extraídos dele.

## Plano

### 1. Atualizar `pix-check-status` para extrair dados do beneficiário (ONZ)

Na seção ONZ do `pix-check-status` (linhas 134-146), ao atualizar a transação, extrair os campos do beneficiário do payload da ONZ e salvá-los:

- Procurar por campos como `creditParty.name`, `creditor.name`, `beneficiary.name`, `receiverName`, `creditParty.taxId` no payload
- Salvar em `beneficiary_name` e `beneficiary_document` na transação
- Só sobrescrever se o campo estiver vazio (não apagar dados já existentes)

### 2. Atualizar `pix-pay-dict` para extrair dados do beneficiário (ONZ)

Na resposta inicial do pagamento (linha 223-228), caso a ONZ retorne dados do beneficiário na criação, extraí-los e salvá-los na transação.

### 3. Atualizar `internal-payment-webhook` para extrair beneficiário

No handler `handlePaymentConfirmed`, extrair dados do beneficiário do evento de webhook e salvá-los na transação.

## Detalhes Técnicos

Campos ONZ prováveis para beneficiário (baseado em padrões de API Pix):
```
payload.creditParty?.name
payload.creditorAccount?.name  
payload.receiver?.name
payload.beneficiary?.name
payload.creditParty?.taxId
payload.creditorAccount?.taxId
```

A extração usará uma função auxiliar que tenta múltiplos caminhos no JSON:
```typescript
function extractBeneficiary(payload: any) {
  const name = payload?.creditParty?.name 
    || payload?.creditor?.name 
    || payload?.receiver?.name
    || payload?.beneficiary?.name
    || payload?.receiverName
    || '';
  const doc = payload?.creditParty?.taxId
    || payload?.creditor?.taxId
    || payload?.beneficiary?.document
    || payload?.receiverDocument
    || '';
  return { name, doc };
}
```

### Arquivos alterados
- `supabase/functions/pix-check-status/index.ts` — extrair e salvar beneficiário
- `supabase/functions/pix-pay-dict/index.ts` — extrair beneficiário da resposta inicial
- `supabase/functions/internal-payment-webhook/index.ts` — extrair beneficiário do webhook

Nenhuma alteração de frontend necessária — o `RecentPayments` já exibe `beneficiary_name` quando disponível.

