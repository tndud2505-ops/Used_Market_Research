import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const runnerRoot = dirname(fileURLToPath(import.meta.url));

const requiredFiles = [
  '.env.example',
  'README.md',
  'configure-ebay.cmd',
  'configure-ebay-credentials.ps1',
  'install-ebay-from-dpapi.ps1',
  'deploy-from-windows.ps1',
  'configure-tunnel.sh',
  'health-check.sh',
  'install-ubuntu24.sh',
  'install-ebay-credentials.sh',
  'nginx-retired-docker.conf',
  'rollback.sh',
  'runner.mjs',
  'update-release.sh',
  'used-market-global-runner.service',
  'used-market-global-tunnel.service'
];

for (const name of requiredFiles) {
  const body = await readFile(resolve(runnerRoot, name), 'utf8');
  assert.ok(body.trim(), `${name} must not be empty`);
}

const read = (name) => readFile(resolve(runnerRoot, name), 'utf8');
const [env, readme, configureEbayCmd, configureEbay, installEbay, configureTunnel, health, install, nginxRetired, rollback, update, service, tunnelService] = await Promise.all([
  read('.env.example'),
  read('README.md'),
  read('configure-ebay.cmd'),
  read('configure-ebay-credentials.ps1'),
  read('install-ebay-credentials.sh'),
  read('configure-tunnel.sh'),
  read('health-check.sh'),
  read('install-ubuntu24.sh'),
  read('nginx-retired-docker.conf'),
  read('rollback.sh'),
  read('update-release.sh'),
  read('used-market-global-runner.service'),
  read('used-market-global-tunnel.service')
]);

assert.match(env, /^PORT=8790$/m);
assert.match(env, /^NODE_ENV=production$/m);
assert.match(env, /^LOCAL_BROWSER_BINARY=\/usr\/bin\/chromium$/m);
assert.match(env, /^MERGE_RESULT_BASE=\/var\/lib\/used-market-global-runner\/results$/m);
assert.match(env, /^TRANSACTION_RESULT_BASE=\/var\/lib\/used-market-global-runner\/results\/transactions$/m);
assert.match(env, /^EBAY_CLIENT_ID=$/m);
assert.match(env, /^EBAY_CLIENT_SECRET=$/m);

assert.match(configureEbayCmd, /configure-ebay-credentials\.ps1/);
assert.match(configureEbay, /Read-Host 'Production App ID \(Client ID\)' -AsSecureString/);
assert.match(configureEbay, /Read-Host 'Production Cert ID \(Client Secret\)' -AsSecureString/);
assert.match(configureEbay, /install-ebay-credentials\.sh/);
assert.match(configureEbay, /Test-EbayProductionCredentials/);
assert.match(configureEbay, /api\.ebay\.com\/identity\/v1\/oauth2\/token/);
assert.match(configureEbay, /same Production keyset/);
const installEbayFromDpapi = await read('install-ebay-from-dpapi.ps1');
assert.match(installEbayFromDpapi, /Import-Clixml/);
assert.match(installEbayFromDpapi, /install-ebay-credentials\.sh/);
assert.match(installEbayFromDpapi, /ZeroFreeBSTR/);
assert.match(installEbayFromDpapi, /Remove-Item -LiteralPath \$HandoffPath/);
const deployFromWindows = await read('deploy-from-windows.ps1');
assert.match(deployFromWindows, /update-release\.sh/);
assert.match(deployFromWindows, /StrictHostKeyChecking=accept-new/);
assert.match(deployFromWindows, /RELEASE_ID=/);
assert.doesNotMatch(deployFromWindows, /docker|compose|system prune/i);
assert.doesNotMatch(configureEbay, /Set-Content|Out-File|Add-Content/);
assert.match(installEbay, /\/etc\/used-market-global-runner\/runner\.env/);
assert.match(installEbay, /EBAY_CLIENT_ID/);
assert.match(installEbay, /EBAY_CLIENT_SECRET/);
assert.match(installEbay, /previous environment restored/);
assert.match(installEbay, /"sites":\["ebay"\]/);
assert.match(installEbay, /collection_state === 'ready'/);
assert.match(installEbay, /collection_state === 'partial'/);
assert.match(installEbay, /source\?\.errors\?\.length/);
assert.doesNotMatch(installEbay, /set -x|echo.*client_secret/i);

assert.match(service, /^Description=Used Market Global Node Chromium Runner$/m);
assert.match(service, /^User=__RUNNER_USER__$/m);
assert.match(service, /^StateDirectory=used-market-global-runner$/m);
assert.match(service, /^WorkingDirectory=__APP_ROOT__\/current$/m);
assert.match(service, /^EnvironmentFile=__RUNNER_ENV_FILE__$/m);
assert.match(service, /^ExecStart=\/usr\/bin\/node __APP_ROOT__\/current\/aws-runner\/runner\.mjs$/m);
assert.match(service, /^Restart=on-failure$/m);
assert.match(service, /^NoNewPrivileges=true$/m);
assert.match(service, /^ProtectSystem=strict$/m);
assert.doesNotMatch(service, /docker|compose/i);

const runnerEntry = await read('runner.mjs');
assert.doesNotMatch(runnerEntry, /installLoopbackBinding|loopback-bind/);
assert.match(runnerEntry, /process\.env\.HOST = '127\.0\.0\.1'/);
assert.match(runnerEntry, /process\.env\.PUBLIC_API_ONLY = 'true'/);
assert.match(runnerEntry, /requires CLOUDFLARE_RUNNER_TOKEN/);
assert.match(runnerEntry, /dist\/web-backend\/logic\/index\.js/);
assert.doesNotMatch(update, /loopback-bind-contract|loopback-bind/);

