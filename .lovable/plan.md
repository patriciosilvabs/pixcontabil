

# Corrigir Drawer Pix deslocado ao abrir teclado no mobile

## Problema

Quando o usuário toca no campo "Chave Pix" no Step 1 do drawer, o teclado virtual empurra o conteúdo para cima e o drawer fica inacessível — o usuário precisa arrastar manualmente para ver o input.

Isso ocorre porque o drawer usa `fixed bottom-0`, mas quando o teclado abre, o `bottom-0` refere-se ao viewport do layout (não o visual), fazendo o conteúdo ficar atrás do teclado.

## Solução

### 1. `src/components/ui/drawer.tsx` — Ajustar posicionamento com Visual Viewport

Atualizar o hook `useVisualViewportHeight` para também retornar o `offsetTop` do visual viewport e aplicar como `bottom` dinâmico no `DrawerContent`, garantindo que o drawer se reposicione quando o teclado abre:

- Capturar `visualViewport.offsetTop` para calcular a posição correta do `bottom`
- Aplicar `bottom` via `style` inline no `DrawerPrimitive.Content` para compensar o deslocamento do teclado
- Manter `maxHeight` dinâmico já existente

### 2. `src/components/pix/PixKeyDialog.tsx` — Melhorar scrollIntoView

- Aumentar o delay do `scrollIntoView` de 300ms para 400ms para dar tempo ao reposicionamento do drawer
- Aplicar `scrollIntoView` também nos inputs de Step 2 (valor, descrição) que sofrem do mesmo problema

## Arquivos modificados

| Arquivo | Alteração |
|---|---|
| `src/components/ui/drawer.tsx` | Hook retorna `bottom` offset; DrawerContent aplica posição dinâmica |
| `src/components/pix/PixKeyDialog.tsx` | Melhorar timing do scrollIntoView nos inputs |

