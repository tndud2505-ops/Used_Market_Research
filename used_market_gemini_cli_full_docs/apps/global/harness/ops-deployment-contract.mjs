import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const read = (relativePath) => readFile(path.join(root, relativePath), 'utf8');

const compose = await read('docker-compose.yml');
assert.match(compose, /^name:\s*used-market-global-app/m);
assert.match(compose, /127\.0\.0\.1:8788:8787/);
assert.match(compose, /restart:\s*unless-stopped/);
assert.match(compose, /cpus:\s*0\.9/);
assert.match(compose, /mem_limit:\s*1800m/);
assert.match(compose, /memswap_limit:\s*2200m/);
assert.match(compose, /pids_limit:\s*320/);
assert.match(compose, /max-old-space-size=900/);
for (const setting of [
  /PUBLIC_API_ONLY:\s*["']true["']/,
  /SEARCH_CONCURRENCY_LIMIT:\s*["']1["']/,
  /SEARCH_RETRY_AFTER_SECONDS:\s*["']5["']/,
  /SEARCH_MAX_WORK_UNITS:\s*["']12["']/,
  /SEARCH_CACHE_TTL_SECONDS:\s*["']120["']/,
  /SEARCH_CACHE_MAX_ENTRIES:\s*["']32["']/,
]) assert.match(compose, setting, `Missing production setting ${setting}`);
assert.match(compose, /no-new-privileges:true/);
assert.match(compose, /cap_drop:\s*\n\s*- ALL/);
assert.match(compose, /read_only:\s*true/);
assert.match(compose, /logging:\s*\n\s*driver:\s*json-file/);
assert.match(compose, /max-size:\s*["']10m["']/);
assert.match(compose, /max-file:\s*["']5["']/);
assert.match(compose, /name:\s*used-market-global_results/);

const nginx = await read('deploy/nginx-global-only.conf');
assert.match(nginx, /location = \/\s*\{\s*return 308 \/global\/\?country=jp;/s);
assert.match(nginx, /limit_req_zone \$binary_remote_addr zone=used_market_global_search_ip:10m rate=10r\/m;/);
assert.match(nginx, /limit_req_zone \$binary_remote_addr zone=used_market_global_refresh_ip:10m rate=30r\/m;/);
assert.match(nginx, /limit_conn_zone \$server_name zone=used_market_global_search_host:10m;/);
assert.match(nginx, /limit_req_status 429;/);
assert.match(nginx, /limit_conn_status 429;/);
assert.match(nginx, /add_header Retry-After "15" always;/);
assert.match(nginx, /access_log \/var\/log\/nginx\/used-market-global\.access\.log;/);
assert.match(nginx, /error_log \/var\/log\/nginx\/used-market-global\.error\.log warn;/);
assert.match(nginx, /add_header Cache-Control "no-store" always;/);
assert.match(nginx, /location = \/global\/health\s*\{[\s\S]*?proxy_pass http:\/\/127\.0\.0\.1:8788;/);
assert.match(nginx, /location = \/global\/api\/categories\s*\{[\s\S]*?\$request_method !~ \^\(GET\|HEAD\)\$[\s\S]*?proxy_pass http:\/\/127\.0\.0\.1:8788;/);
assert.match(nginx, /location = \/global\/api\/search\s*\{[\s\S]*?\$request_method != POST[\s\S]*?limit_req zone=used_market_global_search_ip burst=2 nodelay;[\s\S]*?limit_conn used_market_global_search_host 1;[\s\S]*?proxy_read_timeout 180s;/);
assert.match(nginx, /location \^~ \/global\/api\/search\/refresh\/\s*\{[\s\S]*?\$request_method !~ \^\(GET\|HEAD\)\$[\s\S]*?limit_req zone=used_market_global_refresh_ip burst=5 nodelay;/);
assert.match(nginx, /location \^~ \/global\/api\/\s*\{\s*return 404;/s);
assert.match(nginx, /location \^~ \/api\s*\{\s*return 404;/s);
assert.match(nginx, /location \^~ \/health\/\s*\{\s*return 404;/s);
assert.match(nginx, /location \^~ \/global\/\s*\{[\s\S]*?proxy_pass http:\/\/127\.0\.0\.1:8788;/);
assert.match(nginx, /location = \/health\s*\{\s*return 404;/s);
assert.match(nginx, /X-Robots-Tag "noindex, nofollow, noarchive"/);
assert.doesNotMatch(nginx, /Strict-Transport-Security/);

const securityHeaders = await read('deploy/nginx-global-security-headers.conf');
assert.match(securityHeaders, /Content-Security-Policy/);
assert.match(securityHeaders, /Permissions-Policy/);
assert.match(securityHeaders, /X-Content-Type-Options "nosniff"/);
assert.match(securityHeaders, /X-Frame-Options "DENY"/);
const proxyParams = await read('deploy/nginx-global-proxy-params.conf');
assert.match(proxyParams, /proxy_http_version 1\.1/);
assert.match(proxyParams, /proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for/);
assert.match(proxyParams, /proxy_set_header X-Forwarded-Proto \$scheme/);

const retentionService = await read('deploy/used-market-global-retention.service');
assert.match(retentionService, /ExecStart=\/opt\/used-market-global\/current\/deploy\/retention\.sh/);
const retentionTimer = await read('deploy/used-market-global-retention.timer');
assert.match(retentionTimer, /OnCalendar=daily/);
assert.match(retentionTimer, /Persistent=true/);
assert.match(retentionTimer, /Unit=used-market-global-retention\.service/);

for (const script of ['install.sh', 'update.sh', 'rollback.sh', 'health-smoke.sh', 'retention.sh']) {
  const source = await read(`deploy/${script}`);
  assert.match(source, /^#!\/usr\/bin\/env bash/);
  assert.match(source, /set -Eeuo pipefail/);
}

const install = await read('deploy/install.sh');
assert.match(install, /nginx-global-only\.conf/);
assert.match(install, /nginx-global-security-headers\.conf/);
assert.match(install, /nginx-global-proxy-params\.conf/);
assert.match(install, /systemctl disable --now used-market-retention\.timer/);
assert.match(install, /systemctl enable --now used-market-global-retention\.timer/);

const deployment = await read('DEPLOYMENT.md');
for (const term of ['Ubuntu 24.04', 'rollback.sh', 'global.used-pick.com', 'used-market-global-free', '127.0.0.1:8790', 'Retired Docker deployment']) {
  assert.ok(deployment.includes(term), `DEPLOYMENT.md must cover ${term}`);
}

console.log('global operations deployment contract: passed');
