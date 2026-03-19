

## Plano: Compartilhar comprovante no WhatsApp ou salvar como imagem

### Contexto
Hoje o `downloadReceipt` baixa o comprovante como PDF via `pix-receipt` (que retorna `pdf_base64`). O usuário quer duas ações novas: **compartilhar no WhatsApp** e **salvar como imagem no aparelho**.

### Abordagem

1. **Adicionar funções `shareReceipt` e `saveReceiptAsImage` no `usePixPayment.ts`**
   - `saveReceiptAsImage`: converte o PDF base64 em blob, cria URL temporária, e dispara download como arquivo (fallback para dispositivos sem Web Share API)
   - `shareReceipt`: usa a **Web Share API** (`navigator.share`) com o PDF como arquivo compartilhável. No WhatsApp e outros apps, o sistema operacional abre o seletor nativo de compartilhamento. Se a Web Share API não estiver disponível, faz fallback para `whatsapp://send` com link ou salva o arquivo

2. **Atualizar `PaymentStatusScreen.tsx`**
   - Na tela de "Pagamento confirmado", substituir o botão único "Ver Comprovante" por dois botões:
     - **Compartilhar** (ícone Share2) — chama `navigator.share` com o arquivo PDF
     - **Salvar no Aparelho** (ícone Download) — baixa o PDF como arquivo
   - Manter botão "Fechar" abaixo

3. **Considerar também o comprovante gerado internamente**
   - O sistema já gera comprovantes PNG via `generate-pix-receipt`. Se o provider retornar PDF, usa o PDF. Se não, busca o PNG do storage como fallback para compartilhamento.

### Detalhes técnicos

- **Web Share API**: suportada em Chrome Android, Safari iOS, e Edge — cobre a maioria dos dispositivos mobile. Permite compartilhar arquivos diretamente no WhatsApp, Telegram, etc.
- **Fallback**: se `navigator.canShare` retornar false, abre `https://wa.me/?text=...` com mensagem e faz download normal do arquivo
- Nenhuma alteração de backend necessária — os endpoints `pix-receipt` e `generate-pix-receipt` já fornecem os dados necessários

### Arquivos a alterar
- `src/hooks/usePixPayment.ts` — adicionar `shareReceipt` e exportar
- `src/components/pix/PaymentStatusScreen.tsx` — novos botões de compartilhar/salvar

