import assert from 'node:assert/strict';
import { postStatsJson } from '../aws-runner/pc-stats-publication-client.mjs';

// Synthetic transport tests only. No real HTTP requests or production writes.
const originalFetch = globalThis.fetch;
const token = 'synthetic-credential-not-a-real-token';
const url = 'https://publication.test/admin/stage-product-stats';
let passed = 0;
async function check(name, fn) { await fn(); passed += 1; console.log(`PASS ${name}`); }
try {
  await check('503 HTML preserves status, request IDs and a redacted bounded excerpt', async () => {
    let calls = 0;
    globalThis.fetch = async (_url, options) => {
      calls += 1;
      assert.equal(options.redirect, 'manual');
      assert.equal(options.headers.authorization, `Bearer ${token}`);
      return new Response(`<h1>Service unavailable</h1> Bearer ${token} password="do-not-log" access_token=do-not-log-either`, {
        status: 503, headers: { 'content-type': 'text/html', 'cf-ray': 'fixture-ray-ICN', 'x-request-id': 'fixture-request' }
      });
    };
    await assert.rejects(() => postStatsJson(url, token, {}, 1000), error => {
      assert.equal(error.code, 'D1_STATS_IMPORT_HTTP_503');
      assert.equal(error.diagnostics.cf_ray, 'fixture-ray-ICN');
      assert.equal(error.diagnostics.request_id, 'fixture-request');
      assert.match(error.diagnostics.body_excerpt, /Service unavailable/u);
      assert.ok(error.diagnostics.elapsed_ms >= 0);
      assert.doesNotMatch(error.message, /synthetic-credential|do-not-log/u);
      return true;
    });
    assert.equal(calls, 1);
  });
  for (const status of [401, 403, 429, 302]) {
    await check(`${status} is not retried or followed`, async () => {
      let calls = 0;
      globalThis.fetch = async () => { calls += 1; return new Response('denied', { status }); };
      await assert.rejects(() => postStatsJson(url, token, {}, 1000), new RegExp(`D1_STATS_IMPORT_HTTP_${status}`, 'u'));
      assert.equal(calls, 1);
    });
  }
  await check('valid JSON success is unchanged', async () => {
    globalThis.fetch = async () => Response.json({ ok: true, chunk: { publication_id: 'fixture' } });
    assert.equal((await postStatsJson(url, token, {}, 1000)).chunk.publication_id, 'fixture');
  });
  await check('HTTP 200 semantic failure is not reported as success', async () => {
    globalThis.fetch = async () => Response.json({ ok: false, error: 'fixture failure' });
    await assert.rejects(() => postStatsJson(url, token, {}, 1000), /D1_STATS_IMPORT_HTTP_200/u);
  });
  await check('oversized streaming response is cancelled before unbounded allocation', async () => {
    let cancelled = false;
    let pulls = 0;
    globalThis.fetch = async () => new Response(new ReadableStream({
      pull(controller) { pulls += 1; controller.enqueue(new Uint8Array(262144).fill(65)); },
      cancel() { cancelled = true; }
    }));
    await assert.rejects(() => postStatsJson(url, token, {}, 1000), error => {
      assert.equal(error.code, 'D1_STATS_IMPORT_RESPONSE_TOO_LARGE');
      assert.equal(error.diagnostics.response_bytes_read, 1048576);
      assert.ok(error.diagnostics.body_excerpt.length <= 1200);
      return true;
    });
    assert.equal(cancelled, true);
    assert.ok(pulls <= 7);
  });
  await check('network errors do not leak a credential-bearing URL', async () => {
    globalThis.fetch = async () => { throw new TypeError(`failure at ${url}?token=${token}`); };
    await assert.rejects(() => postStatsJson(url, token, {}, 1000), error => {
      assert.equal(error.code, 'D1_STATS_IMPORT_TRANSPORT_FAILED');
      assert.doesNotMatch(error.message, /synthetic-credential|\?token=/u);
      return true;
    });
  });
} finally { globalThis.fetch = originalFetch; }
console.log(JSON.stringify({ status: 'passed', contract: 'pc-agent1-publication-http', checks: passed, real_requests: 0 }));
