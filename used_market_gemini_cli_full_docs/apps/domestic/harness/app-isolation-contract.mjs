import assert from 'node:assert/strict';
import { lstat, readFile, realpath } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sibling = path.resolve(root, '..', 'global');
const required = ['package.json', 'package-lock.json', 'tsconfig.json', 'Dockerfile', 'docker-compose.yml', 'web-backend/public/index.html', 'web-backend/public/app.js', 'web-backend/public/styles.css'];

for (const relative of required) {
  const target = path.join(root, relative);
  assert.equal((await lstat(target)).isSymbolicLink(), false, `${relative} must be an owned file`);
  assert.ok((await realpath(target)).startsWith(root), `${relative} escaped domestic app root`);
}

const pkg = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
assert.equal(pkg.name, 'used-market-domestic');
assert.match(pkg.scripts.test, /^npm run build && node harness\//);
assert.doesNotMatch(JSON.stringify(pkg), /apps[\\/]global|\.\.[\\/]global|workspace:|file:|link:/);

const app = await readFile(path.join(root, 'web-backend/public/app.js'), 'utf8');
assert.match(app, /const APP_ID = 'domestic'/);
assert.match(app, /const MARKET_PROFILE = 'domestic'/);
assert.doesNotMatch(app, /PAGE_PARAMS\.get\(['"]market['"]\)/);
assert.match(app, /switchUrl: '\/global\/'/);

const sites = await readFile(path.join(root, 'collector/logic/sites.ts'), 'utf8');
for (const key of ['joonggonara', 'bunjang', 'daangn']) assert.match(sites, new RegExp(`key: ["']${key}["']`));
for (const key of ['mercari_jp', 'yahoo_auction_jp', 'rakuma', 'poshmark', 'vinted', 'unclaimed_baggage']) assert.doesNotMatch(sites, new RegExp(`key: ["']${key}["']`));

assert.notEqual(await realpath(root), await realpath(sibling));
console.log('domestic app isolation contract: 24 checks passed');
