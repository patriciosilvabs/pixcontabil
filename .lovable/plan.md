

# Pix com Verificação de Beneficiário via Micro-Pagamento (R$ 0,01)

## Contexto

A API da ONZ não possui endpoint DICT para consultar o nome do beneficiário antes do pagamento. A solução é enviar um Pix de R$ 0,01 (probe), capturar o nome do beneficiário no retorno, mostrar ao usuário para confirmação e só então executar o pagamento real.

## Fluxo proposto

```text
Usuário informa chave + valor + descrição
→ Clica "Confirmar Pagamento"
→ Sistema envia R$ 0,01 (probe) via pix-pay-dict
→ Polling aguarda confirmação do probe
→ Backend extrai beneficiary_name da resposta ONZ
→ Tela mostra: "Beneficiário: Fulano de Tal — CPF: ***"
→ Usuário confirma → sistema envia pagamento real (R$ 100,00)
→ Usuário cancela → probe já foi liquidado (R$ 0,01 perdido)
```

## Novo fluxo de steps no PixKeyDialog

Hoje: 4 steps (chave → valor → confirmação → status)

Novo: 6 steps:
1. **Chave Pix** (igual)
2. **Valor + Descrição** (igual)
3. **Verificando beneficiário** — envia probe R$ 0,01, polling aguarda completed, extrai nome
4. **Confirmação com beneficiário real** — mostra nome + documento + valor original e pede confirmação
5. **Processando pagamento real** — envia o valor cheio
6. **Status do pagamento** — polling do pagamento real (igual ao step 4 atual)

## Implementação

### 1. Frontend — `src/components/pix/PixKeyDialog.tsx`
- Expandir de 4 para 6 steps
- Step 3 (novo): chama `payByKey` com `valor: 0.01` e `descricao: "Verificação de beneficiário"`, depois faz polling via `checkStatus` até completar. Quando completar, busca a transação no banco para pegar `beneficiary_name` e `beneficiary_document`
- Step 4 (novo): tela de confirmação mostrando nome real, documento (mascarado), valor original (ex: R$ 100), com botões "Confirmar" e "Cancelar"
- Step 5: executa `payByKey` com o valor real
- Step 6: `PaymentStatusScreen` do pagamento real

### 2. Frontend — `src/hooks/usePixPayment.ts`
- Adicionar função `getTransactionDetails(transactionId)` que busca `beneficiary_name` e `beneficiary_document` da tabela `transactions` após o probe completar

### 3. Backend — `supabase/functions/pix-pay-dict/index.ts`
- Marcar transações de probe (`valor === 0.01` e descrição contém "Verificação") com um campo ou flag para não poluir relatórios
- Alternativa: adicionar campo `is_probe` na descrição ou metadata do `pix_provider_response`

### 4. Tratamento de probe na tabela transactions
- Adicionar coluna `is_probe` (boolean, default false) para distinguir o micro-pagamento dos pagamentos reais — ou simplesmente filtrar por `amount = 0.01` e `description LIKE '%Verificação%'` nos relatórios

## Decisão sobre a coluna `is_probe`

Para manter os relatórios limpos e não exigir migração, vou usar a abordagem sem nova coluna: o probe será salvo normalmente com `description = 'Verificação de beneficiário'` e `amount = 0.01`. Nos relatórios e listagens, podemos filtrar esses registros se necessário no futuro.

## Arquivos que serão alterados

| Arquivo | Alteração |
|---|---|
| `src/components/pix/PixKeyDialog.tsx` | Novo fluxo de 6 steps com probe + confirmação |
| `src/hooks/usePixPayment.ts` | Nova função `getTransactionBeneficiary()` |

## Riscos e mitigações

- **R$ 0,01 perdido se cancelar**: valor insignificante, aceitável como custo de verificação
- **Probe falha**: se o probe falhar, mostra erro e não avança — o usuário não perde nada além dos R$ 0,01
- **Latência extra**: o probe adiciona ~5-15s ao fluxo total (tempo de liquidação)
- **Idempotência**: o probe e o pagamento real terão `idempotency_key` diferentes, sem conflito

