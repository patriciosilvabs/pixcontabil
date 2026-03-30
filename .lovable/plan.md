

# Corrigir consulta de juros/multa para boletos vencidos (ONZ)

## Diagnóstico

A API ONZ **não possui endpoint de consulta de boleto** (`/api/v2/billets/consult` não existe). O `billet-consult` tenta chamá-lo, falha silenciosamente no `catch` (linha 158), e retorna o fallback com todos os valores `undefined` — sem juros, multa, vencimento ou beneficiário.

A documentação oficial ONZ confirma que existem apenas 4 endpoints de boleto:
- `POST /billets/payments` — pagar
- `GET /billets` — listar
- `GET /billets/{id}` — detalhe
- `GET /billets/payments/receipt/{id}` — comprovante

A ONZ diz explicitamente: **"Payment will always be made using an adjusted amount (interest and fines)"** — ou seja, juros e multa são calculados automaticamente no momento do pagamento.

Além disso, há um segundo bug em `billet-pay`: na linha 160, `informedValue` (valor informado pelo usuário/parser, sem juros) tem prioridade sobre `paymentData.payment?.amount` (valor ajustado pela ONZ). Isso faz com que a transação seja salva com o valor original, sem juros.

## Correções

### 1. `supabase/functions/billet-consult/index.ts` — Melhorar fallback ONZ

Em vez de tentar um endpoint inexistente, usar o parser local de código de barras para extrair valor original e vencimento, e sinalizar que juros serão calculados automaticamente:

- Remover a tentativa de chamar `/api/v2/billets/consult`
- Implementar parsing inline do código de barras (extrair valor e vencimento do código 44/47 dígitos)
- Calcular se está vencido comparando `dueDate < hoje`
- Retornar `value`, `due_date`, `is_overdue: true` e uma nota explicativa
- Adicionar logging para debug

### 2. `supabase/functions/billet-pay/index.ts` — Corrigir prioridade do valor

Na linha 160, inverter a prioridade para que o valor ajustado da ONZ tenha precedência sobre o valor informado:

```typescript
// ANTES (bug):
const amount = informedValue || parsePositiveAmount(paymentData.payment?.amount) || ...

// DEPOIS (correto):
const amount = parsePositiveAmount(paymentData.payment?.amount) || informedValue || ...
```

Isso garante que o valor gravado na transação inclua juros e multa calculados pela ONZ.

### 3. `src/components/payment/BoletoPaymentDrawer.tsx` — Exibir aviso de boleto vencido

Quando o `consultData` retornar `is_overdue: true` e `provider: 'onz'`:
- Mostrar alerta informando que juros e multa serão calculados automaticamente pelo provedor
- Exibir o valor original e vencimento extraídos do código de barras
- Na tela de confirmação (step 2), mostrar aviso: "O valor final pode incluir juros e multa calculados automaticamente"

## Resultado esperado

- Boletos vencidos mostram aviso claro de que juros/multa serão aplicados
- Valor original e vencimento são extraídos do código de barras
- Transação é salva com o valor real pago (incluindo juros), não o valor original

