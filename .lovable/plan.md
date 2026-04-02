

## Auditoria: `apikey` ausente em chamadas internas entre Edge Functions

### Resultado da análise

Todas as chamadas para `generate-pix-receipt` em **4 funções** estão sem o header `apikey`. Usam `SERVICE_ROLE_KEY` como Bearer token, mas o gateway do Supabase exige o header `apikey` separadamente.

### Chamadas com problema (sem `apikey`)

| Função | Linha(s) | Destino |
|--------|----------|---------|
| `pix-check-status` | 221, 308, 397 | `generate-pix-receipt` |
| `pix-webhook` | 192, 271 | `generate-pix-receipt` |
| `pix-webhook-gateway` | 271 | `generate-pix-receipt` |
| `internal-payment-webhook` | 152 | `generate-pix-receipt` |

**Total: 7 chamadas sem `apikey`**

### Chamadas já corretas (com `apikey`) — não precisam de alteração

- `pix-pay-qrc` → `pix-pay-dict`, `pix-qrc-info` (corrigido na última iteração)
- `pix-pay-dict` → `pix-auth`
- `pix-balance` → `pix-auth`
- `pix-check-status` → `pix-auth`
- `pix-dict-lookup` → `pix-auth`
- `billet-pay` → `pix-auth`
- `billet-check-status` → `pix-auth`
- `billet-consult` → `pix-auth`
- `register-transfeera-webhook` → `pix-auth`

### Correção

Adicionar `'apikey': Deno.env.get('SUPABASE_ANON_KEY')!` nos headers de cada uma das 7 chamadas listadas acima.

### Arquivos alterados
- `supabase/functions/pix-check-status/index.ts` (3 ocorrências)
- `supabase/functions/pix-webhook/index.ts` (2 ocorrências)
- `supabase/functions/pix-webhook-gateway/index.ts` (1 ocorrência)
- `supabase/functions/internal-payment-webhook/index.ts` (1 ocorrência)

### Resultado esperado
- Geração automática de comprovantes para de falhar silenciosamente
- Todos os fluxos de confirmação (webhook, polling, gateway) geram recibo de forma confiável

