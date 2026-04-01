

# Adicionar Campo "Nome da Empresa" nos Pagamentos QR Code e Boleto

## Problema

Nos fluxos de QR Code e Boleto, o sistema não solicita o nome da empresa que está recebendo o pagamento, dificultando o rastreamento.

## Solução

Adicionar um campo obrigatório "Nome da Empresa" na etapa de confirmação de ambos os fluxos. O campo será pré-preenchido com dados disponíveis (nome do recebedor do QR ou beneficiário do boleto) e salvo no campo `beneficiary_name` da tabela `transactions`.

## Alterações

### 1. `src/components/pix/PixQrPaymentDrawer.tsx`
- Adicionar input "Nome da Empresa *" no Step 3 (confirmação), pré-preenchido com `merchantName`
- Validar que o campo está preenchido antes de confirmar
- Salvar no update da transaction como `beneficiary_name`

### 2. `src/components/payment/BoletoPaymentDrawer.tsx`
- Adicionar input "Nome da Empresa *" no Step 2 (confirmação), pré-preenchido com `consultInfo.recipient_name`
- Validar que o campo está preenchido antes de confirmar
- Passar como `beneficiary_name` junto com a descrição

## Arquivos modificados

| Arquivo | Alteração |
|---|---|
| `src/components/pix/PixQrPaymentDrawer.tsx` | Input obrigatório + validação + salvar beneficiary_name |
| `src/components/payment/BoletoPaymentDrawer.tsx` | Input obrigatório + validação + salvar beneficiary_name |

