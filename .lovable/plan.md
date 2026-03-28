

# Simplificar fluxo Pix por chave — 6 steps + seletor de tipo de chave

## O que muda

O fluxo atual tem 7 steps com uma tela intermediária de "Confirmar Dados" (step 3) que é desnecessária. O usuário quer que ao clicar "Continuar" no valor, o probe já dispare imediatamente.

Além disso, as screenshots mostram que o step 1 deve ter um seletor de **Tipo de chave** (CPF, CNPJ, E-mail, Telefone, Chave aleatória) antes do campo de chave.

## Fluxo simplificado (6 steps)

| Step | Conteúdo |
|------|----------|
| 1 | Tipo de chave (select) + Chave Pix (input) |
| 2 | Valor (R$) + Descrição |
| 3 | Loading — probe R$ 0,01 enviado automaticamente ao clicar "Continuar" no step 2 |
| 4 | Popup com nome do beneficiário + botões Confirmar / Cancelar |
| 5 | Loading — pagamento real com valor original |
| 6 | PaymentStatusScreen |

## Alterações em `src/components/pix/PixKeyDialog.tsx`

1. **Adicionar seletor "Tipo de chave"** no step 1 com opções: CPF, CNPJ, E-mail, Telefone, Chave aleatória — com placeholder dinâmico no input conforme o tipo selecionado
2. **Remover step 3 antigo** (tela de confirmação/resumo) — `handleStep2` agora chama `startProbe()` diretamente
3. **Renumerar de 7 para 6 steps** — ajustar `type Step`, `stepIcons`, `stepTitles`, `handleBack`, indicadores de progresso
4. Manter toda a lógica de probe, polling, retry de beneficiário e pagamento real sem alteração

