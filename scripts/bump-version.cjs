const fs = require('fs');
const path = require('path');

const versionFile = path.resolve(__dirname, '..', 'version.json');

if (!fs.existsSync(versionFile)) {
  console.error('[bump-version] ERRO CRÍTICO: version.json não encontrado!');
  process.exit(1);
}

const raw = fs.readFileSync(versionFile, 'utf8');
let data;
try {
  data = JSON.parse(raw);
} catch {
  console.error('[bump-version] ERRO CRÍTICO: version.json inválido!');
  process.exit(1);
}

const parts = data.version.split('.').map(Number);

if (parts.length !== 2 || parts.some(isNaN)) {
  console.error('[bump-version] Formato inválido. Esperado: X.Y — encontrado:', data.version);
  process.exit(1);
}

const oldVersion = data.version;
parts[1] += 1;
data.version = parts.join('.');

fs.writeFileSync(versionFile, JSON.stringify(data, null, 2) + '\n');

// Gravar .last-version para validação pós-build
const lastVersionFile = path.resolve(__dirname, '..', '.last-version');
fs.writeFileSync(lastVersionFile, data.version);

console.log(`[bump-version] v${oldVersion} → v${data.version}`);
