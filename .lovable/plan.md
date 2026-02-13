

# Corrigir Fluxo de Anexar Comprovante

## Problema

A pagina de captura de comprovante (`ReceiptCapture.tsx`) nao salva nada no banco de dados. O `handleSubmit` apenas simula um delay e navega para a home. Por isso, mesmo apos "anexar" um comprovante, a transacao continua mostrando o botao "Anexar" no historico.

## Causa Raiz

- Linha 141-142: `await new Promise((resolve) => setTimeout(resolve, 1500))` -- apenas simula, nao salva nada
- O arquivo nunca e enviado para o storage
- Nenhum registro e criado na tabela `receipts`
- Ao voltar para `/transactions`, o `hasReceipt` continua `false`

## Solucao

Corrigir o `handleSubmit` para:

1. Fazer upload do arquivo para um bucket de storage
2. Criar um registro na tabela `receipts` vinculado a transacao
3. Atualizar o `category_id` da transacao com a categoria selecionada
4. Navegar de volta para `/transactions` apos salvar

## Alteracoes

### 1. Criar bucket de storage (migracao SQL)

```sql
INSERT INTO storage.buckets (id, name, public) VALUES ('receipts', 'receipts', true);

CREATE POLICY "Members can upload receipts"
ON storage.objects FOR INSERT
WITH CHECK (bucket_id = 'receipts' AND auth.role() = 'authenticated');

CREATE POLICY "Members can view receipts"
ON storage.objects FOR SELECT
USING (bucket_id = 'receipts' AND auth.role() = 'authenticated');
```

### 2. Arquivo: `src/pages/ReceiptCapture.tsx`

Reescrever a funcao `handleSubmit` para:

- Gerar um path unico para o arquivo: `{company_id}/{transaction_id}/{timestamp}_{filename}`
- Fazer upload via `supabase.storage.from('receipts').upload(path, file)`
- Obter a URL publica do arquivo
- Inserir registro na tabela `receipts` com:
  - `transaction_id`: do parametro da URL
  - `file_url`: URL publica do storage
  - `file_name`: nome do arquivo original
  - `file_type`: tipo MIME do arquivo
  - `uploaded_by`: usuario logado (via `session.user.id`)
  - `ocr_status`: 'pending'
- Se o usuario selecionou uma categoria, atualizar `category_id` na tabela `transactions`
- Navegar para `/transactions` em vez de `/` apos salvar com sucesso

### 3. Arquivo: `src/pages/Transactions.tsx`

Nenhuma alteracao necessaria -- o codigo ja verifica `hasReceipt` corretamente via join com `receipts(id)`. Uma vez que o registro exista no banco, o botao "Anexar" sera substituido pelo icone de visualizar automaticamente.

### Detalhes Tecnicos

- A tabela `receipts` ja possui RLS para INSERT: `uploaded_by = auth.uid()` e `transaction_id` pertence a empresa do usuario
- A tabela `transactions` ja possui RLS para UPDATE: usuario criador ou admin
- O `subcategory` selecionado pelo usuario sera mapeado para o `category_id` correspondente na tabela `categories`
- O OCR ainda usa dados simulados (mock), mas a estrutura esta pronta para integracao futura

