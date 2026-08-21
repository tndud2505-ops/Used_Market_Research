import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';

const port = 19500 + (process.pid % 500);
const child = spawn(process.execPath, ['dist/web-backend/logic/index.js'], {
  cwd: process.cwd(),
  env: { ...process.env, HOST: '127.0.0.1', PORT: String(port), PUBLIC_API_ONLY: 'true', NODE_ENV: 'test' },
  stdio: ['ignore', 'pipe', 'pipe']
});

const base = `http://127.0.0.1:${port}`;
try {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    try { if ((await fetch(`${base}/global/health`)).ok) break; } catch {}
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  const health = await fetch(`${base}/global/health`);
  assert.equal(health.status, 200);
  assert.equal((await health.json()).app, 'global');
  assert.equal((await fetch(`${base}/`)).status, 404);
  const home = await fetch(`${base}/global/?country=us`);
  assert.equal(home.status, 200);
  assert.equal(home.headers.get('x-used-market-app'), 'global');
  const html = await home.text();
  assert.match(html, /<html lang="en">/u);
  assert.match(html, /https:\/\/global\.used-pick\.com\/global\/\?country=us/u);
  const excludedSite = ['bun', 'jang'].join('');
  const rejected = await fetch(`${base}/global/api/search`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ keyword: 'iphone 13', sites: [excludedSite] })
  });
  assert.equal(rejected.status, 400);
  assert.match(await rejected.text(), new RegExp(`Unsupported site: ${excludedSite}`, 'u'));
  console.log('global runtime isolation contract: 9 checks passed');
} finally {
  child.kill();
}
