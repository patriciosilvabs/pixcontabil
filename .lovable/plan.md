

## Abrir "Pix com Chave" direto no Dashboard (sem navegar para outra pagina)

### O que muda

Quando o usuario clicar no icone "COM CHAVE" no dashboard mobile, ao inves de navegar para `/pix/new?tab=key`, um **dialog (modal)** sera aberto direto no dashboard com:

- Titulo "PIX COM CHAVE" com botao de voltar
- Campo "CHAVE PIX" com placeholder "Ex: 123.456.789-10"
- Checkbox "Salvar como Favorecido"
- Botao "VALIDAR" (verde, full-width)

Ao clicar em "VALIDAR", o sistema consultara a chave Pix via edge function e, se valida, navegara para a pagina de pagamento com os dados pre-preenchidos.

### Arquivos a serem modificados/criados

1. **Novo componente:** `src/components/pix/PixKeyDialog.tsx`
   - Dialog/Sheet mobile-friendly com o layout da imagem de referencia
   - Campo de input para chave Pix
   - Checkbox "Salvar como Favorecido"
   - Botao "VALIDAR" que chama a edge function `pix-pay-dict` (ou valida a chave)
   - Ao validar com sucesso, navega para `/pix/new?tab=key&pixkey=<chave>&amount=<valor>` com dados pre-preenchidos

2. **Modificar:** `src/components/dashboard/MobileDashboard.tsx`
   - Trocar o `Link` do "COM CHAVE" por um botao que abre o `PixKeyDialog`
   - Adicionar estado para controlar abertura/fechamento do dialog
   - Importar e renderizar o `PixKeyDialog`

3. **Modificar:** `src/pages/NewPayment.tsx`
   - Aceitar query params `pixkey` para pre-preencher a chave Pix quando vier do dialog

### Detalhes tecnicos

**PixKeyDialog.tsx:**
- Usar componente `Sheet` (drawer de baixo para cima) no mobile para UX nativa
- Input com mascara simples para CPF/CNPJ (detectar automaticamente pelo tamanho)
- Estado local: `pixKey`, `saveFavorite`, `isValidating`
- No "VALIDAR": chamar `getQRCodeInfo` ou simplesmente navegar para NewPayment com a chave pre-preenchida
- Usar `useNavigate` para redirecionar apos validacao

**MobileDashboard.tsx:**
- O item "COM CHAVE" deixa de ser `Link` e passa a ser um `button` com `onClick` que abre o dialog
- Os demais quickActions continuam como `Link` normalmente
