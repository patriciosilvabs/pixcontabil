
Problema confirmado: não é mais rota do proxy nem demora da ONZ. O proxy já está devolvendo `LIQUIDATED`, mas o backend de status do boleto está lendo o campo no nível errado da resposta.

O que a análise mostrou
- Nos logs de `pix-check-status`, o retorno vem como:
  ```text
  status=200
  data = { data: { ..., status: "LIQUIDATED", ... } }
  ```
- Em `supabase/functions/pix-check-status/index.ts`, no bloco de boleto, o código usa `const billetData = result.data` e depois lê `billetData.status`.
- Como o `status` está dentro de `result.data.data`, o `rawBilletStatus` fica vazio e o `internal_status` cai em `pending`.
- Por isso a tela fica presa em “Aguardando confirmação”, mesmo com o boleto já liquidado.
- O mesmo erro existe em `supabase/functions/billet-check-status/index.ts`.
- Além disso, o fluxo legado em `src/pages/NewPayment.tsx` ainda usa `startBilletPolling(result.external_id || result.transaction_id)`, o que pode enviar `onz:...` como `billet_id` bruto e causar inconsistência.

Plano de correção
1. Corrigir o parsing do boleto em `supabase/functions/pix-check-status/index.ts`
- Fazer o mesmo “unwrap” que já existe no fluxo Pix:
  - `rawBilletData = result.data`
  - `billetData = rawBilletData?.data ?? rawBilletData`
- Mapear `billetData.status` para `completed/pending/failed/refunded`
- Atualizar `transactions.status`, `paid_at` e `pix_provider_response` usando o payload normalizado
- Manter a regra atual de não rebaixar status final

2. Alinhar `supabase/functions/billet-check-status/index.ts`
- Aplicar o mesmo unwrap da resposta do proxy
- Garantir que qualquer uso legado dessa função também reconheça `LIQUIDATED` corretamente

3. Remover a divergência do fluxo antigo de boleto
- Em `src/pages/NewPayment.tsx` e/ou `src/hooks/useBilletPayment.ts`, parar de iniciar polling com `external_id` bruto
- Preferir `transaction_id` e o mesmo resolvedor usado no fluxo principal (`pix-check-status`)
- Isso evita um cenário em que um fluxo confirma e o outro continua pendente

4. Adicionar logs objetivos de reconciliação
- Logar:
  - se a resposta veio envelopada
  - `provider_status`
  - `internal_status`
  - `transaction_id`
- Isso deixa claro, no próximo teste, se a transação foi reconhecida como concluída já na primeira consulta

Arquivos a ajustar
- `supabase/functions/pix-check-status/index.ts`
- `supabase/functions/billet-check-status/index.ts`
- `src/hooks/useBilletPayment.ts`
- `src/pages/NewPayment.tsx`

Resultado esperado
- Quando o proxy retornar `LIQUIDATED`, o backend responderá `internal_status: completed`
- A tela de boleto sairá de “Aguardando confirmação” e mostrará sucesso
- O status no banco ficará consistente
- Os dois fluxos de boleto ficarão alinhados, sem um usar lógica antiga e outro lógica nova

Detalhes técnicos
- Não precisa mexer no proxy novo
- Não precisa criar webhook novo para este caso
- Não precisa mudar banco nem políticas
- A falha é de shape/parsing da resposta: o código do boleto não está tratando o envelope `{ data: ... }` que o proxy devolve
