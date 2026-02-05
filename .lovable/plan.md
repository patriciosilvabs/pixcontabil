
# Sistema de Gestão de Pagamentos com Lastro Contábil

## Visão Geral
Aplicação web responsiva estilo Banco Digital (Nubank/Inter) para controle de saídas via Pix com rastreabilidade total. O sistema garante que nenhum pagamento seja concluído sem evidência documental classificada contabilmente.

---

## Módulo 1: Autenticação e Controle de Acesso (RBAC)

### Funcionalidades
- **Login seguro** com email/senha
- **Dois perfis de acesso**:
  - **Administrador (Dono)**: Acesso completo - saldo, extrato, relatórios, gestão de usuários
  - **Operador (Funcionário)**: Saldo oculto, pode realizar pagamentos, obrigatório anexar comprovante
- **Multi-empresa**: Seletor de conta/empresa na tela inicial
- **Gestão de usuários**: Admins podem criar operadores e definir limites de pagamento

### Experiência do Usuário
- Tela de login moderna com gradiente estilo fintech
- Dashboard personalizado conforme perfil do usuário
- Operadores veem apenas funcionalidades permitidas (saldo sempre oculto)

---

## Módulo 2: Dashboard e Visão Geral

### Para Administradores
- **Cards com resumo financeiro**: Saldo atual, Total de saídas (dia/mês), Custos vs Despesas
- **Gráficos visuais**: Pizza (distribuição Custo/Despesa), Linha (evolução mensal)
- **Lista de últimas transações** com status e usuário responsável
- **Alertas**: Notas fiscais pendentes de classificação, possíveis duplicidades

### Para Operadores
- Cards com **saldo oculto** (exibe "---")
- Atalhos rápidos para: Novo Pix, Histórico de Pagamentos, Comprovantes Pendentes
- Lista de suas próprias transações do dia

---

## Módulo 3: Fluxo de Pagamento Pix

### Tipos de Pagamento Suportados
- **Chave Pix**: CPF, CNPJ, Email, Telefone, Chave Aleatória
- **Copia e Cola**: Campo para colar código Pix
- **QR Code**: Scanner de câmera para ler QR Code

### Fluxo Completo
1. **Seleção do tipo de Pix** e entrada dos dados
2. **Confirmação de valores** e dados do favorecido
3. **Integração com API bancária** para efetuar o pagamento
4. **Tela de sucesso** com gatilho automático para captura de evidência

### Validações de Segurança
- Verificação de limite de pagamento do operador
- Confirmação de dados antes de enviar
- Log de todas as tentativas (sucesso e falha)

---

## Módulo 4: Captura de Evidência (Comprovante)

### Gatilho Automático
Após confirmação do Pix, o sistema **abre automaticamente** a interface de captura.

### Opções de Captura
- **📸 Foto da Nota Fiscal/Cupom**: Abertura da câmera do dispositivo
- **📎 Anexar Arquivo**: Upload de PDF, imagem ou print
- **📋 Comprovante Digital**: Detecção de conteúdo na área de transferência

### Classificação Rápida (Obrigatória)
- Miniatura da imagem capturada
- **Dois botões grandes**: [💰 CUSTO] ou [📊 DESPESA]
- Subcategorias aparecem após seleção principal

### Bloqueio de Saída
- O operador **não consegue fechar a tela** sem anexar e classificar o comprovante
- Indicador visual de "Comprovante Obrigatório"

---

## Módulo 5: Processamento Inteligente com IA (OCR)

### Extração Automática de Dados
Usando Lovable AI, o sistema processa a imagem em background:
- **CNPJ/CPF** do emissor
- **Data** da emissão
- **Valor total**
- **Chave de Acesso** (NFe/NFCe)
- **Itens da nota** (quando legível)

