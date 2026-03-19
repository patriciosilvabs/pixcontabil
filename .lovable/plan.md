
Objetivo: eliminar os erros `406 (Not Acceptable)` ao salvar permissões de funcionalidades na tela `/users` e reduzir o ruído no console sem mudar a regra de negócio.

1. Diagnóstico confirmado
- O problema está em `src/pages/Users.tsx`, no fluxo de salvar permissões.
- Hoje o código faz consultas com `.single()` para verificar se já existe um registro em:
  - `user_page_permissions`
  - `user_feature_permissions`
- Quando não existe linha, a API responde `406` com `PGRST116` (“0 rows”), e depois o código faz `insert`, então a operação funciona, mas gera erro no console.
- Isso aparece principalmente em `user_feature_permissions` porque essa tabela não foi pré-populada por migration, diferente de `user_page_permissions`.

2. Ajuste principal
- Trocar a estratégia “buscar com `.single()` e depois decidir entre update/insert” por uma destas abordagens:
  - Preferencial: `upsert` com conflito em `(user_id, company_id, feature_key)` e `(user_id, company_id, page_key)`.
  - Alternativa segura: usar `.maybeSingle()` em vez de `.single()`.
- Minha recomendação é `upsert`, porque:
  - elimina os `406`
  - reduz o número de requests
  - simplifica bastante o `handleSave`

3. Refactor no fluxo de salvamento
- Em `handleSave`, substituir os loops com `select -> update/insert` por:
  - um `upsert` em lote para `user_page_permissions`
  - um `upsert` em lote para `user_feature_permissions`
- Manter a montagem atual de `permRows` e `featureRows`, apenas mudando a forma de persistir.

4. Compatibilidade com o banco
- As duas tabelas já têm `UNIQUE` nos campos corretos:
  - `user_page_permissions (user_id, company_id, page_key)`
  - `user_feature_permissions (user_id, company_id, feature_key)`
- Então não deve ser necessária mudança estrutural no banco para usar `upsert`.

5. Resultado esperado
- Salvar permissões continuará funcionando igual.
- Os erros `406` deixarão de aparecer no console.
- O salvamento ficará mais rápido e com menos chamadas à API.

6. Limpeza adicional recomendada
- Corrigir também os avisos de acessibilidade `Missing Description or aria-describedby` nos `DialogContent`, começando por:
  - `src/pages/Users.tsx`
  - `src/pages/Companies.tsx`
  - `src/pages/Categories.tsx`
  - `src/pages/WebhookEvents.tsx`
- Isso não afeta a lógica, mas remove warnings recorrentes do console.

Detalhes técnicos
```text
Hoje:
select().single() -> 0 rows -> 406 -> insert()

Depois:
upsert([...], { onConflict: 'user_id,company_id,feature_key' })
upsert([...], { onConflict: 'user_id,company_id,page_key' })
```

Arquivos a alterar
- `src/pages/Users.tsx`
- Opcional na mesma rodada de limpeza:
  - `src/pages/Companies.tsx`
  - `src/pages/Categories.tsx`
  - `src/pages/WebhookEvents.tsx`

Validação após implementar
- Abrir edição de um usuário sem permissões prévias salvas
- Marcar/desmarcar funcionalidades
- Salvar
- Confirmar:
  - toast de sucesso
  - nenhuma resposta `406` no console/network
  - permissões persistidas corretamente ao reabrir o modal
