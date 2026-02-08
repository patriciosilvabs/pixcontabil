
# Criação das Páginas Administrativas Faltantes

## Resumo
Implementar as 5 páginas que aparecem no menu lateral mas ainda não existem: **Categorias**, **Relatórios**, **Usuários**, **Empresas** e **Configurações**.

---

## Páginas a Criar

| Página | Rota | Acesso | Função |
|--------|------|--------|--------|
| Categorias | `/categories` | Admin | CRUD de categorias (Custos vs Despesas) |
| Relatórios | `/reports` | Admin | Relatórios financeiros e exportação |
| Usuários | `/users` | Admin | Gerenciar usuários e permissões |
| Empresas | `/companies` | Admin | CRUD de empresas |
| Configurações | `/settings` | Todos | Configurações da conta e sistema |

---

## Detalhamento por Página

### 1. Categorias (`/categories`)
**Funcionalidades:**
- Listar todas as categorias da empresa
- Criar nova categoria (nome, classificação: Custo/Despesa)
- Editar categoria existente
- Desativar categoria
- Filtrar por classificação (Custos / Despesas)
- Keywords para auto-classificação OCR

**Componentes:**
- Tabela com colunas: Nome, Classificação, Status, Ações
- Modal de criação/edição
- Filtros por tipo

---

### 2. Relatórios (`/reports`)
**Funcionalidades:**
- Resumo financeiro por período
- Gráfico de Custos vs Despesas
- Tabela de transações por categoria
- Exportar para CSV/PDF
- Filtros de data (hoje, semana, mês, personalizado)

**Componentes:**
- Cards de resumo (total saídas, custos, despesas)
- Gráficos (já temos Recharts instalado)
- Tabela detalhada
- Botões de exportação

---

### 3. Usuários (`/users`)
**Funcionalidades:**
- Listar usuários da empresa
- Convidar novo usuário
- Alterar role (admin/operador)
- Definir limite de pagamento por usuário
- Desativar usuário

**Componentes:**
- Lista de usuários com avatar
- Badge de role (Admin/Operador)
- Modal de convite
- Input para limite de pagamento

---

### 4. Empresas (`/companies`)
**Funcionalidades:**
- Listar todas as empresas
- Criar nova empresa
- Editar dados (nome, CNPJ, endereço)
- Upload de logo
- Desativar empresa

**Componentes:**
- Cards de empresas
- Modal de criação/edição
- Upload de imagem

---

### 5. Configurações (`/settings`)
**Funcionalidades:**
- Dados do perfil (nome, email, telefone)
- Alterar senha
- Upload de foto de perfil
- Links para sub-páginas (Integração Pix, etc)
- Tema claro/escuro (futuro)

**Componentes:**
- Form de perfil
- Seção de segurança
- Menu de navegação para sub-configurações

---

## Estrutura de Arquivos

```text
src/pages/
├── Categories.tsx          (CRIAR)
├── Reports.tsx             (CRIAR)
├── Users.tsx               (CRIAR)
├── Companies.tsx           (CRIAR)
├── Settings.tsx            (CRIAR)
└── settings/
    └── PixIntegration.tsx  (já existe)
```

---

## Fluxo de Implementação

```text
                    ┌─────────────────┐
                    │   App.tsx       │
                    │  (add rotas)    │
                    └────────┬────────┘
                             │
        ┌────────────────────┼────────────────────┐
        │                    │                    │
        ▼                    ▼                    ▼
┌───────────────┐  ┌───────────────┐   ┌───────────────┐
│  Categories   │  │    Reports    │   │    Settings   │
│  (CRUD cats)  │  │  (gráficos)   │   │  (perfil)     │
└───────────────┘  └───────────────┘   └───────────────┘
        │
        ├──────────────────────────────────────────┐
        │                                          │
        ▼                                          ▼
┌───────────────┐                        ┌───────────────┐
│    Users      │                        │   Companies   │
│ (membros)     │                        │  (empresas)   │
└───────────────┘                        └───────────────┘
```

---

## Seção Técnica

### Tabelas Utilizadas
- `categories` - Já existe, com RLS configurado
- `profiles` - Já existe, para dados do usuário
- `companies` - Já existe, CRUD de empresas
- `company_members` - Já existe, relação user-empresa
- `user_roles` - Já existe, roles de usuário
- `transactions` - Para relatórios agregados

### Padrão de Código
Cada página seguirá o mesmo padrão da `PixIntegration.tsx`:
- Usar `MainLayout` para layout consistente
- Cards com `CardHeader` e `CardContent`
- Estados de loading com `Loader2`
- Toast para feedback
- Hooks do React Query para dados (quando necessário)

### Rotas a Adicionar (App.tsx)

```typescript
// Páginas admin-only
<Route path="/categories" element={<AuthGuard requireAdmin><Categories /></AuthGuard>} />
<Route path="/reports" element={<AuthGuard requireAdmin><Reports /></AuthGuard>} />
<Route path="/users" element={<AuthGuard requireAdmin><Users /></AuthGuard>} />
<Route path="/companies" element={<AuthGuard requireAdmin><Companies /></AuthGuard>} />

// Página para todos
<Route path="/settings" element={<AuthGuard><Settings /></AuthGuard>} />
```

---

## Ordem de Implementação

1. **Settings** - Página mais simples, serve de hub
2. **Categories** - CRUD básico, essencial para classificação
3. **Companies** - CRUD de empresas
4. **Users** - Gerenciamento de membros
5. **Reports** - Mais complexa, usa dados agregados

---

## Próximos Passos

Após aprovar, implementarei todas as 5 páginas com:
- Layout consistente com o resto do app
- Integração com Supabase (dados reais)
- Componentes shadcn/ui
- Validação de formulários
- Feedback visual (loading, toasts)
