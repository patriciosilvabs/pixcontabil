

# Implementar probe de R$ 0,01 no NewPayment.tsx (desktop)

## Problema

O fluxo de verificação de beneficiário (probe R$ 0,01) foi implementado apenas no `PixKeyDialog.tsx` (mobile). O usuário está usando a página desktop `NewPayment.tsx`, que ainda envia o valor original diretamente sem probe.

## Solução

Adicionar a mesma lógica de probe no `NewPayment.tsx` para pagamentos por chave Pix:

1. Quando o usuário clica "Confirmar Pagamento" com tipo `key`:
   - Enviar probe R$ 0,01 via `payByKey` com `descricao: "Verificação de beneficiário"`
   - Mostrar loading "Verificando beneficiário..."
   - Fazer polling até o probe completar
   - Buscar nome do beneficiário via `getTransactionBeneficiary`

2. Exibir um **Dialog/Modal** de confirmação com:
   - Nome do beneficiário retornado
   - Valor original que será transferido
   - Botões "Confirmar e Pagar" / "Cancelar"

3. Se confirmar → executar `payByKey` com o valor original e navegar para receipt
4. Se cancelar → fechar o dialog, não envia nada

## Arquivos alterados

| Arquivo | Alteração |
|---|---|
| `src/pages/NewPayment.tsx` | Adicionar estados de probe, dialog de confirmação, lógica de polling — mesma lógica do PixKeyDialog mas adaptada ao layout desktop com cards |

## Detalhes técnicos

- Reutilizar `getTransactionBeneficiary` e `checkStatus` do `usePixPayment` (já disponíveis)
- Usar um `Dialog` (não Drawer) para o popup de confirmação no desktop
- Manter o fluxo de boleto, copy/paste e QR code inalterados
- O probe só se aplica ao tipo `key`