assert.match(tunnelService, /^Description=Cloudflare Tunnel for Used Market Global Runner$/m);
assert.match(tunnelService, /^Requires=used-market-global-runner\.service$/m);
assert.match(tunnelService, /^ExecStart=\/usr\/bin\/cloudflared tunnel --no-autoupdate --url http:\/\/127\.0\.0\.1:8790 run --token-file __TUNNEL_TOKEN_FILE__$/m);
assert.match(tunnelService, /^User=__TUNNEL_USER__$/m);
assert.doesNotMatch(tunnelService, /docker|compose/i);

assert.match(install, /Ubuntu 24\.04/);
assert.match(install, /Node\.js 22/);
assert.match(install, /chromium/);
assert.match(install, /RUNNER_USER="\$\{RUNNER_USER:-usedglobalrunner\}"/);
assert.match(install, /APP_ROOT="\$\{APP_ROOT:-\/opt\/used-market-global-runner\}"/);
assert.match(install, /RUNNER_ENV_FILE="\$\{RUNNER_ENV_FILE:-\/etc\/used-market-global-runner\/runner\.env\}"/);
assert.match(install, /s\|__APP_ROOT__\|/);
assert.match(install, /s\|__RUNNER_ENV_FILE__\|/);
assert.match(install, /systemctl enable --now used-market-global-runner\.service/);
assert.match(install, /used-market-global-tunnel\.service/);
assert.match(install, /used-market-global-runner\.token/);
assert.match(install, /cloudflared/);
assert.match(install, /RUNNER_TOKEN="\$runner_token"/);
assert.match(install, /randomBytes\(32\)/);
assert.doesNotMatch(install, /docker|compose/i);

assert.match(configureTunnel, /TUNNEL_TOKEN_FILE="\$\{TUNNEL_TOKEN_FILE:-\/etc\/cloudflared\/used-market-global-runner\.token\}"/);
assert.match(configureTunnel, /systemctl enable --now used-market-global-tunnel\.service/);
assert.match(configureTunnel, /global-runner\.used-pick\.com/);
assert.match(configureTunnel, /store a non-empty token in the runner environment file/);
assert.match(configureTunnel, /\{1\.\.24\}/);
assert.match(configureTunnel, /RUN_SEARCH_SMOKE=false/);
assert.match(configureTunnel, /HEALTH_REQUEST_TIMEOUT=2/);

assert.match(nginxRetired, /return 308 https:\/\/global\.used-pick\.com\$request_uri;/);
assert.doesNotMatch(nginxRetired, /proxy_pass|8788|8790/);

assert.match(update, /releases_dir="\$\{app_root\}\/releases"/);
assert.match(update, /release_id="\$\{RELEASE_ID:-\$\(date -u \+%Y%m%dT%H%M%SZ\)\}"/);
assert.match(update, /npm ci/);
assert.match(update, /npm run build/);
assert.match(update, /npm prune --omit=dev/);
assert.match(update, /\/var\/lib\/used-market-global-runner\/results/);
assert.match(update, /merge\/result/);
assert.match(update, /systemctl restart used-market-global-runner\.service/);
assert.match(update, /health-check\.sh/);
assert.match(update, /RUN_SEARCH_SMOKE=false/);
assert.match(update, /HEALTH_REQUEST_TIMEOUT=2/);
assert.match(update, /restoring previous release/);
assert.doesNotMatch(update, /docker|compose/i);

assert.match(rollback, /\^\[0-9\]\{8\}T\[0-9\]\{6\}Z\$/);
assert.match(rollback, /Refusing target outside releases directory/);
assert.match(rollback, /systemctl restart used-market-global-runner\.service/);
assert.match(rollback, /health-check\.sh/);
assert.match(rollback, /\{1\.\.24\}/);
assert.match(rollback, /RUN_SEARCH_SMOKE=false/);
assert.match(rollback, /HEALTH_REQUEST_TIMEOUT=2/);
assert.doesNotMatch(rollback, /docker|compose/i);

assert.match(health, /http:\/\/127\.0\.0\.1:8790/);
assert.match(health, /\/global\/health/);
assert.match(health, /X-Used-Market-App/);
assert.match(health, /\/global\/\?country=jp/);
assert.match(health, /RUNNER_TOKEN:-\$\{CLOUDFLARE_RUNNER_TOKEN:-\}/);
assert.match(health, /Authorization: Bearer/);
assert.match(health, /\/global\/api\/categories/);
assert.match(health, /401/);
assert.match(health, /Rakuma Chromium search did not reach the ready state/);

for (const required of [
  '`/opt/used-market-global-runner`',
  '`used-market-global-runner.service`',
  '`usedglobalrunner`',
  '`/etc/used-market-global-runner/runner.env`',
  '`/var/lib/used-market-global-runner/results`',
  '`/etc/cloudflared/used-market-global-runner.token`',
  '`127.0.0.1:8790`',
  '`global-runner.used-pick.com`'
]) {
  assert.ok(readme.includes(required), `README missing ${required}`);
}

const boundaryFiles = (await readdir(runnerRoot)).filter((name) => name !== 'runner-contract.mjs');
for (const name of boundaryFiles) {
  const body = await read(name);
  assert.doesNotMatch(body, /apps[\\/]domestic|\.\.[\\/]domestic|used-market-domestic/i, `${name} crosses the global boundary`);
}

console.log(`global aws runner contract: ${requiredFiles.length} files and ${boundaryFiles.length} boundary files passed`);
