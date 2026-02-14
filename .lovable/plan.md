
# Fazer cada botao abrir diretamente sua funcao

## Problema
A pagina `NewPayment` nao le o parametro `?tab=` da URL. Quando o usuario clica em "COPIA E COLA" no dashboard, ele e redirecionado para `/pix/new?tab=copy_paste`, mas a pagina abre sempre na aba "Chave" (valor padrao).

## Solucao
Adicionar leitura do parametro `?tab=` na pagina `NewPayment.tsx` para definir a aba ativa automaticamente ao carregar.

## Mudancas

### `src/pages/NewPayment.tsx`
1. Importar `useSearchParams` de `react-router-dom` (ja importa `useNavigate`)
2. Adicionar `const [searchParams] = useSearchParams()`
3. Adicionar um `useEffect` que le `searchParams.get("tab")` e, se for um valor valido (`key`, `copy_paste`, `qrcode`, `boleto`), atualiza `pixData.type` com esse valor

Isso garante que:
- `/pix/new?tab=copy_paste` abre direto em Copia e Cola
- `/pix/new?tab=qrcode` abre direto em QR Code
- `/pix/new?tab=boleto` abre direto em Boleto
- `/pix/new?tab=key` abre direto em Chave
- `/pix/new` (sem parametro) abre em Chave (padrao atual)
