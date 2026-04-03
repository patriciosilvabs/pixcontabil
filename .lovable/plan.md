

## Correção: Remover padding inferior excessivo (resíduo do layout `fixed`)

### Problema

Quando migramos para o Flexbox App Shell, a `BottomTabBar` deixou de ser `fixed` e passou a ser um filho direto do flex container. Porém, vários componentes ainda têm `pb-24` — um padding que existia para compensar a barra fixa. Agora esse padding cria espaço morto desnecessário, forçando o usuário a rolar para ver conteúdo que deveria caber na tela.

### Alterações

| Arquivo | De | Para |
|---------|-----|------|
| `src/components/dashboard/MobileDashboard.tsx` (L141) | `pb-24` | `pb-4` |
| `src/pages/MobileMenu.tsx` (L46) | `pb-24` | `pb-4` |
| `src/pages/BatchPayment.tsx` (L155, L239) | `pb-24` | `pb-4` |
| `src/components/pix/PixKeyDialog.tsx` (L396) | `pb-24` | `pb-6` |

### Por que funciona

O container raiz (`h-dvh flex flex-col overflow-hidden`) já gerencia o espaço. Header e TabBar são `shrink-0` no fluxo flex, e `<main>` é `flex-1 overflow-y-auto`. O conteúdo dentro do `<main>` não precisa mais "fugir" de uma barra fixa — o flex já reserva o espaço correto. Reduzir o padding inferior faz o conteúdo caber melhor na viewport, eliminando scroll desnecessário.

