

# Central de Segurança — Implementação Completa

## Visão Geral

Sistema end-to-end de monitoramento de segurança: eventos de segurança são registrados no banco, analisados por regras automáticas em uma Edge Function, alertas são gerados, IPs podem ser bloqueados, e administradores gerenciam tudo via dashboard.

## Arquitetura

```text
Login/Request → AuthContext/Edge Functions
       ↓
  security_events (tabela)
       ↓
  Edge Function: security-analyze
  (brute force, enumeração, rate limit, token inválido, acesso proibido)
       ↓
  security_alerts (tabela)  +  ip_blocks (tabela)
       ↓
  Dashboard Admin (/security)
  (métricas, alertas, eventos, bloqueio/desbloqueio IP)
```

## 1. Migração — 3 Tabelas

### `security_events`
| Coluna | Tipo |
|--------|------|
| id | uuid PK |
| company_id | uuid (nullable) |
| user_id | uuid (nullable) |
| event_type | text (login_failed, access_denied, rate_limit, invalid_token, user_enumeration) |
| severity | text (low, medium, high, critical) |
| ip_address | text |
| user_agent | text (nullable) |
| metadata | jsonb |
| created_at | timestamptz |

RLS: admins SELECT all; authenticated INSERT com company check.

### `security_alerts`
| Coluna | Tipo |
|--------|------|
| id | uuid PK |
| company_id | uuid (nullable) |
| alert_type | text |
| severity | text |
| title | text |
| description | text |
| source_ip | text (nullable) |
| target_user_id | uuid (nullable) |
| related_event_ids | uuid[] |
| status | text (open, investigating, resolved, dismissed) |
| resolved_by | uuid (nullable) |
| resolved_at | timestamptz (nullable) |
| created_at | timestamptz |

RLS: admins ALL.

### `ip_blocks`
| Coluna | Tipo |
|--------|------|
| id | uuid PK |
| ip_address | text (unique) |
| reason | text |
| blocked_by | uuid |
| blocked_at | timestamptz |
| expires_at | timestamptz (nullable) |
| is_active | boolean |
| created_at | timestamptz |

RLS: admins ALL.

Habilitar realtime em `security_alerts` para notificações ao vivo no dashboard.

## 2. Edge Function: `security-analyze`

Recebe eventos do tipo `{ event_type, ip_address, user_id?, metadata }`, aplica regras:

- **Brute Force**: 5+ `login_failed` do mesmo IP em 10 min → alerta critical + auto-block IP
- **Enumeração de Usuários**: 10+ tentativas com emails diferentes do mesmo IP em 5 min → alerta high
- **Acesso Proibido Repetido**: 5+ `access_denied` do mesmo user em 5 min → alerta medium
- **Rate Limit**: 50+ eventos de qualquer tipo do mesmo IP em 1 min → alerta high + auto-block
- **Token Inválido Repetido**: 5+ `invalid_token` do mesmo IP em 10 min → alerta high

A função insere o evento em `security_events`, executa as regras consultando eventos recentes, e cria alertas/bloqueios conforme necessário.

## 3. Edge Function: `security-admin`

Endpoints admin (validação JWT + is_admin):
- `GET /events` — listar eventos com filtros (tipo, severidade, período)
- `GET /alerts` — listar alertas com filtros
- `GET /metrics` — contadores agregados (eventos 24h, alertas abertos, IPs bloqueados)
- `POST /alerts/:id/resolve` — resolver alerta
- `POST /alerts/:id/dismiss` — dispensar alerta
- `POST /ip-blocks` — bloquear IP manualmente
- `DELETE /ip-blocks/:id` — desbloquear IP

## 4. Integração no AuthContext

No `signIn` do `AuthContext.tsx`, ao receber erro de login, chamar `security-analyze` com `event_type: 'login_failed'` e IP do cliente. Isso alimenta o sistema automaticamente.

## 5. Frontend — Página `/security`

Nova página `src/pages/Security.tsx` com layout similar ao `WebhookEvents.tsx`:

- **Cards de métricas**: Eventos (24h), Alertas Abertos, IPs Bloqueados, Nível de Risco
- **Tabs**: Alertas | Eventos | IPs Bloqueados
- **Tab Alertas**: Tabela com severity badge, título, IP, status, ações (resolver/dispensar)
- **Tab Eventos**: Tabela com tipo, severidade, IP, user, timestamp, filtros por tipo/severidade
- **Tab IPs**: Tabela com IP, motivo, bloqueado por, expiração, botão desbloquear + formulário para bloquear novo IP
- Realtime subscription em `security_alerts` para atualização ao vivo

## 6. Rota e Navegação

- Rota `/security` em `App.tsx` com `requireAdmin`
- Item "Central de Segurança" no `MainLayout.tsx` com ícone `Shield`, adminOnly

## Arquivos Alterados/Criados

| Arquivo | Ação |
|---------|------|
| Migração SQL | Criar 3 tabelas + RLS + realtime |
| `supabase/functions/security-analyze/index.ts` | Criar — registro + análise |
| `supabase/functions/security-admin/index.ts` | Criar — endpoints admin |
| `src/pages/Security.tsx` | Criar — dashboard completo |
| `src/hooks/useSecurityData.ts` | Criar — hook para dados + realtime |
| `src/App.tsx` | Adicionar rota /security |
| `src/components/layout/MainLayout.tsx` | Adicionar nav item |
| `src/contexts/AuthContext.tsx` | Registrar evento em login falho |

