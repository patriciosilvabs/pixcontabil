

# Corrigir logo, cores e layout conforme referencia InfoPago

## Problema
O header esta com gradiente verde em vez de roxo/purple, o logo nao tem o destaque visual correto ("CONTABIL" com fundo roxo), falta o subtitulo, e os icones de acoes rapidas estao com cor rosa em vez de roxo.

## Mudancas

### 1. Header: Gradiente roxo/purple (nao verde)
No `src/index.css`, alterar `--gradient-bank-header` de verde para roxo/purple:
- De: `linear-gradient(180deg, hsl(145 60% 32%), hsl(145 55% 40%))`
- Para: `linear-gradient(180deg, hsl(270 91% 50%), hsl(280 80% 42%))`

### 2. Logo no header mobile com destaque em "CONTABIL"
No `MobileHeader.tsx`, reformular o logo para:
- "PIX" em branco bold
- "CONTABIL" com fundo roxo escuro/highlight (badge com background)
- Adicionar subtitulo "Sistema de Pagamento Contabil" abaixo do logo
- Remover a linha decorativa atual

### 3. Icones de acoes rapidas: roxo com icone branco
No `MobileDashboard.tsx`, trocar as cores dos circulos:
- De: `bg-rose-100` + `text-rose-600`
- Para: `bg-primary` + `text-white` (circulos roxos com icones brancos, conforme screenshot)

### 4. Barra inferior (sub-bar) permanece verde
A barra com "Conta: 0001" continua verde como esta - apenas o header principal muda para roxo.

## Arquivos modificados
- `src/index.css` - gradiente do header (1 linha)
- `src/components/layout/MobileHeader.tsx` - logo com destaque + subtitulo
- `src/components/dashboard/MobileDashboard.tsx` - cores dos icones de acoes rapidas
