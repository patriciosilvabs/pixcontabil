const fs = require('fs');
const path = require('path');

const versionFile = path.resolve(__dirname, '..', 'version.json');
const lastVersionFile = path.resolve(__dirname, '..', '.last-version');
const distDir = path.resolve(__dirname, '..', 'dist');

// 1. Verificar version.json
if (!fs.existsSync(versionFile)) {
  console.error('[validate-version] ERRO CRÍTICO: version.json não encontrado!');
  process.exit(1);
}

let versionData;
try {
  versionData = JSON.parse(fs.readFileSync(versionFile, 'utf8'));
} catch {
  console.error('[validate-version] ERRO CRÍTICO: version.json inválido!');
  process.exit(1);
}

const currentVersion = versionData.version;
console.log(`[validate-version] version.json = ${currentVersion}`);

// 2. Verificar .last-version (confirma que prebuild rodou)
if (!fs.existsSync(lastVersionFile)) {
  console.error('[validate-version] ERRO CRÍTICO: .last-version não encontrado — prebuild não rodou!');
  process.exit(1);
}

const lastVersion = fs.readFileSync(lastVersionFile, 'utf8').trim();
if (lastVersion !== currentVersion) {
  console.error(`[validate-version] ERRO: version.json (${currentVersion}) != .last-version (${lastVersion})`);
  process.exit(1);
}

// 3. Verificar que a versão está presente no bundle
if (!fs.existsSync(distDir)) {
  console.error('[validate-version] ERRO CRÍTICO: diretório dist/ não encontrado!');
  process.exit(1);
}

const versionString = `v${currentVersion}`;
const jsFiles = fs.readdirSync(path.join(distDir, 'assets')).filter(f => f.endsWith('.js'));

let found = false;
for (const file of jsFiles) {
  const content = fs.readFileSync(path.join(distDir, 'assets', file), 'utf8');
  if (content.includes(versionString)) {
    found = true;
    break;
  }
}

if (!found) {
  console.error(`[validate-version] ERRO CRÍTICO: "${versionString}" não encontrada no bundle dist/!`);
  process.exit(1);
}

console.log(`[validate-version] ✅ Build válido — ${versionString} confirmada no bundle`);
