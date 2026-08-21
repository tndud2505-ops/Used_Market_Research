import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { rm } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const port = Number(process.env.HTTP_CONTRACT_PORT || 8899);
const baseUrl = `http://127.0.0.1:${port}`;
const runnerToken = 'http-contract-token';

const server = spawn(process.execPath, ['dist/web-backend/logic/index.js'], {
  cwd: root,
  env: {
    ...process.env,
    PORT: String(port),
    HOST: '127.0.0.1',
    CLOUDFLARE_RUNNER_TOKEN: runnerToken
  },
  stdio: ['ignore', 'pipe', 'pipe']
});

let feedbackRecord;

try {
  await waitForHealth();

  const health = await request('/health');
  assert.equal(health.response.status, 200);
  assert.equal(health.payload.ok, true);

  const rootPage = await request('/');
  assert.equal(rootPage.response.status, 200);
  assert.match(rootPage.text, /app\.js\?v=/);

  const categories = await request('/api/categories');
  assert.equal(categories.response.status, 200);
  assert.equal(categories.payload.status, 'success');
  assert.equal(categories.payload.data.categories.length, 32);
  assert.ok(categories.payload.data.categories.some((category) => category.id === 'fashion_women_bottoms'));
  assert.ok(categories.payload.data.categories.some((category) => category.id === 'pc'));
  assert.deepEqual(Object.keys(categories.payload.data.site_plans), ['joonggonara', 'bunjang', 'hellomarket', 'rethinkmall']);
  assert.equal(categories.payload.data.site_plans.bunjang.fashion_women_bottoms.strategy, 'source_category');
  assert.equal(categories.payload.data.site_plans.bunjang.fashion_women_bottoms.selectable, true);
  assert.equal(categories.payload.data.site_plans.bunjang.fashion_women_bottoms.availability, 'official');
  assert.equal(categories.payload.data.site_plans.joonggonara.fashion_women_bottoms.availability, 'official');
  assert.equal(categories.payload.data.site_plans.hellomarket.fashion_women_bottoms.strategy, 'keyword');
  assert.equal(categories.payload.data.site_plans.rethinkmall.fashion_women_bottoms.strategy, 'keyword');

  const categoriesWrongMethod = await request('/api/categories', { method: 'POST', body: {} });
  assert.equal(categoriesWrongMethod.response.status, 404);

  const sourceCatalog = await request('/api/search-only/sources');
  assert.equal(sourceCatalog.response.status, 200);
  assert.deepEqual(
    sourceCatalog.payload.data.sources.map((source) => source.key),
    ['hellomarket', 'rethinkmall']
  );

  const feedbackSummaryBefore = await request('/api/feedback/summary');
  assert.equal(feedbackSummaryBefore.response.status, 200);
  assert.equal(feedbackSummaryBefore.payload.status, 'success');

  const marker = `http-contract-${Date.now()}`;
  const feedback = await request('/api/feedback', {
    method: 'POST',
    body: {
      feedback_type: 'search_truth',
      benchmark: 'http-contract',
      screen: 'search',
      query: marker,
      overall: 5,
      note: marker
    }
  });
  assert.equal(feedback.response.status, 201);
  assert.equal(feedback.payload.status, 'success');
  feedbackRecord = feedback.payload.data;
  assert.match(feedbackRecord.id, /-/);

  const feedbackSummaryAfter = await request('/api/feedback/summary');
  assert.equal(feedbackSummaryAfter.response.status, 200);
  assert.equal(feedbackSummaryAfter.payload.data.total, feedbackSummaryBefore.payload.data.total + 1);
  assert.ok(feedbackSummaryAfter.payload.data.recent.some((record) => record.id === feedbackRecord.id));

  const history = await request('/api/market/history?keyword=RTX%203070&days=7');
  assert.equal(history.response.status, 200);
  assert.equal(history.payload.status, 'success');
  assert.ok(Array.isArray(history.payload.data.points));

  const invalidHistory = await request('/api/market/history?keyword=RTX%203070&days=91');
  assert.equal(invalidHistory.response.status, 400);

  const invalidFeedback = await request('/api/feedback', { method: 'POST', body: {} });
  assert.equal(invalidFeedback.response.status, 400);

  const engine = await request('/api/engine/status');
  assert.equal(engine.response.status, 200);
  assert.equal(engine.payload.status, 'success');
  assert.ok(Array.isArray(engine.payload.data.jobs));

  const runnerStatus = await request('/api/runner/status');
  assert.equal(runnerStatus.response.status, 200);
  assert.equal(runnerStatus.payload.status, 'success');
  assert.ok(runnerStatus.payload.data.jobs.length > 0);
  assert.equal(runnerStatus.payload.data.coordination_scope, 'same-host-shared-filesystem');

  const unauthorizedRunner = await request('/api/runner/run', {
    method: 'POST',
    body: { job_name: 'unknown-job' }
  });
  assert.equal(unauthorizedRunner.response.status, 401);
  assert.equal(unauthorizedRunner.payload.error, 'Unauthorized');

  const unknownRunner = await request('/api/runner/run', {
    method: 'POST',
    headers: { Authorization: `Bearer ${runnerToken}` },
    body: { job_name: 'unknown-job' }
  });
  assert.equal(unknownRunner.response.status, 400);
  assert.equal(unknownRunner.payload.status, 'error');
  assert.match(unknownRunner.payload.suggestion, /runner\/status/);

  const invalidSearch = await request('/api/search', {
    method: 'POST',
    body: {}
  });
  assert.equal(invalidSearch.response.status, 400);
  assert.equal(invalidSearch.payload.status, 'error');

  const invalidAllCategory = await request('/api/search', {
    method: 'POST',
    body: { category_id: 'all', sites: ['joonggonara'] }
  });
  assert.equal(invalidAllCategory.response.status, 400);

  const retiredDaangnSearch = await request('/api/search', {
    method: 'POST',
    body: { keyword: '아이폰 15', sites: ['daangn'] }
  });
  assert.equal(retiredDaangnSearch.response.status, 400);

  const invalidSearchOnly = await request('/api/search-only', {
    method: 'POST',
    body: { source: 'ebay', keyword: 'RTX 3070' }
  });
  assert.equal(invalidSearchOnly.response.status, 400);
  assert.equal(invalidSearchOnly.payload.status, 'error');

  const searchWrongMethod = await request('/api/search');
  assert.equal(searchWrongMethod.response.status, 404);
  const searchOnlyWrongMethod = await request('/api/search-only');
  assert.equal(searchOnlyWrongMethod.response.status, 404);

  const missingRun = await request('/api/runs/collector/not-real');
  assert.equal(missingRun.response.status, 404);

  const invalidJson = await request('/api/search', {
    method: 'POST',
    rawBody: '{'
  });
  assert.equal(invalidJson.response.status, 400);
  assert.equal(invalidJson.payload.status, 'error');
  assert.doesNotMatch(invalidJson.text, /Internal error|Unexpected end of JSON input/);

  const oversizedJson = await request('/api/search', {
    method: 'POST',
    rawBody: JSON.stringify({ keyword: 'RTX 3070', padding: 'x'.repeat(1_100_000) })
  });
  assert.equal(oversizedJson.response.status, 413);
  assert.equal(oversizedJson.payload.status, 'error');

  const options = await request('/api/categories', { method: 'OPTIONS' });
  assert.equal(options.response.status, 204);

  console.log(JSON.stringify({
    status: 'passed',
    checks: 33,
    routes: [
      '/health', '/', '/api/categories', '/api/search-only/sources',
      '/api/feedback', '/api/feedback/summary', '/api/market/history',
      '/api/engine/status', '/api/runner/status', '/api/runner/run',
      '/api/search', '/api/search-only', 'OPTIONS'
    ]
  }, null, 2));
} finally {
  if (feedbackRecord?.id && feedbackRecord?.created_at) {
    const day = feedbackRecord.created_at.slice(0, 10);
    await rm(resolve(root, 'merge/result/ux-feedback', day, `${feedbackRecord.id}.json`), { force: true });
  }
  server.kill('SIGTERM');
  await new Promise((resolveExit) => {
    const timeout = setTimeout(resolveExit, 1000);
    server.once('exit', () => {
      clearTimeout(timeout);
      resolveExit();
    });
  });
}

async function waitForHealth() {
  const deadline = Date.now() + 15000;
  let lastError = 'server did not start';
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${baseUrl}/health`, { signal: AbortSignal.timeout(1000) });
      if (response.ok) return;
      lastError = `HTTP ${response.status}`;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 150));
  }
  throw new Error(`HTTP contract server did not become ready: ${lastError}`);
}

async function request(pathname, options = {}) {
  const headers = { ...(options.headers || {}) };
  let body;
  if (options.rawBody !== undefined) {
    body = options.rawBody;
    headers['Content-Type'] = 'application/json';
  } else if (options.body !== undefined) {
    body = JSON.stringify(options.body);
    headers['Content-Type'] = 'application/json';
  }

  const response = await fetch(`${baseUrl}${pathname}`, {
    method: options.method || 'GET',
    headers,
    body
  });
  const text = await response.text();
  let payload = null;
  if (text) {
    try {
      payload = JSON.parse(text);
    } catch {
      // Static HTML is intentionally returned as text.
    }
  }
  return { response, text, payload };
}
