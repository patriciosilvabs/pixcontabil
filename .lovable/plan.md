

# Quick Tags — Tags de Atalho Dinâmicas e Gerenciáveis

## Resumo

Criar tabela `quick_tags`, painel CRUD administrativo, e chips de seleção rápida na tela de pagamento (PixKeyDialog step 2) que preenchem descrição e pré-selecionam classificação.

## 1. Banco de Dados — Nova tabela `quick_tags`

Migration SQL:

```sql
CREATE TABLE public.quick_tags (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL,
  name text NOT NULL,
  suggested_classification text, -- 'cost' | 'expense' | null
  request_order_number boolean NOT NULL DEFAULT false,
  is_active boolean NOT NULL DEFAULT true,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.quick_tags ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can manage quick_tags" ON public.quick_tags
  FOR ALL TO authenticated USING (is_admin(auth.uid()));

CREATE POLICY "Members can view active quick_tags" ON public.quick_tags
  FOR SELECT TO authenticated
  USING (company_id IN (SELECT get_user_companies(auth.uid()) AS get_user_companies));
```

## 2. Painel Admin — `src/pages/QuickTags.tsx`

- CRUD completo (lista, criar, editar, excluir) seguindo o padrão de `Categories.tsx`
- Campos: Nome, Classificação Sugerida (opcional: Custo/Despesa/Nenhuma), Solicitar Nº Pedido (checkbox), Ativo/Inativo
- Ordenação drag-and-drop ou campo `sort_order`
- Rota `/quick-tags` protegida por `requireAdmin`

## 3. Hook — `src/hooks/useQuickTags.ts`

- Busca tags ativas da empresa atual, ordenadas por `sort_order`
- Cache com `useCallback` + state, refresh ao montar

## 4. Interface de Operação — `PixKeyDialog.tsx` (Step 2)

No step 2 (Valor + Descrição), acima do campo de descrição:

- Renderizar chips horizontais scrolláveis com as tags ativas
- Ao clicar um chip:
  - Append o nome da tag ao campo descrição (permite combinar)
  - Se `suggested_classification` definida, gravar no state para uso posterior
  - Se `request_order_number = true`, exibir um Input inline "Nº Pedido" que appenda ao texto
- Chips grandes, touch-friendly (h-10, px-4), com cores primárias

## 5. Rota e Navegação

- Adicionar rota `/quick-tags` em `App.tsx`
- Adicionar link no menu admin (sidebar/MobileMenu)

## Arquivos modificados/criados

| Arquivo | Alteração |
|---|---|
| Migration SQL | Criar tabela `quick_tags` + RLS |
| `src/pages/QuickTags.tsx` | **Novo** — CRUD admin |
| `src/hooks/useQuickTags.ts` | **Novo** — fetch tags ativas |
| `src/components/pix/PixKeyDialog.tsx` | Chips de quick tags no step 2 |
| `src/App.tsx` | Rota `/quick-tags` |
| `src/components/layout/MainLayout.tsx` | Link no menu admin |
| `src/pages/MobileMenu.tsx` | Link no menu mobile |

