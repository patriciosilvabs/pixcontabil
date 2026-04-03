

## Trava Técnica de Versionamento — Reforço

### Estado atual

O projeto **já possui** todo o sistema solicitado funcionando:

| Componente | Arquivo | Status |
|---|---|---|
| Fonte da verdade | `version.json` (`"1.3"`) | ✅ Existe |
| Script de incremento | `scripts/bump-version.cjs` | ✅ Existe, valida formato X.Y, falha se ausente/inválido |
| Hook no build | `package.json` → `"prebuild"` | ✅ Roda antes de todo `npm run build` |
| Injeção no app | `vite.config.ts` → `define` | ✅ Injeta `__APP_VERSION__`, `__BUILD_DATE__`, `__BUILD_HASH__` |
| Exibição na UI | Header mobile, Sidebar desktop, Configurações | ✅ Mostra versão |
| Console log | `src/main.tsx` | ✅ Loga versão no boot |
| Endpoint `/version` | `supabase/functions/version/index.ts` | ✅ Retorna JSON com versão |

### O que falta: validação pós-build

O sistema atual incrementa e falha se o arquivo for inválido, mas **não valida que o artefato final contém a versão correta**. Vou adicionar uma camada extra de segurança:

### Alterações

**1. `scripts/bump-version.cjs`** — adicionar log mais explícito com versão anterior e nova, e gravar um arquivo `.last-version` para validação posterior:
```
v1.3 → v1.4  (grava "1.4" em .last-version)
```

**2. Criar `scripts/validate-version.cjs`** — script pós-build que:
- Lê `version.json` e `.last-version`
- Confirma que coincidem (prebuild rodou)
- Verifica que o `dist/` contém a string da versão no bundle
- Se qualquer check falhar → `process.exit(1)` (build considerado inválido)

**3. `package.json`** — adicionar script `postbuild`:
```json
"postbuild": "node scripts/validate-version.cjs"
```

**4. Atualizar `supabase/functions/version/index.ts`** — sincronizar a versão hardcoded com a versão atual do `version.json` (v1.3). Nota: essa edge function retorna versão estática; será atualizada para refletir a versão corrente.

**5. Adicionar `version.json` e `.last-version` ao `.gitignore`** — NÃO. `version.json` deve ser commitado. Apenas `.last-version` será ignorado (artefato temporário de build).

### Fluxo completo garantido

```text
npm run build
  │
  ├─ prebuild: bump-version.cjs
  │   ├─ Lê version.json (1.3)
  │   ├─ Incrementa → 1.4
  │   ├─ Grava version.json (1.4)
  │   ├─ Grava .last-version (1.4)
  │   └─ Se falhar → exit(1) → BUILD ABORTADO
  │
  ├─ vite build
  │   ├─ Lê version.json (1.4)
  │   ├─ Injeta __APP_VERSION__ = "v1.4"
  │   └─ Se version.json ausente → erro de leitura → BUILD ABORTADO
  │
  └─ postbuild: validate-version.cjs
      ├─ Confirma version.json == .last-version
      ├─ Busca "v1.4" no bundle dist/
      └─ Se falhar → exit(1) → BUILD INVÁLIDO
```

### Onde conferir a versão em produção
- **UI**: Header mobile (barra verde) · Sidebar desktop (rodapé) · Página Configurações
- **Console**: Log automático no boot do app
- **API**: `GET /functions/v1/version`

### Arquivos criados/alterados
- `scripts/bump-version.cjs` — pequeno ajuste (gravar `.last-version`)
- `scripts/validate-version.cjs` — **novo** (validação pós-build)
- `package.json` — adicionar `postbuild`
- `supabase/functions/version/index.ts` — atualizar versão estática

