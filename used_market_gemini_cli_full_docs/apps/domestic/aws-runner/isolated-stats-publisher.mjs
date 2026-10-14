import http from 'node:http';
import { spawn } from 'node:child_process';

export const STATS_SOCKET = '/run/used-market-stats/publisher.sock';
export const STATS_DEADLINE_MS = 2 * 60 * 60 * 1000;

export function statsWorkerStatus({ socketPath = STATS_SOCKET } = {}) {
  return new Promise((resolve, reject) => {
    const request = http.get({ socketPath, path: '/status' }, response => {
      let body = '';
      response.on('data', chunk => { body += chunk; if (body.length > 4096) request.destroy(new Error('INVALID_STATS_STATUS')); });
      response.on('error', reject);
      response.on('end', () => {
        try {
          const status = JSON.parse(body);
          if (response.statusCode !== 200 || typeof status.active !== 'boolean') throw new Error('INVALID_STATS_STATUS');
          resolve(status);
        } catch (error) { reject(error); }
      });
    });
    const timer = setTimeout(() => request.destroy(new Error('STATS_STATUS_TIMEOUT')), 2000);
    request.on('error', reject);
    request.on('close', () => clearTimeout(timer));
  });
}

// A local-only socket avoids privileged commands or credentials in process arguments.
export function requestIsolatedPublication({ socketPath = STATS_SOCKET, timeoutMs = STATS_DEADLINE_MS + 30000, requestPath = '/publish', payload, successKey = 'published' } = {}) {
  return new Promise((resolve, reject) => {
    const request = http.request({ socketPath, path: requestPath, method: 'POST' }, response => {
      let body = '';
      response.on('data', chunk => {
        body += chunk;
        if (Buffer.byteLength(body) > 1048576) request.destroy(new Error('PC_STATS_RESULT_TOO_LARGE'));
      });
      response.on('end', () => {
        try {
          const result = JSON.parse(body);
          if (response.statusCode !== 200 || result[successKey] !== true) throw new Error(result.error || 'PC_STATS_PUBLISHER_FAILED');
          resolve(result);
        } catch (error) { reject(error); }
      });
      response.on('error', reject);
    });
    const deadline = setTimeout(() => request.destroy(new Error('PC_STATS_PUBLISHER_DEADLINE')), timeoutMs);
    request.once('close', () => clearTimeout(deadline));
    request.once('error', reject);
    request.end(payload === undefined ? undefined : JSON.stringify(payload));
  });
}

export function requestIsolatedVerification(publication, options = {}) {
  return requestIsolatedPublication({ ...options, requestPath: '/verify', payload: publication, successKey: 'verified', timeoutMs: 92000 });
}

export function createStatsService({ command, args, cwd, env, deadlineMs = STATS_DEADLINE_MS, killGraceMs = 5000, requestPath = '/publish', successKey = 'published', input = false, log = line => process.stderr.write(line) }) {
  let active = false;
  const server = http.createServer((request, response) => {
    const send = (status, value) => { if (!response.destroyed) { response.writeHead(status, { 'content-type': 'application/json' }); response.end(JSON.stringify(value)); } };
    if (request.method === 'GET' && request.url === '/status') return send(200, { active });
    if (request.method !== 'POST' || request.url !== requestPath) return send(404, { error: 'NOT_FOUND' });
    if (active) return send(409, { error: 'PC_STATS_PUBLICATION_ALREADY_ACTIVE' });
    active = true;
    const child = spawn(command, args, { cwd, env, stdio: [input ? 'pipe' : 'ignore', 'pipe', 'pipe'], detached: process.platform !== 'win32', windowsHide: true });
    let output = '', failure = '', killTimer, finished = false;
    const signal = name => {
      try { if (process.platform !== 'win32' && child.pid) process.kill(-child.pid, name); else child.kill(name); } catch (error) { if (error.code !== 'ESRCH') log(`${error.message}\n`); }
    };
    const stop = reason => {
      if (failure) return;
      failure = reason;
      signal('SIGTERM');
      killTimer = setTimeout(() => signal('SIGKILL'), killGraceMs);
    };
    const deadline = setTimeout(() => stop('PC_STATS_PUBLISHER_DEADLINE'), deadlineMs);
    response.once('close', () => { if (!response.writableEnded) stop('PC_STATS_PUBLISHER_CALLER_DISCONNECTED'); });
    if (input) {
      let bytes = 0;
      child.stdin.on('error', () => stop('PC_STATS_INPUT_FAILED'));
      request.on('data', chunk => {
        bytes += chunk.length;
        if (bytes > 65536) stop('PC_STATS_INPUT_TOO_LARGE');
        else if (!failure) child.stdin.write(chunk);
      });
      request.on('end', () => child.stdin.end());
      request.on('error', () => stop('PC_STATS_INPUT_FAILED'));
    }
    child.stdout.on('data', chunk => {
      if (failure) return;
      output += chunk;
      if (Buffer.byteLength(output) > 1048576) stop('PC_STATS_PUBLISHER_OUTPUT_TOO_LARGE');
    });
    // Phase records are visible immediately, rather than buffered for hours by the HTTP runner.
    child.stderr.on('data', chunk => log(String(chunk)));
    const finish = (code, error) => {
      if (finished) return;
      finished = true;
      clearTimeout(deadline); clearTimeout(killTimer); active = false;
      if (failure || error || code !== 0) return send(503, { error: failure || 'PC_STATS_PUBLISHER_FAILED' });
      try {
        const result = JSON.parse(output.trim().split(/\r?\n/u).at(-1) || '{}');
        if (result[successKey] !== true) throw new Error('Invalid result');
        send(200, result);
      } catch { send(503, { error: 'PC_STATS_PUBLISHER_INVALID_OUTPUT' }); }
    };
    child.once('error', error => finish(null, error));
    child.once('close', code => finish(code));
  });
  server.requestTimeout = 0;
  server.isActive = () => active;
  return server;
}
