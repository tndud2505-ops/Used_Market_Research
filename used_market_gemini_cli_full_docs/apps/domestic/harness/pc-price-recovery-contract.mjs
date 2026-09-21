// Deterministic Worker + cache + browser-store contracts. All prices are
// synthetic; this suite does not contact or write to any production service.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import worker from '../cloudflare/worker.mjs';
import { guardPriceStatsResponse } from '../cloudflare/pc-price-response-guard.mjs';
import { fetchThroughPcReadCache } from '../cloudflare/free-tier.mjs';
import { parsePriceStatsRequest } from '../aws-runner/pc-price-stats-http.mjs';
import { createPriceStore } from '../web-backend/public/pc-tools-data.mjs';

const id = 'cpu:intel:i3-7100';
const route = `https://used-pick.test/api/products/${encodeURIComponent(id)}/price-stats?days=30`;
const environment = { SEARCH_RUNNER_URL: 'https://runner.test/api/search', RUNNER_TOKEN: 'synthetic-token' };
const query = parsePriceStatsRequest(new URL(route));
const shift = (value, days) => new Date(Date.parse(`${value}T00:00:00Z`) + days * 86400000).toISOString().slice(0, 10);
const metric = value => ({ sample_count: 5, min: value, max: value, mean: value, median: value });
const complete = (offset = 0) => {
  const to = shift(query.asOfDate, offset), from = shift(to, -29);
  return { canonical_product_id: id, publication_id: `synthetic-publication-${offset}`,
    as_of: `${to}T05:00:00Z`, published_window: { from, to, days: 30 }, window: query.window,
    active: metric(120000.5), sold: metric(110000.5), reserved: { sample_count: 0 }, confirmed_transactions: { sample_count: 0 },
    by_source: [], daily: [{ date: to, active: metric(120000.5), sold: metric(110000.5) }],
    methodology: { days: 30, market_pool: 'KR_C2C_USED', condition: 'USED_WORKING', currency: 'KRW' } };
};
const incomplete = () => ({ ...complete(), active: { ...metric(999), aggregate_incomplete: true } });
const response = data => new Response(JSON.stringify({ status: 'success', data }), {
  headers: { 'content-type': 'application/json', 'cache-control': 'public, max-age=300' }
});

function storedD1(stats) {
  const reads = [];
  return { reads, prepare(sql) {
    assert.match(sql.trim(), /^SELECT\b/, 'fallback may only read stored data');
    reads.push(sql);
    return { bind(...args) {
      assert.equal(args[0], id, 'fallback must request the same model');
      if (/s\.stats_json|SELECT s\.as_of/.test(sql)) {
        assert.deepEqual(args, [id, 'KR_C2C_USED', 'USED_WORKING', 'KRW', 30]);
        return { first: async () => ({ stats_json: JSON.stringify(stats), publication_id: stats.publication_id, as_of: stats.as_of, days: 30 }) };
      }
      assert.match(sql, /FROM listings/);
      return { all: async () => ({ results: [] }) };
    } };
  } };
}
async function withRuntime(run) {
  const previousFetch = globalThis.fetch, previousCaches = globalThis.caches;
  globalThis.caches = undefined;
  try { await run(); }
  finally { globalThis.fetch = previousFetch; globalThis.caches = previousCaches; }
}

test('HTTP 200 incomplete Runner response recovers from a complete same-scope D1 publication', () => withRuntime(async () => {
  let calls = 0;
  globalThis.fetch = async () => { calls++; return response(incomplete()); };
  const db = storedD1(complete());
  const result = await worker.fetch(new Request(route), { ...environment, DB: db });
  assert.equal(result.status, 200);
  assert.equal(result.headers.get('x-search-data-source'), 'd1-fallback');
  const body = await result.json();
  assert.equal(body.data.active.mean, 120000.5);
  assert.equal(body.data.sold.mean, 110000.5);
  assert.equal(body.data.publication_id, complete().publication_id);
  assert.equal(calls, 1);
  assert.equal(db.reads.length, 3, 'bounded same-scope stored reads only');
}));

test('valid Runner prices remain primary and never query the fallback database', () => withRuntime(async () => {
  globalThis.fetch = async () => response(complete());
  const result = await worker.fetch(new Request(route), { ...environment,
    DB: { prepare() { throw new Error('valid Runner must not touch D1'); } } });
  assert.equal(result.status, 200);
  assert.equal(result.headers.get('x-search-data-source'), 'aws-runner');
}));

test('a stale HTTP 200 Runner publication can recover, without accepting its stale prices', () => withRuntime(async () => {
  globalThis.fetch = async () => response(complete(-2));
  const result = await worker.fetch(new Request(route), { ...environment, DB: storedD1(complete()) });
  assert.equal(result.status, 200);
  assert.equal((await result.json()).data.publication_id, complete().publication_id);
}));

