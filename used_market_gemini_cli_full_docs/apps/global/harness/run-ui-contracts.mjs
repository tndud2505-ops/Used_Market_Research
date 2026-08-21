import { spawn } from 'node:child_process';
import net from 'node:net';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

async function freePort() {
  const server = net.createServer();
  await new Promise((resolveListen, reject) => server.once('error', reject).listen(0, '127.0.0.1', resolveListen));
  const address = server.address();
  await new Promise((resolveClose) => server.close(resolveClose));
  if (!address || typeof address === 'string') throw new Error('Could not allocate a local UI contract port');
  return address.port;
}

function runContract(file, env) {
  return new Promise((resolveRun, reject) => {
    const child = spawn(process.execPath, [resolve(root, 'harness', file)], {
      cwd: root,
      env: { ...process.env, ...env },
      stdio: 'inherit',
      windowsHide: true
    });
    child.once('error', reject);
    child.once('exit', (code) => code === 0 ? resolveRun() : reject(new Error(`${file} exited with ${code ?? 1}`)));
  });
}

const port = await freePort();
const base = `http://127.0.0.1:${port}/global/`;
const server = spawn(process.execPath, [resolve(root, 'dist/web-backend/logic/index.js')], {
  cwd: root,
  env: { ...process.env, HOST: '127.0.0.1', PORT: String(port), PUBLIC_API_ONLY: 'true', CLOUDFLARE_RUNNER_TOKEN: '' },
  stdio: ['ignore', 'pipe', 'pipe'],
  windowsHide: true
});

try {
  let ready = false;
  for (let attempt = 0; attempt < 40; attempt += 1) {
    if (server.exitCode !== null) throw new Error(`UI contract server exited with ${server.exitCode}`);
    try {
      const response = await fetch(`${base}health`);
      if (response.ok) {
        ready = true;
        break;
      }
    } catch {
      // The server is still starting.
    }
    await new Promise((resolveWait) => setTimeout(resolveWait, 100));
  }
  if (!ready) throw new Error('UI contract server did not become ready');
  await runContract('foreign-ui-contract.mjs', { FOREIGN_UI_URL: base });
  await runContract('foreign-english-ui-contract.mjs', { FOREIGN_ENGLISH_UI_URL: `${base}?country=jp` });
} finally {
  server.kill('SIGTERM');
  await new Promise((resolveExit) => {
    if (server.exitCode !== null) resolveExit();
    else {
      server.once('exit', resolveExit);
      setTimeout(() => {
        if (server.exitCode === null) server.kill('SIGKILL');
        resolveExit();
      }, 5000).unref();
    }
  });
}
