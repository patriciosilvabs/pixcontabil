

## Auditoria de Responsividade - Problemas Encontrados

Analisei todas as páginas e componentes do sistema. O Dashboard mobile, a Auth page, o MobileMenu e o BottomTabBar estão bem implementados. Porém, encontrei problemas significativos em **5 áreas**:

---

### 1. Categorias (`src/pages/Categories.tsx`) - CRÍTICO

**Problema**: Tabela com 5 colunas (Nome, Classificação, Keywords, Status, Ações) é cortada no mobile. Colunas "Keywords", "Status" e "Ações" ficam fora da tela.

**Problema 2**: Header com botões "Importar em Lote" e "Nova Categoria" lado a lado com o título fica apertado.

**Solução**: 
- Envolver a tabela em um `overflow-x-auto` container
- Alternativamente, no mobile usar layout de cards empilhados em vez de tabela
- Header: empilhar título e botões verticalmente no mobile (`flex-col sm:flex-row`)

---

### 2. Usuários (`src/pages/Users.tsx`) - CRÍTICO

**Problema**: Mesma situação da tabela de categorias - 5 colunas (Usuário, Role, Limite, Status, Ações) sendo cortadas. Os botões "Editar", "Desativar" e "Excluir" na coluna Ações ficam inacessíveis.

**Solução**: 
- Envolver a tabela em `overflow-x-auto`
- Ou converter para cards no mobile

---

### 3. Relatórios (`src/pages/Reports.tsx`) - MODERADO

**Problema**: A barra de filtros (Período + Classificação + Exportar) usa `flex-wrap` mas os `SelectTrigger` têm largura fixa (`w-[160px]` e `w-[150px]`), que em telas estreitas pode não se adaptar bem. Os gráficos de barra podem ter labels de categorias cortados.

**Solução**: 
- Fazer os selects full-width no mobile (`w-full sm:w-[160px]`)
- Adicionar `flex-col sm:flex-row` ao container de filtros

---

### 4. Integração Pix (`src/pages/settings/PixIntegration.tsx`) - MODERADO

**Problema**: A página tem tabs "Entrada", "Saída", "Ambos" e formulários densos. No mobile funciona razoavelmente pelo `max-w-4xl mx-auto`, mas os `grid md:grid-cols-2` fazem campos ficarem muito comprimidos entre 500-768px (tablet portrait).

**Solução**: Ajustar breakpoint dos grids para `sm:grid-cols-2` para tablets menores.

---

### 5. Categorias e Users - Header Actions

**Problema comum**: Nas duas páginas, o header usa `flex items-center justify-between` sem quebra responsiva. Os botões de ação colidem com o título em telas menores.

**Solução**: Usar `flex-col gap-3 sm:flex-row sm:items-center sm:justify-between`.

---

### Plano de Implementação

**Arquivo 1: `src/pages/Categories.tsx`**
- Linha 137-148: Tornar header responsivo com `flex-col gap-3 sm:flex-row sm:items-center sm:justify-between`
- Botões: empilhar em coluna no mobile com `flex-col sm:flex-row`
- Linha 160: Adicionar `overflow-x-auto` ao container da tabela

**Arquivo 2: `src/pages/Users.tsx`**
- Linha 340-350: Tornar header responsivo com `flex-col gap-3 sm:flex-row sm:items-center sm:justify-between`
- Linha 353: Adicionar `overflow-x-auto` ao container da tabela

**Arquivo 3: `src/pages/Reports.tsx`**
- Linha 212: Mudar container de filtros para `flex flex-col sm:flex-row sm:flex-wrap items-stretch sm:items-center gap-3`
- Selects: mudar de largura fixa para `w-full sm:w-[160px]`

**Arquivo 4: `src/pages/settings/PixIntegration.tsx`**
- Verificar grids de formulário e ajustar breakpoints se necessário

### Páginas que estão OK
- Dashboard (mobile/desktop com layout dedicado)
- Auth (split layout `lg:` com logo mobile)
- Transactions (já usa `flex-col sm:flex-row`)
- Companies (usa grid responsivo `md:grid-cols-2 lg:grid-cols-3`)
- Settings (usa grids `md:grid-cols-2`)
- MobileMenu, BottomTabBar, MobileHeader
- NewPayment (max-w-2xl com tabs responsivas)
- ReceiptCapture (max-w-2xl, grid `sm:grid-cols-2`)

