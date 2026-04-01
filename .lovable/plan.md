

# Âncora de Memória e Identificação para Pendências

## Resumo

Adicionar dados do beneficiário na tela de captura, campo obrigatório "O que foi pago?" ao salvar sem foto, e melhorar a tela de pendências com contexto completo.

## Alterações

### 1. `src/pages/ReceiptCapture.tsx` — Exibir dados da transação + campo descrição

- No `useEffect` que carrega o status da transação (linha ~67), expandir o `select` para incluir `beneficiary_name, amount, created_at, description`
- Exibir card com: "Pendente: Nota Fiscal para **[NOME]** - R$ [VALOR]" e data/hora
- Adicionar campo de texto "O que foi pago?" (Textarea ou Input)
- **Se foto anexada**: campo descrição é opcional
- **Se "Salvar sem comprovante"**: campo descrição é OBRIGATÓRIO — validar antes de salvar
- No `handleSaveWithoutReceipt`: salvar descrição na transação (`description`) via update
- No `handleSubmit`: salvar descrição se preenchida

### 2. `src/hooks/usePendingReceipts.ts` — Incluir mais dados

- Expandir select para incluir `created_at, description` no retorno
- Atualizar interface `PendingReceipt` com `created_at: string`, `description: string | null`

### 3. `src/components/dashboard/MobileDashboard.tsx` — Melhorar exibição de pendências

- Onde o badge de pendência redireciona, exibir na lista: nome do beneficiário, valor, e a descrição digitada pelo usuário
- Formato: "**Nome** — R$ Valor — *Compra de tomate*"

### 4. Validação cruzada no `handleSubmit`

- "Salvar Comprovante" só funciona se: foto presente E (descrição preenchida OU subcategoria selecionada)
- Atualizar `canSubmit` para incluir check de descrição/classificação

## Detalhes técnicos

- Campo `description` já existe na tabela `transactions` — não precisa de migração
- A descrição serve como "lembrete" para quando o usuário for anexar a foto depois
- O card de identificação usa dados já disponíveis na query existente, apenas expandindo os campos selecionados

## Resultado

- Usuário sabe exatamente para quem pagou ao abrir a tela de captura
- Ao pular foto, é obrigado a descrever o que pagou
- Na lista de pendências, vê nome + valor + descrição para localizar a foto correta

