
# Implementar mTLS na Edge Function pix-auth

## Problema
A API da ONZ requer certificados mTLS (client certificate + key) para autenticacao. A edge function `pix-auth` atualmente faz `fetch` sem apresentar certificados, causando o erro `onz-0001: Invalid credentials`.

## Solucao
Usar `Deno.createHttpClient()` com os certificados PEM para criar um cliente HTTP customizado que apresenta o certificado do cliente durante o handshake TLS.

## Mudancas

### 1. Atualizar `supabase/functions/pix-auth/index.ts`
- Incluir `certificate_encrypted` e `certificate_key_encrypted` na interface `PixConfig`
- Apos carregar a config do banco, decodificar os certificados de Base64 para texto PEM
- Criar um `Deno.createHttpClient({ cert, key })` com os certificados
- Passar o `client` customizado na chamada `fetch` para o endpoint `/oauth/token`
- Fazer cleanup do client apos uso (`client.close()`)

### 2. Atualizar todas as outras edge functions que chamam a API da ONZ
As seguintes edge functions tambem fazem `fetch` diretamente para a API ONZ e precisam do mesmo tratamento mTLS:
- `supabase/functions/pix-pay-dict/index.ts` - pagamento via chave
- `supabase/functions/pix-pay-qrc/index.ts` - pagamento via QR code
- `supabase/functions/pix-check-status/index.ts` - consulta de status
- `supabase/functions/pix-receipt/index.ts` - comprovante
- `supabase/functions/pix-refund/index.ts` - devolucao
- `supabase/functions/pix-qrc-info/index.ts` - info do QR code
- `supabase/functions/billet-pay/index.ts` - pagamento de boleto
- `supabase/functions/billet-check-status/index.ts` - status boleto
- `supabase/functions/billet-receipt/index.ts` - comprovante boleto

**Abordagem:** Como todas essas funcoes ja chamam `pix-auth` para obter o token, e depois fazem chamadas diretas a API ONZ, cada uma precisara carregar a config e criar o `Deno.createHttpClient` com os certificados.

### 3. UI - Atualizar placeholder dos campos de certificado
Na pagina `src/pages/settings/PixIntegration.tsx`, atualizar o placeholder para indicar que os certificados sao **obrigatorios** para a ONZ (remover "opcional para alguns provedores").

## Detalhes Tecnicos

### Codigo do mTLS no pix-auth (exemplo central):

```text
// Decodificar certificados de Base64 para PEM
const certPem = atob(pixConfig.certificate_encrypted);
const keyPem = atob(pixConfig.certificate_key_encrypted);

// Criar HTTP client com mTLS
const httpClient = Deno.createHttpClient({
  cert: certPem,
  key: keyPem,
});

// Usar na chamada fetch
const tokenResponse = await fetch(tokenUrl, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(tokenPayload),
  client: httpClient,
});

// Cleanup
httpClient.close();
```

### Validacao
- Se os campos `certificate_encrypted` ou `certificate_key_encrypted` estiverem vazios, retornar erro 400 informando que certificados mTLS sao obrigatorios para o provedor ONZ
- Tratar erros de certificado invalido com mensagem clara

### Arquivos afetados
1. `supabase/functions/pix-auth/index.ts` - Adicionar mTLS
2. `supabase/functions/pix-pay-dict/index.ts` - Adicionar mTLS nas chamadas a API ONZ
3. `supabase/functions/pix-pay-qrc/index.ts` - Adicionar mTLS
4. `supabase/functions/pix-check-status/index.ts` - Adicionar mTLS
5. `supabase/functions/pix-receipt/index.ts` - Adicionar mTLS
6. `supabase/functions/pix-refund/index.ts` - Adicionar mTLS
7. `supabase/functions/pix-qrc-info/index.ts` - Adicionar mTLS
8. `supabase/functions/billet-pay/index.ts` - Adicionar mTLS
9. `supabase/functions/billet-check-status/index.ts` - Adicionar mTLS
10. `supabase/functions/billet-receipt/index.ts` - Adicionar mTLS
11. `src/pages/settings/PixIntegration.tsx` - Atualizar placeholders
