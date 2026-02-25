

## Investigacao do Proxy mTLS - Passo a Passo

O codigo atual do proxy ja esta correto em teoria: ele recebe `body_raw` como string e encaminha diretamente sem re-serializar (linha 84 do `index.js`). Mas precisamos confirmar que isso esta acontecendo na pratica.

### Diagnostico em 4 etapas

---

### Etapa 1: Adicionar logs de diagnostico no proxy

Editar o arquivo `index.js` do proxy (no Cloud Run/Railway) adicionando logs que comparem o `body_raw` recebido vs o que e enviado para a ONZ. Especificamente:

```javascript
// Após linha 84, antes de fetchOptions:
if (body_raw) {
  // Extrair qrCode do body_raw para comparação
  try {
    const parsed = JSON.parse(body_raw);
    if (parsed.qrCode) {
      console.log(`[proxy] qrCode length: ${parsed.qrCode.length}`);
      console.log(`[proxy] qrCode has spaces: ${parsed.qrCode.includes(' ')}`);
      console.log(`[proxy] qrCode first 80: ${parsed.qrCode.substring(0, 80)}`);
      console.log(`[proxy] qrCode last 20: ${parsed.qrCode.substring(parsed.qrCode.length - 20)}`);
    }
  } catch(e) { /* not JSON */ }
  console.log(`[proxy] requestBody === body_raw: ${requestBody === body_raw}`);
  console.log(`[proxy] requestBody length: ${requestBody.length}`);
  console.log(`[proxy] body_raw length: ${body_raw.length}`);
}
```

Fazer deploy do proxy com essas alteracoes.

---

### Etapa 2: Fazer um pagamento de teste

1. Gerar um QR Code dinamico em uma maquininha (Mercado Pago, PagSeguro, etc.)
2. Escanear com o app e confirmar o pagamento
3. Aguardar o resultado (sucesso ou erro onz-0010)

---

### Etapa 3: Verificar os logs

Acessar os logs do proxy (Cloud Run Console ou Railway Logs) e procurar por:

1. **`qrCode has spaces: true`** — confirma que os espacos foram preservados ate o proxy
2. **`requestBody === body_raw: true`** — confirma que o proxy nao alterou o body
3. **`qrCode length`** — comparar com o length que aparece nos logs do `pix-pay-qrc` (no Lovable Cloud). Devem ser iguais

Se `qrCode has spaces: false`, o problema esta antes do proxy (frontend ou edge function). Se `requestBody === body_raw: false`, o proxy esta alterando o body.

---

### Etapa 4: Verificar se e o Express JSON parser

Ha um risco sutil: o Express middleware `express.json()` parseia o body inteiro do request (que contem `body_raw` como string dentro do JSON). Isso deveria preservar a string, mas podemos verificar adicionando um log extra:

```javascript
// Logo após a linha 46: const { url, method, headers, body, body_raw } = req.body;
console.log(`[proxy] typeof body_raw: ${typeof body_raw}`);
```

Se `typeof body_raw` for `string`, esta correto. Se for `object`, o Express parseou o JSON dentro do JSON (nao deveria acontecer, mas vale confirmar).

---

### Secao Tecnica: Por que o proxy poderia corromper

O fluxo atual e:
1. Edge function serializa o payload com `JSON.stringify(payload)` → `rawBody`
2. Edge function envia para o proxy como `body_raw: rawBody` dentro de outro JSON
3. Express parseia o JSON externo → `req.body.body_raw` e uma string
4. Proxy usa `body_raw` diretamente como `requestBody` (linha 84)
5. `https.request.write(requestBody)` envia para a ONZ

O ponto critico e a **linha 84**: `body_raw ? body_raw : (body ? JSON.stringify(body) : undefined)`. Se `body_raw` estiver presente, o body original e preservado. Se por algum motivo `body_raw` for `undefined` e `body` existir, o Express re-serializa o objeto (o que poderia reordenar campos mas nao deveria corromper strings).

### Resultado esperado

Depois de coletar os logs, compartilhe aqui:
- O `qrCode length` do log do proxy
- O `qrCode length` do log do pix-pay-qrc  
- Se `requestBody === body_raw` e `true`
- Se o erro onz-0010 ainda apareceu

Com esses dados saberemos exatamente onde esta a corrupcao.

