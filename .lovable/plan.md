

## Tela de Confirmação Pós-Pagamento com Verificação de Status

### Problema Atual
Após confirmar o pagamento, o sistema exibe apenas um toast "Pagamento iniciado!" e redireciona para `/transactions`. O usuário não tem garantia visual de que o provedor realmente processou e liquidou o pagamento.

### Solução
Adicionar uma **etapa final de verificação** nos drawers de pagamento (PixKeyDialog e PixQrPaymentDrawer) que faz polling do status real via `pix-check-status` e exibe um resultado visual claro.

### Fluxo novo
1. Usuário confirma → botão muda para "Processando..."
2. Backend retorna `transaction_id` → drawer muda para **Step 4: "Aguardando confirmação"**
3. Polling automático a cada 3s via `pix-check-status` (max 20 tentativas = ~60s)
4. Resultado final exibido no drawer:
   - **Sucesso** (FINALIZADO): ícone verde, valor, botão "Ver Comprovante" + "Fechar"
   - **Falha** (FALHA): ícone vermelho, mensagem de erro, botão "Fechar"
   - **Timeout** (ainda pending após 60s): ícone amarelo, "Pagamento em processamento. Acompanhe pelo extrato."

### Implementação

**1. Criar componente `PaymentStatusScreen`** (`src/components/pix/PaymentStatusScreen.tsx`)
- Recebe `transactionId`, `amount`, `beneficiaryName`
- Usa `checkStatus(transactionId, true)` com polling interno
- 3 estados visuais: aguardando (spinner), sucesso (check verde), falha (X vermelho)
- Botão "Ver Comprovante" chama `downloadReceipt` quando sucesso

**2. Atualizar `PixKeyDialog`**
- Adicionar step 4 que renderiza `PaymentStatusScreen`
- Após `payByKey` retornar com sucesso, ir para step 4 em vez de fechar o drawer

**3. Atualizar `PixQrPaymentDrawer`**
- Mesmo padrão: step 4 com `PaymentStatusScreen` após confirmação

**4. Ajustar `pix-check-status`**
- A edge function já retorna `is_completed` e `internal_status` — nenhuma mudança necessária no backend

