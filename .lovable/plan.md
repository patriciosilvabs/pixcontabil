

# Auditoria de Segurança — Resultado Completo

## Resumo Executivo

O sistema possui uma base de segurança sólida, mas a varredura automatizada encontrou **4 vulnerabilidades** que precisam ser corrigidas, sendo **1 crítica**.

---

## 1. Criptografia (Em trânsito e em repouso)

**Status: BOM, com ressalva**

- **Em trânsito**: Todo tráfego usa HTTPS (TLS) — tanto o frontend quanto as chamadas às APIs do provedor (ONZ/Transfeera). OK.
- **Em repouso**: O banco de dados Lovable Cloud criptografa dados em repouso por padrão (AES-256). OK.
- **Senhas**: Gerenciadas pelo sistema de autenticação nativo (bcrypt com salt). Nunca armazenadas em texto puro. OK.
- **Ressalva**: A proteção contra senhas vazadas (HIBP check) está **desabilitada**. Isso permite que usuários usem senhas já comprometidas em vazamentos públicos.

**Ação necessária**: Habilitar a proteção contra senhas vazadas nas configurações de autenticação.

---

## 2. Autenticação e Controle de Acesso (RBAC)

**Status: BOM**

- RBAC implementado com tabela separada `user_roles` (admin/operator).
- Permissões granulares por página (`user_page_permissions`) e por funcionalidade (`user_feature_permissions`).
- `AuthGuard` protege rotas no frontend; RLS policies protegem dados no backend.
- Funções `SECURITY DEFINER` (`is_admin`, `has_role`, `is_company_member`) previnem recursão de RLS.
- Edge functions verificam role de admin via `adminClient.rpc("is_admin")` antes de operações sensíveis (criar/excluir usuários, resetar senhas).

**Sem ação necessária.**

---

## 3. Credenciais Sensíveis Expostas (CRÍTICO)

**Status: VULNERABILIDADE CRÍTICA**

A tabela `pix_configs` contém campos altamente sensíveis (`client_secret_encrypted`, `certificate_encrypted`, `certificate_key_encrypted`, `webhook_secret`). A política RLS atual permite que **qualquer membro autenticado** da empresa leia esses dados, não apenas administradores.

Embora exista a view `pix_configs_safe`, a tabela base continua acessível.

**Ação necessária**:
- Remover/restringir a política de SELECT na tabela `pix_configs` para permitir acesso apenas a administradores.
- Garantir que operadores acessem apenas via `pix_configs_safe` (que já filtra campos sensíveis).

---

## 4. Políticas RLS com Escopo Incorreto

**Status: AVISO**

Várias tabelas sensíveis (`pix_tokens`, `pix_configs`, `pix_refunds`, `pix_webhook_logs`, `user_page_permissions`, `user_feature_permissions`) têm policies aplicadas ao role `public` em vez de `authenticated`. Embora `auth.uid()` retorne NULL para não-autenticados (prevenindo acesso), isso é um padrão inseguro — qualquer mudança futura nas funções auxiliares poderia expor dados.

**Ação necessária**: Alterar todas as políticas afetadas de `public` para `authenticated`.

---

## 5. Injeção de Logs de Auditoria

**Status: AVISO**

A política de INSERT na tabela `audit_logs` permite inserir registros com `company_id IS NULL`, o que significa que qualquer usuário autenticado (mesmo sem empresa) pode inserir entradas arbitrárias no log de auditoria.

**Ação necessária**: Remover a branch `company_id IS NULL` da política de INSERT, ou restringir inserções ao backend/service-role.

---

## 6. APIs e Proteção contra Ataques

**Status: BOM**

- **SQL Injection**: Não aplicável — o sistema usa o Supabase SDK com queries parametrizadas, sem SQL cru.
- **XSS**: O único uso de `dangerouslySetInnerHTML` está no componente `chart.tsx` (shadcn/ui) com CSS gerado internamente, sem input do usuário. OK.
- **CSRF**: Mitigado pelo uso de tokens JWT Bearer em vez de cookies de sessão.
- **Webhooks**: Protegidos com `x-webhook-secret` obrigatório e rate limiting (100 req/min por IP).

**Sem ação necessária.**

---

## 7. Logs e Vazamento de Dados

**Status: BOM, com ressalva**

- Nenhum `console.log` expõe senhas, CPFs ou dados sensíveis do usuário.
- Logs no backend registram apenas metadados operacionais (ex: "token received successfully", "polling attempt 5/90").
- Edge functions retornam mensagens genéricas em caso de erro para evitar vazamento de detalhes internos.
- **Ressalva menor**: Há ~88 `console.log` no frontend (câmera, polling) que são úteis para debug mas poderiam ser removidos em produção para reduzir ruído.

---

## Plano de Correção (4 itens)

### Migração SQL (1 migration)

1. **Restringir `pix_configs` a admins**: Dropar a política que permite SELECT por membros comuns e recriar apenas para admins.
2. **Corrigir escopo de policies**: Alterar de `TO public` para `TO authenticated` nas tabelas `pix_tokens`, `pix_configs`, `pix_refunds`, `pix_webhook_logs`, `user_page_permissions`, `user_feature_permissions`.
3. **Corrigir política de `audit_logs`**: Remover a branch `company_id IS NULL` do INSERT.

### Configuração de Auth

4. **Habilitar proteção HIBP**: Usar a ferramenta de configuração de autenticação para ativar a verificação de senhas vazadas.

### Detalhes Técnicos

A migration SQL conterá:
- `DROP POLICY` + `CREATE POLICY` para cada tabela afetada
- Todas as novas policies usarão `TO authenticated`
- A política de `pix_configs` para SELECT será restrita a `is_admin(auth.uid())`
- A política de `audit_logs` INSERT removerá `company_id IS NULL`

Nenhuma mudança de frontend é necessária.

