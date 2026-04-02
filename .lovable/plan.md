

## Correção: `apikey` ausente + QRC ativo no proxy

A rota `/pix/pagar-qrc` já está sendo chamada corretamente (linha 376). O problema restante é que **duas chamadas internas estão sem o header `apikey`**, o que causa falhas 502 intermitentes:

1. **`delegateQrToPixPayDict`** (linha 42) — chamada para `pix-pay-dict` sem `apikey`
2. **`pix-qrc-info`** (linha 330) — chamada para decodificar QR sem `apikey`

Quando o fallback para dict é acionado (QRC falha ou QR estático), essas chamadas podem falhar silenciosamente.

### Alterações em `supabase/functions/pix-pay-qrc/index.ts`

1. **Linha 42**: Adicionar `'apikey': Deno.env.get('SUPABASE_ANON_KEY')!` nos headers de `delegateQrToPixPayDict`
2. **Linha 330**: Adicionar `'apikey': Deno.env.get('SUPABASE_ANON_KEY')!` nos headers da chamada para `pix-qrc-info`

### Resultado
- QR Codes dinâmicos vão direto pelo proxy `/pix/pagar-qrc` (já funciona)
- Fallback para dict e decodificação de QR param de falhar com 502
- Todos os usuários conseguem pagar consistentemente

### Arquivo alterado
- `supabase/functions/pix-pay-qrc/index.ts`

