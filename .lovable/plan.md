

# Redesign Mobile para estilo InfoPago

## Resumo
Ajustar a interface mobile do PixFlow para ficar visualmente identica ao app InfoPago, mantendo as funcionalidades existentes. As mudancas sao exclusivamente visuais/de layout no mobile.

## Mudancas

### 1. Header Mobile (`MobileHeader.tsx`)
- Adicionar botao "MINHA EMPRESA" centralizado abaixo do logo (pill/badge branco com texto verde)
- Adicionar barra verde abaixo do header com numero da conta a esquerda e nome da empresa a direita
- Manter avatar, logo PIXFLOW, icones de olho e sino

### 2. Dashboard Mobile (`MobileDashboard.tsx`)
- **Card de saldo**: Aumentar a barra de progresso (de `h-1.5` para `h-2.5`), cor verde solida, remover icone do olho de dentro do card (ja esta no header)
- **Grid de acoes rapidas**: 
  - Adicionar titulo "FUNCOES PRINCIPAIS" acima do grid
  - Aumentar tamanho dos cards (padding maior, icones maiores ~6x6)
  - Fundo cinza claro com cantos mais arredondados e sombra sutil
  - Renomear "AGENDADAS" para "TRANSACOES AGENDADAS"
- **Transacoes recentes**:
  - Adicionar separador de data (ex: "14 FEVEREIRO 2026") acima das transacoes
  - Mostrar tipo da transacao em texto menor acima do nome ("PAGAMENTO EFETUADO")
  - Adicionar seta/chevron a direita de cada item
  - Valores recebidos em verde, pagos em vermelho
  - Mostrar sub-valor abaixo do valor principal

### 3. Bottom Tab Bar (`BottomTabBar.tsx`)
- Reduzir para 3 abas: Home (botao flutuante circular), Menu (grid), Transacoes (icone de setas)
- O botao Home deve ser um circulo elevado centralizado com fundo verde e icone branco
- Estilo pill/arredondado para a barra em si

### 4. CSS (`index.css`)
- Nenhuma mudanca de tema necessaria, o gradiente verde do header ja existe

## Arquivos modificados
- `src/components/layout/MobileHeader.tsx` - header com barra de conta/empresa
- `src/components/dashboard/MobileDashboard.tsx` - layout do dashboard
- `src/components/layout/BottomTabBar.tsx` - barra inferior com 3 abas
