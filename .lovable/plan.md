
# Configuração da Integração Pix com ONZ Sandbox

## Resumo
Você recebeu credenciais de sandbox da ONZ para testar a integração Pix. Este plano detalha como configurar essas credenciais no PixFlow.

---

## Informações Recebidas (do Email)

| Item | Valor |
|------|-------|
| **Portal Finance (Sandbox)** | https://finance.bancodigital.hmg.onz.software/ |
| **Login Finance** | 00904831388 |
| **Senha Finance** | @patricio11 |
| **Senha de Transação** | 1234 |
| **API QRCodes** | https://api.pix-h.amplea.coop.br |
| **API de Contas (Base URL)** | https://secureapi.bancodigital.hmg.onz.software/api/v2 |
| **Chave Pix (testes)** | a848179b-3d62-431c-b563-4d30e24f9316 |
| **Senha certificado PFX** | onzsoftware |

---

## Passo a Passo de Configuração

### Passo 1: Gerar Credenciais de API no Portal ONZ

1. Acesse o Portal Finance: https://finance.bancodigital.hmg.onz.software/
2. Faça login com:
   - **CPF**: 00904831388
   - **Senha**: @patricio11
3. Navegue até **Configurações** ou **API/Integrações**
4. Crie novas credenciais de API com as permissões:
   - Pix (Leitura, Escrita, Criação)
   - Contas (Leitura)
   - Transações (Leitura)
   - Webhooks (Leitura, Escrita)
5. **IMPORTANTE**: Copie e salve o **Client ID** e **Client Secret** gerados - o secret só aparece uma vez!

### Passo 2: Configurar no PixFlow

Na página **Integração Pix** (`/settings/pix-integration`), preencha:

| Campo | Valor |
|-------|-------|
| **Provedor** | ONZ / Infopago |
| **Ambiente** | Sandbox (Testes) - deixar ativado |
| **URL Base da API** | `https://secureapi.bancodigital.hmg.onz.software/api/v2` (preenchido automaticamente) |
| **Client ID** | (gerado no passo 1) |
| **Client Secret** | (gerado no passo 1) |
| **Tipo de Chave** | Chave Aleatória |
| **Chave Pix** | `a848179b-3d62-431c-b563-4d30e24f9316` |

### Passo 3: Configurar Webhook no Portal ONZ

1. No Portal Finance, vá até **Webhooks**
2. Desative a opção **"Pausar envio dos webhooks"**
3. Configure um novo webhook:
   - **URL**: `https://ntvgthwqxixkoemyxhqo.supabase.co/functions/v1/pix-webhook`
   - **Método**: POST
   - **Eventos**: Transferência, Recebimento, Devolução
4. Se quiser adicionar segurança extra, configure um header:
   - **Header**: `x-webhook-secret`
   - **Valor**: (crie uma senha e anote)

### Passo 4: Testar a Conexão

1. Clique em **"Testar Conexão"** na página de configuração
2. Se aparecer "Conexão bem-sucedida!", a integração está funcionando
3. Faça um pagamento de teste pequeno (ex: R$ 0,01)

---

## Diagrama do Fluxo

```text
┌──────────────┐    1. Gerar credenciais    ┌─────────────────┐
│  Portal ONZ  │ ◄────────────────────────► │  Client ID +    │
│  (Sandbox)   │                             │  Client Secret  │
└──────────────┘                             └────────┬────────┘
                                                      │
                                                      ▼ 2. Configurar
┌──────────────┐    3. Testar conexão       ┌─────────────────┐
│   PixFlow    │ ◄────────────────────────► │   pix-auth      │
│  Config Page │                             │   Edge Func     │
└──────────────┘                             └─────────────────┘
       │                                              │
       │ 4. Webhook                                   │
       ▼                                              ▼
┌──────────────┐                             ┌─────────────────┐
│  Portal ONZ  │ ─────── Notificações ─────► │   pix-webhook   │
│  Webhooks    │                             │   Edge Func     │
└──────────────┘                             └─────────────────┘
```

---

## Seção Técnica

### Campos da Tabela `pix_configs`

| Campo | Tipo | Descrição |
|-------|------|-----------|
| `provider` | string | `"onz"` |
| `client_id` | string | ID gerado no portal |
| `client_secret_encrypted` | string | Secret gerado (armazenado em texto por enquanto) |
| `base_url` | string | `https://secureapi.bancodigital.hmg.onz.software/api/v2` |
| `pix_key` | string | `a848179b-3d62-431c-b563-4d30e24f9316` |
| `pix_key_type` | string | `"random"` |
| `is_sandbox` | boolean | `true` |
| `is_active` | boolean | `true` |

### Endpoint de Autenticação ONZ

A edge function `pix-auth` já está configurada para o formato ONZ:

```text
POST {base_url}/oauth/token
Body: {
  "clientId": "...",
  "clientSecret": "...",
  "grantType": "client_credentials",
  "scope": "pix.read pix.write transactions.read account.read webhook.read webhook.write"
}
```

### Sobre o Certificado PFX

Para sandbox, geralmente não é necessário certificado mTLS. A senha `onzsoftware` é para uso futuro em produção, se exigido.

---

## Próximo Passo

Acesse o Portal Finance da ONZ, gere as credenciais de API (Client ID e Client Secret), e preencha na página de Integração Pix. Me avise quando tiver as credenciais!
