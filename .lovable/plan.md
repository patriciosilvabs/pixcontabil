

# Corrigir erro de duplicação de variável no pix-auth

## Problema

O `pix-auth` não consegue inicializar (BootFailure) porque `supabaseAdmin` é declarado duas vezes com `const` — uma na linha 67 e outra na linha 91. Isso causa o erro `Identifier 'supabaseAdmin' has already been declared`, fazendo com que todas as funções que dependem de `pix-auth` (como `pix-pay-dict`) retornem 502.

## Correção

**Arquivo**: `supabase/functions/pix-auth/index.ts`

Remover a segunda declaração duplicada na linha 91:
```typescript
// REMOVER esta linha:
const supabaseAdmin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
```

O `supabaseAdmin` da linha 67 já é suficiente e será reutilizado em todo o resto da função.

Após a correção, reimplantar a Edge Function `pix-auth`.

