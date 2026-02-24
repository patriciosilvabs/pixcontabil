

# Fix: Pagamento de QR Code Dinamico retornando 502 (404 do ONZ)

## Problema
O endpoint `/pix/payments/qrcode` nao existe na API ONZ v2. Quando o sistema detecta um QR Code dinamico, ele tenta enviar o pagamento para esse endpoint inexistente, resultando em 404 do provedor e 502 para o usuario.

O endpoint que funciona e o `/pix/payments/dict` (usado pelo `pix-pay-dict` para pagamentos por chave Pix).

## Solucao
Para QR Codes dinamicos, em vez de tentar um endpoint inexistente, delegar para o `pix-pay-dict` usando a chave Pix extraida do QR Code (que ja vem do `pix-qrc-info`). Essa abordagem e identica ao que ja funciona para QR Codes estaticos.

## Alteracoes

### 1. `supabase/functions/pix-pay-qrc/index.ts`
- Remover o bloco de pagamento nativo via `/pix/payments/qrcode` (linhas 149-212)
- Substituir por delegacao ao `pix-pay-dict` usando a chave Pix extraida do QR Code dinamico
- Manter a logica de salvar a transacao com `pix_type: 'qrcode'` e `pix_copia_cola` para rastreabilidade
- Se a chave Pix nao estiver disponivel no QR Code dinamico, retornar erro informativo

### Fluxo apos a correcao

```text
QR Code escaneado
       |
  pix-qrc-info (decodifica EMV localmente)
       |
  pix-pay-qrc
       |
       +-- Estatico --> pix-pay-dict (chave Pix) --> OK
       |
       +-- Dinamico --> pix-pay-dict (chave Pix extraida) --> OK
                         |
                    Atualiza transacao com pix_type='qrcode'
```

### Detalhes tecnicos
- O `pix-qrc-info` ja extrai a `pix_key` de QR Codes dinamicos (campo `chave` do payload COBV)
- O `pix-pay-dict` usa o endpoint `/pix/payments/dict` que funciona corretamente com a ONZ
- Apos o pagamento via `pix-pay-dict`, a transacao sera atualizada para marcar como `pix_type: 'qrcode'` e salvar o `pix_copia_cola` original

