
# Criar Edge Function de Boleto e Revisar Funcoes Existentes

## Resumo
Criar as edge functions para pagamento de boleto via API ONZ e corrigir divergencias nas funcoes existentes comparando com a documentacao oficial.

## Parte 1: Novas Edge Functions para Boleto

### 1.1 - `billet-pay` (POST /billets/payments)
Novo arquivo: `supabase/functions/billet-pay/index.ts`

- Recebe: `company_id`, `digitable_code` (linha digitavel), `description`, `payment_flow`, `amount` (opcional)
- Autentica via `pix-auth` (mesmo token OAuth2 serve para billets)
- Envia para ONZ: `POST /billets/payments` com header `x-idempotency-key`
- Payload ONZ:
```text
{
  digitableCode: string (somente numeros),
  description: string (obrigatorio),
  paymentFlow: "INSTANT" | "APPROVAL_REQUIRED",
  payment: { currency: "BRL", amount: number } (opcional)
}
```
- Salva transacao no banco com `pix_type: 'boleto'` e `boleto_code`
- Registra audit log

### 1.2 - `billet-check-status` (GET /billets/{id})
Novo arquivo: `supabase/functions/billet-check-status/index.ts`

- Recebe: `company_id`, `billet_id` (provider id) ou `transaction_id`
- Consulta `GET /billets/{id}` na ONZ
- Retorna status, dados do boleto (dueDate, settleDate, barCode), creditor/debtor
- Atualiza status da transacao no banco

### 1.3 - `billet-receipt` (GET /billets/payments/receipt/{id})
Novo arquivo: `supabase/functions/billet-receipt/index.ts`

- Recebe: `company_id`, `billet_id` ou `transaction_id`
- Consulta `GET /billets/payments/receipt/{id}` na ONZ
- Retorna PDF em base64

### 1.4 - Configuracao em `supabase/config.toml`
Adicionar:
```text
[functions.billet-pay]
verify_jwt = false

[functions.billet-check-status]
verify_jwt = false

[functions.billet-receipt]
verify_jwt = false
```

## Parte 2: Hook Frontend - `useBilletPayment`

Novo arquivo: `src/hooks/useBilletPayment.ts`

- `payBillet(params)` - chama `billet-pay`
- `checkBilletStatus(billetId)` - chama `billet-check-status`
- `downloadBilletReceipt(billetId)` - chama `billet-receipt`
- Polling de status similar ao `usePixPayment`

## Parte 3: Integrar Boleto na Pagina NewPayment

Atualizar `src/pages/NewPayment.tsx`:
- Importar e usar `useBilletPayment`
- No `handleConfirmPayment`, quando `type === 'boleto'`, chamar `payBillet` ao inves do mock
- Iniciar polling de status apos pagamento

## Parte 4: Revisao e Correcoes das Edge Functions Existentes

### 4.1 - `pix-refund` - DIVERGENCIA ENCONTRADA
**Problema**: Usa endpoint estilo BCB (`/pix/{e2eid}/devolucao/{refundId}` com PUT), mas a API ONZ nao documenta esse endpoint. Devoluoes na ONZ sao tratadas via webhooks de REFUND.
**Correcao**: Verificar se a ONZ realmente suporta esse endpoint ou se devoluoes devem ser feitas de outra forma. Por enquanto, manter como esta (pode ser um endpoint nao documentado publicamente) e adicionar tratamento de erro mais robusto.

### 4.2 - `pix-pay-dict` - CORRETO
- Endpoint `POST /pix/payments/dict` com `x-idempotency-key` - alinhado
- Campos `pixKey`, `creditorDocument`, `priority`, `paymentFlow`, `expiration`, `payment` - todos corretos
- Falta campo opcional `endToEndId` (para baixa de ficha de consultas) e `ispbDeny`
- **Melhoria**: Adicionar suporte ao campo `endToEndId` opcional no request

### 4.3 - `pix-pay-qrc` - CORRETO
- Endpoint `POST /pix/payments/qrc` com `x-idempotency-key` - alinhado
- Campos corretos
- Falta campo `ispbDeny`
- **Sem correcao necessaria**

### 4.4 - `pix-check-status` - CORRETO
- Endpoints `GET /pix/payments/{endToEndId}` e `GET /pix/payments/idempotencyKey/{key}` - alinhados
- Resposta mapeada corretamente com `data` wrapper

### 4.5 - `pix-receipt` - CORRETO
- Endpoint `GET /pix/payments/receipt/{endToEndId}` - alinhado
- Resposta `data.pdf` em base64 - correto

### 4.6 - `pix-qrc-info` - CORRETO
- Endpoint `POST /pix/payments/qrc/info` com `x-idempotency-key` - alinhado
- Campos de resposta mapeados corretamente

### 4.7 - `pix-webhook` - CORRETO
- Payload com `data` e `type` (TRANSFER/RECEIVE/REFUND/CASHOUT) - alinhado com callback samples da ONZ
- **Melhoria**: Adicionar validacao de webhook secret no header para seguranca

### 4.8 - `pix-auth` - CORRETO
- Endpoint `POST /oauth/token` com JSON body - alinhado
- Campos `clientId`, `clientSecret`, `grantType`, `scope` - corretos

## Sequencia de Implementacao

1. Criar `billet-pay`, `billet-check-status`, `billet-receipt` (edge functions)
2. Atualizar `config.toml`
3. Criar hook `useBilletPayment`
4. Integrar boleto real no `NewPayment.tsx`
5. Aplicar melhorias menores nas funcoes existentes (campo `endToEndId` no dict, webhook secret validation)
