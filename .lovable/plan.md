

# Corrigir 404 no hard refresh (Ctrl+Shift+R)

## Problema

Ao fazer Ctrl+Shift+R (hard refresh que ignora cache), o servidor da Lovable não sabe redirecionar rotas como `/auth` para o `index.html`, resultando em 404. O F5 normal funciona porque o browser/service worker já conhece o roteamento do SPA.

## Correção

Criar o arquivo `vercel.json` na raiz do projeto com uma regra de rewrite que direciona todas as rotas para `index.html`:

**Novo arquivo**: `vercel.json`
```json
{
  "rewrites": [
    { "source": "/(.*)", "destination": "/index.html" }
  ]
}
```

Isso garante que qualquer rota acessada diretamente (hard refresh ou link direto) seja servida pelo `index.html`, permitindo que o React Router assuma o controle.

### Arquivos alterados
- `vercel.json` (novo) — regra de rewrite para SPA

