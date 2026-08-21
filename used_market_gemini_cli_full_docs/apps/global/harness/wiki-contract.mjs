import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const wikiPath = path.join(root, 'docs', 'WIKI.md');
const worklogPath = path.join(root, 'docs', 'worklog', '2026-08-19-cloudflare-release.md');
const linkedPaths = [
  'README.md',
  'USER_MANUAL.md',
  'DEPLOYMENT.md',
  'docs/APP_SCOPE.md',
  'harness/README.md',
  'harness/foreign-site-contract.mjs',
  'harness/foreign-ui-contract.mjs',
  'harness/foreign-english-ui-contract.mjs',
  'harness/ebay-api-contract.mjs',
  'harness/us-search-policy-contract.mjs',
  'harness/us-search-matrix-live.mjs',
  'harness/ops-deployment-contract.mjs',
  'web-backend/public/app.js',
  'collector/logic/sites.ts',
  'cloudflare/wrangler.jsonc',
  'cloudflare/harness.mjs',
  'aws-runner/used-market-global-runner.service',
  'aws-runner/runner-contract.mjs',
  'harness/cloudflare-runner-boundary-contract.mjs'
];

for (const relative of linkedPaths) await access(path.join(root, relative));

const [wiki, worklog, app, sites, wrangler, service, runnerEntry, pkgText] = await Promise.all([
  readFile(wikiPath, 'utf8'),
  readFile(worklogPath, 'utf8'),
  readFile(path.join(root, 'web-backend/public/app.js'), 'utf8'),
  readFile(path.join(root, 'collector/logic/sites.ts'), 'utf8'),
  readFile(path.join(root, 'cloudflare/wrangler.jsonc'), 'utf8'),
  readFile(path.join(root, 'aws-runner/used-market-global-runner.service'), 'utf8'),
  readFile(path.join(root, 'aws-runner/runner.mjs'), 'utf8'),
  readFile(path.join(root, 'package.json'), 'utf8')
]);
const pkg = JSON.parse(pkgText);

for (const heading of [
  '# USED MARKET Global Wiki',
  '## Current Scope',
  '## Marketplace Matrix',
  '## Search And UI Contracts',
  '## Deployment Boundary',
  '## Source Policy And Risks',
  '## Decision Log',
  '## Verification Map',
  '## Open Work'
]) assert.match(wiki, new RegExp(heading.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));

const internalSites = ['mercari_jp', 'yahoo_auction_jp', 'rakuma', 'ebay', 'poshmark', 'vinted', 'unclaimed_baggage'];
for (const key of internalSites) {
  assert.match(sites, new RegExp(`key: ["']${key}["']`));
  assert.match(wiki, new RegExp(`\\b${key}\\b`));
}

assert.match(app, /sites:\s*\['ebay',\s*'poshmark',\s*'vinted',\s*'unclaimed_baggage'\]/);
assert.match(sites, /key:\s*["']ebay["']/);
assert.match(wiki, /eBay[^\n]+Browse API/i);
assert.match(wiki, /Production Client ID and Client Secret/i);
assert.match(wiki, /marketplace-account-deletion subscription/i);
assert.match(wiki, /global\/api\/ebay\/account-deletion/i);
assert.match(wiki, /not written to D1 response cache or runner market-result storage/i);
assert.match(wiki, /Facebook Marketplace[^\n]+not implemented/i);
assert.match(wiki, /Mercari US[^\n]+not implemented/i);
assert.match(wiki, /three queries × four sources/i);
assert.match(wiki, /does not persist listing titles, URLs, sellers, eBay item IDs, or raw response bodies/i);
assert.match(wiki, /Vinted and Unclaimed Baggage cursors preserve within-page offsets/i);
assert.match(wiki, /Price controls apply to the collected window/i);

assert.match(wrangler, /"name": "used-market-global"/);
assert.match(wrangler, /"database_name": "used-market-global-free"/);
assert.match(wrangler, /"pattern": "global\.used-pick\.com"/);
assert.match(runnerEntry, /process\.env\.HOST = '127\.0\.0\.1'/);
assert.match(runnerEntry, /process\.env\.PORT = port/);
assert.match(runnerEntry, /port !== '8790'/);
assert.match(service, /MemoryMax=1800M/);
for (const required of ['`/global/`', '`/global/api`', '`127.0.0.1:8790`', '`/var/lib/used-market-global-runner/results`']) {
  assert.ok(wiki.includes(required), `wiki is missing deployment boundary ${required}`);
}

assert.match(pkg.scripts.test, /node harness\/wiki-contract\.mjs/);
assert.match(wiki, /`npm test`/);
assert.match(wiki, /`npm run test:ui`/);
assert.match(worklog, /^# 2026-08-19 Cloudflare Production Release/m);
assert.match(worklog, /48[^\n]+132[^\n]+English/i);
assert.match(worklog, /Rakuma search returned 26/);

for (const relative of linkedPaths) {
  assert.ok(wiki.includes(`\`${relative}\``), `wiki must route readers to ${relative}`);
}

const combinedDocs = `${wiki}\n${worklog}`;
for (const secretPattern of [
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
  /AKIA[0-9A-Z]{16}/,
  /AIza[0-9A-Za-z_-]{35}/,
  /(?:api[_-]?key|secret|token)\s*[:=]\s*["'][^"']{8,}["']/i
]) assert.doesNotMatch(combinedDocs, secretPattern);

console.log(`global wiki contract: ${internalSites.length} internal sources, 0 external sources, ${linkedPaths.length} routed paths passed`);
