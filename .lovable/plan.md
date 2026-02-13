

# Adicionar Resumo Visual com Comprovantes na Tela de Relatorios

## Objetivo

Mostrar diretamente na pagina de Relatorios um resumo dos pagamentos agrupados por dia, com os respectivos comprovantes visiveis inline. A contabilidade podera navegar pelos dias/semanas sem precisar exportar, visualizando cada despesa e seu comprovante na propria tela.

## Como Vai Funcionar

A secao de resumo visual substitui a tabela simples atual. As transacoes serao agrupadas por dia, e cada grupo mostra:

- A data como cabecalho (ex: "Segunda, 10/02/2026")
- O subtotal do dia
- Cada transacao com descricao, categoria, classificacao, valor e status
- Uma miniatura clicavel do comprovante (que abre em tamanho grande num dialog)

Quando o periodo selecionado for "Hoje", mostra apenas 1 dia. Para "Esta Semana" ou "Este Mes", mostra multiplos dias colapsados em acordeao (Accordion), com cada dia expansivel.

## Layout

```text
+-- 10/02/2026 (Segunda) — Subtotal: R$ 2.340,00 --------+
|                                                           |
|  [thumb]  Compra de insumos    Insumos  Custo  R$ 800,00 |
|  [thumb]  Agua mineral         Bebidas  Custo  R$ 140,00 |
|  [thumb]  Energia eletrica     Energia  Despesa R$1400,00 |
+-----------------------------------------------------------+

+-- 09/02/2026 (Domingo) — Subtotal: R$ 560,00 -----------+
|  (clique para expandir)                                   |
+-----------------------------------------------------------+
```

Ao clicar na miniatura do comprovante, abre um Dialog com a imagem em tamanho grande.

## Alteracoes

### Arquivo: `src/pages/Reports.tsx`

1. **Agrupar transacoes por dia**: Criar um `useMemo` que agrupa as transacoes por data (`dd/MM/yyyy`), calculando subtotal de cada dia
2. **Substituir a tabela** pela secao de resumo visual usando o componente `Accordion` (Radix) para cada dia
3. **Miniaturas de comprovantes**: Para cada transacao com `receipts[0].file_url`, gerar signed URL e exibir um `<img>` em miniatura (64x64px)
4. **Dialog de imagem ampliada**: Ao clicar na miniatura, abrir um `Dialog` com a imagem em tamanho legivel
5. **Estado de signed URLs**: Criar estado `signedUrls` (Record<string, string>) e carregar as URLs assinadas ao montar os dados
6. **Manter graficos e cards de resumo** no topo -- o resumo visual fica abaixo dos graficos, no lugar da tabela atual
7. **Manter exportacao** -- os botoes de exportar PDF/CSV/XLSX continuam funcionando normalmente

### Importacoes adicionais

- `Accordion, AccordionContent, AccordionItem, AccordionTrigger` de `@/components/ui/accordion`
- `Dialog, DialogContent, DialogTrigger` de `@/components/ui/dialog`
- `Image, Eye` de `lucide-react`
- `extractStoragePath` e logica de signed URL (reutilizar do `reportExports.ts` ou criar helper compartilhado)

## Detalhes Tecnicos

- Agrupamento por dia: `transactions.reduce()` usando `format(new Date(t.created_at), "yyyy-MM-dd")` como chave
- Signed URLs geradas em batch usando `Promise.all` ao carregar as transacoes, armazenadas em estado local
- Miniaturas usam `object-fit: cover` para manter proporcao dentro do quadrado
- Dialog usa `max-w-3xl` para a imagem ficar grande e legivel
- Fallback para transacoes sem comprovante: exibe icone de "sem imagem"
- Accordion inicia com o primeiro dia expandido (o mais recente)

