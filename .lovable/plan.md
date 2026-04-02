

## Configuração de Bloqueio por Comprovante Pendente

### O que muda

Hoje o sistema sempre bloqueia novos pagamentos quando há comprovantes pendentes. Vamos tornar isso uma configuração por empresa, que o admin pode ligar/desligar na tela de Configurações.

### Plano

**1. Criar coluna `block_on_pending_receipt` na tabela `companies`**

Migração SQL:
```sql
ALTER TABLE public.companies 
ADD COLUMN block_on_pending_receipt boolean NOT NULL DEFAULT true;
```

Default `true` mantém o comportamento atual. Admin pode desativar.

**2. Expor a configuração no AuthContext**

- Ao carregar `currentCompany`, o valor de `block_on_pending_receipt` já estará disponível.
- Atualizar `types/database.ts` (interface `Company`) para incluir o novo campo.
- No `AuthContext`, expor via `currentCompany.block_on_pending_receipt`.

**3. Remover bloqueio condicional no frontend**

Em `NewPayment.tsx` e `MobileDashboard.tsx`, o check de `pendingCount > 0` passa a ser:
```typescript
if (currentCompany?.block_on_pending_receipt && pendingCount > 0) { ... }
```

Se desativado, o aviso de pendência continua visível no dashboard (badge informativo), mas não impede novos pagamentos.

**4. Adicionar toggle na página Settings**

Na tela `/settings`, adicionar um card "Regras de Operação" (visível só para admin) com um Switch:
- Label: "Bloquear novos pagamentos quando houver comprovantes pendentes"
- Descrição: "Se ativado, o operador deve anexar o comprovante antes de realizar outro pagamento."
- Ao mudar, atualiza `companies.block_on_pending_receipt` via Supabase e chama `refreshProfile` para propagar.

### Arquivos alterados
- **Migração SQL**: nova coluna em `companies`
- `src/types/database.ts`: adicionar campo na interface `Company`
- `src/pages/Settings.tsx`: novo card com Switch para admin
- `src/pages/NewPayment.tsx`: condicionar bloqueio
- `src/components/dashboard/MobileDashboard.tsx`: condicionar bloqueio
- `src/components/layout/MainLayout.tsx`: manter badge informativo mesmo sem bloqueio

