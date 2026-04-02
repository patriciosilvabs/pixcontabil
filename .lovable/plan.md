

## Diagnóstico: Por que o boleto retorna 404

Analisei a documentação ONZ API e o código. O endpoint correto para consultar status de boleto é:

```text
GET /billets/{id}    (documentação ONZ, página 24-26)
```

O `pix-check-status` chama `callNewProxy('/status/billet/{id}', 'GET')` -- ou seja, depende de uma rota no novo proxy que deveria mapear para `GET /billets/{id}` na ONZ. O 404 vem da ONZ (`"Desculpe, não conseguimos encontrar o que você está procurando."`), o que indica que o novo proxy provavelmente está encaminhando para um endpoint incorreto (possivelmente `/billets/payments/{id}` que não existe como GET na ONZ).

Enquanto isso, a `billet-consult` já usa o **proxy antigo** (`ONZ_PROXY_URL`) com sucesso, passando a URL completa da ONZ diretamente.

## Correção

Modificar `pix-check-status` para usar o **proxy antigo** (`callOnzViaProxy`) para consultas de status de boleto, em vez do novo proxy. Isso garante que a URL correta da ONZ (`GET {base_url}/api/v2/billets/{id}`) seja chamada diretamente.

### Alterações em `supabase/functions/pix-check-status/index.ts`

1. **Adicionar função `callOnzViaProxy`** (mesma usada em `billet-consult`) que chama o proxy antigo com URL exata da ONZ

2. **Para boletos ONZ, trocar o fluxo:**
   - Obter token via `pix-auth`
   - Buscar `base_url` do `pix_configs` (já disponível em `config`)
   - Chamar `callOnzViaProxy('{base_url}/api/v2/billets/{id}', 'GET', headers)` diretamente
   - Manter todo o mapeamento de status e lógica de 404/failed existente

3. **Manter o fluxo Pix pelo novo proxy** (funciona normalmente para Pix)

### Fluxo resultante

```text
Boleto ONZ: pix-check-status → pix-auth (token) → proxy antigo → GET /api/v2/billets/{id}
Pix ONZ:    pix-check-status → novo proxy → GET /status/pix/{e2eId}
```

### Arquivo alterado
- `supabase/functions/pix-check-status/index.ts`

