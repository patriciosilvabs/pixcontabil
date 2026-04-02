

## Diagnóstico e Correção: `pix-balance` alinhado ao Proxy v3.1

### Análise

Comparei o código do proxy v3.1 (Fastify) com todas as Edge Functions que o chamam. A maioria das rotas já está alinhada. O problema principal é o **timeout de 8 segundos** na rota `/saldo`.

**Por que dá timeout?**
O proxy v3.1 chama `getToken()` antes de cada request. Se o token expirou, ele faz uma chamada OAuth à ONZ (com mTLS), que pode levar vários segundos. Somando a chamada de saldo em si (`/accounts/balances/`), o total facilmente ultrapassa 8s.

### Plano de correção

**1. Aumentar timeout do `pix-balance` para 15 segundos**
O timeout de 8s é insuficiente quando o proxy precisa renovar o token OAuth antes de consultar o saldo. Aumentar para 15s.

**2. Corrigir parsing do saldo para resposta direta do Fastify**
O proxy Fastify retorna `res.data` diretamente (a resposta da ONZ). A ONZ retorna do endpoint `/accounts/balances/` um objeto com a estrutura `{data: [{balanceAmount: {available, current}}]}`. O edge function já trata isso, mas precisa garantir compatibilidade com o formato direto (sem wrapper `{status, data}` do proxy Express antigo).

**3. Garantir que o frontend trate `available: false` sem crash**
O hook `usePixBalance` já mapeia `data.available` corretamente — sem alterações necessárias no frontend.

### Arquivos alterados

| Arquivo | Alteração |
|---------|-----------|
| `supabase/functions/pix-balance/index.ts` | Aumentar `PROXY_TIMEOUT_MS` de 8000 para 15000. Melhorar log de diagnóstico. |

### Nota

As outras Edge Functions (`billet-pay`, `pix-pay-dict`, `pix-check-status`, `pix-receipt`, `billet-receipt`) já estão alinhadas com as rotas do proxy v3.1:
- `/billets/pagar` → `billet-pay` envia `linhaDigitavel`/`valor`/`descricao` ✅
- `/pix/pagar` → `pix-pay-dict` envia `chavePix`/`valor`/`creditorDocument` ✅
- `/status/:tipo/:id` → `pix-check-status` usa `/status/billet/:id` e `/status/pix/:id` ✅
- `/recibo/:tipo/:id` → `pix-receipt` e `billet-receipt` usam `/recibo/pix/:id` e `/recibo/billet/:id` ✅

