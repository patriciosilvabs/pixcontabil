
# Integração com API Pix - Padrão BCB (Banco Central do Brasil)

## Visao Geral

Este plano implementa a camada de integracao com provedores Pix que seguem o padrao da API definida pelo Banco Central. A arquitetura sera modular para suportar diferentes PSPs (Prestadores de Servico de Pagamento) como Banco Inter, Gerencianet/Efi, Itau, Bradesco, entre outros.

---

## Arquitetura da Integracao

```text
+------------------+     +-------------------+     +------------------+
|   Frontend       |     |   Edge Functions  |     |   Provedor Pix   |
|   (React)        |     |   (Deno)          |     |   (API BCB)      |
+------------------+     +-------------------+     +------------------+
         |                        |                        |
         |  1. Criar Pix          |                        |
         |----------------------->|                        |
         |                        |  2. OAuth Token        |
         |                        |----------------------->|
         |                        |<-----------------------|
         |                        |                        |
         |                        |  3. POST /cob          |
         |                        |----------------------->|
         |                        |<-----------------------|
         |                        |                        |
         |  4. txid + QR Code     |                        |
         |<-----------------------|                        |
         |                        |                        |
         |                        |  5. Webhook (pago)     |
         |                        |<-----------------------|
         |                        |                        |
         |  6. Notificacao        |                        |
         |<-----------------------|                        |
+------------------+     +-------------------+     +------------------+
```

---

## Modulo 1: Configuracao de Secrets

### Secrets Necessarios
Para integrar com qualquer provedor Pix, serao necessarios:

| Secret | Descricao |
|--------|-----------|
| `PIX_CLIENT_ID` | ID do cliente OAuth2 |
| `PIX_CLIENT_SECRET` | Chave secreta OAuth2 |
| `PIX_BASE_URL` | URL base da API do provedor |
| `PIX_CERTIFICATE` | Certificado mTLS (Base64) |
| `PIX_CERTIFICATE_KEY` | Chave do certificado (Base64) |
| `PIX_WEBHOOK_SECRET` | Chave para validar webhooks |

### Observacao sobre mTLS
A API Pix exige autenticacao mutua TLS (mTLS) com certificado digital. No ambiente Deno/Edge Functions, isso sera tratado atraves de chamadas HTTP com certificados injetados.

---

## Modulo 2: Edge Function - Autenticacao OAuth2

### Arquivo: `supabase/functions/pix-auth/index.ts`

Responsabilidades:
- Obter access_token via `client_credentials`
- Cache do token ate expiracao
- Renovacao automatica

Endpoint interno:
```text
POST /pix-auth
Response: { access_token, expires_in, token_type }
```

### Fluxo
1. Verificar se ha token em cache (tabela `pix_tokens`)
2. Se expirado, solicitar novo via `POST /oauth/token`
3. Armazenar token com timestamp de expiracao
4. Retornar token valido

---

## Modulo 3: Edge Function - Criar Cobranca (Cob)

### Arquivo: `supabase/functions/pix-create-cob/index.ts`

Responsabilidades:
- Criar cobranca imediata (Cob)
- Gerar QR Code e Pix Copia e Cola
- Registrar transacao no banco

### Endpoint
```text
POST /pix-create-cob
Body: {
  valor: number,
  chave: string,
  descricao?: string,
  devedor?: { cpf/cnpj, nome }
}
```

### Fluxo
1. Autenticar via `pix-auth`
2. Gerar txid unico (35 caracteres alfanumericos)
3. Chamar `PUT /cob/{txid}` na API do provedor
4. Receber `location` e dados do QR Code
5. Salvar transacao no banco com status `pending`
6. Retornar QR Code + Pix Copia e Cola

---

## Modulo 4: Edge Function - Consultar Status

### Arquivo: `supabase/functions/pix-check-status/index.ts`

Responsabilidades:
- Consultar status de pagamento
- Atualizar transacao se paga

