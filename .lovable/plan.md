
# Redesign do Layout Mobile - Estilo Banco Digital

## Objetivo
Redesenhar a versao mobile do dashboard e navegacao para seguir o layout da referencia (estilo Infopago/banco digital), com header verde, card de saldo, grid de acoes rapidas 4x2, transacoes recentes e bottom tab bar.

## Mudancas Principais

### 1. Bottom Tab Bar (Mobile)
Criar componente `src/components/layout/BottomTabBar.tsx`
- 3 abas fixas na parte inferior: Home (icone casa), Menu (icone grid), Transacoes (icone setas)
- Aba ativa com destaque verde (botao circular elevado para Home)
- Visivel apenas em mobile (hidden lg:)
- Navegacao: `/` , `/menu` , `/transactions`

### 2. Header Mobile Redesenhado
Atualizar `MainLayout.tsx` no mobile:
- Remover sidebar/hamburger menu no mobile
- Header com fundo gradiente verde (inspirado na referencia)
- Lado esquerdo: avatar do usuario
- Centro: logo "PIXFLOW" + nome da empresa selecionada
- Lado direito: icone de visibilidade (mostrar/ocultar saldo) + notificacoes
- Abaixo: linha com numero da conta e nome da empresa

### 3. Dashboard Mobile Redesenhado
Atualizar `OperatorDashboard.tsx` e `AdminDashboard.tsx` para mobile:

**Card de Saldo:**
- Card com fundo branco, borda arredondada
- "SALDO DISPONIVEL" em texto pequeno
- Valor grande "R$ 0,00" (ou saldo real quando disponivel)
- Barra de progresso verde na parte inferior do card
- Botao de olho para ocultar/mostrar valor

**Grid de Funcoes Principais (4 colunas x 2 linhas):**
- 8 botoes com icones e labels:
  - MENU PIX | PAGAR QR CODE | COPIA E COLA | COM CHAVE
  - FAVORECIDOS | TRANSACOES AGENDADAS | BOLETO | TRANSFERIR
- Cards com fundo cinza claro, cantos arredondados, icones acima do texto
- Links para as respectivas paginas

**Transacoes Recentes:**
- Titulo "TRANSACOES RECENTES" em bold
- Lista de transacoes ou "Nenhum dado encontrado"
- Link "EXTRATO COMPLETO" ao final

### 4. Pagina de Menu (`/menu`)
Criar `src/pages/MobileMenu.tsx`
- Lista completa de opcoes de navegacao para mobile
- Categorias, Relatorios, Usuarios, Empresas (admin only)
- Configuracoes, Integracao Pix
- Perfil do usuario com botao de logout

### 5. Ajustes no Roteamento
Atualizar `App.tsx`:
- Adicionar rota `/menu` protegida

## Detalhes Tecnicos

### Cores do Header (gradiente verde)
Usar variaveis CSS customizadas para o gradiente verde do header mobile, mantendo o sistema de design existente. Adicionar em `index.css`:
```text
--gradient-bank-header: linear-gradient(180deg, hsl(145 60% 35%), hsl(145 55% 42%));
```

### Responsividade
- Bottom tab bar: visivel apenas `lg:hidden`, com `pb-20` no main content mobile
- Sidebar desktop: mantida como esta (`hidden lg:flex`)
- Header mobile: redesenhado, mantido `lg:hidden`
- Grid de funcoes: `grid-cols-4` no mobile, adaptavel em desktop

### Componentes Afetados
1. `src/components/layout/MainLayout.tsx` - Redesenho do header mobile, remover hamburger menu, adicionar bottom tab bar
2. `src/components/layout/BottomTabBar.tsx` - Novo componente
3. `src/components/dashboard/OperatorDashboard.tsx` - Layout mobile com card de saldo e grid de acoes
4. `src/components/dashboard/AdminDashboard.tsx` - Mesmo layout mobile (com saldo visivel para admin)
5. `src/pages/MobileMenu.tsx` - Nova pagina de menu mobile
6. `src/App.tsx` - Adicionar rota `/menu`
7. `src/index.css` - Novas variaveis CSS para gradiente verde

### Navegacao do Grid de Acoes
| Botao | Destino |
|-------|---------|
| MENU PIX | `/pix/new` (aba key) |
| PAGAR QR CODE | `/pix/new` (aba qrcode) |
| COPIA E COLA | `/pix/new` (aba copy_paste) |
| COM CHAVE | `/pix/new` (aba key) |
| FAVORECIDOS | `/transactions` (futuro) |
| TRANSACOES AGENDADAS | `/transactions` |
| BOLETO | `/pix/new` (aba boleto) |
| TRANSFERIR | `/pix/new` |
