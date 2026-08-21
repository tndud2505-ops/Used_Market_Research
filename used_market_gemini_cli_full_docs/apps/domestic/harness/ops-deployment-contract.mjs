import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const read = (relativePath) => readFile(path.join(root, relativePath), 'utf8');

const compose = await read('docker-compose.yml');
assert.match(compose, /^name:\s*used-market-global/m, 'Compose project name must be stable across releases');
assert.match(compose, /restart:\s*unless-stopped/, 'Container must restart after host reboot');
assert.match(compose, /cpus:\s*1\.5/, 'CPU ceiling is required on the shared host');
assert.match(compose, /mem_limit:\s*2300m/, 'Container memory limit is required');
assert.match(compose, /memswap_limit:\s*2800m/, 'Container memory+swap ceiling is required');
assert.match(compose, /pids_limit:\s*384/, 'PID limit is required');
assert.match(compose, /max-old-space-size=1100/, 'Node heap must leave room for Chromium');
for (const setting of [
  /PUBLIC_API_ONLY:\s*["']true["']/,
  /SEARCH_CONCURRENCY_LIMIT:\s*["']1["']/,
  /SEARCH_RETRY_AFTER_SECONDS:\s*["']5["']/,
  /SEARCH_MAX_WORK_UNITS:\s*["']12["']/,
  /SEARCH_CACHE_TTL_SECONDS:\s*["']120["']/,
  /SEARCH_CACHE_MAX_ENTRIES:\s*["']32["']/,
]) assert.match(compose, setting, `Missing production setting ${setting}`);
assert.match(compose, /no-new-privileges:true/, 'Privilege escalation must be disabled');
assert.match(compose, /cap_drop:\s*\n\s*- ALL/, 'Linux capabilities must be dropped');
assert.match(compose, /read_only:\s*true/, 'Root filesystem must be read-only');
assert.match(compose, /logging:\s*\n\s*driver:\s*json-file/, 'Docker logging driver must be explicit');
assert.match(compose, /max-size:\s*["']10m["']/, 'Docker logs must be size-limited');
assert.match(compose, /max-file:\s*["']5["']/, 'Docker logs must be rotated');
assert.match(compose, /name:\s*used-market-global_used-market-results/, 'Result volume must preserve the existing server data and survive release directory changes');

const nginx = [
  await read('deploy/nginx-used-market.conf'),
  await read('deploy/nginx-used-market-routes.conf'),
  await read('deploy/nginx-security-headers.conf'),
].join('\n');
assert.match(nginx, /limit_req_status\s+429;/, 'Rate limiting must return 429');
assert.match(nginx, /limit_conn_status\s+429;/, 'Concurrency limiting must return 429');
assert.match(nginx, /Retry-After/, '429 response must include Retry-After');
assert.match(nginx, /Content-Security-Policy/, 'CSP header is required');
assert.match(nginx, /X-Robots-Tag\s+"noindex, nofollow, noarchive"/, 'Bare IP deployment must not be indexed');
assert.doesNotMatch(nginx, /Strict-Transport-Security/, 'HSTS must not be sent by the HTTP-only IP server');
assert.match(nginx, /\$request_method\s+!~\s+\^\(GET\|HEAD\)\$/, 'GET endpoints must support HEAD and reject writes');
assert.match(nginx, /\$request_method\s+!=\s+POST/, 'Search endpoint must reject non-POST methods');

const tls = await read('deploy/nginx-used-market-tls.conf.template');
assert.match(tls, /listen\s+443\s+ssl/, 'TLS template must listen on 443');
assert.match(tls, /Strict-Transport-Security/, 'HSTS is required on TLS server only');
assert.match(tls, /server_name\s+__DOMAIN__/, 'TLS template must require an explicit domain');
assert.doesNotMatch(tls, /X-Robots-Tag\s+"noindex/, 'Domain template should allow search indexing');

const logrotate = await read('deploy/logrotate-used-market');
assert.match(logrotate, /daily/);
assert.match(logrotate, /rotate\s+14/);
assert.match(logrotate, /compress/);

for (const script of ['install.sh', 'update.sh', 'rollback.sh', 'health-smoke.sh', 'retention.sh']) {
  const source = await read(`deploy/${script}`);
  assert.match(source, /^#!\/usr\/bin\/env bash/, `${script} must be executable with bash`);
  assert.match(source, /set -Eeuo pipefail/, `${script} must fail safely`);
}

const deployment = await read('DEPLOYMENT.md');
for (const term of ['Ubuntu 24.04', 'rollback.sh', 'health-smoke.sh', 'certbot', 'DNS', '429']) {
  assert.ok(deployment.includes(term), `DEPLOYMENT.md must cover ${term}`);
}

console.log('ops deployment contract: ok');
