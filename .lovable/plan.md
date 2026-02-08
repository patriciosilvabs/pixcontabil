
# Adicionar aba Boleto na página Novo Pagamento

## O que falta
O arquivo `NewPayment.tsx` foi renomeado mas o conteudo interno nao mudou. Precisa:

1. **Tipo**: Mudar de `"key" | "copy_paste" | "qrcode"` para incluir `"boleto"`
2. **State**: Adicionar campo `boletoCode` no `PixData`
3. **Titulo**: Trocar "Novo Pagamento Pix" por "Novo Pagamento"
4. **Descricao Step 1**: Trocar "Escolha como deseja realizar o Pix" por "Escolha a forma de pagamento"
5. **Tabs**: De `grid-cols-3` para `grid-cols-4`, adicionar aba Boleto com icone `FileText`
6. **TabsContent boleto**: Campo "Linha Digitavel" com input mono
7. **Validacao Step 1**: Se tipo = boleto e sem codigo, mostrar erro
8. **Confirmacao Step 3**: Mostrar "Boleto" e a linha digitavel no resumo
9. **Export**: Renomear funcao de `NewPix` para `NewPayment`

---

## Secao Tecnica

### Arquivo unico a modificar
`src/pages/NewPayment.tsx`

### Alteracoes especificas

**Imports**: Adicionar `FileText` do lucide-react

**Tipo PixType (linha 24)**:
```typescript
type PaymentType = "key" | "copy_paste" | "qrcode" | "boleto";
```

**Interface PixData**: Adicionar `boletoCode?: string`

**Validacao (handleNext)**: Adicionar check para boleto sem codigo

**TabsList**: `grid-cols-4` com nova aba:
```text
┌────────┬─────────────┬─────────┬────────┐
│ Chave  │ Copia e Cola│ QR Code │ Boleto │
└────────┴─────────────┴─────────┴────────┘
```

**TabsContent boleto**: Input para linha digitavel (47-48 digitos)

**Step 3 confirmacao**: Exibir "Boleto" como tipo e mostrar a linha digitavel truncada
