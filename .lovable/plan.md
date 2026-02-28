

# Plano: Registro Automatico de Webhook via API Transfeera

## Problema
O webhook precisa ser registrado manualmente na plataforma Transfeera. A API permite registro programatico via `POST /webhook`.

## Implementacao

### 1. Nova Edge Function: `register-transfeera-webhook`
Criar `supabase/functions/register-transfeera-webhook/index.ts`:
- Recebe `company_id` no body
- Autentica com token **novo** (nunca cached) via `pix-auth` com `force_new: true`, ou autentica diretamente usando credenciais do `pix_configs`
- Consulta webhooks existentes: `GET /webhook`
- Se ja existe webhook com a URL do sistema, atualiza via `PUT /webhook/{id}`
- Se nao existe, cria via `POST /webhook` com:
  - `url`: URL do pix-webhook do projeto
  - `object_types`: `['Transfer', 'TransferRefund', 'CashIn', 'CashInRefund']`
- Retorna sucesso/erro

### 2. Frontend: Adicionar botao "Registrar Webhook" no PixIntegration.tsx
- Adicionar botao ao lado do campo de webhook URL
- Ao clicar, chama a edge function `register-transfeera-webhook`
- Exibe toast de sucesso/erro
- Tambem chamar automaticamente apos "Testar Conexao" com sucesso

### 3. Atualizar `handleTestConnection` no PixIntegration.tsx
- Apos teste de conexao bem-sucedido, automaticamente registrar o webhook via a nova edge function
- Exibir feedback ao usuario sobre o registro

### Detalhes Tecnicos

```text
Edge Function: register-transfeera-webhook
1. Busca pix_configs da company
2. Autentica DIRETAMENTE na Transfeera (token novo, sem cache)
3. GET {baseUrl}/webhook -> lista webhooks existentes
4. Se URL ja registrada -> PUT /webhook/{id} para atualizar object_types
5. Se nao -> POST /webhook com url + object_types
6. Retorna resultado
```

URLs da API (sandbox vs producao):
- Sandbox: `https://api-sandbox.transfeera.com/webhook`
- Producao: `https://api.transfeera.com/webhook`

