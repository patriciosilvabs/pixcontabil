

## Plano: Pagamento em Lote

### Análise da API ONZ

A API da ONZ **não possui endpoint nativo de pagamento em lote**. Os endpoints disponíveis são todos unitários:
- `POST /pix/payments/dict` — Pix por chave (unitário)
- `POST /pix/payments/qrc` — Pix por QR Code (unitário)
- `POST /billets/payments` — Boleto (unitário)

A Transfeera já suporta batch via `POST /batch`, que o sistema já utiliza.

**Conclusão:** Para ONZ, o pagamento em lote será orquestrado no backend — uma Edge Function que recebe um array de pagamentos e os executa sequencialmente (com idempotency key individual), salvando cada transação e retornando o resultado consolidado.

---

### Arquitetura

```text
┌─────────────────┐     ┌──────────────────────┐     ┌──────────────────┐
│  Nova página     │────▶│  Edge Function         │────▶│  ONZ (unitário)  │
│  /batch-payment │     │  batch-pay             │     │  N chamadas      │
│  Upload CSV/     │     │  Loop sequencial com   │     │  sequenciais     │
│  entrada manual  │     │  idempotency por item  │     └──────────────────┘
└─────────────────┘     └──────────────────────┘
```

### O que será construído

#### 1. Edge Function `batch-pay`
- Recebe array de pagamentos `{ items: [{ type: 'pix_key'|'boleto', pix_key?, pix_key_type?, codigo_barras?, valor, descricao }] }`
- Limite de 50 itens por lote
- Para cada item: autentica (reusa token), executa pagamento unitário via proxy ONZ, salva transação no banco
- Retorna resultado consolidado: `{ results: [{ index, success, transaction_id, error? }], summary: { total, success_count, failed_count } }`
- Cada item tem sua própria idempotency key

#### 2. Nova página `/batch-payment`
- **Modo 1 — Upload CSV**: Importar arquivo CSV com colunas (tipo, chave/código, valor, descrição)
- **Modo 2 — Entrada manual**: Tabela editável para adicionar linhas de pagamento uma a uma
- Preview/validação antes de confirmar: mostra tabela com todos os pagamentos, valores totais
- Botão "Executar Lote" com confirmação
- Progress bar em tempo real mostrando X de N processados
- Resultado final: tabela com status de cada pagamento (sucesso/falha)

#### 3. Rota e navegação
- Adicionar rota `/batch-payment` no App.tsx
- Adicionar link no menu/dashboard para "Pagamento em Lote"

### Arquivos a criar/alterar

| Arquivo | Ação |
|---------|------|
| `supabase/functions/batch-pay/index.ts` | Criar — Edge Function de lote |
| `src/pages/BatchPayment.tsx` | Criar — Página principal |
| `src/hooks/useBatchPayment.ts` | Criar — Hook para orquestrar chamadas |
| `src/App.tsx` | Alterar — Adicionar rota |
| `src/components/layout/BottomTabBar.tsx` | Alterar — Adicionar atalho (se couber) |
| `supabase/config.toml` | Alterar — Adicionar `verify_jwt = false` para batch-pay |

### Detalhes técnicos

- A Edge Function processará itens **sequencialmente** (não em paralelo) para evitar rate limiting da ONZ e manter controle de erros
- Timeout da Edge Function: ~150s no Supabase. Com ~2s por pagamento, suporta ~50 itens
- Se um item falhar, os demais continuam (fail-safe por item)
- CSV esperado: `tipo;chave;valor;descricao` com separador `;` (padrão BR) ou `,`