test('yesterday fallback exposes its actual dates and is accepted by the shared UI price store', () => withRuntime(async () => {
  globalThis.fetch = async () => response(incomplete());
  const result = await worker.fetch(new Request(route), { ...environment, DB: storedD1(complete(-1)) });
  assert.equal(result.status, 200);
  const payload = await result.clone().json();
  assert.equal(payload.data.availability.status, 'LAST_PUBLISHED');
  assert.equal(payload.data.window.to, shift(query.asOfDate, -1));
  assert.equal(payload.data.window.from, shift(query.asOfDate, -30));
  assert.equal(payload.data.requested_window.to, query.asOfDate);
  globalThis.fetch = async () => result.clone();
  const store = createPriceStore(() => {});
  await store.load([{ canonical_product_id: id }]);
  assert.equal(store.get(id).state, 'ready');
  assert.equal(store.get(id).data.active.mean, 120000.5);
  store.clear();
}));

test('incomplete or too-old D1 data remains an uncached 503, never a fabricated ready price', () => withRuntime(async () => {
  for (const stats of [incomplete(), complete(-2)]) {
    globalThis.fetch = async () => response(incomplete());
    const result = await worker.fetch(new Request(route), { ...environment, DB: storedD1(stats) });
    assert.equal(result.status, 503);
    assert.equal(result.headers.get('cache-control'), 'no-store');
    const body = await result.json();
    assert.equal(body.error, 'EXACT_STATS_NOT_READY');
    assert.equal(body.data, undefined);
  }
}));

test('explicit current and historical dates never borrow a different D1 publication', () => withRuntime(async () => {
  for (const date of [query.asOfDate, shift(query.asOfDate, -1)]) {
    globalThis.fetch = async () => response(incomplete());
    const result = await worker.fetch(new Request(`${route}&as_of=${date}`), { ...environment,
      DB: { prepare() { throw new Error('explicit date must not touch D1'); } } });
    assert.equal(result.status, 503);
    assert.equal(result.headers.get('x-search-data-source'), 'aws-runner');
    assert.equal((await result.json()).data, undefined);
  }
}));

test('invalid cached 200 is evicted, refreshed once, then reused without another Runner call', () => withRuntime(async () => {
  for (const seed of [incomplete(), complete(-2)]) {
    let entry = response(seed), evictions = 0, writes = 0, calls = 0;
    globalThis.caches = { default: {
      match: async () => entry?.clone(),
      delete: async () => { evictions++; entry = null; return true; },
      put: async (_key, value) => { writes++; entry = value.clone(); }
    } };
    globalThis.fetch = async () => { calls++; return response(complete()); };
    const result = await worker.fetch(new Request(route), environment);
    assert.equal(result.status, 200);
    assert.equal(result.headers.get('x-pc-read-cache'), 'MISS');
    assert.equal((await result.json()).data.active.mean, 120000.5);
    const next = await worker.fetch(new Request(route), environment);
    assert.equal(next.status, 200);
    assert.equal(next.headers.get('x-pc-read-cache'), 'HIT');
    assert.deepEqual({ evictions, writes, calls }, { evictions: 1, writes: 1, calls: 1 });
  }
}));

test('failed cache recovery makes one attempt and stores no incomplete or error response', () => withRuntime(async () => {
  let calls = 0, writes = 0;
  globalThis.caches = { default: { match: async () => response(incomplete()), put: async () => { writes++; } } };
  globalThis.fetch = async () => { calls++; return response(incomplete()); };
  const result = await worker.fetch(new Request(route), environment);
  assert.equal(result.status, 503);
  assert.equal(result.headers.get('cache-control'), 'no-store');
  assert.equal((await result.json()).data, undefined);
  assert.equal(calls, 1);
  assert.equal(writes, 0);
}));

test('healthy previous-day cache is labelled with real dates without a new origin request', () => withRuntime(async () => {
  globalThis.caches = { default: { match: async () => response(complete(-1)), put: async () => { throw new Error('cache hit'); } } };
  globalThis.fetch = async () => { throw new Error('healthy cache must not fetch'); };
  const result = await worker.fetch(new Request(route), environment);
  assert.equal(result.status, 200);
  assert.equal(result.headers.get('x-pc-read-cache'), 'HIT');
  assert.equal((await result.json()).data.window.to, shift(query.asOfDate, -1));
}));

test('successful no-store responses are never promoted to public cache entries', () => withRuntime(async () => {
  let calls = 0, writes = 0;
  globalThis.caches = { default: { match: async () => undefined, put: async () => { writes++; } } };
  const origin = async () => { calls++; return new Response('{}', { headers: { 'cache-control': 'no-store' } }); };
  await fetchThroughPcReadCache(new Request(route), {}, origin);
  await fetchThroughPcReadCache(new Request(route), {}, origin);
  assert.equal(calls, 2);
  assert.equal(writes, 0);
}));

test('normalizing a latest-completed response is idempotent and explicit dates still reject it', async () => {
  const first = await guardPriceStatsResponse(new Request(route), response(complete(-1)));
  const original = await first.clone().json();
  const second = await guardPriceStatsResponse(new Request(route), first);
  assert.deepEqual(await second.clone().json(), original);
  const explicit = await guardPriceStatsResponse(new Request(`${route}&as_of=${query.asOfDate}`), second);
  assert.equal(explicit.status, 503);
});
