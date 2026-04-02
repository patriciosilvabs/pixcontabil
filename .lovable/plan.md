

## Reverter boleto para novo proxy em `pix-check-status`

O proxy novo (`http://72.61.25.92:3000`) já foi corrigido e agora roteia corretamente `GET /status/billet/{id}` para `GET /billets/{id}` na ONZ. Não há mais necessidade de usar o proxy antigo.

### Alteração em `supabase/functions/pix-check-status/index.ts`

1. **Remover `callOnzViaProxy`** (linhas 25-37) e **`getOnzToken`** (linhas 39-52) — não são mais necessários

2. **Substituir o bloco de boleto (linhas 181-260)** para usar `callNewProxy` em vez do proxy antigo:
   - Trocar `callOnzViaProxy(billetUrl, 'GET', headers)` por `callNewProxy('/status/billet/' + statusId, 'GET')`
   - Remover a chamada de autenticação via `pix-auth` (o novo proxy gerencia tokens internamente)
   - Manter toda a lógica de mapeamento de status, tratamento de 404 e atualização de transação

3. **Resultado**: boleto e pix seguem o mesmo padrão via novo proxy

```text
Boleto ONZ: pix-check-status → novo proxy → GET /status/billet/{id} → ONZ GET /billets/{id}
Pix ONZ:    pix-check-status → novo proxy → GET /status/pix/{e2eId}
```

### Arquivo alterado
- `supabase/functions/pix-check-status/index.ts`

