

# Corrigir: Perfil "Caixa" sem permissão de classificação não consegue salvar comprovante

## Problema

Quando o usuário tem perfil "Caixa" sem permissões de classificação (`classificar_insumo` e `classificar_despesa` ambos desativados), a tela de anexo de comprovante fica travada:

- Os botões de classificação (Custo/Despesa) não aparecem
- Nenhuma classificação automática é aplicada
- `receiptData.classification` permanece `null`
- Os botões "Salvar Comprovante" e "Salvar classificação sem comprovante" ficam desabilitados permanentemente

## Solução

Quando o usuário **não tem nenhuma permissão de classificação**, o fluxo deve permitir que ele apenas anexe o comprovante (foto) e a descrição, **sem exigir classificação**. A classificação será feita depois por alguém com permissão (gestor).

### Alterações em `src/pages/ReceiptCapture.tsx`

1. **Detectar ausência total de permissão de classificação:**
   ```
   const hasNoClassificationAccess = !canClassifyCost && !canClassifyExpense;
   ```

2. **Esconder o card de classificação** quando `hasNoClassificationAccess` é `true` — não mostrar botões Custo/Despesa nem categorias.

3. **Ajustar validação de submit:**
   - `canSubmit`: quando sem permissão de classificação, exigir apenas `receiptData.file` (sem classificação)
   - `handleSubmit`: pular validação de `classification` se `hasNoClassificationAccess`
   - Remover o botão "Salvar sem comprovante" para esse perfil (Caixa deve sempre anexar a foto)

4. **Mostrar aviso informativo** dizendo que a classificação será feita pelo gestor.

## Arquivo modificado

| Arquivo | Alteração |
|---|---|
| `src/pages/ReceiptCapture.tsx` | Permitir salvar sem classificação quando usuário não tem permissão |

