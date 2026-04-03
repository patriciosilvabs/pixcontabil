

## Redesign Step 1 — Tela de Transferência Pix (estilo Nubank)

### O que muda

Substituir o Step 1 atual (drawer com badges e progress bar) por uma **tela fullscreen escura** idêntica à imagem de referência.

### Layout alvo

```text
┌──────────────────────────────┐
│ ✕                            │  botão fechar (canto superior esq)
│                              │
│ Para quem você quer          │  título grande, bold
│ transferir?                  │
│                              │
│ Insira o dado de quem vai    │  subtítulo verde/muted
│ receber                      │
│ ┌────────────────────┐ [QR]  │  input + ícone QR à direita
│ │ Nome, CPF/CNPJ ... │       │
│ └────────────────────┘       │
│                              │
│ Você sempre costuma pagar    │  seção favoritos (horizontal)
│ (●)(●)(●)                    │  avatares circulares
│ Nome  Nome  Nome             │
│                              │
│ Todos os seus contatos       │  seção contatos (futuro)
└──────────────────────────────┘
```

### Alterações

**1. `src/components/pix/PixKeyDialog.tsx` — Step 1 fullscreen**

- Step 1 deixa de usar o `Drawer` — renderiza uma **tela fullscreen** com `fixed inset-0 z-50 bg-background`
- Steps 2-6 continuam no `Drawer` como hoje
- Novo layout Step 1:
  - Botão `X` no canto superior esquerdo (fecha o dialog)
  - Título: "Para quem você quer transferir?" — `text-2xl font-bold`
  - Subtítulo: "Insira o dado de quem vai receber" — cor `text-green-500` (como na imagem)
  - Input com placeholder "Nome, CPF/CNPJ ou chave Pix" — estilo underline (border-bottom only)
  - Ícone QR code à direita do input (abre scanner QR existente ou é decorativo)
  - Auto-detecção mantida internamente (`detectPixKeyType`) mas **sem os badges visíveis**
  - Ao digitar uma chave válida e pressionar Enter ou confirmar, avança para Step 2 (abre o Drawer)

- Seção "Você sempre costuma pagar":
  - Busca favoritos salvos do banco de dados (tabela `favorites` ou similar, se existir)
  - Renderiza avatares circulares com iniciais + nome + instituição truncada
  - Ao clicar num favorito, preenche a chave e avança

- Seção "Todos os seus contatos": placeholder estático por enquanto

**2. Estilo visual**
- Fundo escuro (`bg-background` no tema dark)
- Input com estilo underline (sem borda completa, apenas `border-b`)
- Texto do subtítulo em verde (`text-green-500`)
- Avatares: círculos `bg-muted` com iniciais ou ícone de empresa

### Detecção de chave

A lógica de `detectPixKeyType` continua funcionando internamente para validar a chave antes de avançar. Os badges são removidos da UI — a detecção é transparente para o usuário.

### Fluxo resultante

1. Usuário clica "COM CHAVE" → abre tela fullscreen (Step 1)
2. Digita a chave ou seleciona favorito → `detectPixKeyType` valida internamente
3. Pressiona Enter ou botão → fecha fullscreen, abre Drawer no Step 2
4. Steps 2-6 permanecem iguais

### Arquivos alterados

| Arquivo | Alteração |
|---------|-----------|
| `src/components/pix/PixKeyDialog.tsx` | Step 1 como tela fullscreen, steps 2-6 no drawer |

