

## Fluxo de pagamento completo direto no Dashboard (sem passar pela pagina Novo Pagamento)

### Problema atual

Quando o usuario clica em "COM CHAVE" ou "PAGAR QR CODE" no dashboard:
1. Abre um modal/scanner para coletar os dados iniciais (chave ou QR code)
2. Depois redireciona para a pagina `/pix/new` para completar o pagamento (valor, confirmacao)

O usuario quer que **todo o fluxo** aconteca dentro do proprio drawer/modal, sem sair do dashboard.

### Solucao

Transformar o `PixKeyDialog` em um fluxo completo de pagamento com 3 etapas internas, e criar logica similar para o QR Code. Os drawers passam a conter:

- **Etapa 1**: Coleta de dados (chave Pix ou resultado do QR code)
- **Etapa 2**: Valor do pagamento (com campo R$)
- **Etapa 3**: Confirmacao e execucao do pagamento

Ao confirmar, o pagamento e executado diretamente via `usePixPayment` (payByKey ou payByQRCode) e o usuario e redirecionado para a tela de comprovante.

### Arquivos a modificar

#### 1. `src/components/pix/PixKeyDialog.tsx` -- Refatorar completamente

Transformar de um simples formulario de chave em um fluxo de 3 etapas:

- **Estado interno**: `step` (1, 2, 3), `pixKey`, `amount`, `saveFavorite`, `isValidating`, `isProcessing`
- **Usar `usePixPayment`** para chamar `payByKey` diretamente
- **Etapa 1**: Campo de chave Pix + checkbox favorecido (layout atual)
- **Etapa 2**: Campo de valor (R$) com input numerico
- **Etapa 3**: Resumo (chave + valor) com botao "Confirmar Pagamento"
- Ao confirmar, chama `payByKey({ pix_key, valor })` e navega para `/pix/receipt/{transaction_id}`
- Botao de voltar navega entre etapas (etapa 1 fecha o drawer)

#### 2. Criar `src/components/pix/PixQrPaymentDrawer.tsx` -- Novo componente

Drawer para o fluxo de pagamento via QR Code escaneado:

- Recebe o `qrCode` (string escaneada) como prop
- Ao abrir, automaticamente chama `getQRCodeInfo` para extrair valor e dados
- **Etapa 1**: Mostra loading enquanto consulta, depois mostra dados extraidos (recebedor, valor)
- **Etapa 2**: Campo de valor (pre-preenchido se encontrado, editavel se nao)
- **Etapa 3**: Confirmacao com botao "Confirmar Pagamento"
- Ao confirmar, chama `payByQRCode({ qr_code, valor })` e navega para `/pix/receipt/{transaction_id}`

#### 3. `src/components/dashboard/MobileDashboard.tsx` -- Ajustar integracao

- O scanner QR continua abrindo normalmente
- Ao escanear, em vez de navegar para `/pix/new`, abre o `PixQrPaymentDrawer` com o codigo escaneado
- Novo estado: `scannedQrCode` para armazenar o resultado do scan e controlar abertura do drawer

### Detalhes tecnicos

**PixKeyDialog.tsx (fluxo completo):**
```
Etapa 1: [Chave Pix] + [Salvar Favorecido] -> [Continuar]
Etapa 2: [R$ ____] -> [Continuar]  
Etapa 3: [Resumo: Chave + Valor] -> [Confirmar Pagamento]
         -> payByKey() -> navigate(/pix/receipt/{id})
```

**PixQrPaymentDrawer.tsx (fluxo QR):**
```
Scanner detecta QR -> Abre drawer
  -> getQRCodeInfo() automatico
  -> Se tem valor: mostra resumo -> [Confirmar Pagamento]
  -> Se nao tem valor: pede valor -> resumo -> [Confirmar]
  -> payByQRCode() -> navigate(/pix/receipt/{id})
```

**MobileDashboard.tsx:**
- `handleQrScan`: em vez de `navigate(...)`, seta `scannedQrCode` e abre o drawer
- `PixQrPaymentDrawer` renderizado condicionalmente quando `scannedQrCode` tem valor

### Fluxo do usuario

```text
COM CHAVE:
  Dashboard -> Clica "COM CHAVE"
           -> Abre drawer com campo de chave (etapa 1)
           -> Digita chave -> Clica "Continuar"
           -> Mostra campo de valor (etapa 2)
           -> Digita valor -> Clica "Continuar"
           -> Mostra resumo (etapa 3)
           -> Clica "Confirmar Pagamento"
           -> Pagamento executado -> Tela de comprovante

PAGAR QR CODE:
  Dashboard -> Clica "PAGAR QR CODE"
           -> Abre camera fullscreen
           -> Escaneia QR Code
           -> Abre drawer com dados extraidos
           -> Se valor encontrado: mostra resumo -> Confirmar
           -> Se sem valor: pede valor -> Confirmar
           -> Pagamento executado -> Tela de comprovante
```

