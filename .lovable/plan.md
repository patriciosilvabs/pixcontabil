
# Corrigir erro de pagamento de boleto + Configurar webhooks para ONZ

## Problema 1: TypeError no pagamento de boleto

O erro `Cannot read properties of undefined (reading 'toString')` ocorre na linha 175 de `NewPayment.tsx`:

```
startBilletPolling(result.billet_id.toString());
```

A Edge Function `billet-pay` retorna `external_id` no response, mas o frontend espera `billet_id`. O campo `billet_id` nao existe na resposta, causando o crash. O pagamento ja foi processado com sucesso pela ONZ, mas o frontend quebra antes de redirecionar o usuario.

**Correcao:** Alterar a linha 175 para usar `result.external_id` em vez de `result.billet_id`:

```typescript
startBilletPolling(result.external_id?.toString() || result.transaction_id);
```

Tambem precisamos atualizar a interface `BilletPaymentResult` no hook `useBilletPayment.ts` para refletir os campos reais retornados pela Edge Function (substituir `billet_id` por `external_id`).

## Problema 2: Webhooks ONZ nao configurados

A imagem mostra que todos os 5 tipos de webhook (Transferencia, Recebimento, Estorno, Fila de Saida de Pagamentos, Infracoes) estao "Nao Configurado" e "Pausado" no painel ONZ.

Para que o sistema receba notificacoes de status dos pagamentos (boletos e Pix), e necessario configurar pelo menos os webhooks de **Transferencia** e **Fila de Saida de Pagamentos** no painel ONZ.

A URL do webhook deve apontar para a Edge Function `pix-webhook` do sistema. Como o webhook precisa de autenticacao via `x-webhook-secret`, precisamos:

1. Verificar qual e a URL publica do webhook
2. Orientar a configuracao no painel ONZ com a URL correta e o header de seguranca

## Arquivos a serem alterados

### 1. `src/hooks/useBilletPayment.ts`
- Atualizar a interface `BilletPaymentResult`: substituir `billet_id: number` por `external_id: string`

### 2. `src/pages/NewPayment.tsx`
- Linha 175: Corrigir de `result.billet_id.toString()` para `result.external_id || result.transaction_id`

### 3. `src/constants/app.ts`
- Incrementar versao para `v1.1.3`

## Configuracao de Webhooks (Manual no painel ONZ)

Apos a correcao do codigo, sera necessario configurar os webhooks no painel da ONZ. A URL do webhook do sistema e:

```
https://ntvgthwqxixkoemyxhqo.supabase.co/functions/v1/pix-webhook
```

Os tipos que devem ser configurados:
- **Transferencia** - para receber confirmacoes de pagamentos Pix
- **Fila de Saida de Pagamentos** - para receber atualizacoes de status de boletos

O header `x-webhook-secret` deve ser configurado com o valor do secret armazenado no sistema.
