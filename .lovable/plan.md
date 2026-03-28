

# Proteger .env no .gitignore

## O que será feito

Adicionar `.env` e variantes ao `.gitignore` para prevenir que arquivos de ambiente sejam versionados acidentalmente no Git.

## Alteração

**Arquivo**: `.gitignore`

Adicionar após a linha 13 (`*.local`):

```
.env
.env.*
```

Isso protege contra commits acidentais de `.env`, `.env.development`, `.env.production`, etc.

## Nota importante

No Lovable, o `.env` é gerenciado automaticamente pela plataforma e não precisa ser editado manualmente. Esta alteração é uma camada extra de segurança caso o projeto seja exportado para GitHub.

