
Diagnóstico atual:

- O webhook da ONZ já está chegando corretamente. Há evidência clara disso:
  - `pix_webhook_logs` registrou `TRANSFER` com `data.status = LIQUIDATED`
  - `pix-webhook` logou: `Updated tx d512d4fd...: pending → completed`
- Então o problema não é mais o cadastro da URL/header na ONZ.

Causa raiz:

- O erro agora está no polling de `pix-check-status`.
- A resposta da ONZ vem aninhada assim:
  ```text
  { "data": { "status": "LIQUIDATED", ... } }
  ```
- Mas o código atual em `supabase/functions/pix-check-status/index.ts` usa `result.data.status` em vez de ler `result.data.data.status`.
- Resultado:
  - o status é interpretado como vazio
  - o mapeamento cai em `pending`
  - a tela continua em “Aguardando confirmação”
  - e em alguns momentos o registro pode voltar para `pending`

Plano de correção:

1. Corrigir o parser da resposta ONZ em `supabase/functions/pix-check-status/index.ts`
   - Normalizar a resposta com algo como:
     ```text
     onzPayload = result.data?.data ?? result.data
     ```
   - Ler `onzPayload.status`, `onzPayload.id`, `onzPayload.endToEndId` e salvar o payload normalizado.

2. Fortalecer a regra de não-downgrade no fluxo ONZ
   - Se a transação já estiver em estado final (`completed`, `failed`, `cancelled`, `refunded`) e o polling calcular um estado inferior, não atualizar o banco.
   - Além disso, retornar o status final real ao frontend, não o `pending` calculado erroneamente.
   - Hoje isso já foi feito no ramo Transfeera, mas o ramo ONZ ainda precisa do mesmo comportamento de retorno.

3. Ajustar a persistência do status ONZ
   - Quando a ONZ retornar `LIQUIDATED`, garantir:
     - `status = completed`
     - `paid_at` preenchido
     - `pix_provider_response` com payload normalizado
   - Isso deixa o estado consistente mesmo sem depender do webhook.

4. Revisar o `pix-webhook` apenas para consistência
   - Confirmar que ele continua atualizando por `endToEndId` / `external_id`
   - Opcionalmente marcar `pix_webhook_logs.processed = true` quando reconciliar a transação, para facilitar auditoria futura

5. Reconciliar a transação já afetada
   - Após o ajuste, atualizar a transação `d512d4fd-7dc1-4e96-99da-44131212d422` para `completed`, porque os logs mostram que ela foi liquidada e já tem `paid_at`

Validação planejada:

- Fazer uma nova transação Pix
- Confirmar esta sequência:
  ```text
  ONZ -> webhook recebido
      -> transação marcada completed
      -> polling retorna internal_status = completed
      -> PaymentStatusScreen mostra "Pagamento confirmado"
  ```
- Conferir que a transação não volta mais para `pending`
- Confirmar geração automática do comprovante

Detalhes técnicos:

- Arquivo principal a ajustar: `supabase/functions/pix-check-status/index.ts`
- Possível ajuste secundário: `supabase/functions/pix-webhook/index.ts`
- Não precisa migration de banco
- Não parece ser problema de RLS, autenticação, URL do webhook ou segredo da ONZ
- O bug está na interpretação da resposta ONZ e na reconciliação do status retornado ao frontend
