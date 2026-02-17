

## Abrir Scanner QR Code direto no Dashboard

### O que muda

Quando o usuario clicar em "PAGAR QR CODE" no dashboard mobile, ao inves de navegar para `/pix/new?tab=qrcode`, um scanner de camera em tela cheia sera aberto diretamente, com:

- Fundo preto com feed da camera
- Botao de voltar (seta) no topo
- Texto "Aponte sua camera para realizar a leitura" abaixo do visor
- Ao escanear um QR Code, navega automaticamente para `/pix/new?tab=copy_paste&qrcode=<codigo_escaneado>` com os dados pre-preenchidos

### Arquivos a modificar

1. **`src/components/dashboard/MobileDashboard.tsx`**
   - Adicionar estado `qrScannerOpen` para controlar abertura do scanner
   - Trocar o `Link` do "PAGAR QR CODE" por um `button` que abre o scanner
   - Importar e renderizar o `BarcodeScanner` existente no modo `qrcode`
   - No callback `onScan`, usar `useNavigate` para redirecionar para NewPayment com o codigo escaneado via query param

2. **`src/pages/NewPayment.tsx`**
   - Aceitar query param `qrcode` na inicializacao
   - Quando presente, pre-preencher o campo `copyPaste` com o codigo e automaticamente chamar `getQRCodeInfo` para extrair valor e dados do recebedor (mesmo fluxo que ja existe no onScan do scanner)

### Detalhes tecnicos

**MobileDashboard.tsx:**
- Novo estado: `const [qrScannerOpen, setQrScannerOpen] = useState(false)`
- O item "PAGAR QR CODE" vira um `button` com `onClick={() => setQrScannerOpen(true)}`
- Renderizar `<BarcodeScanner mode="qrcode" isOpen={qrScannerOpen} onScan={handleQrScan} onClose={() => setQrScannerOpen(false)} />`
- `handleQrScan` usa `navigate(`/pix/new?tab=copy_paste&qrcode=${encodeURIComponent(result)}`)`

**NewPayment.tsx:**
- No `useEffect` inicial (ou junto ao existente que le query params), verificar `searchParams.get('qrcode')`
- Se presente, setar `pixData.copyPaste` com o valor e disparar `getQRCodeInfo` automaticamente
- Preencher valor e avancar para step 2 se o QR retornar valor (mesmo comportamento do scanner atual)

### Fluxo do usuario

```text
Dashboard -> Clica "PAGAR QR CODE"
         -> Abre camera fullscreen (BarcodeScanner mode=qrcode)
         -> Escaneia QR Code
         -> Navega para /pix/new?tab=copy_paste&qrcode=<codigo>
         -> Valor e dados preenchidos automaticamente
         -> Usuario confirma e paga
```

O componente `BarcodeScanner` ja existe e funciona bem no modo QR code -- sera reutilizado sem modificacoes. A unica diferenca e que agora ele tambem pode ser aberto a partir do dashboard.

