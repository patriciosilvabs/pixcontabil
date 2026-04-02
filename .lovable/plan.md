
Problema confirmado: o toggle foi aplicado no frontend, mas o bloqueio principal continua ativo no backend.

O que encontrei
- Em `src/pages/Settings.tsx`, o switch salva corretamente `companies.block_on_pending_receipt`.
- Em `src/pages/NewPayment.tsx` e `src/components/dashboard/MobileDashboard.tsx`, o frontend só bloqueia quando `currentCompany?.block_on_pending_receipt !== false`.
- Porém as funções de pagamento no backend ainda ignoram essa configuração e fazem o bloqueio sempre.

Ponto exato da falha
As seguintes funções ainda retornam o erro:
`Você possui comprovante(s) pendente(s). Anexe a nota fiscal antes de realizar um novo pagamento.`

Arquivos afetados:
- `supabase/functions/pix-pay-dict/index.ts`
- `supabase/functions/pix-pay-qrc/index.ts`
- `supabase/functions/billet-pay/index.ts`
- `supabase/functions/batch-pay/index.ts`

Hoje elas fazem:
1. buscar transações concluídas sem comprovante manual;
2. se existir alguma, retornar `403 PENDING_RECEIPT`;
3. sem consultar `companies.block_on_pending_receipt`.

Por isso, mesmo com o toggle desligado, o backend ainda barra o pagamento.

Plano de correção
1. Ajustar a checagem server-side em todas as funções de pagamento
- Antes de validar comprovantes pendentes, buscar a empresa pelo `company_id`.
- Ler `block_on_pending_receipt`.
- Só executar o bloqueio se esse campo for `true`.
- Se for `false`, continuar o pagamento normalmente.

2. Padronizar a lógica nas 4 funções
- Aplicar a mesma regra em:
  - `pix-pay-dict`
  - `pix-pay-qrc`
  - `billet-pay`
  - `batch-pay`
- Evitar divergência futura entre tipos de pagamento.

3. Manter segurança do backend
- O bloqueio não deve depender apenas do frontend.
- A regra precisa continuar no backend, mas agora condicionada à configuração da empresa.
- Se a coluna vier nula por qualquer motivo, tratar como `true` para manter comportamento seguro.

4. Validar o comportamento esperado
Cenário A — toggle desligado:
- aviso pode continuar visível no app;
- pagamento novo deve seguir normalmente;
- backend não deve retornar `PENDING_RECEIPT`.

Cenário B — toggle ligado:
- backend continua barrando nova transação quando houver comprovante pendente;
- mensagem atual pode ser mantida.

Detalhes técnicos
Padrão esperado dentro das funções:
```text
buscar company -> verificar block_on_pending_receipt -> 
se true, rodar pendency check -> se false, pular check
```

Exemplo da lógica a inserir:
```text
const { data: company } = await supabaseAdmin
  .from('companies')
  .select('block_on_pending_receipt')
  .eq('id', company_id)
  .single();

const shouldBlock = company?.block_on_pending_receipt !== false;

if (shouldBlock) {
  // lógica atual de completedTxs + receipts
}
```

Resultado esperado
- Com o toggle desligado, o sistema para de exigir anexo antes de um novo pagamento.
- O comportamento fica consistente entre tela e backend.
- A mensagem vermelha do print deixa de aparecer nesses casos.
