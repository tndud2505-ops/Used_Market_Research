import { spawn } from 'node:child_process';

const tunnelMode = (process.env.CLOUDFLARE_TUNNEL_MODE ?? 'preserve').trim().toLowerCase();
const namedTunnelOrigin = 'https://runner.used-pick.com';
if (!['preserve', 'named', 'custom'].includes(tunnelMode)) {
  console.error('CLOUDFLARE_TUNNEL_MODE must be preserve, named, or custom');
  process.exit(2);
}
const runnerUrl = process.env.CLOUDFLARE_RUNNER_URL?.trim()
  || (tunnelMode === 'named' ? `${namedTunnelOrigin}/api/runner/run` : undefined);
const searchRunnerUrl = process.env.CLOUDFLARE_SEARCH_RUNNER_URL?.trim()
  || (tunnelMode === 'named' ? `${namedTunnelOrigin}/api/search` : undefined);
const originUrl = process.env.CLOUDFLARE_ORIGIN_URL?.trim()
  || (tunnelMode === 'named' ? namedTunnelOrigin : undefined);
const freeTierMode = (process.env.CLOUDFLARE_FREE_TIER_MODE
  ?? (tunnelMode === 'named' || tunnelMode === 'custom' ? 'false' : 'true'))
  .trim().toLowerCase() !== 'false';
if ((tunnelMode === 'named' || tunnelMode === 'custom') && freeTierMode) {
  console.error('Named/custom Cloudflare Tunnel deployment requires CLOUDFLARE_FREE_TIER_MODE=false');
  process.exit(2);
}
if (!freeTierMode && (!runnerUrl || !/^https:\/\//i.test(runnerUrl))) {
  console.error('CLOUDFLARE_RUNNER_URL must be an https URL to /api/runner/run');
  process.exit(2);
}
if (!freeTierMode && (!searchRunnerUrl || !/^https:\/\//i.test(searchRunnerUrl))) {
  console.error('CLOUDFLARE_SEARCH_RUNNER_URL must be an https URL to /api/search');
  process.exit(2);
}
if (tunnelMode === 'named') {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10_000);
  try {
    const response = await fetch(`${namedTunnelOrigin}/health`, { signal: controller.signal });
    if (!response.ok) throw new Error(`HTTP_${response.status}`);
  } catch (error) {
    console.error(`Named Tunnel preflight failed for ${namedTunnelOrigin}/health: ${error instanceof Error ? error.message : String(error)}`);
    console.error('Add the runner.used-pick.com CNAME before deploying the named profile.');
    process.exit(2);
  } finally {
    clearTimeout(timeout);
  }
}

const command = process.platform === 'win32' ? 'npx.cmd' : 'npx';
const wranglerPackage = process.env.CLOUDFLARE_WRANGLER_PACKAGE?.trim() || 'wrangler@4.121.0';
const args = [
  '--yes',
  '--package',
  wranglerPackage,
  'wrangler',
  'deploy',
  '--config',
  'cloudflare/wrangler.jsonc'
];
if (runnerUrl) {
  args.push('--var', `RUNNER_URL:${runnerUrl}`);
}
if (searchRunnerUrl) {
  args.push('--var', `SEARCH_RUNNER_URL:${searchRunnerUrl}`);
}
if (originUrl) {
  args.push('--var', `ORIGIN_URL:${originUrl}`);
}
if (process.env.CLOUDFLARE_FREE_TIER_MODE) {
  args.push('--var', `FREE_TIER_MODE:${freeTierMode}`);
}
const hasExplicitRuntimeVars = Boolean(
  runnerUrl || searchRunnerUrl || originUrl || process.env.CLOUDFLARE_FREE_TIER_MODE
);
if (!hasExplicitRuntimeVars) {
  args.push('--keep-vars');
}
// Windows exposes npm as npx.cmd; Node 24 requires shell resolution for this shim.
const child = spawn(command, args, {
  stdio: 'inherit',
  shell: process.platform === 'win32'
});

child.on('exit', (code) => {
  process.exitCode = code ?? 1;
});
