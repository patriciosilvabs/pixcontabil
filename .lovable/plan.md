

# Eliminar proxy ONZ: usar `caCerts` nativo do Deno

## Contexto

O proxy mTLS no Railway foi criado apenas porque o Deno nao confiava na CA do servidor ONZ (`UnknownIssuer`). Nao ha mTLS bidirecional obrigatorio — o servidor ONZ nao exige certificado client. A solucao correta e passar o certificado CA do servidor via `caCerts` no `Deno.createHttpClient`.

## Pre-requisito

O secret `ONZ_CA_CERT` ja existe no projeto. Verificar se contem o PEM correto da CA do servidor ONZ. Para extrair:

```text
openssl s_client -connect cashout.infopago.com.br:443 -showcerts < /dev/null 2>/dev/null | openssl x509 -outform PEM
```

Salvar o output completo (incluindo `-----BEGIN/END CERTIFICATE-----`) como valor do secret `ONZ_CA_CERT`.

## Plano de implementacao

### 1. Criar helper compartilhado para HttpClient ONZ

Em cada Edge Function que usa ONZ, adicionar uma funcao helper (ou repetir o pattern inline) que cria o `httpClient`:

```typescript
function createOnzClient(): Deno.HttpClient {
  const caCertRaw = Deno.env.get('ONZ_CA_CERT');
  if (!caCertRaw) throw new Error('ONZ_CA_CERT not configured');
  const caCerts = parseCaCerts(caCertRaw); // ja existe em todas as functions
  return Deno.createHttpClient({ caCerts });
}
```

### 2. Alterar as 8 Edge Functions

Substituir toda logica de proxy por chamadas diretas com `fetch` + `client: httpClient`. Arquivos afetados:

| Arquivo | Operacao |
|---|---|
| `pix-auth/index.ts` | OAuth token (POST /oauth/token) |
| `pix-balance/index.ts` | Consulta saldo (GET /accounts/balances/) |
| `pix-pay-dict/index.ts` | Pagamento por chave (POST /pix/payments/dict) |
| `pix-pay-qrc/index.ts` | Pagamento QR Code |
| `pix-qrc-info/index.ts` | Decode QR Code |
| `pix-check-status/index.ts` | Status do pagamento |
| `pix-receipt/index.ts` | Comprovante |
| `pix-refund/index.ts` | Devolucao |

**Padrao da alteracao (exemplo pix-balance):**

De:
```typescript
const proxyUrl = Deno.env.get('ONZ_PROXY_URL');
const proxyApiKey = Deno.env.get('ONZ_PROXY_API_KEY');
// ... fetch via proxy ...
const proxyResponse = await fetch(`${proxyUrl}/proxy`, { ... });
const proxyData = await proxyResponse.json();
const data = proxyData.data || proxyData;
```

Para:
```typescript
const httpClient = createOnzClient();
try {
  const response = await fetch(balanceUrl, {
    method: 'GET',
    headers: fetchHeaders,
    // @ts-ignore - Deno specific
    client: httpClient,
  });
  const data = await response.json();
  // ... processar data diretamente (sem wrapper proxyData.data) ...
} finally {
  httpClient.close();
}
```

### 3. pix-auth: formato do body OAuth

Manter o formato `application/x-www-form-urlencoded` com `client_id`, `client_secret`, `grant_type` (snake_case) que ja foi implementado. Apenas trocar o transporte de proxy para chamada direta.

### 4. Remover dependencias do proxy

- Os secrets `ONZ_PROXY_URL` e `ONZ_PROXY_API_KEY` podem ser mantidos por enquanto (nao quebram nada)
- O codigo do proxy em `docs/onz-proxy/` pode ser mantido como referencia

## Resumo das mudancas

- **8 Edge Functions** alteradas: remover logica de proxy, usar `Deno.createHttpClient({ caCerts })` com chamada direta
- **0 novas dependencias** — usa APIs nativas do Deno
- **Nenhuma mudanca no frontend** — as Edge Functions mantêm a mesma interface
- **Resultado**: elimina dependencia do Railway, reduz latencia (1 hop a menos), simplifica debug

