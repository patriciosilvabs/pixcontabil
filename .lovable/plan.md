

# Renomear app para "PIX CONTABIL" e ajustes visuais

## Resumo
O screenshot mostra que o nome do app deve ser **"PIX CONTABIL"** (nao "PIXFLOW") e o header deve ter uma linha decorativa abaixo do nome. Os demais elementos do layout ja estao implementados corretamente.

## Mudancas

### 1. Renomear "PIXFLOW" para "PIX CONTABIL" em todos os lugares
Arquivos afetados:
- `src/components/layout/MobileHeader.tsx` - header mobile (linha 62)
- `src/components/layout/MainLayout.tsx` - sidebar desktop (linha 78)
- `src/pages/Auth.tsx` - tela de login (linhas 57, 86, 98, 131)
- `index.html` - titulo da pagina e meta tags (linhas 6, 8, 13)
- `public/manifest.json` - nome do PWA

### 2. Adicionar linha decorativa abaixo do nome no header mobile
No `MobileHeader.tsx`, adicionar um pequeno traco/underline decorativo abaixo do texto "PIX CONTABIL", como aparece no screenshot (um risco sutil embaixo do nome).

### 3. Ajustar backgrounds dos icones de acoes rapidas
No `MobileDashboard.tsx`, os icones de acoes rapidas no screenshot parecem ter backgrounds em tons de rosa/salmon em vez do roxo atual (`bg-primary/10`). Ajustar para um tom mais quente que combine com o visual do screenshot.

## Detalhes tecnicos

Todas as mudancas sao de texto e estilo CSS (Tailwind classes). Nenhuma logica de negocio sera alterada.

Arquivos modificados:
- `src/components/layout/MobileHeader.tsx` - nome + underline decorativo
- `src/components/layout/MainLayout.tsx` - nome na sidebar
- `src/components/dashboard/MobileDashboard.tsx` - cor dos icones
- `src/pages/Auth.tsx` - nome na tela de login
- `index.html` - titulo e meta tags
- `public/manifest.json` - nome do PWA

