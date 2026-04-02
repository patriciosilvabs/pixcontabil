

## Diagnóstico e Correção: Erro 502 no `pix-balance`

### Problema raiz

O código no repositório **já trata** o erro 404 do proxy graciosamente (retorna HTTP 200 com `available: false`). Porém, a resposta real do Edge Function (`{"error":"Route GET:/saldo not found","provider_error":...}`) **não corresponde** ao formato do código atual — indica que a versão deployada está desatualizada.

### Plano

**1. Redeployar `pix-balance`**
- Fazer deploy da versão atual que já contém o `unavailableBalanceResponse` e tratamento de 404/503
- Isso resolverá o erro 502 e a tela em branco, mostrando "Saldo indisponível" em vez de crashar

**2. Testar após deploy**
- Invocar `pix-balance` para confirmar que retorna `{ success: true, available: false, message: "..." }` em vez de 502

### Nota sobre o proxy

O erro `Route GET:/saldo not found` é do **seu proxy v3.1** — a rota `/saldo` não está registrada nele. O trecho que você compartilhou diz `// ... (mantenha rotas de saldo iguais)`, mas aparentemente essa rota não está ativa. Isso precisa ser corrigido no lado do proxy para que o saldo funcione de fato. O deploy do Edge Function apenas garante que a ausência da rota não quebre o dashboard.

