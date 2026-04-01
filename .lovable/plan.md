

# Fix: Drawer sobe e conteúdo desaparece quando teclado virtual abre no mobile

## Problema

Quando o usuário toca no campo "Chave Pix" no Step 1 do PixKeyDialog, o teclado virtual do celular abre e empurra o Drawer para cima, fazendo o conteúdo ficar invisível/inacessível. O usuário precisa arrastar manualmente para ver os campos.

## Causa raiz

O viewport meta tag usa o comportamento padrão que redimensiona o layout viewport quando o teclado abre. O Drawer está fixado com `bottom-0` e `max-h-[85dvh]` — quando o teclado abre, o `dvh` muda e o drawer se reposiciona de forma errada.

## Solução

Duas alterações coordenadas:

### 1. Adicionar `interactive-widget=resizes-content` ao viewport meta — `index.html`

Isso instrui o browser a manter o layout viewport estável quando o teclado virtual abre, redimensionando apenas o conteúdo visual. Evita que elementos `fixed` (como o Drawer) sejam reposicionados.

```html
<meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no, viewport-fit=cover, interactive-widget=resizes-content" />
```

### 2. Ajustar DrawerContent para usar `max-h` baseado em visual viewport — `src/components/ui/drawer.tsx`

Adicionar um hook que escuta `visualViewport.resize` e ajusta o `max-height` do drawer dinamicamente, garantindo que o conteúdo sempre caiba na área visível acima do teclado.

### 3. Garantir scroll automático ao campo focado — `src/components/pix/PixKeyDialog.tsx`

Adicionar `onFocus` no input da chave Pix para fazer `scrollIntoView({ block: 'center' })` após breve delay, garantindo que o campo fique visível após o teclado abrir.

## Arquivos modificados

| Arquivo | Alteração |
|---|---|
| `index.html` | Adicionar `interactive-widget=resizes-content` ao viewport meta |
| `src/components/ui/drawer.tsx` | Hook de visual viewport para max-height dinâmico |
| `src/components/pix/PixKeyDialog.tsx` | `scrollIntoView` nos inputs do Step 1 |

