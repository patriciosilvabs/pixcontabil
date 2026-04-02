

## Correção: Adicionar status faltantes no `pix-check-status`

### Situação atual

Correções 1 e 2 do plano anterior **já foram aplicadas** em mensagens anteriores:
- `pix-webhook/index.ts` já possui `PAID`, `COMPLETED` e `ON_QUEUE` no statusMap (linhas 140-151)
- `billet-consult/index.ts` já envia `linhaDigitavel`, `valor`, `descricao` (linhas 170-175)

### Única alteração necessária

**`supabase/functions/pix-check-status/index.ts`** — linha 293-298

O segundo `billetStatusMap` (usado no fluxo Transfeera/genérico, diferente do primeiro na linha 205 que já está completo) está faltando `COMPLETED` e `ON_QUEUE`:

```typescript
// ANTES (linha 293-298):
const billetStatusMap: Record<string, string> = {
  'LIQUIDATED': 'completed', 'PAID': 'completed',
  'PROCESSING': 'pending', 'CREATED': 'pending', 'SCHEDULED': 'pending',
  'CANCELED': 'failed', 'FAILED': 'failed',
  'REFUNDED': 'refunded',
};

// DEPOIS:
const billetStatusMap: Record<string, string> = {
  'LIQUIDATED': 'completed', 'PAID': 'completed', 'COMPLETED': 'completed',
  'PROCESSING': 'pending', 'CREATED': 'pending', 'SCHEDULED': 'pending', 'ON_QUEUE': 'pending',
  'CANCELED': 'failed', 'FAILED': 'failed',
  'REFUNDED': 'refunded',
};
```

### Após a alteração
- Testar polling do boleto `13351767` via `pix-check-status` para confirmar que o proxy v3.0 retorna status corretamente

### O que NÃO será alterado
- Nenhum outro arquivo
- Nenhuma lógica de negócio
- Nenhum endpoint ou payload

