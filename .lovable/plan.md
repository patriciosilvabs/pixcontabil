

# Padronizacao de Responsividade Full-Stack

## Resumo

Auditar e corrigir todas as telas do sistema para garantir excelencia em Mobile e Desktop. As principais lacunas sao: tabelas admin que nao se adaptam a telas pequenas, e dialogs que deveriam ser drawers no mobile.

## Diagnostico por Tela

| Tela | Desktop | Mobile | Problema |
|---|---|---|---|
| Transactions | OK (cards) | OK | Ja usa cards responsivos |
| Companies | OK (grid cards) | OK | Ja usa grid responsivo |
| **QuickTags** | Table OK | Table ruim | Precisa de cards no mobile |
| **Users** | Table OK | Table ruim | Precisa de cards no mobile |
| **Categories** | Table OK | Table ruim | Precisa de cards no mobile |
| **Security** | Table parcial | Ruim | Precisa de cards no mobile |
| Reports | OK | Parcial | Charts ja sao responsivos via ResponsiveContainer |
| Settings | OK | OK | Layout simples, funciona |
| Dashboard | OK | OK | Ja tem MobileDashboard dedicado |

## Alteracoes

### 1. Componente utilitario `ResponsiveTable` — Novo arquivo

Criar `src/components/ui/responsive-card-table.tsx` — um wrapper que renderiza `<Table>` no desktop e cards empilhados no mobile, usando `useIsMobile()`. Isso evita duplicar logica em cada pagina.

### 2. QuickTags — Mobile cards

- No mobile: renderizar cada tag como um Card com nome, badge de classificacao, switch de ativo, e botoes de acao
- Botoes touch-friendly (min h-10, p-3)
- Dialog de criar/editar: usar Drawer no mobile via componente responsivo

### 3. Users — Mobile cards

- No mobile: cada membro como Card com avatar, nome, email, badges de role/status, e botoes de acao
- Acoes (Editar, Desativar, Senha, Excluir) em row de botoes ou dropdown
- Edit dialog -> Drawer no mobile (ja tem `max-h-[90vh] overflow-y-auto`, converter para Drawer)

### 4. Categories — Mobile cards

- No mobile: cada categoria como Card com nome, badge classificacao, keywords truncadas, switch ativo, botoes acao
- Dialog -> Drawer no mobile

### 5. Security — Mobile cards

- Tabelas de alertas, eventos e IPs bloqueados: cards no mobile
- Ja tem `hidden md:table-cell` parcial, mas precisa de conversao completa

### 6. Componente `ResponsiveDialog` — Novo arquivo

Criar `src/components/ui/responsive-dialog.tsx` que renderiza `Dialog` no desktop e `Drawer` no mobile. Isso padroniza o comportamento em todo o sistema sem alterar cada uso individualmente.

```text
Desktop:          Mobile:
+----------+      +----------+
| Dialog   |      |          |
| centered |      | Drawer   |
| modal    |      | bottom   |
+----------+      +----------+
```

### 7. Revisao de touch targets

Garantir que todos os botoes de acao em tabelas/cards tenham `min-h-[44px] min-w-[44px]` no mobile (padrao Apple/Google para touch targets).

## Arquivos criados/modificados

| Arquivo | Alteracao |
|---|---|
| `src/components/ui/responsive-dialog.tsx` | **Novo** — Dialog no desktop, Drawer no mobile |
| `src/pages/QuickTags.tsx` | Cards no mobile + ResponsiveDialog |
| `src/pages/Users.tsx` | Cards no mobile + ResponsiveDialog |
| `src/pages/Categories.tsx` | Cards no mobile + ResponsiveDialog |
| `src/pages/Security.tsx` | Cards no mobile para todas as tabs |

## Resultado esperado

- 100% das telas admin funcionais e legiveis em telas < 768px
- Dialogs se comportam como bottom-sheets no mobile (consistente com drawers de pagamento)
- Touch targets adequados para uso rapido no balcao
- Zero regressao em desktop — tables permanecem para telas grandes

