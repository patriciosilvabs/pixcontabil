

## Corrigir fluxo Pix Copia e Cola — valor obrigatório do sistema

### Problema
Atualmente, quando o sistema não consegue extrair o valor do código EMV (amount null/0), o drawer redireciona para o Step 3 pedindo ao usuário para digitar o valor manualmente. Isso está errado: no fluxo Copia e Cola, o valor **sempre** vem do código — se não vier, é erro e o pagamento não deve prosseguir.

### Correção

**Arquivo: `src/components/pix/PixCopyPasteDrawer.tsx`**

1. **Remover Step 3 (entrada manual de valor)** — eliminar toda a UI e lógica do step de digitação de valor
2. **Quando `getQRCodeInfo` retornar sem valor (`amount` null/0)**: exibir erro claro ("Este código Pix não contém valor. Verifique o código e tente novamente.") e voltar ao Step 1 em vez de avançar
3. **Quando `getQRCodeInfo` falhar completamente**: exibir erro e voltar ao Step 1
4. **Ajustar indicadores de progresso** de 4 steps para 3 (Código → Consultando → Confirmação)
5. **Remover estado e função `handleAmountContinue`** que não serão mais necessários

### Resultado
O fluxo será: Colar código → Sistema consulta e extrai valor → Confirmação com valor do sistema → Pagamento. Se o código não tiver valor, erro e volta.

