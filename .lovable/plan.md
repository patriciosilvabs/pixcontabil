

## Corrigir pagamento via QR Code dinamico (erro DS04)

### Problema
O `pix-pay-qrc` atualmente extrai a chave Pix do QR Code e chama `pix-pay-dict` (pagamento por chave). Para QR Codes dinamicos (COBV), o PSP destinatario rejeita o pagamento (DS04) porque espera receber o pagamento vinculado ao QR Code original (com txid), nao como pagamento avulso.

### Causa raiz
A funcao `pix-pay-qrc` nao tem logica propria de pagamento -- ela apenas delega para `pix-pay-dict`. QR Codes dinamicos exigem que o EMV completo (copia-e-cola) seja enviado ao provedor.

### Solucao

Implementar pagamento nativo por QR Code no `pix-pay-qrc` para cada provedor, enviando o EMV/copia-e-cola diretamente em vez de extrair a chave e pagar por dict.

### Alteracoes

**Arquivo: `supabase/functions/pix-pay-qrc/index.ts`**

1. Manter a decodificacao via `pix-qrc-info` para obter o valor e informacoes do QR
2. Detectar se e QR dinamico (`type === "dynamic"`) ou estatico
3. Para QR **dinamico**: usar endpoint nativo do provedor para pagamento por QR Code:
   - **Woovi**: `POST /api/v1/payment` com `type: "QR_CODE"` e o EMV completo no campo `qrCode`, em vez de `PIX_KEY`
   - **ONZ**: enviar o campo `qrCode` (EMV completo) via proxy
   - **Transfeera**: usar o payload EMV no campo adequado
   - **EFI**: endpoint de pagamento por location/QR
4. Para QR **estatico**: manter o fluxo atual via `pix-pay-dict` (funciona corretamente)
5. Criar a transacao diretamente no `pix-pay-qrc` em vez de depender do `pix-pay-dict` para isso

### Detalhes tecnicos

```text
Fluxo atual (quebrado para QR dinamico):
  QR Code -> pix-qrc-info -> extrai chave -> pix-pay-dict -> paga por chave -> DS04 rejeitado

Fluxo corrigido:
  QR Code estatico -> pix-qrc-info -> extrai chave -> pix-pay-dict -> OK
  QR Code dinamico -> pix-qrc-info -> detecta tipo -> pix-pay-qrc paga com EMV completo -> OK
```

**Woovi - payload corrigido para QR dinamico:**
```text
POST /api/v1/payment
{
  "type": "QR_CODE",
  "qrCode": "<EMV completo do QR Code>",
  "value": <valor em centavos>,
  "comment": "Pagamento Pix",
  "correlationID": "<uuid>"
}
```

Isso envia o QR Code completo ao Woovi, que resolve internamente o txid e destinatario, evitando a rejeicao DS04.

### Resultado esperado
- QR Codes dinamicos (COBV) serao pagos corretamente sem rejeicao DS04
- QR Codes estaticos continuarao funcionando via dict
- A transacao sera salva com `pix_type: 'qrcode'` e o EMV completo em `pix_copia_cola`

