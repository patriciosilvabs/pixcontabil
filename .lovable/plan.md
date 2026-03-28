

# Trocar texto de loading do probe

Alteração simples de texto em 2 arquivos:

### `src/components/pix/PixKeyDialog.tsx` (mobile)
- Linha 445-448: Trocar "Verificando beneficiário" + "Enviando micro-pagamento de R$ 0,01 para identificar o destinatário..." por **"Consultando transação ..."**

### `src/pages/NewPayment.tsx` (desktop)
- Linha 976-978: Trocar "Verificando beneficiário..." por **"Consultando transação ..."**

Nenhuma lógica alterada, apenas os textos exibidos durante o loading do probe.

