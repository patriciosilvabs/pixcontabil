

## Ajustes no Step 1 da Tela Pix por Chave

### Alterações

**`src/components/pix/PixKeyDialog.tsx`**

1. **Remover seção "Todos os seus contatos"** — Deletar o bloco de placeholder (linhas 383-391) com título e descrição

2. **Botão "Continuar" sempre visível** — Remover a condição `pixKey.trim().length > 0` para que o botão apareça sempre (desabilitado quando não há chave válida)

3. **Favoritos reais em vez de mock** — Substituir `MOCK_FAVORITES` por uma query real na tabela `transactions` que busca os beneficiários mais frequentes do usuário:
   - Query: agrupar transações com status `completed` por `beneficiary_name` + `beneficiary_document`, ordenar por contagem DESC, limitar a 5
   - Usar `useAuth()` para obter `currentCompany.id` e filtrar por `company_id`
   - Gerar iniciais a partir do `beneficiary_name`
   - Ao clicar num favorito, preencher o campo `pixKey` com a `pix_key` da transação mais recente daquele beneficiário
   - Mostrar skeleton ou nada enquanto carrega; esconder a seção se não houver resultados

### Dados dos favoritos

Não é necessário criar tabela nova. A tabela `transactions` já possui `beneficiary_name`, `beneficiary_document`, `pix_key` e `pix_key_type` — suficiente para montar a lista de beneficiários frequentes.

