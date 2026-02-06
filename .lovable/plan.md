

# Configurar Primeiro Usuário como Proprietário/Admin

## Situação Atual

O usuário `patriciobarbosadasilva@gmail.com` foi criado com sucesso, porém:
- A tabela `user_roles` está vazia (sem role atribuída)
- Nenhuma empresa foi criada
- Nenhuma associação empresa-usuário existe

Isso causa problemas de acesso porque o sistema verifica roles e associações de empresa para liberar funcionalidades.

## Plano de Implementação

### 1. Inserir Dados Iniciais via Migração SQL

Criar uma migração que:

**a) Atribuir role de admin ao usuário**
```sql
INSERT INTO user_roles (user_id, role)
VALUES ('51d2d0ca-94ae-42e7-b56f-627be7df0a50', 'admin');
```

**b) Criar empresa padrão**
```sql
INSERT INTO companies (name, email, is_active)
VALUES ('Minha Empresa', 'patriciobarbosadasilva@gmail.com', true)
RETURNING id;
```

**c) Vincular usuário à empresa**
```sql
INSERT INTO company_members (user_id, company_id, is_active)
VALUES ('51d2d0ca-94ae-42e7-b56f-627be7df0a50', <company_id>, true);
```

### 2. Implementar Lógica de "Primeiro Usuário é Admin"

Para garantir que futuros cadastros também funcionem corretamente, implementar um trigger que:

- Verifica se é o primeiro usuário do sistema
- Se for, atribui role `admin` automaticamente
- Se não for, atribui role `operator` por padrão

```sql
CREATE OR REPLACE FUNCTION handle_first_user_role()
RETURNS TRIGGER AS $$
DECLARE
    user_count INTEGER;
BEGIN
    -- Contar usuários existentes
    SELECT COUNT(*) INTO user_count FROM auth.users;
    
    -- Se for o primeiro usuário, é admin
    IF user_count = 1 THEN
        INSERT INTO user_roles (user_id, role)
        VALUES (NEW.id, 'admin');
    ELSE
        INSERT INTO user_roles (user_id, role)
        VALUES (NEW.id, 'operator');
    END IF;
    
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
```

### 3. Criar Trigger no auth.users

```sql
CREATE TRIGGER on_auth_user_created_role
    AFTER INSERT ON auth.users
    FOR EACH ROW
    EXECUTE FUNCTION handle_first_user_role();
```

---

## Resumo das Alterações

| Arquivo/Recurso | Alteração |
|-----------------|-----------|
| Migração SQL | Inserir role admin para o usuário atual |
| Migração SQL | Criar empresa padrão |
| Migração SQL | Vincular usuário à empresa |
| Trigger SQL | Auto-atribuir role no cadastro de novos usuários |

## Resultado Esperado

Após a implementação:
- Você terá acesso completo como administrador
- O dashboard exibirá a visão de admin com todos os recursos
- A empresa aparecerá no seletor do menu lateral
- Novos usuários receberão role `operator` automaticamente

