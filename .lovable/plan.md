

## Fix: Botão "Continuar" escondido pela barra de navegação

### Problema
Na tela fullscreen do Step 1 (Pix com Chave), o botão "Continuar" fica atrás da BottomTabBar porque o `pb-6` não é suficiente para compensar a área ocupada pela barra fixa de navegação.

### Solução

**`src/components/pix/PixKeyDialog.tsx`** — Aumentar o padding inferior do container do botão:

- Linha 396: trocar `pb-6` por `pb-[calc(env(safe-area-inset-bottom,16px)+80px)]` para garantir que o botão fique acima da BottomTabBar (que tem ~64px de altura + padding)
- Alternativa mais limpa: como a tela é fullscreen (`fixed inset-0 z-50`), a BottomTabBar não deveria aparecer. Verificar se o `z-50` está funcionando corretamente ou se precisa ser `z-[60]` para ficar acima de tudo.

Abordagem recomendada: aumentar o padding inferior para `pb-24` (96px), garantindo espaço suficiente independente do safe-area.

