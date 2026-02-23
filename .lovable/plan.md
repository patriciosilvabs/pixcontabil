

## Auto-gerar e anexar comprovante Pix

Quando um pagamento Pix por chave for realizado com sucesso, o sistema vai automaticamente gerar um comprovante digital (imagem PNG) com os dados da transacao e anexa-lo, eliminando a necessidade de captura manual.

### O que muda para o usuario

- Apos confirmar o pagamento Pix por chave, o comprovante e gerado e anexado automaticamente em segundo plano
- O usuario e redirecionado direto para a tela de transacoes (ou para a tela de classificacao simplificada) sem precisar tirar foto
- O comprovante digital contem: data/hora, valor, chave Pix do destinatario, ID da transacao (e2eId), nome do provedor

### Detalhes tecnicos

#### 1. Nova Edge Function: `generate-pix-receipt` 
**Arquivo:** `supabase/functions/generate-pix-receipt/index.ts`

Funcao que recebe os dados da transacao e gera uma imagem PNG do comprovante usando a biblioteca `resvg` (disponivel no Deno) para renderizar SVG em PNG:

- Recebe: `transaction_id`, `company_id`
- Busca os dados da transacao no banco
- Gera um SVG com layout de comprovante bancario (data, valor, chave, e2eId, status)
- Converte SVG para PNG usando `resvg-js` (compativel com Deno)
- Faz upload do PNG para o bucket `receipts` no caminho `{company_id}/{transaction_id}/{timestamp}_comprovante_pix.png`
- Cria o registro na tabela `receipts` com os dados do arquivo
- Retorna o caminho do arquivo

#### 2. Chamar auto-geracao apos pagamento no webhook
**Arquivo:** `supabase/functions/pix-webhook/index.ts`

No handler da EFI (e demais provedores), apos marcar a transacao como `completed`:
- Chamar `generate-pix-receipt` internamente passando `transaction_id` e `company_id`
- Isso garante que mesmo pagamentos confirmados via webhook tenham comprovante auto-gerado

#### 3. Chamar auto-geracao apos pagamento no frontend (fallback)
**Arquivo:** `src/hooks/usePixPayment.ts`

No retorno do `payByKey`, apos obter o `transaction_id`:
- Invocar `supabase.functions.invoke('generate-pix-receipt')` em background (sem await bloqueante)
- Isso cobre o cenario onde o webhook demora ou o pagamento ja e confirmado imediatamente

#### 4. Ajustar fluxo pos-pagamento
**Arquivos:** `src/components/pix/PixKeyDialog.tsx`, `src/pages/NewPayment.tsx`

- Apos pagamento por chave, navegar para `/transactions` em vez de `/pix/receipt/:id`
- A tela de classificacao (Custo/Despesa) pode ser apresentada como um dialog inline ou na propria tela de transacoes, ja que o comprovante foi auto-gerado
- Manter a rota `/pix/receipt/:id` funcional para casos de boleto ou quando o usuario quiser reanexar

#### 5. Layout do comprovante SVG gerado

```text
+----------------------------------+
|     COMPROVANTE PIX              |
|     [logo/icone]                 |
+----------------------------------+
| Data: 23/02/2026 14:30           |
| Valor: R$ 1.500,00               |
| Chave Pix: fulano@email.com      |
| Beneficiario: Nome               |
| E2E ID: E1234567890123456        |
| Status: Confirmado               |
+----------------------------------+
| Gerado automaticamente           |
+----------------------------------+
```

#### Sequencia de eventos

```text
Usuario confirma pagamento
    |
    v
pix-pay-dict cria transacao (status: pending)
    |
    v
Frontend chama generate-pix-receipt (background)
    |
    v
Webhook confirma pagamento (status: completed)
    |
    v
Webhook tambem chama generate-pix-receipt (idempotente - verifica se ja existe receipt)
    |
    v
Comprovante PNG salvo no storage + registro na tabela receipts
```

A funcao `generate-pix-receipt` sera idempotente: antes de gerar, verifica se ja existe um receipt para aquela transacao. Se existir, nao duplica.

