

## Problema Identificado

Na screenshot, o drawer de confirmação de pagamento corta os textos no lado direito: nome do recebedor, chave Pix e valor ficam truncados. Isso ocorre em **todos os drawers de pagamento** que usam o padrão `flex justify-between` com `max-w-[60%] truncate` nos valores.

## Arquivos Afetados

### 1. `PixQrPaymentDrawer.tsx` (Step 3 - Confirmação, linhas 195-213)
- Recebedor: `max-w-[60%] truncate` corta nomes longos
- Chave Pix: `max-w-[60%] truncate` corta UUIDs
- Mudar layout de horizontal para **empilhado (label em cima, valor embaixo)** com `break-all` para chaves longas

### 2. `PixCopyPasteDrawer.tsx` (Step 4 - Confirmação, linhas 260-279)
- Mesmo padrão idêntico ao QrPaymentDrawer
- Aplicar a mesma correção

### 3. `PixKeyDialog.tsx` (Step 3 - Confirmação, linhas 188-196)
- Chave Pix com `max-w-[60%] truncate`
- Aplicar a mesma correção

### 4. `BoletoPaymentDrawer.tsx` (Step 2 - Confirmação, linhas ~130-155)
- Código do boleto com `truncate ml-2 max-w-[60%]`
- Aplicar a mesma correção

## Solução

Trocar o layout das linhas de detalhes de:
```
<div class="flex justify-between items-center">
  <span>LABEL</span>
  <span class="truncate max-w-[60%]">VALOR LONGO...</span>
</div>
```

Para:
```
<div>
  <p class="text-xs uppercase text-muted-foreground">LABEL</p>
  <p class="text-sm font-medium break-all">VALOR COMPLETO SEM CORTAR</p>
</div>
```

Isso garante que valores longos (nomes, UUIDs, códigos de boleto) apareçam completos, quebrando linha se necessário em vez de truncar.

### 5. Dashboard `MobileDashboard.tsx` - Transações Recentes (linhas 220-243)
- Verificar se textos de beneficiário e valores não estão sendo cortados na borda direita
- Já usa `truncate` no nome e `shrink-0` nos valores — funciona corretamente, sem alteração necessária

## Resumo das Alterações
- **4 arquivos** de drawers de pagamento
- Trocar layout horizontal truncado por layout empilhado com `break-all`
- Manter o valor (R$) destacado e visível por completo
