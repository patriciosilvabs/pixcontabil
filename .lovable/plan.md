

## Problema

Quando o pagamento é por **QR Code dinâmico** (maquininha), o sistema está delegando para `pix-pay-dict` → proxy `/pix/pagar` → ONZ `/pix/payments/dict`. Isso executa o pagamento como se fosse um **Pix por chave**, não como um pagamento QR Code.

Por isso a **maquininha não recebe a confirmação** — o pagamento por DICT não vincula ao QR Code original da maquininha. A ONZ tem um endpoint específico `/pix/payments/qrc` que faz essa vinculação.

## Solução

### 1. Adicionar endpoint `/pix/pagar-qrc` no proxy dedicado (72.61.25.92)

O proxy precisa de uma nova rota que chame o endpoint correto da ONZ:

```javascript
// Nova rota no proxy
fastify.post('/pix/pagar-qrc', async (request, reply) => {
  if (request.headers['x-proxy-key'] !== process.env.PROXY_ADMIN_KEY) return reply.code(401).send();
  
  const { emv, valor, descricao } = request.body;
  const idempotencyKey = request.headers['x-idempotency-key'] || `qrc-${Date.now()}`;

  const token = await getToken(true);
  const res = await axios.post(`${process.env.URL_CASHOUT}/pix/payments/qrc`, {
    emv: emv,
    payment: { currency: "BRL", amount: valor },
    description: descricao || "Pagamento QR Code",
    paymentFlow: "INSTANT"
  }, {
    headers: { 
      Authorization: `Bearer ${token}`,
      'x-idempotency-key': idempotencyKey 
    },
    httpsAgent: agentOut
  });
  return res.data;
});
```

### 2. Atualizar `pix-pay-qrc` Edge Function

Alterar o bloco ONZ dynamic QR (linhas 351-378) para chamar o novo endpoint do proxy `/pix/pagar-qrc` com o EMV completo, em vez de delegar para `pix-pay-dict`:

- Chamar `NEW_PROXY_URL/pix/pagar-qrc` enviando o `emv` (QR code completo), `valor` e `descricao`
- Criar a transação no banco com `pix_type: 'qrcode'` e `pix_copia_cola: qr_code`
- Manter o fallback para `pix-pay-dict` caso o endpoint QRC falhe

### Resultado esperado

O pagamento via QR Code dinâmico agora vai:
1. Usar o endpoint ONZ `/pix/payments/qrc` que vincula ao QR Code original
2. A maquininha recebe a confirmação de pagamento
3. O comprovante sai na maquininha normalmente

### Ação do usuário
Você precisará adicionar a rota `/pix/pagar-qrc` no seu proxy em 72.61.25.92 antes de eu atualizar a Edge Function.

