

## Correção: Comprovante não sai na maquininha (QR Code)

### Causa raiz

O proxy v3.1 não tem a rota `POST /pix/pagar-qrc`. A Edge Function `pix-pay-qrc` tenta chamá-la, recebe 404, e faz fallback para pagamento via chave (dict). Pagamentos dict **não imprimem na maquininha** porque usam o endpoint ONZ `/pix/payments/dict` em vez de `/pix/payments/qrc`.

### Plano de correção (2 partes)

**Parte 1 — Você precisa adicionar a rota no proxy v3.1**

Adicione esta rota no seu `server.js` antes do `start()`:

```javascript
// 6. PAGAR PIX VIA QR CODE (EMV) - para imprimir na maquininha
fastify.post('/pix/pagar-qrc', async (request, reply) => {
  if (request.headers['x-proxy-key'] !== process.env.PROXY_ADMIN_KEY) return reply.code(401).send();
  const { emv, valor, descricao } = request.body;
  
  try {
    const token = await getToken();
    const res = await axios.post(`${process.env.URL_CASHOUT}/pix/payments/qrc`, {
      emv,
      payment: { currency: "BRL", amount: valor },
      description: descricao || "Pagamento via QR Code"
    }, {
      headers: { 
        Authorization: `Bearer ${token}`,
        'x-idempotency-key': request.headers['x-idempotency-key'] || `qrc-${Date.now()}`
      },
      httpsAgent: agentOut
    });
    return res.data;
  } catch (err) {
    return reply.code(err.response?.status || 500).send(err.response?.data || err.message);
  }
});
```

Depois: `pm2 restart` no proxy.

**Parte 2 — Atualizar Edge Function `pix-pay-qrc`**

Modificar o fallback para que, quando a rota QRC do novo proxy falhar, tente o proxy antigo (genérico) com o endpoint QRC correto **antes** de cair no dict. Só faz fallback para dict como último recurso.

| Arquivo | Alteração |
|---------|-----------|
| `supabase/functions/pix-pay-qrc/index.ts` | No bloco de fallback (linhas 399-411), tentar `callOnzQrcWithTokenRetry` (proxy genérico antigo) antes de `delegateQrToPixPayDict` |

### Cadeia de fallback resultante

```text
1. NEW_PROXY /pix/pagar-qrc  →  ✅ imprime na maquininha
2. OLD_PROXY /pix/payments/qrc →  ✅ imprime na maquininha (fallback)
3. pix-pay-dict (dict)         →  ❌ NÃO imprime (último recurso)
```

### Resumo técnico

A única alteração de código é na Edge Function `pix-pay-qrc/index.ts`, adicionando ~15 linhas no bloco de fallback. A correção principal depende de você adicionar a rota `/pix/pagar-qrc` no proxy v3.1.

