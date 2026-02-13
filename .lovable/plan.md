

# Salvar Certificados ONZ no Banco de Dados

## Resumo
Salvar o par de certificado e chave privada do INFOPAGO_70 na tabela `pix_configs` para habilitar mTLS com o endpoint Cash-out da ONZ Infopago.

## Arquivos identificados
- **Certificado publico**: `INFOPAGO_70-3.crt` (CN=INFOPAGO_70, CA=onz.software, valido ate 2035)
- **Chave privada**: `INFOPAGO_70.key` (RSA 4096-bit)
- Segundo par disponivel: `INFOPAGO_70-4.crt` + `INFOPAGO_70-2.key` (CA=ONZ-SECURE-AREA-INFOP) - reserva

## O que sera feito

### 1. Codificar certificado e chave em Base64
O conteudo PEM dos arquivos sera codificado em Base64 usando a funcao SQL `encode(convert_to(...), 'base64')`.

### 2. Atualizar pix_configs
Executar UPDATE na tabela `pix_configs` onde `provider = 'onz'`:
- `certificate_encrypted` = Base64 do conteudo completo do INFOPAGO_70-3.crt
- `certificate_key_encrypted` = Base64 do conteudo completo do INFOPAGO_70.key

### 3. Testar conexao
Chamar a Edge Function `pix-auth` para verificar se o mTLS funciona com `https://cashout.infopago.com.br/api/v2/oauth/token`.

## Detalhes tecnicos
- O campo `certificate_encrypted` ja existe na tabela `pix_configs` (atualmente NULL)
- O campo `certificate_key_encrypted` ja existe na tabela `pix_configs` (atualmente NULL)
- As Edge Functions ja foram atualizadas para usar mTLS com ONZ (implementacao anterior)
- O registro ONZ tem ID: `355c96b2-e46f-4cfe-bbf7-4c034b5a87c9`
- Nenhuma alteracao de codigo necessaria - apenas dados no banco

