import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';

const port = 19000 + (process.pid % 500);
const child = spawn(process.execPath, ['dist/web-backend/logic/index.js'], {
  cwd: process.cwd(),
  env: { ...process.env, PORT: String(port), PUBLIC_API_ONLY: 'true', NODE_ENV: 'test' },
  stdio: ['ignore', 'pipe', 'pipe']
});

const base = `http://127.0.0.1:${port}`;
try {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    try { if ((await fetch(`${base}/health`)).ok) break; } catch {}
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  const health = await fetch(`${base}/health`);
  assert.equal(health.status, 200);
  assert.equal((await health.json()).app, 'domestic');
  const home = await fetch(`${base}/`);
  assert.equal(home.status, 200);
  assert.equal(home.headers.get('x-used-market-app'), 'domestic');
  const html = await home.text();
  assert.match(html, /<html lang="ko">/u);
  assert.match(html, /data-site-tab="ebay">eBay</u);
  console.log('domestic runtime contract: 7 checks passed');
} finally {
  child.kill();
}
