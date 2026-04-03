

## Funcionalidade: Visibilidade de Tags por Tipo de Pagamento

### Resumo
Adicionar um campo na tabela `quick_tags` que define em quais tipos de pagamento cada tag deve aparecer (Pix por Chave, QR Code, Copia e Cola, Boleto, Dinheiro). No formulário de criação/edição de tags, o admin escolhe os tipos. Na tela de pagamento, as tags são filtradas pelo tipo ativo.

### Alterações

**1. Migração de banco de dados**

Adicionar coluna `visible_in` (array de texto) à tabela `quick_tags`:
```sql
ALTER TABLE public.quick_tags 
ADD COLUMN visible_in text[] NOT NULL DEFAULT '{key,qrcode,copy_paste,boleto,cash}';
```
O default inclui todos os tipos para manter compatibilidade com tags existentes.

**2. `src/hooks/useQuickTags.ts`**
- Adicionar `visible_in: string[]` à interface `QuickTag`
- No `useQuickTags()` (hook do operador): aceitar parâmetro opcional `paymentType` e filtrar localmente `tags.filter(t => t.visible_in.includes(paymentType))`
- No `createTag` e `updateTag`: incluir `visible_in` nos campos aceitos

**3. `src/pages/QuickTags.tsx`** (admin)
- Adicionar estado `formVisibleIn` (array de strings) com checkboxes para cada tipo de pagamento:
  - Pix por Chave (`key`)
  - QR Code (`qrcode`)
  - Copia e Cola (`copy_paste`)
  - Boleto (`boleto`)
  - Dinheiro (`cash`)
- Exibir os tipos selecionados como badges na listagem de tags
- Passar `visible_in` no `createTag` e `updateTag`

**4. `src/pages/NewPayment.tsx`**
- Passar `pixData.type` para filtrar as tags: mostrar apenas tags onde `visible_in` inclui o tipo de pagamento atual
- Atualmente as tags só aparecem para `key`; com essa mudança, elas poderão aparecer para qualquer tipo conforme configuração

### Tipos de pagamento mapeados

| Label no formulário | Valor interno |
|---|---|
| Pix por Chave | `key` |
| QR Code | `qrcode` |
| Copia e Cola | `copy_paste` |
| Boleto | `boleto` |
| Dinheiro | `cash` |

