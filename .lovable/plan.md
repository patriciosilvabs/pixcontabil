

## Correção Definitiva: Layout Mobile Keyboard-Aware

### Problema
No mobile, quando o teclado virtual abre:
- O header é empurrado para fora da tela
- Botões de ação ficam escondidos atrás do teclado
- `min-h-screen` não se adapta ao viewport reduzido

### Solução

Converter o layout mobile de posicionamento fixo com padding estático para um **flex container com altura dinâmica (`100dvh`)**, onde apenas o `<main>` encolhe e ganha scroll quando o teclado aparece.

```text
┌─────────────────────┐
│  MobileHeader       │  ← fixed, permanece visível
├─────────────────────┤
│                     │
│  <main>             │  ← flex-1, overflow-y-auto
│  (encolhe quando    │     (scroll apenas aqui)
│   teclado sobe)     │
│                     │
├─────────────────────┤
│  BottomTabBar       │  ← some com teclado (já implementado)
└─────────────────────┘
```

### Alterações por arquivo

**1. `index.html`** — Meta tag viewport
- Já possui `interactive-widget=resizes-content` ✅ (sem alteração)

**2. `src/index.css`** — Regras base
- Remover `overscroll-behavior-y: none` do `body` (impede scroll natural)
- Manter `overscroll-behavior: none` no `html` (previne pull-to-refresh)
- Adicionar utilitário `.h-dvh` para `height: 100dvh`

**3. `src/components/layout/MainLayout.tsx`** — Layout principal
- Trocar `min-h-screen` por `h-dvh flex flex-col` no container raiz (mobile)
- Trocar `pt-[104px] pb-16 min-h-screen` do `<main>` por `flex-1 overflow-y-auto pt-[104px] pb-20`
- Desktop (`lg:`) mantém comportamento atual inalterado

**4. `src/components/layout/BottomTabBar.tsx`** — Sem alteração
- Já usa `useKeyboardVisible` para esconder, funciona corretamente

**5. `src/components/layout/MobileHeader.tsx`** — Sem alteração
- Já usa `useKeyboardVisible` para esconder com `-translate-y-full`

### Impacto
- **Mobile**: Header permanece visível, conteúdo rola dentro do `<main>`, botões de ação acessíveis com scroll natural
- **Desktop**: Zero alterações visuais (sidebar + layout existente preservado)
- **Drawers/Formulários**: Funcionam melhor pois o container pai agora aceita redimensionamento dinâmico

