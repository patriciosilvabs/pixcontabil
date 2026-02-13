
# Fazer o Botao "Anexar" Funcionar na Pagina de Transacoes

## Problema

O botao "Anexar" na lista de transacoes nao faz nada ao ser clicado. Ele nao tem nenhum `onClick` configurado.

## Solucao

Adicionar navegacao ao botao "Anexar" para redirecionar o usuario para a pagina de captura de comprovante (`/pix/receipt/:transactionId`), que ja existe no sistema.

## Alteracoes

### Arquivo: `src/pages/Transactions.tsx`

1. Importar `useNavigate` do `react-router-dom` (ja tem `useSearchParams` importado)
2. Adicionar `const navigate = useNavigate()` dentro do componente
3. No botao "Anexar" (linha 235), adicionar `onClick={() => navigate(`/pix/receipt/${transaction.id}`)}`
4. No botao de visualizar comprovante (icone Eye, linha 231), adicionar `onClick={() => navigate(`/pix/receipt/${transaction.id}`)}` tambem

Isso vai redirecionar o usuario para a tela de captura de comprovante ja existente, passando o ID da transacao.
