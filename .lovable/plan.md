

## Correção: Adicionar `apikey` nas chamadas internas entre Edge Functions

### Problema
Algumas chamadas `fetch` entre Edge Functions não incluem o header `apikey`, necessário pelo gateway do Supabase. Sem ele, as requisições falham com 401/502.

### Chamadas sem `apikey` identificadas

| Arquivo | Linha | Destino |
|---------|-------|---------|
| `billet-consult/index.ts` | 219 | `pix-auth` (fluxo Transfeera) |
| `pix-receipt/index.ts` | 92 | `pix-auth` (fluxo Transfeera) |
| `pix-refund/index.ts` | 106 | `pix-auth` |
| `pix-pay-qrc/index.ts` | 482 | `pix-pay-dict` (static QR fallback) |
| `pix-pay-qrc/index.ts` | 527 | `pix-pay-dict` (dynamic QR fallback) |

### Chamadas que JÁ possuem `apikey` (não alterar)
- `pix-check-status` — todas as 4 chamadas OK
- `pix-webhook` — ambas OK
- `pix-webhook-gateway` — OK
- `internal-payment-webhook` — OK
- `pix-balance` — OK
- `pix-pay-dict` — OK
- `billet-check-status` — OK
- `pix-pay-qrc` linhas 42, 330, 502 — OK
- `register-transfeera-webhook` — OK

### Correção
Adicionar `'apikey': Deno.env.get('SUPABASE_ANON_KEY')!` no objeto `headers` de cada chamada listada acima. Nenhuma outra alteração.

### Arquivos alterados
1. **`supabase/functions/billet-consult/index.ts`** — linha 219
2. **`supabase/functions/pix-receipt/index.ts`** — linha 92
3. **`supabase/functions/pix-refund/index.ts`** — linha 106
4. **`supabase/functions/pix-pay-qrc/index.ts`** — linhas 482 e 527

### O que NÃO será alterado
- Nenhuma lógica de negócio
- Nenhum endpoint ou payload
- Nenhum arquivo frontend
- Funções que já possuem `apikey`

