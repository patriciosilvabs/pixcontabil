

## Plano: Corrigir Dockerfile do Proxy ONZ

### Problema
O Cloud Build usa o contexto do repositório raiz, onde `index.js` e `package.json` do proxy não existem. O Dockerfile atual tenta `COPY index.js ./` mas o arquivo está em `docs/onz-proxy/index.js`.

### Solução
Atualizar o `Dockerfile` na raiz para copiar os arquivos do caminho correto:

```dockerfile
FROM node:18-alpine
WORKDIR /app
COPY docs/onz-proxy/package.json ./
RUN npm install --production
COPY docs/onz-proxy/index.js ./
EXPOSE 3000
CMD ["node", "index.js"]
```

### Alternativa (recomendada para o futuro)
Em vez de alterar o Dockerfile, submeter o build com contexto restrito:
```bash
gcloud builds submit --tag gcr.io/PROJECT_ID/onz-proxy docs/onz-proxy/
```
Isso usa o `Dockerfile` que já existe em `docs/onz-proxy/` com os caminhos corretos. Nenhuma alteração de código necessária.

### Ação imediata
Atualizar o Dockerfile raiz com os caminhos `docs/onz-proxy/`.

