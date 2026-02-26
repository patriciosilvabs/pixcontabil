

## Plano: Limpeza de dados de teste + Edição/Exclusão de comprovantes nos Relatórios

### Parte 1 — Limpeza dos dados de teste

Dados encontrados no banco:
- **32 transações**
- **7 comprovantes (receipts)**
- **27 registros de auditoria**

Ações (via ferramenta de dados, não migração):
1. Apagar todos os arquivos do bucket `receipts` no storage
2. Deletar todos os registros da tabela `receipts`
3. Deletar todos os registros da tabela `pix_refunds` (se houver)
4. Deletar todos os registros da tabela `transactions`
5. Deletar todos os registros da tabela `audit_logs`
6. Deletar todos os registros da tabela `pix_webhook_logs`
7. Deletar todos os registros da tabela `pix_tokens` (tokens expirados de teste)

Empresas, categorias, perfis de usuários e configurações Pix são **preservados**.

### Parte 2 — Gerenciamento de comprovantes na página Relatórios

Funcionalidade disponível apenas para **administradores**:

#### 2a. Botão "Trocar comprovante" (editar)
- Na listagem de cada transação no `DailyTransactionSummary`, ao lado da miniatura do comprovante, adicionar um botão de edição (ícone de lápis)
- Ao clicar, abre um input de arquivo para selecionar uma nova imagem
- O sistema faz upload do novo arquivo no bucket `receipts`, atualiza o registro na tabela `receipts` com o novo `file_url` e remove o arquivo antigo do storage

#### 2b. Botão "Excluir comprovante"
- Ícone de lixeira ao lado da miniatura
- Abre um AlertDialog de confirmação ("Tem certeza que deseja excluir este comprovante?")
- Ao confirmar: remove o arquivo do storage e deleta o registro da tabela `receipts`

#### 2c. Migração necessária
- Adicionar policy de **DELETE** na tabela `receipts` para admins:
```sql
CREATE POLICY "Admins can delete receipts"
ON public.receipts FOR DELETE
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM transactions t
    WHERE t.id = receipts.transaction_id
    AND t.company_id IN (SELECT get_user_companies(auth.uid()))
  )
  AND is_admin(auth.uid())
);
```

#### 2d. Alterações de código
- **`DailyTransactionSummary.tsx`**: Adicionar props `isAdmin` e `onReceiptChange` (callback para refrescar dados). Adicionar botões de editar/excluir condicionais ao `isAdmin`. Lógica de upload, delete no storage e update/delete no banco.
- **`Reports.tsx`**: Passar `isAdmin` e callback de refresh para o componente.

### Detalhes técnicos
- O upload substituto usa o mesmo padrão de path: `{company_id}/{transaction_id}/{filename}`
- A exclusão do arquivo antigo usa `extractStoragePath()` já existente em `storageHelpers.ts`
- O refresh após alteração recarrega as transações do período atual

