

## Checkbox "Acesso ao Saldo" na edicao de usuario

### Problema

Atualmente, o saldo e visivel para todos que tem acesso ao Dashboard (admins veem o valor real, operadores veem "---"). A necessidade e ter um controle granular: alguns usuarios com acesso ao Dashboard devem poder ver o saldo, outros nao.

### Solucao

Adicionar uma coluna `can_view_balance` na tabela `company_members` e um checkbox dedicado "Visualizar Saldo" no dialogo de edicao de usuario. O Dashboard usara essa permissao para decidir se mostra o saldo ou oculta.

### Alteracoes

#### 1. Migracao no banco de dados

- Adicionar coluna `can_view_balance BOOLEAN DEFAULT false` na tabela `company_members`
- Admins terao o valor `true` por padrao ao serem criados

#### 2. `src/types/database.ts` -- Atualizar tipo CompanyMember

- Adicionar `can_view_balance?: boolean` a interface `CompanyMember`

#### 3. `src/pages/Users.tsx` -- Adicionar checkbox no dialogo de edicao

- Novo estado `editCanViewBalance`
- Carregar valor ao abrir edicao (`openEdit`)
- Checkbox "Visualizar Saldo" abaixo do limite de pagamento, separado das permissoes de pagina
- Salvar no `handleSave` via update em `company_members`

#### 4. `src/contexts/AuthContext.tsx` -- Expor `canViewBalance`

- Ler `can_view_balance` do `companyMembership` e expor como `canViewBalance` no contexto

#### 5. `src/components/dashboard/AdminDashboard.tsx` -- Condicionar exibicao do saldo

- Usar `canViewBalance` do contexto
- Se `false`, mostrar card de saldo oculto (mesmo estilo do OperatorDashboard)

#### 6. `src/components/dashboard/OperatorDashboard.tsx` -- Condicionar exibicao do saldo

- Usar `canViewBalance` do contexto
- Se `true`, mostrar saldo real em vez de "---"

#### 7. `src/components/dashboard/MobileDashboard.tsx` -- Condicionar exibicao do saldo

- Receber `canViewBalance` como prop
- Se `false`, ocultar valor do saldo

### Detalhes tecnicos

A logica de visibilidade sera:

```text
canViewBalance = companyMembership?.can_view_balance ?? isAdmin
```

Isso garante que admins veem o saldo por padrao (retrocompativel), e operadores so veem se explicitamente autorizado.

No dialogo de edicao, o checkbox aparecera assim:

```text
Limite de Pagamento (R$)
[___100___]

[x] Visualizar Saldo da Conta    <-- novo checkbox

Acesso as Paginas
[x] Dashboard    [x] Novo Pagamento
...
```

