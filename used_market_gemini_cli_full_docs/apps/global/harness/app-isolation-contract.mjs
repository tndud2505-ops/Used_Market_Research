import assert from 'node:assert/strict';
import { lstat, readFile, readdir, realpath } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const siblingName = ['dom', 'estic'].join('');
const sibling = path.resolve(root, '..', siblingName);
const required = ['package.json', 'package-lock.json', 'tsconfig.json', 'Dockerfile', 'docker-compose.yml', 'web-backend/public/index.html', 'web-backend/public/app.js', 'web-backend/public/styles.css'];

for (const relative of required) {
  const target = path.join(root, relative);
  assert.equal((await lstat(target)).isSymbolicLink(), false, `${relative} must be an owned file`);
  assert.ok((await realpath(target)).startsWith(root), `${relative} escaped global app root`);
}

const pkg = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
assert.equal(pkg.name, 'used-market-global');
assert.match(pkg.scripts.test, /^npm run build && node harness\//);
assert.doesNotMatch(JSON.stringify(pkg), new RegExp(`apps[\\\\/]${siblingName}|\\.\\.[\\\\/]${siblingName}|workspace:|file:|link:`));

const app = await readFile(path.join(root, 'web-backend/public/app.js'), 'utf8');
assert.match(app, /const APP_ID = 'global'/);
assert.match(app, /const GLOBAL_MARKET = \{/);
assert.doesNotMatch(app, /PAGE_PARAMS\.get\(['"]market['"]\)/);
assert.match(app, /const API_BASE_PATH = '\/global\/api'/);

const sites = await readFile(path.join(root, 'collector/logic/sites.ts'), 'utf8');
for (const key of ['mercari_jp', 'yahoo_auction_jp', 'rakuma', 'ebay', 'poshmark', 'vinted', 'unclaimed_baggage']) assert.match(sites, new RegExp(`key: ["']${key}["']`));
for (const key of [['joong', 'gonara'].join(''), ['bun', 'jang'].join(''), ['daa', 'ngn'].join('')]) {
  assert.doesNotMatch(sites, new RegExp(`key: ["']${key}["']`));
}

const forbiddenReferences = [
  siblingName,
  '\uAD6D\uB0B4',
  ['bun', 'jang'].join(''),
  ['joong', 'gonara'].join(''),
  ['hello', 'market'].join(''),
  ['re', 'think'].join(''),
  ['daa', 'ngn'].join(''),
  ['market=', siblingName].join(''),
  ['87', '89'].join(''),
  ['Korea', ' Search'].join(''),
];
const scanRoots = ['harness', 'docs', 'deploy'];
const textExtensions = new Set(['.conf', '.html', '.js', '.json', '.md', '.mjs', '.service', '.sh', '.timer', '.txt', '.yaml', '.yml']);
const scanFiles = [];

async function collectTextFiles(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) await collectTextFiles(target);
    else if (entry.isFile() && textExtensions.has(path.extname(entry.name))) scanFiles.push(target);
  }
}

for (const directory of scanRoots) await collectTextFiles(path.join(root, directory));
for (const entry of await readdir(root, { withFileTypes: true })) {
  if (entry.isFile() && path.extname(entry.name) === '.md') scanFiles.push(path.join(root, entry.name));
}

for (const target of scanFiles) {
  const relative = path.relative(root, target);
  const content = (await readFile(target, 'utf8')).toLowerCase();
  for (const forbidden of forbiddenReferences) {
    assert.equal(content.includes(forbidden.toLowerCase()), false, `${relative} contains forbidden global-app reference: ${forbidden}`);
  }
}

assert.notEqual(await realpath(root), await realpath(sibling));
console.log(`global app isolation contract: 28 structural checks plus ${scanFiles.length} boundary files passed`);
