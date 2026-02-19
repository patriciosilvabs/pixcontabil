

## Diagnostico

Identifiquei **3 problemas** que causaram a situacao onde o app mostra "sucesso" mas o Pix nao foi efetivamente transferido:

### Problema 1: Limite diario na EFI esta R$ 0,00
A EFI recebeu a solicitacao de pagamento mas **rejeitou** com a mensagem:
> "Voce esta tentando transferir R$ 1,99. No momento, seu limite disponivel para o dia de hoje e R$ 0,00."

Isso e uma configuracao na sua conta EFI que precisa ser ajustada no painel da Gerencianet/EFI Pay.

### Problema 2: Webhook marca pagamento como "completed" sem verificar status
O webhook da EFI enviou uma notificacao com status `NAO_REALIZADO` (falhou), mas o codigo do webhook **ignora o status** e marca tudo como "completed". Por isso a transacao aparece como concluida no app mesmo tendo falhado.

### Problema 3: Funcao de verificar status usa metodo de autenticacao quebrado
A funcao `pix-check-status` usa `getClaims()` que causa erro 503. Deveria usar `getUser()`. Isso impede que o polling de status funcione corretamente.

---

## Plano de correcao

### 1. Corrigir o webhook da EFI para respeitar o status real
**Arquivo:** `supabase/functions/pix-webhook/index.ts`

Na funcao `handleEfiWebhook`, ao processar cada notificacao, verificar o campo `status` do payload EFI:
- `NAO_REALIZADO` -> marcar transacao como `failed`
- `REALIZADO` / sem erro -> marcar como `completed`
- Salvar a mensagem de erro do campo `gnExtras.erro.motivo` na descricao

### 2. Corrigir autenticacao na funcao pix-check-status
**Arquivo:** `supabase/functions/pix-check-status/index.ts`

Substituir `getClaims(token)` por `getUser()` (padrao correto para Edge Functions).

### 3. Mostrar erro real ao usuario no app
Quando uma transacao for marcada como `failed`, o app deve exibir a mensagem de erro do provedor para que o usuario saiba o que aconteceu (ex: limite diario insuficiente).

---

## Secao tecnica

### Webhook EFI - Mudanca no mapeamento de status (pix-webhook/index.ts)
```text
Antes:
  - Qualquer notificacao EFI -> status = "completed"

Depois:
  - Verificar pixEvent.status:
    - "NAO_REALIZADO" -> status = "failed", nao setar paid_at
    - "REALIZADO" / sem campo status -> status = "completed", setar paid_at
  - Armazenar gnExtras.erro.motivo como informacao adicional
```

### pix-check-status - Correcao de autenticacao (pix-check-status/index.ts)
```text
Antes:
  const { data: claims, error: authError } = await supabase.auth.getClaims(token);
  const userId = claims.claims.sub;

Depois:
  const { data: { user }, error: authError } = await supabase.auth.getUser();
```

### Acao necessaria no painel EFI
Para que os pagamentos Pix funcionem de fato, voce precisa acessar o painel da EFI Pay (app.gerencianet.com.br ou app.sejaefi.com.br) e aumentar o limite diario de transferencias Pix, que atualmente esta em R$ 0,00.

