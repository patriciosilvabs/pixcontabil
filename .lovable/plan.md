
# Limpeza Total de Pendências + Marco Zero em 01/04/2026

## Resumo

Atualizar o marco zero para hoje (01/04/2026), regularizar todas as 655 transações pendentes via UPDATE em massa, garantir filtro de R$ 0,01 em todos os pontos, e forçar refresh imediato do cache.

## Alterações

### 1. Atualizar constante de cut-off — `src/constants/app.ts`

Mudar `RECEIPT_CUTOFF_DATE` de `"2025-05-22T00:00:00Z"` para `"2026-04-01T00:00:00Z"`.

### 2. Atualizar cut-off nas Edge Functions — `pix-pay-dict`, `pix-pay-qrc`, `billet-pay`

Substituir `'2025-05-22T00:00:00Z'` por `'2026-04-01T00:00:00Z'` na query de pendência server-side de cada uma das 3 funções. Redesplotar as 3 funções.

### 3. Script de regularização em massa (SQL INSERT tool)

Executar via insert tool (pois é UPDATE):

```sql
UPDATE public.transactions
SET classified_at = now(),
    description = COALESCE(NULLIF(description, ''), 'Histórico regularizado')
WHERE status = 'completed'
  AND created_at < '2026-04-01T00:00:00Z'
  AND classified_at IS NULL;
```

Isso marca ~655 transações antigas como "resolvidas", removendo-as da fila de bloqueio mesmo que o filtro de data falhe.

### 4. Verificar filtro `.gt("amount", 0.01)` em todos os pontos

Já confirmado presente em:
- `usePendingReceipts.ts` (linhas 45, 57) ✅
- `pix-pay-dict` (linha 133) ✅
- `pix-pay-qrc` (linha 59) ✅
- `billet-pay` (linha 107) ✅

Falta verificar e adicionar no `batch-pay/index.ts` — este **não tem** o check de pendência. Adicionar.

### 5. Forçar invalidação de cache — `usePendingReceipts.ts`

Adicionar um `cacheVersion` baseado no `RECEIPT_CUTOFF_DATE` como dependência do `useCallback`, garantindo que ao publicar a nova constante, o hook re-execute automaticamente. O hook atual já depende de `user?.id` e `currentCompany?.id`, e como a constante muda no build, o refresh é automático.

Adicionalmente, invalidar o dashboard cache via `invalidateDashboardCache()` no `MobileDashboard` ao montar, para garantir dados frescos.

### 6. Adicionar pendency check em `batch-pay/index.ts`

O `batch-pay` não tem verificação de pendência. Adicionar o mesmo bloco server-side antes de processar o lote.

## Arquivos modificados

| Arquivo | Alteração |
|---|---|
| `src/constants/app.ts` | `RECEIPT_CUTOFF_DATE = "2026-04-01T00:00:00Z"` |
| `supabase/functions/pix-pay-dict/index.ts` | Cutoff → `2026-04-01` |
| `supabase/functions/pix-pay-qrc/index.ts` | Cutoff → `2026-04-01` |
| `supabase/functions/billet-pay/index.ts` | Cutoff → `2026-04-01` |
| `supabase/functions/batch-pay/index.ts` | Adicionar pendency check completo |
| SQL (insert tool) | UPDATE em massa para regularizar transações antigas |

## Resultado esperado

- 655 transações pendentes deixam de bloquear instantaneamente (cutoff + UPDATE)
- Novos pagamentos só são bloqueados por transações criadas a partir de hoje
- Probes de R$ 0,01 continuam isentos
- batch-pay agora tem a mesma trava que os outros endpoints
