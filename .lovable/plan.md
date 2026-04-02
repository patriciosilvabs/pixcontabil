

## Diagnóstico: Por que boletos não confirmam

### Investigação completa — dois problemas encontrados

#### Problema A: Polling retorna 404 perpetuamente

O `pix-check-status` chama o proxy `GET /status/billet/13351767`, que retorna 404 indefinidamente. A lógica de tolerância (retornar `PROCESSING` por 10 min, depois marcar como `failed`) está funcionando, mas o proxy **nunca** retorna o status real do boleto.

Evidência:
- Boleto `13351767` → 404 em TODAS as 30+ tentativas de polling
- Boleto `13348811` → mesmo comportamento, marcado como `failed` após 10 min
- Boleto `13332008` (que confirmou em 02/04 às 21:22) → confirmou ~30 min após criação — pode ter sido via polling quando a rota ainda funcionava

**Este é um problema no proxy da VPS**, não no código das Edge Functions. A rota `/status/billet/:id` pode estar mapeando para o endpoint errado da ONZ. Possíveis endpoints corretos na API ONZ:
- `GET /api/v2/billets/payments/{id}` (pagamento pelo ID)
- `GET /api/v2/billets/payments/{id}/status`

#### Problema B: Webhooks da ONZ NÃO estão chegando

Verifiquei a tabela `pix_webhook_logs`:
- **Último webhook válido da ONZ**: 19/03/2026 (IP `54.94.73.68`)
- **Desde 01/04**: apenas entradas `UNAUTHORIZED` de IPs da AWS (health checks)
- **Zero webhooks de boleto** em todo o histórico

Isso significa que a ONZ não está enviando webhooks para pagamentos de boleto (ou parou de enviar webhooks completamente).

### Plano de correção (apenas boletos)

#### 1. Corrigir `pix-webhook/index.ts` — adicionar `PAID` ao statusMap ONZ

O statusMap na linha 140-148 NÃO inclui `PAID`. Se um webhook de boleto chegar com `status: "PAID"`, seria mapeado como `pending` (default). Boletos na ONZ frequentemente usam `PAID` em vez de `LIQUIDATED`.

```typescript
// ANTES (linha 140-148):
const statusMap = { 'LIQUIDATED': 'completed', ... };

// DEPOIS:
const statusMap = { 'LIQUIDATED': 'completed', 'PAID': 'completed', 'COMPLETED': 'completed', ... };
```

#### 2. Corrigir `billet-consult/index.ts` — nomes de campos errados

Os logs mostram erro 400 do proxy:
```
"field":"payment.amount","message":"required validation failed"
"field":"digitableCode","message":"required validation failed"
```

O `billet-consult` envia `digitableCode` + sem `payment.amount`. Mas o `billet-pay` (que funciona!) envia `linhaDigitavel` + `valor`. Os nomes dos campos estão inconsistentes.

```typescript
// ANTES (billet-consult linha 170-174):
{ digitableCode: digitableCode, description: 'Consulta', paymentFlow: 'APPROVAL_REQUIRED' }

// DEPOIS:
{ linhaDigitavel: digitableCode, valor: parsed.amount || 0, descricao: 'Consulta', paymentFlow: 'APPROVAL_REQUIRED' }
```

#### 3. Adicionar `ON_QUEUE` ao statusMap do `pix-check-status`

O status `ON_QUEUE` retornado pela ONZ no momento do pagamento não está no mapa. Adicionar:
```typescript
'ON_QUEUE': 'pending',
```

### O que NÃO será alterado
- Nenhuma função de Pix
- Nenhum arquivo frontend
- Nenhuma tabela ou política RLS
- `pix-webhook-gateway` (já tem `PAID`)
- `internal-payment-webhook` (já funciona)

### Ação necessária do usuário (proxy/ONZ)
1. **Verificar a rota no proxy**: Acessar os logs do proxy na VPS quando `/status/billet/13351767` é chamado. Ver para qual endpoint da ONZ ele está encaminhando e o que a ONZ retorna
2. **Verificar registro de webhook na ONZ**: Os webhooks pararam de chegar desde 01/04. Pode ser necessário re-registrar o webhook URL na ONZ

### Resultado esperado
- Consulta de boletos via `billet-consult` volta a funcionar (campos corretos)
- Se webhooks voltarem a chegar, status `PAID` será reconhecido como `completed`
- `ON_QUEUE` explicitamente tratado no mapa de status

