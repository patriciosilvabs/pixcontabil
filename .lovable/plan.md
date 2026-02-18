

## Correção do endpoint Cash-out da Paggue

### Problema
O erro `"User does not have the right permissions"` ocorre porque as edge functions estão chamando o endpoint **errado** da API Paggue.

**Endpoint atual (incorreto):**
`https://ms.paggue.io/cashout/api/cash-out`

**Endpoint correto (da documentação):**
`https://ms.paggue.io/cashout/api/integration/cash-out`

O path `/integration/` é obrigatório para chamadas via API. O path sem `/integration/` provavelmente é reservado para uso interno do painel da Paggue, por isso retorna erro de permissão.

### Alterações

**1. `supabase/functions/pix-pay-dict/index.ts`**
- Linha 204: Alterar URL de `https://ms.paggue.io/cashout/api/cash-out` para `https://ms.paggue.io/cashout/api/integration/cash-out`

**2. `supabase/functions/pix-pay-qrc/index.ts`**
- Linha 309: Alterar URL de `https://ms.paggue.io/cashout/api/cash-out` para `https://ms.paggue.io/cashout/api/integration/cash-out`

### Reimplantacao
Ambas as edge functions serao reimplantadas automaticamente apos a alteracao.

