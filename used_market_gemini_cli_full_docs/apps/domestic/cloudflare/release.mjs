import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const arguments_ = process.argv.slice(2);
const option = name => {
  const index = arguments_.indexOf(name);
  if (index < 0) return '';
  if (!arguments_[index + 1] || arguments_[index + 1].startsWith('--')) throw new Error(`${name} requires a value`);
  return arguments_[index + 1];
};
const VERSION = option('--version');
const VERSION_CONFIG = path.resolve(ROOT, option('--version-config') || 'cloudflare/wrangler.jsonc');
if (arguments_.includes('--version') && !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(VERSION))
  throw new Error('--version must be the exact UUID of an already uploaded, reviewed Worker version');
if (arguments_.includes('--version-config') && !VERSION) throw new Error('--version-config requires --version');
const UI_ARGS = ['--android-serial', '--adb-server-port', '--android-cdp-port', '--adb']
  .flatMap(name => option(name) ? [name, option(name)] : []);
const UI_OUT = option('--out') || process.env.USED_PICK_RELEASE_UI_OUT;

async function validateVersionConfig() {
  // JSONC comments/trailing commas are accepted without evaluating configuration code.
  const source = await readFile(VERSION_CONFIG, 'utf8');
  const uncommented = source.replace(/"(?:\\.|[^"\\])*"|\/\*[\s\S]*?\*\/|\/\/[^\r\n]*/g,
    match => match.startsWith('"') ? match : ' ');
  const config = JSON.parse(uncommented.replace(/"(?:\\.|[^"\\])*"|,\s*(?=[}\]])/g,
    match => match.startsWith('"') ? match : ''));
  if (config.name !== 'used-market-runner') throw new Error('Release config must target the exact used-market-runner Worker');
}

async function jointUi(candidate) {
  await run(candidate ? 'Candidate web and installed Android acceptance' : 'Public web and installed Android acceptance',
    'node', [path.join(ROOT, 'harness/pc-analysis-workspace-browser.mjs'), '--run',
      ...(candidate ? ['--candidate'] : []), ...UI_ARGS,
      ...(UI_OUT ? ['--out', path.resolve(UI_OUT, candidate ? 'candidate' : 'public')] : [])]);
}

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
      cwd: ROOT,
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
      cwd: ROOT,
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
    'wrangler', 'deployments', 'status', '--config', VERSION_CONFIG, '--json'
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
    || !home.includes('data-provider="house"')
    || !home.includes('com.trainingapp.traingallery')
    || /DAN-|kakao_ad_area/u.test(home)
    || /link\.coupang\.com|ads-partners\.coupang\.com|data-coupang/u.test(home)) {
    throw new Error(`${baseUrl}/ did not return the listing home shell`);
  }
  for (const [name, expected] of [
    ['content-security-policy', /default-src/u],
    ['strict-transport-security', /max-age=/u],
    ['x-content-type-options', /nosniff/u]
  ]) {
    if (!expected.test(homeResponse.headers.get(name) || '')) throw new Error(`${baseUrl}/ missing ${name}`);
  }

  const analysisResponse = await fetch(`${baseUrl}/price-analysis.html?release_check=${Date.now()}`);
  if (!analysisResponse.ok) throw new Error(`${baseUrl}/price-analysis.html returned HTTP ${analysisResponse.status}`);
  const analysis = await analysisResponse.text();
  if (!analysis.includes('href="https://used-pick.com/price-analysis.html"')
    || !analysis.includes('id="analysis-workspace"')
    || !analysis.includes('data-provider="house"')
    || !analysis.includes('com.trainingapp.traingallery')
    || /DAN-|kakao_ad_area/u.test(analysis)) {
    throw new Error(`${baseUrl}/price-analysis.html did not return the price-analysis shell`);
  }
  for (const [label, response, html] of [['home', homeResponse, home], ['analysis', analysisResponse, analysis]]) {
    if ((html.match(/gtag\/js\?id=G-2L2ETG06B1/gu) || []).length !== 1
      || (html.match(/src="\/analytics.js"/gu) || []).length !== 1
      || !response.headers.get('content-security-policy')?.includes('https://www.google-analytics.com')) {
      throw new Error(`${baseUrl}/${label} missing common GA4 HTML processing`);
    }
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
  await validateVersionConfig();
  if (VERSION) {
    console.log('[release] Already uploaded version: no upload, bundle, dry-run, migration or source canary');
  }
  if (APP_ONLY) {
    console.log('[release] Application-only scope: source readiness and D1 migrations are skipped');
  }
  await run('Run Cloudflare worker harness', 'npm', ['run', 'cloudflare:harness']);
  if (!VERSION) await run('Validate Cloudflare deployment with dry-run', 'npx', [
    'wrangler',
    'deploy',
    '--config',
    'cloudflare/wrangler.jsonc',
    '--dry-run'
  ]);
  await jointUi(true);
  if (!VERSION && !APP_ONLY) {
    await run('Verify directory-source canaries, recent collection, rollback, and publication before remote mutations', 'node', [
      'cloudflare/deploy.mjs', '--preflight-only'
    ]);
  }
  previousWorkerVersion = await currentProductionVersion();
  if (!VERSION && !APP_ONLY) {
    await run('Apply D1 migrations', 'npx', [
      'wrangler', 'd1', 'migrations', 'apply', 'used-market-free', '--remote', '--config', 'cloudflare/wrangler.jsonc'
    ]);
  }
  // Retain the exact 100% recovery version before attempting either deployment.
  workerDeployed = true;
  if (VERSION) await run('Activate the reviewed existing Worker version at 100%', 'npx', [
    'wrangler', 'versions', 'deploy', `${VERSION}@100%`, '--yes', '--config', VERSION_CONFIG
  ]);
  else await run(
    APP_ONLY
      ? 'Deploy application Worker, assets, custom domains, and cron triggers'
      : 'Deploy Worker, assets, custom domains, and cron triggers',
    'npm',
    ['run', APP_ONLY ? 'cloudflare:deploy:app' : 'cloudflare:deploy']
  );
  console.log('\n[release] Verify public domains');
  const checks = await verifyPublicSites();
  await jointUi(false);
  console.log(JSON.stringify({ status: 'released', domains: checks }, null, 2));
} catch (error) {
  console.error(`[release] ${error instanceof Error ? error.message : String(error)}`);
  if (workerDeployed) {
    try {
      if (!previousWorkerVersion) throw new Error('Exact pre-deploy Worker version is unavailable');
      await run('Rollback Worker after failed public smoke', 'npx', [
        'wrangler', 'rollback', previousWorkerVersion, '--yes', '--config', VERSION_CONFIG,
        '--message', 'automatic-rollback-used-pick-public-smoke-failed'
      ]);
      await verifyRollbackRestored(previousWorkerVersion);
      console.log(`[release] Rollback verified at Worker version ${previousWorkerVersion}`);
    } catch (rollbackError) {
      console.error(`[release] CRITICAL: automatic Worker rollback failed: ${rollbackError instanceof Error ? rollbackError.message : String(rollbackError)}`);
    }
  }
  process.exitCode = 1;
}
