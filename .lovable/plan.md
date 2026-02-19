

## Suporte a Dois Provedores Simultâneos (Cash-in + Cash-out)

### Situação Atual
A tabela `pix_configs` tem um constraint `UNIQUE (company_id)`, permitindo apenas **uma configuração de provedor por empresa**. Todas as edge functions (pagamento, saldo, QR code) usam essa mesma config.

### Solução Proposta
Adicionar uma coluna `purpose` na tabela `pix_configs` para separar configs por finalidade, permitindo que uma empresa tenha, por exemplo, **Woovi para cash-in** e **Paggue para cash-out**.

### Etapas

**1. Migração do banco de dados**
- Adicionar coluna `purpose` com valores `'cash_in'`, `'cash_out'` ou `'both'` (default: `'both'`)
- Remover o constraint `UNIQUE (company_id)`
- Criar novo constraint `UNIQUE (company_id, purpose)` para evitar duplicatas
- Atualizar registros existentes para `purpose = 'both'`

```text
  pix_configs (antes)           pix_configs (depois)
  +------------------+          +------------------+
  | company_id (UQ)  |          | company_id       |
  | provider         |          | provider         |
  | ...              |          | purpose          | <-- NOVO
  +------------------+          | ...              |
                                +------------------+
                                UQ(company_id, purpose)
```

**2. Atualizar Edge Functions de cash-out** (`pix-pay-dict`, `pix-pay-qrc`)
- Alterar a query de `pix_configs` para buscar primeiro por `purpose = 'cash_out'`
- Se nao encontrar, usar fallback para `purpose = 'both'`
- Isso garante que configs antigas (purpose='both') continuam funcionando

**3. Atualizar Edge Functions de cash-in/consulta** (`pix-balance`, `pix-qrc-info`, `pix-check-status`, `pix-receipt`, `pix-auth`, `pix-webhook`)
- Alterar queries para buscar primeiro por `purpose = 'cash_in'`
- Fallback para `purpose = 'both'`

**4. Atualizar a tela de configuracao Pix** (`src/pages/settings/PixIntegration.tsx`)
- Separar a interface em duas secoes: **Provedor de Recebimento (Cash-in)** e **Provedor de Pagamento (Cash-out)**
- Permitir configurar provedores independentes para cada finalidade
- Manter a opcao de usar o mesmo provedor para ambos (purpose='both')

**5. Atualizar `pix_tokens`**
- A tabela `pix_tokens` tambem tem referencia a `company_id` -- sera necessario diferenciar tokens por config/provedor para evitar conflito de autenticacao entre os dois provedores
- Adicionar coluna `pix_config_id` para vincular o token a config correta

### Compatibilidade
- Registros existentes recebem `purpose = 'both'` e continuam funcionando sem alteracao
- O fallback garante que empresas com apenas uma config nao precisam mudar nada
- Novas empresas podem optar por separar provedores

### Secao Tecnica - Resumo das alteracoes

| Arquivo | Alteracao |
|---------|-----------|
| Migration SQL | Adicionar `purpose`, alterar constraints, atualizar `pix_tokens` |
| `pix-pay-dict/index.ts` | Query com filtro `purpose IN ('cash_out','both')` |
| `pix-pay-qrc/index.ts` | Query com filtro `purpose IN ('cash_out','both')` |
| `pix-balance/index.ts` | Query com filtro `purpose IN ('cash_in','both')` |
| `pix-auth/index.ts` | Receber `purpose` como parametro para autenticar no provedor correto |
| `pix-qrc-info/index.ts` | Query com filtro `purpose IN ('cash_in','both')` |
| `pix-check-status/index.ts` | Detectar provider pela transacao |
| `pix-webhook/index.ts` | Query com filtro `purpose IN ('cash_in','both')` |
| `PixIntegration.tsx` | UI separada para cash-in e cash-out |
| `src/types/database.ts` | Adicionar `purpose` ao tipo `PixConfig` |