### Endpoint
```text
GET /pix-check-status?txid={txid}
```

### Fluxo
1. Chamar `GET /cob/{txid}` na API
2. Verificar status (`ATIVA`, `CONCLUIDA`, `REMOVIDA_PELO_USUARIO_RECEBEDOR`)
3. Atualizar banco de dados se status mudou

---

## Modulo 5: Edge Function - Webhook

### Arquivo: `supabase/functions/pix-webhook/index.ts`

Responsabilidades:
- Receber notificacoes de pagamento
- Validar assinatura do webhook
- Atualizar transacao como paga
- Disparar notificacao para frontend

### Endpoint
```text
POST /pix-webhook
Headers: x-webhook-secret
Body: { pix: [{ txid, valor, horario, ... }] }
```

### Fluxo
1. Validar header de autenticacao
2. Parsear payload do webhook
3. Para cada Pix recebido:
   - Buscar transacao pelo txid/e2eid
   - Atualizar status para `completed`
   - Registrar `paid_at`
4. Retornar 200 OK

### Tipos de Webhook (BCB)
- `pix`: Pagamento recebido
- `devolucao`: Devolucao processada

---

## Modulo 6: Edge Function - Devolver Pix

### Arquivo: `supabase/functions/pix-refund/index.ts`

Responsabilidades:
- Solicitar devolucao parcial ou total
- Registrar devolucao no banco

### Endpoint
```text
POST /pix-refund
Body: { e2eid, id, valor }
```

### Fluxo
1. Autenticar
2. Chamar `PUT /pix/{e2eid}/devolucao/{id}`
3. Registrar na tabela `pix_refunds`

---

## Modulo 7: Tabelas Adicionais

### Nova tabela: `pix_tokens`
```sql
CREATE TABLE pix_tokens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id),
  access_token TEXT NOT NULL,
  token_type TEXT DEFAULT 'bearer',
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);
```

### Nova tabela: `pix_configs`
```sql
CREATE TABLE pix_configs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID UNIQUE NOT NULL REFERENCES companies(id),
  provider TEXT NOT NULL, -- 'inter', 'gerencianet', 'itau', etc
  client_id TEXT NOT NULL,
  client_secret_encrypted TEXT NOT NULL,
  base_url TEXT NOT NULL,
  pix_key TEXT NOT NULL,
  pix_key_type pix_key_type NOT NULL,
  certificate_encrypted TEXT,
  webhook_url TEXT,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);
```

### Nova tabela: `pix_refunds`
```sql
CREATE TABLE pix_refunds (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  transaction_id UUID NOT NULL REFERENCES transactions(id),
  e2eid TEXT NOT NULL,
  refund_id TEXT NOT NULL,
  valor NUMERIC NOT NULL,
  motivo TEXT,
  status TEXT DEFAULT 'EM_PROCESSAMENTO',
  refunded_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now()
);
```

### Atualizacao da tabela `transactions`
```sql
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS
  pix_txid TEXT,
  pix_e2eid TEXT,
  pix_location TEXT,
  pix_qrcode TEXT,
  pix_copia_cola TEXT;
```

---

## Modulo 8: Integracao Frontend

### Atualizacoes em `NewPix.tsx`

1. Ao confirmar pagamento:
   - Chamar edge function `pix-create-cob`
   - Exibir QR Code para conferencia
   - Salvar transacao com status `pending`

2. Polling de status:
   - Verificar a cada 5s se pagamento foi confirmado
   - Ou usar Realtime para notificacao instantanea

3. Fluxo atualizado:
   ```text
   Etapa 1: Dados do Pix
   Etapa 2: Valor e Descricao
   Etapa 3: Confirmacao -> Gera QR Code
   Etapa 4: Aguardando Pagamento (opcional se for envio)
   Etapa 5: Captura de Comprovante
   ```

