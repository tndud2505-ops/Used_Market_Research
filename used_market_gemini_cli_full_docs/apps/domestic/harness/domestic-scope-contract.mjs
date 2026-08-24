import assert from 'node:assert/strict';
import { lstat, readFile, realpath } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const required = [
  'package.json',
  'package-lock.json',
  'tsconfig.json',
  'Dockerfile',
  'docker-compose.yml',
  'web-backend/public/index.html',
  'web-backend/public/app.js',
  'web-backend/public/styles.css'
];

for (const relative of required) {
  const target = path.join(root, relative);
  assert.equal((await lstat(target)).isSymbolicLink(), false, `${relative} must be an owned file`);
  assert.ok((await realpath(target)).startsWith(root), `${relative} escaped app root`);
}

const pkg = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
assert.equal(pkg.name, 'used-market-domestic');
assert.match(pkg.scripts.test, /^npm run build && node harness\//u);
assert.doesNotMatch(JSON.stringify(pkg), /workspace:|file:|link:/u);

const app = await readFile(path.join(root, 'web-backend/public/app.js'), 'utf8');
assert.match(app, /const APP_ID = 'domestic'/u);
assert.match(app, /const DEFAULT_SITES = \['joonggonara', 'bunjang', 'hellomarket', 'rethinkmall', 'ebay'\]/u);

console.log('domestic scope contract: 16 checks passed');
