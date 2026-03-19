

## Diagnóstico

Os logs confirmam que:
1. **O webhook funciona** — a transação `d512d4fd` foi atualizada para `completed` pelo webhook às 21:08:05
2. **A versão deployada do `pix-check-status` é antiga** — os logs mostram `"ONZ response for e2e"` (formato antigo), mas o código atual tem `"ONZ raw response for e2e"` (formato novo). A busca por `"normalized"` não retorna nada nos logs, confirmando que a normalização nunca executou.
3. **O polling rodou com código sem normalização** — por isso retornava `pending` ao frontend, mesmo com a transação já `completed` no banco

**Causa raiz**: O deploy mais recente do `pix-check-status` não foi efetivado. A edge function ainda roda o código antigo sem a normalização da resposta ONZ.

## Plano

1. **Redesployar `pix-check-status`** — simplesmente redesployar a função que já tem o código corrigido com normalização e non-downgrade
2. **Verificar** — após deploy, testar chamando a função para confirmar que os novos logs (`ONZ raw response`, `ONZ normalized payload status`) aparecem

Nenhuma alteração de código é necessária — o código já está correto no repositório, só precisa ser deployado novamente.

