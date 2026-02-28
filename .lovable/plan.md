

## Investigacao da Transacao de R$192,80

### O que aconteceu

Analisei os logs do backend, banco de dados e registros de funcoes. A transacao de R$192,80 para **MARA FRIOS** (QR Code dinamico) esta registrada com status **completed** (ID: `90fd5ec5`). Ela foi criada em 28/02 as 13:29:11 e confirmada as 13:32:43.

### Causa raiz do erro

Nos logs da funcao `pix-pay-qrc`, encontrei este erro **antes** da transacao bem-sucedida:

```text
Http: connection closed before message completed
```

**O que isso significa**: O navegador mobile fechou a conexao HTTP antes que a funcao do backend terminasse de responder. Isso e comum em celulares quando:
- A rede 5G/4G oscila momentaneamente
- O Safari/Chrome mobile encerra conexoes longas
- O telefone muda de antena ou entra em modo de economia

A cadeia de chamadas da funcao (QRC Info → Auth → Transfeera API) leva ~4 segundos no total. O celular fechou a conexao durante esse tempo.

**Resultado**: O frontend recebeu "Failed to send a request to the Edge Function" (erro de rede, nao do servidor), exibiu o toast de erro, mas **nao e possivel saber se o pagamento ja havia sido processado no provedor antes da conexao cair**. Voce entao repetiu o pagamento e este sim foi concluido normalmente.

### Risco identificado: Pagamento duplicado

Se a primeira tentativa tivesse sido processada pela Transfeera antes da conexao cair, voce teria pago R$192,80 **duas vezes**. Nao ha protecao de idempotencia no frontend atualmente.

### Plano de correcao

**1. Adicionar timeout e retry inteligente no frontend (`usePixPayment.ts`)**
- Configurar `AbortController` com timeout de 30s na chamada da funcao
- Em caso de erro de rede (nao HTTP), exibir mensagem orientando o usuario a verificar o extrato antes de tentar novamente

**2. Adicionar protecao de idempotencia no `pix-pay-qrc` e `pix-pay-dict`**
- Gerar `idempotency_key` no frontend e enviar no body
- No backend, verificar se ja existe uma transacao recente com a mesma chave antes de criar um novo batch na Transfeera
- Evita pagamentos duplicados em caso de retry

**3. Melhorar mensagem de erro de rede no frontend**
- Em vez de "Failed to send a request to the Edge Function", exibir: "Conexao perdida durante o processamento. Verifique o extrato antes de tentar novamente."

