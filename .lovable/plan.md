

# Migrar sistema exclusivamente para provedor ONZ Infopago

## Resumo

Remover todo o codigo de provedores legados (Woovi, Paggue, Transfeera, EFI Pay, Banco Inter) de todas as Edge Functions e do frontend, mantendo apenas o provedor ONZ Infopago. Alem disso, reescrever a funcao `billet-pay` para usar o endpoint ONZ `POST /billets/payments` com o campo `digitableCode`.

## Escopo das alteracoes

### Edge Functions a reescrever (7 funcoes)

1. **pix-auth/index.ts** (~580 linhas -> ~120 linhas)
   - Remover blocos: Woovi (linhas 170-181), Paggue (183-280), Transfeera (378-405), EFI (407-465), Inter (467-531)
   - Manter apenas: bloco ONZ (318-376) + cache de token + lookup de config

2. **pix-balance/index.ts** (~416 linhas -> ~100 linhas)
   - Remover blocos: Transfeera (133-151), Woovi (153-172), Paggue (174-225), EFI (281-331), Inter (333-392)
   - Manter apenas: bloco ONZ (227-279)

3. **pix-pay-dict/index.ts** (~635 linhas -> ~150 linhas)
   - Remover blocos: Woovi (162-229), Paggue (230-303), Transfeera (361-413), EFI (414-507), Inter (508-566)
   - Manter apenas: bloco ONZ (304-360) + criacao de transacao

4. **pix-pay-qrc/index.ts** (~657 linhas -> ~180 linhas)
   - Remover blocos: Woovi (229-333), Paggue (334-409), Transfeera (458-479), EFI (480-520), Inter (521-576)
   - Manter apenas: bloco ONZ (410-457) + criacao de transacao

5. **pix-qrc-info/index.ts** (~356 linhas -> ~100 linhas)
   - Remover blocos: Woovi (128-241), Transfeera (283-292), EFI (293-323)
   - Manter apenas: bloco ONZ (242-282)

6. **pix-check-status/index.ts** (~333 linhas -> ~100 linhas)
   - Remover blocos: Woovi (158-174), Paggue (175-189), Transfeera (221-228), EFI (229-250), Inter (251-277)
   - Manter apenas: bloco ONZ (190-220) + normalizacao de status

7. **pix-refund/index.ts** (~371 linhas -> ~100 linhas)
   - Remover blocos: Woovi (169-189), Transfeera (230-250), EFI (251-281), Inter (282-320)
   - Manter apenas: bloco ONZ (190-229)

8. **pix-receipt/index.ts** (~287 linhas -> ~80 linhas)
   - Remover blocos: Woovi (138-157), Transfeera (204-215), EFI (217-251), Inter (253-273)
   - Manter apenas: bloco ONZ (159-202)

9. **pix-webhook/index.ts** (~340 linhas -> ~100 linhas)
   - Remover handlers: Woovi, EFI, Transfeera, Inter Banking
   - Manter apenas: handler ONZ + deteccao de formato generico BCB (array `pix`) para compatibilidade

10. **billet-pay/index.ts** (reescrita completa ~120 linhas)
    - Substituir integracao Inter por ONZ
    - Endpoint: `POST {base_url}/billets/payments` via proxy mTLS
    - Payload: `{ digitableCode, paymentFlow? }` (valor atualizado automaticamente pela ONZ)
    - Manter criacao de transacao e audit log

11. **billet-check-status/index.ts** (reativar ~80 linhas)
    - Reativar com integracao ONZ: `GET {base_url}/billets/{id}` via proxy mTLS
    - Retornar status normalizado

12. **billet-receipt/index.ts** (reativar ~80 linhas)
    - Reativar com integracao ONZ: `GET {base_url}/billets/payments/receipt/{id}` via proxy mTLS
    - Retornar PDF em base64

### Frontend (1 arquivo)

13. **src/pages/settings/PixIntegration.tsx**
    - Remover provedores legados do array `PIX_PROVIDERS` (manter apenas ONZ)
    - Remover entradas do `PROVIDER_CONFIG` para paggue, woovi, transfeera, efi, inter
    - Simplificar UI pois so ha um provedor

### Codigo morto a limpar

14. **docs/onz-proxy/** - Manter (documentacao do proxy, ainda relevante)

## Detalhes tecnicos da integracao ONZ para boletos

### Pagamento de boleto (billet-pay)
```
POST {base_url}/billets/payments
Headers: Authorization: Bearer {token}, x-idempotency-key: {uuid}
Body: {
  "digitableCode": "23793.38128 ...",
  "paymentFlow": "INSTANT"  // ou "APPROVAL_REQUIRED"
}
```
- O valor e sempre o atualizado (com juros/multas) - nao precisa enviar
- Boletos com valor alteravel pelo pagador so podem ser pagos pela interface web da ONZ

### Consulta de status (billet-check-status)
```
GET {base_url}/billets/{id}
Headers: Authorization: Bearer {token}
```

### Comprovante (billet-receipt)
```
GET {base_url}/billets/payments/receipt/{id}
Headers: Authorization: Bearer {token}
```

## Proxy mTLS

Todas as chamadas ONZ continuam passando pelo proxy mTLS existente no Google Cloud Run (`ONZ_PROXY_URL`), que ja esta configurado e funcional.

## Ordem de implementacao

1. Reescrever `pix-auth` (dependencia de todas as outras funcoes)
2. Reescrever demais funcoes Pix em paralelo (balance, pay-dict, pay-qrc, qrc-info, check-status, refund, receipt)
3. Reescrever `billet-pay` para ONZ
4. Reativar `billet-check-status` e `billet-receipt` com ONZ
5. Reescrever `pix-webhook` (apenas ONZ)
6. Atualizar frontend `PixIntegration.tsx`
7. Deploy e teste