### Novo componente: `PixQRCodeDisplay`
- Exibe QR Code gerado
- Botao para copiar Pix Copia e Cola
- Timer de expiracao (calendario.expiracao)

---

## Modulo 9: Tratamento de Erros

### Codigos de Erro BCB Suportados
| Erro | HTTP | Tratamento |
|------|------|------------|
| `RequisicaoInvalida` | 400 | Exibir mensagem ao usuario |
| `AcessoNegado` | 403 | Renovar token e tentar novamente |
| `NaoEncontrado` | 404 | Transacao nao existe |
| `CobOperacaoInvalida` | 400 | Validar dados antes de enviar |
| `ErroInternoDoServidor` | 500 | Retry com backoff |
| `ServicoIndisponivel` | 503 | Retry com backoff |

### Retry Strategy
- Max 3 tentativas
- Backoff exponencial: 1s, 2s, 4s
- Log de todas as tentativas

---

## Modulo 10: Configuracao do Provedor (Admin)

### Nova pagina: `/settings/pix-integration`

Funcionalidades:
- Selecionar provedor (dropdown)
- Inserir credenciais (Client ID, Client Secret)
- Upload de certificado mTLS
- Configurar chave Pix padrao
- Testar conexao
- Visualizar URL do webhook

### Validacao
- Testar autenticacao OAuth2
- Verificar se chave Pix pertence a conta

---

## Resumo dos Arquivos a Criar/Modificar

### Novos Arquivos
| Arquivo | Descricao |
|---------|-----------|
| `supabase/functions/pix-auth/index.ts` | Autenticacao OAuth2 |
| `supabase/functions/pix-create-cob/index.ts` | Criar cobranca |
| `supabase/functions/pix-check-status/index.ts` | Consultar status |
| `supabase/functions/pix-webhook/index.ts` | Receber webhooks |
| `supabase/functions/pix-refund/index.ts` | Devolucoes |
| `src/components/pix/PixQRCodeDisplay.tsx` | Exibir QR Code |
| `src/pages/settings/PixIntegration.tsx` | Config do provedor |
| `src/hooks/usePixPayment.ts` | Hook para pagamentos |

### Arquivos a Modificar
| Arquivo | Modificacao |
|---------|-------------|
| `src/pages/NewPix.tsx` | Integrar com edge functions |
| `supabase/config.toml` | Adicionar novas functions |
| Migracao SQL | Novas tabelas e colunas |

---

## Secao Tecnica - Detalhes de Implementacao

### Geracao do txid
Conforme padrao BCB, o txid deve ter entre 26 e 35 caracteres alfanumericos:
```typescript
function generateTxId(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let result = '';
  for (let i = 0; i < 35; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}
```

### Formato de Cobranca Imediata (Cob)
```json
{
  "calendario": {
    "expiracao": 3600
  },
  "valor": {
    "original": "100.00"
  },
  "chave": "chave-pix-do-recebedor",
  "solicitacaoPagador": "Descricao do pagamento",
  "infoAdicionais": [
    { "nome": "Pedido", "valor": "12345" }
  ]
}
```

### Resposta esperada
```json
{
  "txid": "abc123...",
  "revisao": 0,
  "loc": {
    "id": 1,
    "location": "pix.provider.com/qr/v2/abc123..."
  },
  "location": "pix.provider.com/qr/v2/abc123...",
  "status": "ATIVA",
  "calendario": { ... },
  "valor": { ... },
  "chave": "...",
  "pixCopiaECola": "00020126..."
}
```

---

## Proximos Passos Apos Aprovacao

1. Solicitar secrets do provedor Pix (PIX_CLIENT_ID, PIX_CLIENT_SECRET, etc)
2. Criar migracao SQL para novas tabelas
3. Implementar edge functions na ordem: auth -> create-cob -> webhook -> check-status -> refund
4. Atualizar frontend para usar as novas functions
5. Configurar webhook no painel do provedor
6. Testar fluxo completo em sandbox
