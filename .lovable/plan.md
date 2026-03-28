

# Corrigir fluxo: adicionar tela de confirmação ANTES do probe

## Problema atual

No código atual, ao clicar "Continuar" no step 2 (valor + descrição), o probe de R$ 0,01 é disparado **imediatamente**. O usuário quer um passo intermediário de confirmação antes do probe ser enviado.

## Fluxo correto desejado pelo usuário

```text
1. Digita chave Pix → Continuar
2. Digita valor + descrição → Continuar
3. Tela de confirmação (mostra chave, valor, descrição) → botão "Confirmar Pagamento"
4. Ao clicar confirmar → sistema envia probe R$ 0,01 (tela de loading)
5. Probe confirmado → popup/dialog com nome do beneficiário → "Confirmar" ou "Cancelar"
6. Confirmou → envia pagamento real (loading)
7. Status do pagamento (PaymentStatusScreen)
```

## Implementação — 7 steps no PixKeyDialog

| Step | O que mostra |
|------|-------------|
| 1 | Input da chave Pix |
| 2 | Input de valor + descrição |
| 3 | **NOVO** — Resumo para confirmação (chave, valor, descrição) + botão "Confirmar Pagamento" |
| 4 | Loading do probe R$ 0,01 (idêntico ao step 3 atual) |
| 5 | **Popup** com nome do beneficiário + botões Confirmar/Cancelar (idêntico ao step 4 atual) |
| 6 | Loading do pagamento real |
| 7 | PaymentStatusScreen |

### Arquivo: `src/components/pix/PixKeyDialog.tsx`

- Mudar `type Step` de `1-6` para `1-7`
- Step 2 "Continuar" agora vai para step 3 (não dispara probe)
- Step 3 (novo): mostra resumo com chave + valor + descrição + botão "Confirmar Pagamento" que chama `startProbe()`
- Steps 4-7: renumeração dos antigos steps 3-6
- Ajustar `stepIcons`, `stepTitles`, `handleBack`, indicadores de progresso

