import { spawn } from 'node:child_process';

const PUBLIC_URL = (process.env.CLOUDFLARE_PUBLIC_URL || 'https://used-pick.com').replace(/\/$/, '');
const PUBLIC_ALIASES = Array.from(new Set([
  PUBLIC_URL,
  'https://www.used-pick.com'
]));
const HEALTH_ATTEMPTS = 12;
const HEALTH_DELAY_MS = 2_500;

function executable(name) {
  return process.platform === 'win32' ? `${name}.cmd` : name;
}

function run(label, command, args) {
  return new Promise((resolve, reject) => {
    console.log(`\n[release] ${label}`);
    const child = spawn(executable(command), args, {
      cwd: process.cwd(),
      stdio: 'inherit',
      shell: process.platform === 'win32'
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
  if (!home.includes('class="market-app"')) {
    throw new Error(`${baseUrl}/ did not return the market app shell`);
  }

  const categoriesResponse = await fetch(`${baseUrl}/api/categories`, {
    headers: { accept: 'application/json' }
  });
  if (!categoriesResponse.ok) {
    throw new Error(`${baseUrl}/api/categories returned HTTP ${categoriesResponse.status}`);
  }
  const categories = await categoriesResponse.json();
  if (categories.status !== 'success' || !Array.isArray(categories.data?.categories)) {
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

try {
  await run('Run Cloudflare worker harness', 'npm', ['run', 'cloudflare:harness']);
  await run('Validate Cloudflare deployment with dry-run', 'npx', [
    'wrangler',
    'deploy',
    '--config',
    'cloudflare/wrangler.jsonc',
    '--dry-run'
  ]);
  await run('Deploy Worker, assets, custom domains, and cron triggers', 'npm', ['run', 'cloudflare:deploy']);

  console.log('\n[release] Verify public domains');
  const checks = await verifyPublicSites();
  console.log(JSON.stringify({ status: 'released', domains: checks }, null, 2));
} catch (error) {
  console.error(`[release] ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
}
