

# Adicionar Controle de Acesso por Pagina com Checkboxes

## Objetivo

Permitir que o administrador defina, para cada usuario, quais paginas ele pode acessar. Cada pagina do sistema tera um checkbox no dialog de edicao do usuario, incluindo o Dashboard.

## Nova Tabela no Banco de Dados

Criar uma tabela `user_page_permissions` para armazenar as permissoes de acesso por usuario e empresa:

| Coluna | Tipo | Descricao |
|--------|------|-----------|
| id | uuid (PK) | Identificador |
| user_id | uuid | Referencia ao usuario |
| company_id | uuid | Referencia a empresa |
| page_key | text | Identificador da pagina (ex: "dashboard", "transactions") |
| has_access | boolean | Se o usuario pode acessar |
| created_at | timestamptz | Data de criacao |

Paginas disponiveis como opcoes de checkbox:

- `dashboard` -- Dashboard
- `new_payment` -- Novo Pagamento
- `transactions` -- Transacoes
- `categories` -- Categorias
- `reports` -- Relatorios
- `users` -- Usuarios
- `companies` -- Empresas
- `settings` -- Configuracoes

Admins sempre tem acesso total (nao sao restringidos pelas permissoes).

## Politicas de Seguranca (RLS)

- Admins podem gerenciar todas as permissoes (ALL)
- Membros da empresa podem visualizar suas proprias permissoes (SELECT onde user_id = auth.uid())

## Alteracoes nos Arquivos

### 1. Migracao SQL
- Criar tabela `user_page_permissions`
- Habilitar RLS
- Criar policies para admin (ALL) e usuario (SELECT proprio)
- Inserir permissoes padrao para membros existentes (todas as paginas liberadas)

### 2. `src/pages/Users.tsx`
- Adicionar ao dialog de edicao uma secao "Acesso as Paginas" com checkboxes para cada pagina
- Carregar permissoes atuais do usuario ao abrir o dialog
- Salvar permissoes ao clicar em "Salvar"
- Estado local: `editPermissions` como `Record<string, boolean>`

### 3. `src/contexts/AuthContext.tsx`
- Adicionar `pagePermissions` ao contexto (array de page_keys permitidos)
- Carregar permissoes do usuario ao fazer login (fetchUserData)
- Expor funcao `hasPageAccess(pageKey: string): boolean` que retorna true para admins sempre

### 4. `src/components/auth/AuthGuard.tsx`
- Adicionar prop opcional `requiredPage?: string`
- Verificar se o usuario tem acesso a pagina usando `hasPageAccess`
- Redirecionar para "/" se nao tiver permissao

### 5. `src/App.tsx`
- Adicionar `requiredPage` em cada rota protegida (ex: `requiredPage="dashboard"` no Dashboard)

### 6. `src/components/layout/MainLayout.tsx` e `src/components/layout/BottomTabBar.tsx`
- Ocultar itens de menu para paginas que o usuario nao tem acesso

## Detalhes Tecnicos

- Admins nao sao restringidos -- `hasPageAccess` retorna `true` sempre para role "admin"
- Quando um novo membro e criado, todas as paginas sao liberadas por padrao
- O sistema de permissoes e complementar ao sistema de roles existente (admin/operator)
- Operadores continuam sem ver saldo mesmo tendo acesso ao Dashboard

