

## Versionamento Automático v1.0, v1.1, v1.2...

### Estado atual

O projeto **já possui** um sistema de versionamento automático funcional:
- `version.json` → fonte de verdade (`"1.1.3"`)
- `scripts/bump-version.cjs` → incrementa automaticamente no `prebuild`
- `vite.config.ts` → injeta `__APP_VERSION__` no build
- `src/constants/app.ts` → exporta `APP_VERSION`
- Exibido no header mobile, sidebar desktop e console log

### O que precisa mudar

O formato atual é `v1.1.3` (3 segmentos). O usuário quer **2 segmentos**: `v1.0 → v1.1 → v1.2...`

### Alterações

**1. `version.json`** — mudar para formato de 2 segmentos:
```json
{ "version": "1.3" }
```

**2. `scripts/bump-version.cjs`** — já funciona com qualquer quantidade de segmentos (incrementa o último). Adicionar validação que **falha o build** se o arquivo não existir ou formato for inválido:
```javascript
if (parts.length !== 2) {
  console.error('Formato inválido. Esperado: X.Y');
  process.exit(1);
}
```

**3. `src/constants/app.ts`** — atualizar fallback para `"v1.3"`

**4. Endpoint `/version`** — criar edge function `version` que retorna:
```json
{ "version": "v1.3", "build_date": "...", "build_hash": "..." }
```
Acessível via `/functions/v1/version`.

**5. Página Settings** — adicionar seção com versão, data do build e hash no final da página de Configurações para consulta fácil pelo admin.

### Onde a versão aparece em produção
- Header mobile (barra verde)
- Sidebar desktop (rodapé)
- Console do navegador
- Página de Configurações
- Endpoint `/functions/v1/version`

