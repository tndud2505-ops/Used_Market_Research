import { spawn } from 'node:child_process';

const PUBLIC_URL = (process.env.CLOUDFLARE_PUBLIC_URL || 'https://used-pick.com').replace(/\/$/, '');
const PUBLIC_ALIASES = Array.from(new Set([
  PUBLIC_URL,
  'https://www.used-pick.com'
]));
const APP_ONLY = process.argv.includes('--app-only');
const HEALTH_ATTEMPTS = 12;
const HEALTH_DELAY_MS = 2_500;

function executable(name) {
  if (name === 'node') return process.execPath;
  return process.platform === 'win32' ? `${name}.cmd` : name;
}

function run(label, command, args) {
  return new Promise((resolve, reject) => {
    console.log(`\n[release] ${label}`);
    const child = spawn(executable(command), args, {
      cwd: process.cwd(),
      stdio: ['ignore', 'inherit', 'inherit'],
      env: { ...process.env, CI: process.env.CI || '1' },
      shell: process.platform === 'win32' && command !== 'node'
    });

    child.once('error', reject);
    child.once('exit', (code, signal) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`${label} failed${signal ? ` (${signal})` : ` with exit code ${code ?? 1}`}`));
    });
  });
}

function capture(label, command, args) {
  return new Promise((resolve, reject) => {
    console.log(`\n[release] ${label}`);
    const child = spawn(executable(command), args, {
      cwd: process.cwd(),
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, CI: process.env.CI || '1' },
      shell: process.platform === 'win32' && command !== 'node'
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.once('error', reject);
    child.once('exit', (code) => code === 0
      ? resolve(stdout)
      : reject(new Error(`${label} failed with exit code ${code ?? 1}: ${stderr.trim()}`)));
  });
}

async function currentProductionVersion() {
  const output = await capture('Resolve exact current Worker deployment', 'npx', [
    'wrangler', 'deployments', 'status', '--config', 'cloudflare/wrangler.jsonc', '--json'
  ]);
  const status = JSON.parse(output);
  const versions = Array.isArray(status?.versions) ? status.versions : [];
  const fullyDeployed = versions.filter((version) => Number(version.percentage) === 100);
  if (fullyDeployed.length !== 1 || !fullyDeployed[0].version_id) {
    throw new Error('Current Worker deployment is not a single exact 100% version');
  }
  return String(fullyDeployed[0].version_id);
}

async function verifyRollbackRestored(expectedVersion) {
  const restoredVersion = await currentProductionVersion();
  if (restoredVersion !== expectedVersion) {
    throw new Error(`Rollback restored ${restoredVersion}, expected ${expectedVersion}`);
  }
  for (const baseUrl of PUBLIC_ALIASES) {
    const response = await fetch(`${baseUrl}/health`, { headers: { accept: 'application/json' } });
    if (!response.ok) throw new Error(`${baseUrl}/health failed after rollback with HTTP ${response.status}`);
  }
}

function wait(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function checkPublicSite(baseUrl) {
  const healthResponse = await fetch(`${baseUrl}/health`, {
    headers: { accept: 'application/json' }
  });
  if (!healthResponse.ok) {
    throw new Error(`${baseUrl}/health returned HTTP ${healthResponse.status}`);
  }

  const health = await healthResponse.json();
  if (health.ok !== true) {
    throw new Error(`${baseUrl}/health did not report ok=true`);
  }

  const homeResponse = await fetch(`${baseUrl}/?release_check=${Date.now()}`);
  if (!homeResponse.ok) {
    throw new Error(`${baseUrl}/ returned HTTP ${homeResponse.status}`);
  }
  const home = await homeResponse.text();
  if (!home.includes('<title>중고 PC·컴퓨터 부품 검색 | 중고 시세 비교 | USED PICK</title>')
    || /link\.coupang\.com|ads-partners\.coupang\.com|data-coupang/u.test(home)) {
    throw new Error(`${baseUrl}/ did not return the PC-only trusted shell`);
  }
  for (const [name, expected] of [
    ['content-security-policy', /default-src/u],
    ['strict-transport-security', /max-age=/u],
    ['x-content-type-options', /nosniff/u]
  ]) {
    if (!expected.test(homeResponse.headers.get(name) || '')) throw new Error(`${baseUrl}/ missing ${name}`);
  }

  const categoriesResponse = await fetch(`${baseUrl}/api/categories`, {
    headers: { accept: 'application/json' }
  });
  if (!categoriesResponse.ok) {
    throw new Error(`${baseUrl}/api/categories returned HTTP ${categoriesResponse.status}`);
  }
  const categories = await categoriesResponse.json();
  if (categories.status !== 'success'
    || JSON.stringify(categories.data?.categories?.map((category) => category.id)) !== JSON.stringify(['pc'])) {
    throw new Error(`${baseUrl}/api/categories returned an invalid catalog`);
  }

  return {
    url: baseUrl,
    health: health.ok,
    category_count: categories.data.categories.length
  };
}

async function verifyPublicSites() {
  let lastError;
  for (let attempt = 1; attempt <= HEALTH_ATTEMPTS; attempt += 1) {
    try {
      const checks = [];
      for (const baseUrl of PUBLIC_ALIASES) {
        checks.push(await checkPublicSite(baseUrl));
      }
      return checks;
    } catch (error) {
      lastError = error;
      if (attempt < HEALTH_ATTEMPTS) {
        console.log(`[release] Public check retry ${attempt}/${HEALTH_ATTEMPTS - 1}`);
        await wait(HEALTH_DELAY_MS);
      }
    }
  }
  throw lastError;
}

let workerDeployed = false;
let previousWorkerVersion = null;
try {
  if (APP_ONLY) {
    console.log('[release] Application-only scope: source readiness and D1 migrations are skipped');
  }
  await run('Run Cloudflare worker harness', 'npm', ['run', 'cloudflare:harness']);
  await run('Validate Cloudflare deployment with dry-run', 'npx', [
    'wrangler',
    'deploy',
    '--config',
    'cloudflare/wrangler.jsonc',
    '--dry-run'
  ]);
  if (!APP_ONLY) {
    await run('Verify directory-source canaries, recent collection, rollback, and publication before remote mutations', 'node', [
      'cloudflare/deploy.mjs', '--preflight-only'
    ]);
  }
  previousWorkerVersion = await currentProductionVersion();
  if (!APP_ONLY) {
    await run('Apply D1 migrations', 'npx', [
      'wrangler', 'd1', 'migrations', 'apply', 'used-market-free', '--remote', '--config', 'cloudflare/wrangler.jsonc'
    ]);
  }
  await run(
    APP_ONLY
      ? 'Deploy application Worker, assets, custom domains, and cron triggers'
      : 'Deploy Worker, assets, custom domains, and cron triggers',
    'npm',
    ['run', APP_ONLY ? 'cloudflare:deploy:app' : 'cloudflare:deploy']
  );
  workerDeployed = true;

  console.log('\n[release] Verify public domains');
  const checks = await verifyPublicSites();
  console.log(JSON.stringify({ status: 'released', domains: checks }, null, 2));
} catch (error) {
  console.error(`[release] ${error instanceof Error ? error.message : String(error)}`);
  if (workerDeployed) {
    try {
      if (!previousWorkerVersion) throw new Error('Exact pre-deploy Worker version is unavailable');
      await run('Rollback Worker after failed public smoke', 'npx', [
        'wrangler', 'rollback', previousWorkerVersion, '--yes', '--config', 'cloudflare/wrangler.jsonc',
        '--message', 'Automatic rollback: USED PICK public smoke failed'
      ]);
      await verifyRollbackRestored(previousWorkerVersion);
      console.log(`[release] Rollback verified at Worker version ${previousWorkerVersion}`);
    } catch (rollbackError) {
      console.error(`[release] CRITICAL: automatic Worker rollback failed: ${rollbackError instanceof Error ? rollbackError.message : String(rollbackError)}`);
    }
  }
  process.exitCode = 1;
}
