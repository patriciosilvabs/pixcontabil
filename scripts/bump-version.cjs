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

parts[1] += 1;
data.version = parts.join('.');

fs.writeFileSync(versionFile, JSON.stringify(data, null, 2) + '\n');
console.log(`[bump-version] v${data.version}`);
