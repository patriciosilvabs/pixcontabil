
## Isolamento de dados por usuario (operador vs admin)

### Problema

Atualmente, os dados de transacoes no dashboard e nos pagamentos recentes mostram **todas as transacoes da empresa** para qualquer usuario, incluindo operadores. Apenas a pagina de Historico (Transactions) ja filtra corretamente.

A regra de negocio e:
- **Operador**: ve somente suas proprias transacoes e pagamentos
- **Admin**: ve todas as transacoes de todos os usuarios da empresa

### O que sera corrigido

| Local | Situacao atual | Correcao |
|-------|---------------|----------|
| Dashboard (resumo + transacoes recentes) | Mostra tudo da empresa | Filtrar por `created_by = user.id` para operadores |
| Pagamentos Recentes (RecentPayments) | Mostra todos da empresa | Filtrar por `created_by = user.id` para operadores |
| Historico de Transacoes | Ja filtra corretamente | Nenhuma alteracao |
| Relatorios | Acesso restrito a admins | Nenhuma alteracao |

### Arquivos a modificar

#### 1. `src/hooks/useDashboardData.ts`

- Importar `isAdmin` e `user` do `useAuth()`
- Na query de transacoes do mes, adicionar `.eq("created_by", user.id)` quando o usuario **nao for admin**
- Isso garante que o resumo (custos, despesas, totais) e as transacoes recentes do dashboard reflitam apenas os dados do proprio operador

#### 2. `src/components/payment/RecentPayments.tsx`

- Importar `isAdmin` e `user` do `useAuth()`
- Na query de pagamentos recentes, adicionar `.eq("created_by", user.id)` quando o usuario **nao for admin**
- Isso garante que a lista "Ultimos Pagamentos" (usada para repetir pagamentos) mostre apenas os pagamentos feitos pelo proprio operador

### Detalhes tecnicos

Em ambos os arquivos, a logica sera:

```text
const { currentCompany, isAdmin, user } = useAuth();

let query = supabase.from("transactions").select(...)
  .eq("company_id", currentCompany.id);

if (!isAdmin && user) {
  query = query.eq("created_by", user.id);
}
```

Este e o mesmo padrao ja utilizado em `Transactions.tsx`.

### O que NAO muda

- A pagina de Relatorios continua mostrando dados globais (acesso restrito a admins pelo AuthGuard)
- As politicas RLS do banco permanecem inalteradas (a filtragem e feita no nivel da aplicacao, como ja esta implementado em Transactions.tsx)
- A estrutura visual dos componentes nao sera alterada
