

# Corrigir erro de sintaxe na edge function `pix-pay-qrc`

## Problema

A edge function `pix-pay-qrc` **não está funcionando** — ela nem inicia. Os logs mostram:

```
ERROR worker boot error: Uncaught SyntaxError: Identifier 'supabaseAdmin' has already been declared
```

A variável `const supabaseAdmin` é declarada na **linha 49** (início do `try` block) e novamente na **linha 307** (mesmo nível de escopo). O Deno rejeita isso e a função inteira falha, causando o erro "Conexão perdida" no frontend.

## Solução

Remover a redeclaração duplicada na linha 307 — reutilizar a variável `supabaseAdmin` já declarada na linha 49.

### `supabase/functions/pix-pay-qrc/index.ts`

- **Linha 307**: trocar `const supabaseAdmin = createClient(...)` por simplesmente reutilizar o `supabaseAdmin` já existente (remover o `const` e a chamada `createClient`)
- Alternativa mais limpa: como o `supabaseAdmin` da linha 49 já é o mesmo client, basta **deletar** a linha 307 inteira

Nenhuma outra alteração necessária — o problema é puramente essa redeclaração.

