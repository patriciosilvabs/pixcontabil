

## Atualizar secrets do proxy ONZ

O proxy está rodando no Google Cloud Run com sucesso. Precisamos atualizar dois secrets:

1. **`ONZ_PROXY_URL`** → `https://onz-proxy-488280217238.southamerica-east1.run.app`
2. **`ONZ_PROXY_API_KEY`** → `infopago!!@@`

Depois, testar a autenticação chamando `pix-auth` para confirmar que o proxy está intermediando corretamente as chamadas à ONZ.

### Passos
1. Atualizar `ONZ_PROXY_URL` com a URL correta do Cloud Run
2. Atualizar `ONZ_PROXY_API_KEY` com a chave correta
3. Testar `pix-auth` end-to-end para validar a conexão ONZ via proxy

