

## Repetir Pagamento Pix com 1 Toque

### Problema

Hoje, mesmo usando favoritos no `PixKeyDialog`, o usuário precisa:
1. Tocar no avatar do favorito (preenche só a chave)
2. Digitar o valor novamente
3. Digitar a descrição novamente
4. Confirmar beneficiário
5. Pagar

Quer um atalho: **tocar uma vez e ir direto para a confirmação** com valor + descrição já preenchidos do último pagamento.

### Solução

Adicionar uma seção **"Repetir último pagamento"** no dashboard mobile e também dentro do fluxo Pix com Chave, listando os últimos pagamentos completos com valor, beneficiário e data. Ao tocar, pula direto para o **Step 4 (confirmação do beneficiário)** com tudo preenchido.

### Layout

**No `MobileDashboard` (acima de "Últimas Transações"):**

```text
┌─────────────────────────────────────────┐
│ 🔄 Repetir Pagamento                    │
├─────────────────────────────────────────┤
│ [JS]  João Silva           R$ 150,00 ↻ │
│       CPF ***456.789-** · ontem         │
├─────────────────────────────────────────┤
│ [MA]  Maria Andrade        R$ 89,50  ↻ │
│       Pix · há 2 dias                   │
├─────────────────────────────────────────┤
│ [PE]  Pedro Empresa LTDA   R$ 1.200 ↻ │
│       CNPJ · há 3 dias                  │
└─────────────────────────────────────────┘
         Ver todos os pagamentos →
```

- Mostra os **5 últimos pagamentos únicos** (deduplicados por chave Pix)
- Botão circular `↻` à direita = "Repetir"
- Toque em qualquer lugar do card = abre confirmação

### Fluxo ao tocar em "Repetir"

1. Abre o `PixKeyDialog` direto no **Step 4** (confirmação)
2. Carrega: chave Pix, tipo, valor, descrição, nome do beneficiário do último pagamento
3. Dispara um **probe de R$ 0,01** em background para revalidar o nome atual do beneficiário
4. Usuário só toca em **"Confirmar e Pagar"**
5. Se a tag rápida do método ainda existir, é pré-selecionada; se for obrigatória e não tiver, força seleção antes

### Regras

- Lista apenas transações com `status = 'completed'`, `pix_type` em `('key','copy_paste','qrcode')` e `pix_key` não nulo
- Operadores veem só os próprios pagamentos; admins veem da empresa
- Deduplica por `pix_key` mantendo o mais recente
- Respeita o bloqueio por comprovante pendente (`block_on_pending_receipt`)
- Se a empresa tiver Tags Rápidas obrigatórias, exibe Step 5 (tag) antes de pagar

### Arquivos

**Novos:**
- `src/components/payment/RepeatPaymentSection.tsx` — card no dashboard com os 5 últimos pagamentos únicos
- `src/hooks/useRecentPayments.ts` — extrai a query do `RecentPayments.tsx` para reuso

**Alterados:**
- `src/components/dashboard/MobileDashboard.tsx` — incluir `<RepeatPaymentSection />` antes da lista de transações; ao selecionar, abrir `PixKeyDialog` com `initialPayment` prop
- `src/components/pix/PixKeyDialog.tsx` — aceitar prop opcional `initialPayment` que pré-popula chave/valor/descrição/beneficiário e inicia direto no Step 4
- `src/components/payment/RecentPayments.tsx` — refatorar para consumir `useRecentPayments` (mantém uso desktop em `NewPayment.tsx`)

### Observação

Boletos e pagamentos em dinheiro **não** entram nesta lista (não fazem sentido repetir — código de barras e cédulas mudam). Apenas Pix com chave/QR/copia-cola.

