

## Correção Global: App Shell Flexível (sem `fixed` no mobile)

### Problema atual

O `MobileHeader` e `BottomTabBar` usam `fixed`, tirando-os do fluxo flexbox. O `<main>` compensa com `pt-[104px]` e `pb-20` estáticos. Quando o teclado abre, o `h-dvh` encolhe o container pai, mas os elementos `fixed` não participam do flex — causando gaps, sobreposições e botões escondidos.

### Solução: Flex App Shell puro

Remover `fixed` dos componentes mobile e torná-los filhos diretos do flexbox. Apenas `<main>` rola.

```text
┌──────────────────────────┐
│ MobileHeader (shrink-0)  │  ← no fluxo flex, não fixed
├──────────────────────────┤
│                          │
│ <main> (flex-1,          │  ← único elemento que rola
│   overflow-y-auto)       │
│                          │
├──────────────────────────┤
│ BottomTabBar (shrink-0)  │  ← no fluxo flex, some com teclado
└──────────────────────────┘
```

### Alterações por arquivo

**1. `src/components/layout/MainLayout.tsx`**
- Remover `pt-[104px]` e `pb-20` do `<main>` (mobile) — não são mais necessários sem `fixed`
- `<main>` fica: `flex-1 overflow-y-auto` (mobile) + `lg:pl-64 lg:pt-0 lg:pb-0 lg:min-h-screen lg:overflow-visible` (desktop)
- Container raiz mantém `h-dvh flex flex-col overflow-hidden` (mobile)

**2. `src/components/layout/MobileHeader.tsx`**
- Remover `fixed top-0 left-0 right-0 z-50` — substituir por `shrink-0`
- Manter `lg:hidden`
- Remover `-translate-y-full` do teclado (o header permanece visível ou é condicionalmente renderizado pelo `MainLayout`)
- Simplificar: o componente vira um bloco estático no fluxo

**3. `src/components/layout/BottomTabBar.tsx`**
- Remover `fixed bottom-4 left-4 right-4 z-50` do `<nav>` — substituir por `shrink-0`
- Manter `lg:hidden` e a lógica de `isKeyboardVisible` para retornar `null`
- Ajustar padding/margin para compensar a remoção do `fixed`

**4. `src/index.css`**
- Adicionar `overflow: hidden` no `body` para prevenir scroll no container raiz (iOS bounce)
- Manter `overscroll-behavior: none` no `html`

### Desktop
Zero alterações visuais. O desktop continua com sidebar `fixed` e `<main>` com `lg:pl-64`.

### Benefícios
- Teclado abre → `h-dvh` encolhe → `<main>` encolhe → botões sobem automaticamente
- Sem padding estático que cria gaps quando o header some
- Header visível sempre (ou controlado por `useKeyboardVisible` no `MainLayout` se desejado)

