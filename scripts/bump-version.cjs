const fs = require('fs');
const path = require('path');

const versionFile = path.resolve(__dirname, '..', 'version.json');

const data = JSON.parse(fs.readFileSync(versionFile, 'utf8'));
const parts = data.version.split('.').map(Number);

if (parts.length < 2) {
  console.error('Invalid version format:', data.version);
  process.exit(1);
}

parts[parts.length - 1] += 1;
data.version = parts.join('.');

fs.writeFileSync(versionFile, JSON.stringify(data, null, 2) + '\n');
console.log(`[bump-version] ${data.version}`);
