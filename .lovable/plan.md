

# Adicionar filtro por data específica nos Relatórios

## Alteração

Adicionar uma opção "Data Específica" no select de período. Quando selecionada, exibir um `Popover` com o componente `Calendar` para o usuário escolher um dia exato.

### `src/pages/Reports.tsx`

1. Expandir o tipo `PeriodFilter` para incluir `"custom"`
2. Adicionar estado `customDate` (`Date | undefined`)
3. No `dateRange` memo, tratar o caso `"custom"` usando `startOfDay`/`endOfDay` da data selecionada
4. Substituir o `Select` de período por uma combinação: manter o Select com a opção extra "Data Específica", e quando selecionada, mostrar um `Popover` com `Calendar` ao lado
5. Importar `Calendar` de `@/components/ui/calendar` e `Popover` de `@/components/ui/popover`
6. Atualizar `periodLabels` para incluir a data formatada quando `custom`

### UI

Ao selecionar "Data Específica" no dropdown, aparece um date picker (Calendar) ao lado. O label do período no export PDF mostrará a data formatada (ex: "29/03/2026").

