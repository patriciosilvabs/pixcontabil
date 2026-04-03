

## Versionamento Automático Incremental

### Contexto

No ambiente Lovable, não há controle sobre pipelines CI/CD ou tags Git. A abordagem mais confiável é usar um **script pré-build** que lê um arquivo `version.json`, incrementa o minor, e injeta os valores no build via Vite `define`.

### Alterações

**1. Criar `version.json`** (raiz do projeto)
```json
{ "version": "1.1.3" }
```
Fonte de verdade centralizada. Será lido e incrementado pelo script pré-build.

**2. Criar `scripts/bump-version.js`**
- Lê `version.json`, incrementa o minor (1.1.3 → 1.1.4)
- Salva de volta no `version.json`
- Imprime a nova versão no console

**3. Atualizar `package.json` scripts**
```json
"prebuild": "node scripts/bump-version.js",
"build": "vite build"
```
O `prebuild` roda automaticamente antes de cada `build`, garantindo incremento sem ação manual.

**4. Atualizar `vite.config.ts`**
- Ler `version.json` no topo do config
- Usar `define` para injetar variáveis globais no build:
  - `__APP_VERSION__` → `"v1.1.4"`
  - `__BUILD_DATE__` → data ISO do build
  - `__BUILD_HASH__` → hash curto (baseado em timestamp, já que não temos Git no build)

**5. Atualizar `src/constants/app.ts`**
```typescript
declare const __APP_VERSION__: string;
declare const __BUILD_DATE__: string;

export const APP_VERSION = typeof __APP_VERSION__ !== 'undefined' 
  ? __APP_VERSION__ : "v1.1.3";
export const BUILD_DATE = typeof __BUILD_DATE__ !== 'undefined'
  ? __BUILD_DATE__ : new Date().toISOString();
```
Em dev (sem build), usa fallback. Em produção, usa valores injetados.

**6. Onde a versão aparece** (já existente, sem mudanças necessárias)
- Header mobile (sub-bar verde)
- Sidebar desktop (rodapé)
- Console log ao iniciar a aplicação (adicionar em `src/main.tsx`)

**7. Log no console** — Adicionar em `src/main.tsx`:
```typescript
console.log(`[PixContábil] ${APP_VERSION} | Build: ${BUILD_DATE}`);
```

### Limitação importante

No ambiente Lovable, o build é gerenciado pela plataforma. O script `prebuild` roda automaticamente em deploys via `npm run build`. Durante desenvolvimento no editor Lovable (que usa `vite dev`), a versão não incrementa — só incrementa no build de produção/publish, que é o comportamento correto.

### Sequência de exemplo
```
v1.1.3 → v1.1.4 → v1.1.5 → v1.1.6 ...
```

