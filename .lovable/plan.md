

## Limpar historico de transacoes

Apagar apenas os dados de teste das transacoes, mantendo toda a estrutura do sistema (empresa, usuarios, categorias, configuracao Pix, permissoes).

### Dados que serao apagados

| Tabela | Registros | Descricao |
|--------|-----------|-----------|
| receipts | 18 | Comprovantes anexados |
| audit_logs | 30 | Logs de auditoria das transacoes |
| pix_tokens | 1 | Token de autenticacao Pix (expirado) |
| transactions | 30 | Transacoes de teste |

### Dados que serao mantidos

| Tabela | Registros |
|--------|-----------|
| companies | 1 |
| profiles | 2 |
| user_roles | 2 |
| company_members | 2 |
| categories | 106 |
| pix_configs | 1 |
| user_page_permissions | 16 |

### Ordem de execucao

A limpeza precisa respeitar dependencias entre tabelas:

1. Apagar `receipts` (depende de transactions)
2. Apagar `audit_logs` (referencia transactions)
3. Apagar `pix_tokens` (tokens expirados, serao regenerados)
4. Apagar `transactions`

### Detalhes tecnicos

Serao executados 4 comandos DELETE usando a ferramenta de insercao de dados, na ordem correta para evitar erros de foreign key. Tambem sera feita a limpeza dos arquivos de comprovantes no storage bucket `receipts`.
