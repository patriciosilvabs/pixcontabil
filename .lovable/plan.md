

# Fix: Adicionar "efi" ao CHECK constraint da tabela pix_configs

## Problema
A tabela `pix_configs` possui um CHECK constraint (`pix_configs_provider_check`) que restringe os valores permitidos na coluna `provider`. O valor `"efi"` nao esta na lista permitida, causando erro 400 ao salvar.

Valores atuais permitidos: `onz`, `inter`, `gerencianet`, `itau`, `bradesco`, `santander`, `sicredi`, `sicoob`, `outros`.

## Solucao
1. **Migrar o banco de dados**: Remover o constraint antigo e criar um novo incluindo `"efi"` na lista de provedores permitidos.

## Detalhes Tecnicos

Uma unica migracao SQL:

```text
ALTER TABLE pix_configs DROP CONSTRAINT pix_configs_provider_check;
ALTER TABLE pix_configs ADD CONSTRAINT pix_configs_provider_check 
  CHECK (provider = ANY (ARRAY['efi', 'onz', 'inter', 'gerencianet', 'itau', 'bradesco', 'santander', 'sicredi', 'sicoob', 'outros']));
```

Nenhuma mudanca de codigo e necessaria -- o frontend ja envia `"efi"` corretamente. Apos a migracao, o auto-save funcionara sem erros.

