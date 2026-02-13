

# Historico de Pagamentos Recentes na Tela de Novo Pagamento

## Objetivo

Adicionar uma secao "Ultimos Pagamentos" na pagina de Novo Pagamento, permitindo que o usuario clique em um pagamento anterior para pre-preencher os dados (chave Pix, tipo, descricao) e so precise ajustar o valor se quiser.

## Como vai funcionar

1. Ao abrir a tela "Novo Pagamento", uma lista dos ultimos 10 pagamentos concluidos aparece abaixo do formulario principal
2. Cada item mostra: chave/destinatario, valor anterior, data e descricao
3. Ao clicar em um item, o formulario e pre-preenchido com os dados daquele pagamento (tipo, chave, descricao)
4. O usuario pode manter o mesmo valor ou alterar antes de prosseguir
5. O fluxo segue normalmente pelas 3 etapas

## Alteracoes

### Arquivo: `src/pages/NewPayment.tsx`

1. **Buscar historico**: Adicionar um `useEffect` que consulta as ultimas transacoes concluidas da empresa:
   - Query: `transactions` filtradas por `company_id`, `status = completed`, `pix_type = key`, ordenadas por `created_at desc`, limite 10
   - Campos: `pix_key`, `pix_key_type`, `amount`, `description`, `beneficiary_name`, `created_at`, `pix_type`

2. **Secao visual**: Na etapa 1 (`step === 1`), abaixo do card de "Tipo de Pagamento", exibir um card "Ultimos Pagamentos" com a lista
   - Cada item e um botao/card clicavel mostrando:
     - Icone de chave Pix
     - Chave (parcialmente mascarada para privacidade, ex: `009***1388`)
     - Ultimo valor pago
     - Data do ultimo pagamento
     - Descricao (se houver)
   - Se nao houver historico, a secao nao aparece

3. **Pre-preenchimento**: Ao clicar em um item do historico:
   - `pixData.type` recebe o tipo do pagamento original (key, copy_paste, etc.)
   - `pixData.keyType` recebe o tipo de chave
   - `pixData.key` recebe a chave Pix completa
   - `pixData.amount` recebe o valor anterior (editavel)
   - `pixData.description` recebe a descricao anterior
   - O usuario avanca automaticamente para a etapa 2 (valor) para confirmar/alterar

### Detalhes Tecnicos

- A query usa o Supabase client existente com o `currentCompany.id` do `useAuth()`
- Pagamentos duplicados (mesma chave) sao agrupados, mostrando apenas o mais recente
- O componente de historico so aparece quando `step === 1` e existem pagamentos anteriores
- Nenhuma nova tabela e necessaria -- os dados ja existem na tabela `transactions`
- Para agrupar por chave unica, usamos `reduce` no frontend apos buscar os dados

### Layout Visual

```text
+------------------------------------------+
|  Tipo de Pagamento                       |
|  [Chave] [Copia e Cola] [QR] [Boleto]   |
|  ...campos do formulario...              |
+------------------------------------------+

+------------------------------------------+
|  Ultimos Pagamentos                      |
|  Repita um pagamento anterior            |
|                                          |
|  +--------------------------------------+|
|  | Chave: 009***1388   R$ 1,99          ||
|  | patricio - 13/02/2026                ||
|  +--------------------------------------+|
|  | Chave: 123***4567   R$ 50,00         ||
|  | fornecedor - 12/02/2026              ||
|  +--------------------------------------+|
+------------------------------------------+
```
