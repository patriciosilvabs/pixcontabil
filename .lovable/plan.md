

## Diagnóstico confirmado e plano de correção

### O que os logs mostram

Analisando os logs do `pix-pay-qrc`:

1. **`/qrc/info` com EMV** → `onz-0008` ("O dado informado não é um Pix copia e cola válido")
2. **`/qrc/info` com payload_url** → `onz-0008` (mesma rejeição)
3. **`/qrc` pagamento com EMV** → `onz-0010` ("Invalid QrCode")
4. **`/qrc` pagamento com payload_url** → `onz-0010` (mesma rejeição)
5. **Fallback para DICT** → funciona, mas maquininha não dá baixa

### Sobre o double-encoding

O proxy **não** faz double-encoding — ele usa `body_raw` que é enviado como string pura. Porém, o QR code pode conter caracteres invisíveis vindos do scanner do app (newlines, tabs, espaços). Isso explicaria por que **ambas** as tentativas falham (EMV e URL).

### Correções propostas

**Arquivo: `supabase/functions/pix-pay-qrc/index.ts`**

#### 1. Limpeza do QR Code na entrada (antes de qualquer uso)

Logo após receber `qr_code` do body, sanitizar:

```typescript
// Limpar QR Code - remover espaços, quebras de linha, caracteres invisíveis
const cleanQrCode = qr_code.trim().replace(/[\r\n\t\s]+/g, '');

// Log de diagnóstico
console.log('[pix-pay-qrc] Original QR length:', qr_code.length, 'Clean QR length:', cleanQrCode.length);
console.log('[pix-pay-qrc] QR codes match:', qr_code === cleanQrCode);
if (qr_code !== cleanQrCode) {
  console.log('[pix-pay-qrc] WARNING: QR code was modified during cleaning!');
  console.log('[pix-pay-qrc] Original hex start:', Array.from(qr_code.slice(0, 10)).map(c => c.charCodeAt(0).toString(16)).join(' '));
}
```

#### 2. Usar `cleanQrCode` em todos os lugares

- Na chamada local para `pix-qrc-info`
- No payload para ONZ `/qrc/info`
- No payload para ONZ `/qrc`
- Na consulta de `payload_url` (também limpar)

#### 3. Também limpar a `payload_url` quando usada como fallback

```typescript
const cleanPayloadUrl = qrcInfo.payload_url?.trim().replace(/[\r\n\t\s]+/g, '') || null;
```

### Resumo das mudanças

| Local | Antes | Depois |
|-------|-------|--------|
| Entrada do `qr_code` | Usado cru do frontend | Sanitizado com `.trim()` e regex |
| `payload_url` | Usado cru | Sanitizado |
| Logs | Sem comparação | Log de tamanho original vs limpo |
| Todos os payloads ONZ | `qr_code` | `cleanQrCode` |

### Resultado esperado

- Se o scanner adiciona caracteres invisíveis → os logs vão mostrar diferença de tamanho → bug encontrado e corrigido
- Se tamanhos são iguais → o problema está em outro lugar (formato EMV não suportado pela ONZ para QR codes PagSeguro) e os logs vão fornecer evidência para próxima investigação

