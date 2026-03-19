

## Plano: Adicionar botão "Voltar ao Início" em todas as telas de resultado

### Problema
Na tela de confirmação de pagamento (e em outras telas de resultado/final), não há botão para retornar à página inicial, obrigando o usuário a usar a navegação do dispositivo.

### Alterações

#### 1. `src/components/pix/PaymentStatusScreen.tsx`
Adicionar um botão "Voltar ao Início" (`Home` icon) em todos os estados finais:
- **completed** (com `redirectToReceiptCapture`): após "Anexar Comprovante"
- **completed** (sem redirect): após "Fechar"
- **failed**: após "Fechar"
- **timeout**: após "Fechar"

O botão chamará `onClose()` e depois `navigate("/")`.

#### 2. `src/components/payment/BoletoPaymentDrawer.tsx`
Verificar se a tela de resultado do boleto (step final) tem botão de voltar ao início. Adicionar se ausente.

#### 3. `src/components/payment/CashPaymentDrawer.tsx`
Verificar tela de sucesso do pagamento em dinheiro — adicionar botão "Voltar ao Início" se ausente.

### Detalhes
- Botão com variante `ghost` ou `outline`, ícone `Home`, texto "Voltar ao Início"
- Posicionado como último botão de cada seção de resultado
- Usa `navigate("/")` após fechar o drawer/dialog

