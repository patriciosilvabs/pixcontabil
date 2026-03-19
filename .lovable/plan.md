
## Diagnóstico

A transação fica "aguardando confirmação" porque existem **dois problemas encadeados**:

### Problema 1: Webhook rejeitado (UNAUTHORIZED)
O campo `webhook_secret` está **NULL** na tabela `pix_configs`. Quando a ONZ envia o webhook de confirmação, a função `pix-webhook` rejeita a requisição porque não consegue validar o segredo. O log confirma:
- 20:28:06 → `event_type: UNAUTHORIZED` — "Webhook secret verification failed"

### Problema 2: Polling retorna "pending"
O `pix-check-status` está sendo chamado a cada 2s e retorna 200, mas a ONZ pode retornar o status como `PROCESSING` enquanto a liquidação não é finalizada. Sem o webhook funcionar, a transação nunca atualiza para `completed`.

---

## Plano de Correção

### Passo 1: Configurar webhook_secret no banco
- Gerar um valor aleatório seguro para `webhook_secret` na `pix_configs`
- Atualizar diretamente via migration SQL

### Passo 2: Atualizar webhook_url na ONZ
- O `webhook_url` já está configurado: `https://ntvgthwqxixkoemyxhqo.supabase.co/functions/v1/pix-webhook`
- Você precisa adicionar o header `x-webhook-secret` no painel da ONZ com o valor gerado no passo 1
- **Alternativa:** registrar a URL com query param: `?whs=VALOR_DO_SECRET` (a função já aceita ambos)

### Passo 3: Melhorar o pix-check-status para ONZ
- Adicionar logs de debug para ver a resposta exata da API ONZ durante o polling
- Garantir que o status `LIQUIDATED` da ONZ seja corretamente mapeado para `completed` (já está no código)

### Passo 4: Corrigir transação pendente atual
- Atualizar manualmente a transação `bd37c41b` para `completed` (já que o pagamento foi confirmado na conta do destinatário)

---

## Ação necessária do usuário

Após eu gerar o `webhook_secret`, você precisará atualizar o painel da ONZ Infopago adicionando o header:
```
x-webhook-secret: <valor_gerado>
```
Ou alterar a URL do webhook para incluir `?whs=<valor_gerado>`.
