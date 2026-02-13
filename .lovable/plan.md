
# Adicionar Campo de Pesquisa nas Subcategorias (ReceiptCapture)

## Problema
Com muitas categorias cadastradas, o usuario precisa rolar bastante para encontrar a categoria desejada. Um campo de busca facilita a localizacao rapida.

## Alteracoes

### Arquivo: `src/pages/ReceiptCapture.tsx`

1. **Adicionar estado de busca**: `const [categorySearch, setCategorySearch] = useState("")`
2. **Resetar busca** quando trocar a classificacao (cost/expense) -- no onClick dos botoes CUSTO/DESPESA, resetar `categorySearch` para `""`
3. **Adicionar campo Input de pesquisa** entre o label "Categoria" e os botoes de subcategoria:
   - Placeholder: "Buscar categoria..."
   - Icone de lupa (Search do lucide-react)
   - Filtra as categorias exibidas em tempo real pelo texto digitado
4. **Filtrar categorias**: Alem do filtro por classificacao, aplicar `.filter(c => c.name.toLowerCase().includes(categorySearch.toLowerCase()))`
5. **Mostrar mensagem** quando nenhuma categoria corresponder a busca: "Nenhuma categoria encontrada"

### Layout

```text
Categoria
+--------------------------------------+
| [lupa] Buscar categoria...           |
+--------------------------------------+

[Afiacao de cortadores]  [Agua]  [Agua utilizada...]
[Azeites e oleos...]  [Bebidas para revenda...]
...
```

### Detalhes Tecnicos

- Importar `Search` do lucide-react e `Input` de `@/components/ui/input`
- O campo Input fica dentro da div `space-y-2` existente, logo abaixo do label "Categoria"
- Filtro case-insensitive usando `toLowerCase()`
- Sem debounce necessario pois e filtragem local em memoria
