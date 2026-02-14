

## Mover classificacao (Custo/Despesa) para depois da captura do comprovante

### O que muda

Atualmente, na Etapa 2 do "Novo Pagamento", o usuario precisa informar o valor **e** a classificacao (Custo/Despesa). O usuario quer que a classificacao apareca **somente** na tela de captura do comprovante (`ReceiptCapture`), que ja possui essa funcionalidade implementada.

### Alteracoes

**Arquivo: `src/pages/NewPayment.tsx`**

1. Remover os botoes de classificacao (Custo/Despesa) da Etapa 2 -- manter apenas o campo de valor
2. Atualizar o subtitulo do card de "Informe o valor e a classificacao" para "Informe o valor do pagamento"
3. Remover a exibicao da classificacao na Etapa 3 (tela de confirmacao), ja que ela sera definida depois
4. Remover a validacao/uso de `classification` no `handleConfirmPayment` (a descricao do pagamento nao usara mais "Custo"/"Despesa")
5. Remover os imports `DollarSign` e `TrendingUp` que nao serao mais necessarios

Nenhuma alteracao e necessaria no `ReceiptCapture.tsx`, pois ele ja possui a selecao de classificacao e categoria.

