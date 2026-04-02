

## Status das Correções e Diagnóstico do Erro /saldo

### Correções 1, 2 e 3 — Já Aplicadas

Todas as três correções do plano de boletos **já estão no código atual**:

| Correção | Arquivo | Status |
|----------|---------|--------|
| `PAID`/`COMPLETED`/`ON_QUEUE` no webhook | `pix-webhook/index.ts` L140-151 | ✅ Aplicado |
| Campos `linhaDigitavel`/`valor`/`descricao` | `billet-consult/index.ts` | ✅ Aplicado |
| `COMPLETED`/`ON_QUEUE` no polling | `pix-check-status/index.ts` L205-210 e L293-298 | ✅ Aplicado |

**Não há alterações de código pendentes.**

### Erro `GET /saldo` → 404

O erro atual é do **proxy v3.1**, não do Edge Function. O `pix-balance` chama `GET /saldo` (rota que você confirmou ser a correta), mas o proxy retorna:

```json
{"message":"Route GET:/saldo not found","error":"Not Found","statusCode":404}
```

**Ação necessária**: Verificar no proxy v3.1 se a rota `GET /saldo` está registrada. Possíveis causas:
- A rota não foi incluída na v3.1
- A rota está registrada com outro método (POST em vez de GET)
- O Fastify precisa de restart após o deploy

### Teste do Boleto 13351767

Para testar o polling, posso invocar a Edge Function `pix-check-status` diretamente com o ID do boleto. Isso confirmará se o proxy v3.1 com busca tripla está retornando o status corretamente. **Deseja que eu execute esse teste?**

