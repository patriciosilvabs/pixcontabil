

## Plano: Atualizar URL do Proxy ONZ

### Situação Atual
- O serviço `onz-proxy-service` em `us-central1` está funcionando: `/health` retorna `{"status":"ok","certsLoaded":true}`
- O serviço `onz` em `europe-west1` retorna 403 (problema de IAM)
- O secret `ONZ_PROXY_URL` existe mas provavelmente aponta para o serviço com problema

### Alteração Necessária
1. **Atualizar o secret `ONZ_PROXY_URL`** para o valor:
   `https://onz-proxy-service-180876856178.us-central1.run.app`

Nenhuma alteração de código é necessária — todas as edge functions já usam `Deno.env.get('ONZ_PROXY_URL')`.

### Resultado
Após a atualização, todas as operações Pix (autenticação, pagamentos, saldo, comprovantes) passarão a usar o proxy funcional.

