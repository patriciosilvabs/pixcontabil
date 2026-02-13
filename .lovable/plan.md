

# Corrigir Conexao ONZ Infopago com mTLS

## Problema
O ONZ Infopago requer autenticacao mTLS (certificado digital) igual a EFI Pay, mas o sistema esta tentando conectar sem certificado. O erro `UnknownIssuer` ocorre porque o servidor do ONZ usa um certificado de uma CA privada que so e aceita quando a conexao mTLS e estabelecida com o certificado do cliente.

## Informacoes da Documentacao ONZ (do screenshot)
- **QRCodes API**: `https://api.pix.infopago.com.br`
- **Contas (Cash-out) API**: `https://cashout.infopago.com.br/api/v2/`
- **Certificado CASH-OUT** com senha fornecida

## O que precisa ser feito

### 1. Atualizar base_url no banco de dados
Alterar de `https://secureapi.bancodigital.onz.software/api/v2` para `https://cashout.infopago.com.br/api/v2`

### 2. Converter e armazenar o certificado CASH-OUT
O usuario precisa converter o certificado .p12 para formato PEM e codificar em Base64:

```text
Passos:
1. Extrair certificado: openssl pkcs12 -in certificado.p12 -clcerts -nokeys -out cert.pem
2. Extrair chave privada: openssl pkcs12 -in certificado.p12 -nocerts -nodes -out key.pem
3. Codificar em Base64:
   - cert: base64 -w0 cert.pem
   - key: base64 -w0 key.pem
4. Salvar os valores base64 nos campos certificate_encrypted e certificate_key_encrypted da pix_configs
```

A senha do certificado CASH-OUT e: `Xfbfvi.tyja4biGL4QQgqokmHKBNK_yE4oPztxNn.d!bq*zkbL_CwtvbWrMzhkwY`

### 3. Adicionar mTLS ao provedor ONZ em todas as Edge Functions
Aplicar o mesmo padrao usado pela EFI Pay (Deno.createHttpClient com cert/key) nas seguintes funcoes:

**pix-auth/index.ts** (autenticacao OAuth):
- Verificar se certificate_encrypted existe
- Decodificar cert e key de Base64
- Criar httpClient com mTLS
- Usar para a requisicao de token OAuth
- Fechar httpClient apos uso

**pix-pay-dict/index.ts** (pagamentos):
- Criar httpClient mTLS para chamadas ao endpoint ONZ
- Usar nas requisicoes de pagamento

**pix-balance/index.ts** (consulta saldo):
- Criar httpClient mTLS para consulta de saldo

**pix-qrc-info/index.ts** (decodificar QR Code):
- Criar httpClient mTLS para decodificacao de QR Code

### 4. Arquivos afetados
- `supabase/functions/pix-auth/index.ts` - adicionar mTLS ao bloco ONZ
- `supabase/functions/pix-pay-dict/index.ts` - adicionar mTLS ao bloco ONZ
- `supabase/functions/pix-balance/index.ts` - adicionar mTLS ao bloco ONZ
- `supabase/functions/pix-qrc-info/index.ts` - adicionar mTLS ao bloco ONZ
- Banco de dados: atualizar base_url e certificados na tabela pix_configs

### 5. Padrao de codigo mTLS (igual EFI)
```text
// Dentro de cada bloco ONZ:
let httpClient: Deno.HttpClient | undefined;
if (config.certificate_encrypted) {
  const certPem = atob(config.certificate_encrypted);
  const keyPem = config.certificate_key_encrypted 
    ? atob(config.certificate_key_encrypted) 
    : certPem;
  httpClient = Deno.createHttpClient({ cert: certPem, key: keyPem });
}
// ... usar httpClient nas chamadas fetch ...
httpClient?.close();
```

