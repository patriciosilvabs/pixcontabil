

# Corrigir Pagamento Automatico na Transfeera

## Problema
A API da Transfeera usa um sistema de lotes (batch). Por padrao, `auto_close` e `false`, o que significa que o lote fica "aberto" aguardando aprovacao manual no painel da Transfeera. O pagamento nunca e executado automaticamente.

Alem disso, o tipo de chave aleatoria deveria ser `CHAVE_ALEATORIA` em vez de `EVP`.

## Correcao

### Arquivo: `supabase/functions/pix-pay-dict/index.ts`

1. Adicionar `auto_close: true` no payload do batch da Transfeera para que a transferencia seja executada imediatamente apos a criacao do lote
2. Corrigir o mapeamento de tipos de chave Pix:
   - `EVP` deve ser `CHAVE_ALEATORIA` (padrao Transfeera)
   - Os demais tipos (`CPF`, `CNPJ`, `EMAIL`, `PHONE`) permanecem iguais

### Detalhes Tecnicos

No payload enviado ao `POST /batch`, adicionar os campos:

```text
{
  "type": "TRANSFERENCIA",
  "auto_close": true,        // <-- executa automaticamente
  "transfers": [...]
}
```

Na funcao `detectPixKeyType`, alterar o retorno padrao e o caso UUID de `EVP` para `CHAVE_ALEATORIA`.

