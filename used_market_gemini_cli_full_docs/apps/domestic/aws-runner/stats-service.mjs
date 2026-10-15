import { chmodSync, existsSync, unlinkSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import http from 'node:http';
import path from 'node:path';
import { createStatsService, STATS_SOCKET } from './isolated-stats-publisher.mjs';

if (existsSync(STATS_SOCKET)) unlinkSync(STATS_SOCKET);
const script = fileURLToPath(new URL('./publish-pc-stats-runner.mjs', import.meta.url));
const heapMb = Math.max(256, Math.min(4096, Number(process.env.PC_STATS_HEAP_MB) || 1536));
const publisher = createStatsService({ command: process.execPath, args: [`--max-old-space-size=${heapMb}`, '--expose-gc', script], cwd: '/opt/used-market-runner', env: process.env, input: true });
const verifier = createStatsService({ command: process.execPath,
  args: ['--max-old-space-size=384', fileURLToPath(new URL('./verify-pc-stats-runner.mjs', import.meta.url))],
  cwd: '/opt/used-market-runner', env: process.env, requestPath: '/verify', successKey: 'verified', input: true,
  deadlineMs: 85000, killGraceMs: 2000 });
// Activation calls back while publication waits: verification needs a separate lane.
const server = http.createServer((request, response) => {
  if (request.method === 'GET' && request.url === '/status') {
    response.writeHead(200, { 'content-type': 'application/json' });
    return response.end(JSON.stringify({ active: publisher.isActive(), verification_active: verifier.isActive() }));
  }
  if (request.method === 'POST' && existsSync(path.join(path.dirname(process.env.RUNNER_INDEX_PATH || '/var/lib/used-market-runner/search-index.sqlite'), 'deployment-maintenance'))
    && !(request.url === '/verify' && publisher.isActive())) {
    response.writeHead(503, { 'content-type': 'application/json' });
    return response.end(JSON.stringify({ error: 'RUNNER_DEPLOYMENT_MAINTENANCE' }));
  }
  (request.url === '/verify' ? verifier : publisher).emit('request', request, response);
});
server.requestTimeout = 0;
server.listen(STATS_SOCKET, () => { chmodSync(STATS_SOCKET, 0o660); console.error('PC_STATS_SERVICE_READY'); });
