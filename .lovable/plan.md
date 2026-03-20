

## Corrigir posicionamento do Drawer "Com Chave" no mobile

### Problema
Quando o usuário abre o drawer "Com Chave" no mobile, o conteúdo aparece no topo da tela e fica parcialmente oculto. Isso acontece porque:
1. O drawer do vaul abre do fundo mas com `min-h-[40dvh]` pode expandir demais
2. Quando o teclado virtual abre (campo de input com autoFocus), o viewport encolhe e empurra o conteúdo para cima
3. O `autoFocus` no input da chave Pix dispara o teclado imediatamente, antes do drawer terminar a animação

### Correções

**1. `src/components/pix/PixKeyDialog.tsx`**
- Remover `autoFocus` do input de chave Pix (Step 1) — o teclado abrindo instantaneamente causa o problema de posicionamento
- Remover `autoFocus` do input de valor (Step 2) pelo mesmo motivo
- Adicionar padding-top ao container para garantir espaçamento do handle

**2. `src/components/ui/drawer.tsx`**
- Adicionar `snap points` ao Drawer para controlar melhor a altura inicial: usar `[0.5, 1]` como snap points padrão ou ajustar o `min-h` para um valor mais seguro
- Alternativa mais simples: trocar `min-h-[40dvh]` por um valor que funcione melhor com teclado virtual, como `min-h-[50dvh]`, e garantir que o conteúdo interno tenha scroll adequado

**3. Abordagem recomendada (mais robusta)**
- No `DrawerContent`, usar a propriedade `data-vaul-no-drag` nos inputs para evitar conflitos de gesture
- Remover `autoFocus` de todos os inputs dentro de drawers — deixar o usuário tocar no campo manualmente
- Isso garante que o drawer termine sua animação de abertura antes do teclado aparecer

### Arquivos a alterar
- `src/components/pix/PixKeyDialog.tsx` — remover `autoFocus`, ajustar padding
- `src/components/ui/drawer.tsx` — ajuste fino no min-height se necessário