### Categorização por Palavras-Chave
- Dicionário configurável de keywords
- Exemplos:
  - "Farinha", "Moinho", "Trigo" → **Custo > Insumos**
  - "Energia", "CEMIG", "CPFL" → **Despesa > Utilidades**
  - "Aluguel", "Locação" → **Despesa > Ocupação**

### Preenchimento Automático
- Campos do formulário pré-preenchidos com dados extraídos
- Usuário apenas **confirma ou corrige** as informações
- Badge indicando "Preenchido por IA"

---

## Módulo 6: Gestão de Categorias e Plano de Contas

### Estrutura Hierárquica
- **Custos**: Insumos, Mão de Obra Direta, Embalagens, etc.
- **Despesas**: Utilidades, Ocupação, Administrativo, Marketing, etc.

### Configurações
- CRUD completo de categorias
- Definição de keywords associadas a cada categoria
- Ativação/Desativação de categorias

---

## Módulo 7: Histórico e Extrato

### Visualização
- Lista completa de transações com filtros avançados
- Filtros: Data, Categoria, Usuário, Status, Valor
- Cards com: Favorecido, Valor, Data, Categoria, Usuário, Thumbnail do comprovante

### Detalhes da Transação
- Visualização completa do comprovante em tela cheia
- Todos os dados extraídos por OCR
- Logs de auditoria (quem pagou, quem classificou, quando)
- Metadados: GPS, Timestamp da captura

---

## Módulo 8: Módulo Contábil e Relatórios

### Relatório PDF Inteligente
- **Cabeçalho**: Período, Empresa, Total Custos, Total Despesas
- **Tabela**: Data | Favorecido | Valor | Categoria | Usuário
- **Anexos visuais**: Comprovantes ao lado dos dados
- **QR Codes/Links**: Acesso direto à imagem em alta resolução

### Exportações
- **PDF**: Relatório completo formatado para contador
- **CSV**: Dados tabulares para Excel
- **OFX**: Formato bancário para sistemas contábeis

### Filtros de Relatório
- Por período (dia, semana, mês, personalizado)
- Por categoria (Custo, Despesa, ou ambos)
- Por empresa/conta

---

## Módulo 9: Compliance e Segurança

### Metadata de Captura
- Registro de **GPS** no momento da foto
- **Timestamp real** (data/hora do dispositivo)
- Marcação de imagens com metadados para auditoria

### Logs de Auditoria
- Quem realizou o pagamento
- Quem classificou o documento
- Histórico de alterações

### Prevenção de Duplicidade
- Verificação de **Chave de Acesso** já cadastrada
- Alerta visual se nota fiscal já existe no sistema
- Opção de vincular à transação existente

---

## Módulo 10: Configurações e Administração

### Gestão de Usuários
- Lista de operadores com status
- Criar/Editar/Desativar usuários
- Definir limites de pagamento por operador

### Gestão de Empresas/Contas
- Múltiplas contas bancárias
- Configurações específicas por empresa
- Logotipos e identidade visual

### Integrações
- Configuração da API Pix (credenciais)
- Webhooks para notificações
- Configurações de Storage para comprovantes

---

## Design Visual

### Estilo "Banco Digital"
- Cores vibrantes (roxo/verde gradiente)
- Cards com cantos arredondados e sombras suaves
- Ícones modernos e animações sutis
- Dark mode opcional

### Responsividade
- Otimizado para uso em celular (operadores em campo)
- Layout adaptativo para desktop (administradores)
- Botões grandes e touch-friendly

---

## Arquitetura Técnica

### Frontend
- React + TypeScript + Tailwind CSS
- Componentes shadcn/ui
- Recharts para gráficos

### Backend (Lovable Cloud)
- Banco de dados PostgreSQL
- Storage para comprovantes
- Edge Functions para:
  - Integração com API Pix
  - Processamento OCR com Lovable AI
  - Geração de relatórios PDF

### Segurança
- Autenticação Supabase
- RBAC com tabela de roles separada
- RLS policies rigorosas
- Secrets gerenciados via Lovable Cloud
