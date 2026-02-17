

## Controle de visibilidade dos icones de Funcoes Principais por usuario

### Objetivo

Permitir que o administrador escolha, ao editar um usuario, quais dos 8 icones de "Funcoes Principais" do dashboard mobile ficam visiveis para aquele usuario. Por padrao, todos ficam visiveis.

### Icones controlaveis

| Chave | Label |
|-------|-------|
| menu_pix | MENU PIX |
| pagar_qrcode | PAGAR QR CODE |
| copia_cola | COPIA E COLA |
| com_chave | COM CHAVE |
| favorecidos | FAVORECIDOS |
| agendadas | AGENDADAS |
| boleto | BOLETO |
| transferir | TRANSFERIR |

### Alteracoes

#### 1. Banco de dados -- nova tabela `user_feature_permissions`

Criar tabela para armazenar quais icones cada usuario pode ver:

```text
user_feature_permissions
- id (uuid, PK)
- user_id (uuid, NOT NULL)
- company_id (uuid, NOT NULL)
- feature_key (text, NOT NULL) -- ex: "menu_pix", "boleto"
- is_visible (boolean, default true)
- created_at (timestamptz)
UNIQUE(user_id, company_id, feature_key)
```

Politicas RLS:
- Admins: ALL
- Usuarios: SELECT nas proprias permissoes

#### 2. `src/pages/Users.tsx` -- adicionar secao de checkboxes no dialog de edicao

- Criar constante `FEATURE_OPTIONS` com as 8 opcoes
- Adicionar estado `editFeaturePermissions` (Record de feature_key para boolean)
- No `openEdit`, carregar permissoes de features do banco (default: todos true)
- No dialog, adicionar nova secao "Funcoes Principais Visiveis" com grid de checkboxes, abaixo da secao "Acesso as Paginas"
- No `handleSave`, salvar/atualizar as permissoes de features via upsert

#### 3. `src/contexts/AuthContext.tsx` -- expor permissoes de features

- Adicionar estado `featurePermissions` (string[] com as keys visiveis)
- Buscar da tabela `user_feature_permissions` no `fetchUserData`
- Expor funcao `hasFeatureAccess(featureKey: string): boolean` no contexto (admin = true para todos)

#### 4. `src/components/dashboard/MobileDashboard.tsx` -- filtrar icones

- Receber `hasFeatureAccess` como prop ou usar do contexto
- Adicionar campo `featureKey` a cada item do array `quickActions`
- Filtrar o array antes de renderizar: `quickActions.filter(a => hasFeatureAccess(a.featureKey))`

### Resultado

O admin vera checkboxes para cada icone de funcao principal ao editar um usuario. Icones desmarcados nao aparecerao no dashboard mobile daquele usuario.
