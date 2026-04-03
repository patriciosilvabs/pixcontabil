

## Auto-Detector de Chave Pix — Step 1 Redesign

### O que muda

Substituir o **Select dropdown** de tipo de chave no Step 1 do `PixKeyDialog` por um **input único com detecção automática** e badges visuais que indicam o tipo detectado em tempo real.

### Arquivos

| Arquivo | Alteração |
|---------|-----------|
| `src/lib/pix-utils.ts` | **Novo** — função `detectPixKeyType()` com regex para CPF, CNPJ, Email, Telefone e EVP |
| `src/components/pix/PixKeyDialog.tsx` | Redesign do Step 1: remover Select, adicionar grid de badges e validação automática |

### Detalhes técnicos

**1. `src/lib/pix-utils.ts`** — Função de detecção

```typescript
function detectPixKeyType(input: string): PixKeyType | null
```

Heurística (aplicada nesta ordem):
- **E-mail**: `^\S+@\S+\.\S+$`
- **EVP/Aleatória**: UUID de 36 chars `^[0-9a-f]{8}-...-[0-9a-f]{12}$`
- **Telefone**: `^(\+?55)?\s?\(?\d{2}\)?\s?9?\d{4}-?\d{4}$`
- **CPF**: 11 dígitos (com ou sem máscara), validação de checksum via `isValidCPF` existente
- **CNPJ**: 14 dígitos (com ou sem máscara), validação via `isValidCNPJ` existente
- Retorna `null` se nenhum padrão corresponder

**2. Step 1 do `PixKeyDialog`** — Nova UI

```text
┌──────────────────────────────┐
│  ← PIX COM CHAVE            │
│  ████████████████████████    │  progress bar
│                              │
│  CHAVE PIX                   │
│  ┌────────────────────────┐  │
│  │ Digite a chave...      │  │  input único
│  └────────────────────────┘  │
│                              │
│  [CPF] [CNPJ] [E-mail]      │  badges grid
│  [Telefone] [Aleatória]     │  (detectado = roxo, resto = muted)
│                              │
│  ☐ Salvar como Favorecido   │
│                              │
│  ┌────────────────────────┐  │
│  │     CONTINUAR          │  │  disabled até validação
│  └────────────────────────┘  │
└──────────────────────────────┘
```

- O `pixKeyType` é definido automaticamente pelo `detectPixKeyType()` chamado em `onChange`
- Badge do tipo detectado recebe `bg-primary text-primary-foreground`; demais ficam `bg-muted text-muted-foreground`
- Botão "Continuar" habilitado apenas quando `detectPixKeyType()` retorna um tipo válido
- Se o usuário clicar num badge manualmente, força aquele tipo (override) e desabilita auto-detecção
- Feedback de erro: texto vermelho abaixo do input se a chave não corresponder a nenhum formato após blur

### Impacto

- Remove a etapa manual de selecionar tipo de chave — UX mais fluida
- O `pixKeyType` continua sendo passado para os steps seguintes sem alteração
- Nenhuma mudança nos Steps 2-6 ou nas Edge Functions

