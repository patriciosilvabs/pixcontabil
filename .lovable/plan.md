

# Corrigir Drawer instável ao abrir teclado virtual no mobile

## Problema

Quando o usuário toca nos inputs de chave Pix ou descrição dentro do Drawer (`PixKeyDialog`), o teclado virtual do celular abre e causa:
- O Drawer sobe/desce descontroladamente
- O conteúdo "desaparece" da tela
- O usuário precisa arrastar manualmente para encontrar o campo

Isso acontece porque o Vaul (biblioteca do Drawer) interpreta a mudança de viewport causada pelo teclado como um gesto de arrasto, e os inputs não estão protegidos contra isso.

## Correções

### 1. `src/components/pix/PixKeyDialog.tsx`

Adicionar `data-vaul-no-drag` em todos os inputs (Input e Textarea) para impedir que o Vaul interprete a interação como gesto de arrastar:

- Input da chave Pix (linha 149): adicionar `data-vaul-no-drag`
- Input do valor (linha 191): adicionar `data-vaul-no-drag`
- Textarea da descrição (linha 206): adicionar `data-vaul-no-drag`

### 2. `src/components/ui/drawer.tsx`

Adicionar `handleOnly` ao Drawer para que só o handle (barra superior) permita arrastar, evitando que toques nos inputs acionem o gesto de fechar:

- Na `DrawerContent`, adicionar a prop `onInteractOutside` não é necessária — o fix principal é no `Drawer` root.
- Alterar o componente `Drawer` para passar `handleOnly={true}` ao `DrawerPrimitive.Root`, garantindo que apenas o handle bar controle o arrasto.

### Arquivos alterados
- `src/components/pix/PixKeyDialog.tsx` — adicionar `data-vaul-no-drag` nos 3 inputs
- `src/components/ui/drawer.tsx` — adicionar `handleOnly` ao Drawer root

