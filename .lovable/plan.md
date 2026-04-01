

# Melhorar UI dos templates de perfil

## Problemas
1. Descrições dos templates estão com texto pequeno e desorganizado
2. Ao selecionar um template, não há indicação visual de qual perfil está ativo

## Alterações

### `src/pages/Users.tsx`

**1. Adicionar estado `selectedTemplate`** para rastrear qual template foi selecionado:
- `const [selectedTemplate, setSelectedTemplate] = useState<string | null>(null)`
- No `openEdit`, detectar automaticamente qual template corresponde às permissões carregadas (comparar com cada template) ou deixar `null`
- Ao clicar num template, setar `selectedTemplate` com a key

**2. Melhorar visual dos botões de template:**
- Quando `selectedTemplate === key`, aplicar borda colorida (`border-primary bg-primary/5`) e mostrar um Badge "Ativo" no canto
- Reformatar descrições: usar frases curtas em lista com ícones (✓ Saldo, ✗ Configurações) em vez de texto corrido
- Aumentar padding e espaçamento para melhor legibilidade

**3. Mostrar Badge do perfil ativo** acima da seção de ajustes individuais:
- Quando um template está selecionado, exibir um `Badge` com o nome do perfil (ex: "Perfil: Operacional") com cor diferenciada
- Texto informativo: "Ajustes abaixo sobrescrevem o template selecionado"

## Resultado
- Templates com visual claro e organizado
- Usuário sabe exatamente qual perfil está aplicado ao membro
- Descrições legíveis com destaques visuais do que cada perfil inclui/exclui

