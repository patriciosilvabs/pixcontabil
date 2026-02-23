
# Adicionar versao do sistema no Dashboard

## O que sera feito

Exibir a versao atual do sistema (ex: `v1.0.0`) em dois locais:

1. **Mobile**: Na barra verde (sub-bar), ao lado do nome da empresa
2. **Desktop (sidebar)**: Abaixo do nome/role do usuario logado

A versao sera definida como uma constante centralizada para facilitar atualizacoes futuras.

## Locais de exibicao

**Mobile (MobileHeader.tsx)** - Na sub-bar verde, ao lado do nome da empresa:
- Antes: `Empresa XYZ`
- Depois: `Empresa XYZ - v1.0.0`

**Desktop (MainLayout.tsx)** - Na secao do usuario no rodape da sidebar:
- Antes: Nome + "Administrador"
- Depois: Nome + "Administrador" + "v1.0.0" (em texto menor abaixo)

## Detalhes tecnicos

### 1. Criar constante de versao
- Arquivo: `src/constants/app.ts`
- Conteudo: `export const APP_VERSION = "v1.0.0";`

### 2. Alterar MobileHeader.tsx (linha 97-99)
- Importar `APP_VERSION`
- Adicionar versao ao lado do nome da empresa na sub-bar verde:
```tsx
<span className="font-semibold truncate max-w-[180px]">
  {currentCompany?.name || "Empresa"}{" "}
  <span className="font-normal opacity-70">{APP_VERSION}</span>
</span>
```

### 3. Alterar MainLayout.tsx (linhas 155-157)
- Importar `APP_VERSION`
- Adicionar versao abaixo da role do usuario:
```tsx
<p className="text-xs text-sidebar-foreground/60">
  {isAdmin ? "Administrador" : "Operador"}
</p>
<p className="text-[10px] text-sidebar-foreground/40">
  {APP_VERSION}
</p>
```

## Arquivos envolvidos
- `src/constants/app.ts` (novo) - constante de versao
- `src/components/layout/MobileHeader.tsx` - adicionar versao na sub-bar
- `src/components/layout/MainLayout.tsx` - adicionar versao na sidebar
