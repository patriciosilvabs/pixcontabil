
# Transformar "Novo Pix" em "Novo Pagamento" (com Boleto)

## Resumo
Renomear a pagina de "Novo Pix" para "Novo Pagamento" e adicionar a opcao de pagamento via **Boleto**, alem das 3 opcoes ja existentes (Chave Pix, Copia e Cola, QR Code).

---

## Alteracoes

### 1. Renomear pagina e rota
- **Arquivo**: `src/pages/NewPix.tsx` -- renomear para `src/pages/NewPayment.tsx`
- Titulo: "Novo Pagamento Pix" vira **"Novo Pagamento"**
- Descricao do Step 1: "Escolha como deseja realizar o Pix" vira **"Escolha a forma de pagamento"**

### 2. Adicionar tipo "boleto"
- O tipo de pagamento passa de `"key" | "copy_paste" | "qrcode"` para `"key" | "copy_paste" | "qrcode" | "boleto"`
- Novo campo no state: `boletoCode?: string` (linha digitavel do boleto)
- Nova aba no TabsList com 4 colunas (grid-cols-4) e icone `FileText`

### 3. Tab de Boleto (Step 1)
- Campo: **Linha Digitavel** (input com mascara ou textarea)
- Placeholder: "Cole aqui a linha digitavel do boleto..."
- Texto auxiliar explicando o formato

### 4. Validacao
- Step 1: se tipo = "boleto" e nao preencheu a linha digitavel, mostrar erro
- Step 2 (valor): para boleto, o valor pode vir preenchido automaticamente (futuro) mas por ora e manual

### 5. Confirmacao (Step 3)
- Mostrar "Boleto" como tipo quando selecionado
- Mostrar a linha digitavel no resumo

### 6. Menu lateral
- `MainLayout.tsx`: renomear "Novo Pix" para **"Novo Pagamento"**
- Manter a rota `/pix/new` (ou mudar para `/payment/new` -- vou manter `/pix/new` por ora para nao quebrar nada)

### 7. Rota no App.tsx
- Atualizar o import de `NewPix` para `NewPayment`

### 8. Banco de dados
- A tabela `transactions` ja tem `pix_type` como enum. Sera necessario adicionar `'boleto'` ao enum `pix_type` via migration.
- Adicionar coluna `boleto_code` (text, nullable) na tabela `transactions` para armazenar a linha digitavel.

---

## Secao Tecnica

### Arquivos a modificar
| Arquivo | Acao |
|---------|------|
| `src/pages/NewPix.tsx` | Renomear para `NewPayment.tsx`, adicionar tab boleto |
| `src/components/layout/MainLayout.tsx` | Renomear link "Novo Pix" para "Novo Pagamento" |
| `src/App.tsx` | Atualizar import |
| `src/types/database.ts` | Adicionar `"boleto"` ao tipo `PixType` |
| Migration SQL | `ALTER TYPE pix_type ADD VALUE 'boleto'`; adicionar coluna `boleto_code` |

### Novo tipo
```typescript
type PaymentType = "key" | "copy_paste" | "qrcode" | "boleto";
```

### Layout das tabs (4 colunas)
```text
┌──────────┬──────────────┬──────────┬──────────┐
│  Chave   │ Copia e Cola │ QR Code  │  Boleto  │
└──────────┴──────────────┴──────────┴──────────┘
```

### Migration SQL
```sql
ALTER TYPE pix_type ADD VALUE 'boleto';
ALTER TABLE transactions ADD COLUMN boleto_code text;
```
