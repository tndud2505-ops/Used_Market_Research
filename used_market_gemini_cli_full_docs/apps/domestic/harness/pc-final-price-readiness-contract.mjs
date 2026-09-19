import assert from 'node:assert/strict';
import worker from '../cloudflare/worker.mjs';
import { guardPriceStatsResponse } from '../cloudflare/pc-price-response-guard.mjs';
import { pcPriceReadinessProblem } from '../market/logic/pc-price-readiness.mjs';
import { parsePriceStatsRequest } from '../aws-runner/pc-price-stats-http.mjs';
const today = new Date().toISOString().slice(0, 10);
const past = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
const route = 'https://used-pick.test/api/products/ram%3Ag-skill%3Addr4%3A16gb/price-stats?days=30';
const request = new Request(`${route}&as_of=${past}`);
const incomplete = { status: 'success', data: { canonical_product_id: 'ram:g-skill:ddr4:16gb',
  active: { sample_count: 37, mean: null, median: null, aggregate_incomplete: true },
  sold: { sample_count: 8, mean: null, median: null, aggregate_incomplete: true }, as_of: `${past}T23:59:59.999Z` } };
const response = payload => new Response(JSON.stringify(payload), { headers: { 'content-type': 'application/json', 'cache-control': 'public, max-age=300' } });
let passed = 0;
const historical = await guardPriceStatsResponse(request, response(incomplete));
assert.equal(historical.status, 503); assert.equal(historical.headers.get('cache-control'), 'no-store');
const historicalBody = await historical.json();
assert.equal(historicalBody.error, 'HISTORICAL_PRICE_STATS_UNAVAILABLE'); assert.equal(historicalBody.data, undefined); passed++;
const current = await guardPriceStatsResponse(new Request(route), response(incomplete));
assert.equal(current.status, 503); assert.equal((await current.json()).error, 'EXACT_STATS_NOT_READY'); passed++;
const validQuery = parsePriceStatsRequest(request.url ? new URL(request.url) : request);
const valid = { status: 'success', data: { publication_id: 'test-exact', published_window: validQuery.window,
  active: { sample_count: 2, mean: null, median: null }, sold: { sample_count: 0 }, as_of: `${past}T05:00:00.000Z` } };
assert.equal((await guardPriceStatsResponse(request, response(valid))).status, 200); passed++;
assert.equal((await guardPriceStatsResponse(request, response({ ...valid, data: { ...valid.data, as_of: `${today}T05:00:00.000Z` } }))).status, 503); passed++;
const currentQuery = parsePriceStatsRequest(new URL(route));
const completedDaily = { status: 'success', data: { publication_id: 'test-latest-daily',
  published_window: { ...currentQuery.window, from: new Date(Date.parse(`${currentQuery.window.from}T00:00:00.000Z`) - 86_400_000).toISOString().slice(0, 10), to: past },
  active: { sample_count: 2, mean: null, median: null }, sold: { sample_count: 0 }, as_of: `${past}T18:05:00.000Z` } };
const completedDailyResponse = await guardPriceStatsResponse(new Request(route), response(completedDaily));
assert.equal(completedDailyResponse.status, 200); assert.equal((await completedDailyResponse.json()).data.availability.status, 'LAST_PUBLISHED'); passed++;
assert.equal(pcPriceReadinessProblem(validQuery, { active: { sample_count: 0 }, sold: { sample_count: 0 } }), null); passed++;
const originalFetch = globalThis.fetch;
try {
  let calls = 0;
  globalThis.fetch = async () => { calls++; return response(incomplete); };
  const actual = await worker.fetch(request, { SEARCH_RUNNER_URL: 'https://runner.test/api/search', RUNNER_TOKEN: 'synthetic-token' });
  assert.equal(actual.status, 503); assert.equal((await actual.json()).error, 'HISTORICAL_PRICE_STATS_UNAVAILABLE');
  assert.equal(calls, 1, 'no extra collection, raw rebuild, D1 fallback or retry'); passed++;
  globalThis.fetch = async () => new Response(JSON.stringify({ status: 'error', error: 'HISTORICAL_PRICE_STATS_UNAVAILABLE' }), {
    status: 503, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' }
  });
  const withD1 = await worker.fetch(request, { SEARCH_RUNNER_URL: 'https://runner.test/api/search', RUNNER_TOKEN: 'synthetic-token',
    DB: { prepare() { throw new Error('Historical failure must not touch D1'); } } });
  assert.equal(withD1.status, 503); assert.equal(withD1.headers.get('cache-control'), 'no-store');
  assert.equal(withD1.headers.get('x-search-data-source'), 'aws-runner');
  assert.equal((await withD1.json()).error, 'HISTORICAL_PRICE_STATS_UNAVAILABLE'); passed++;
  const oldCaches = globalThis.caches;
  try {
    globalThis.caches = { default: { match: async () => response(incomplete), put: async () => { throw new Error('Cannot cache incomplete prices'); } } };
    globalThis.fetch = async () => { throw new Error('Must reject the existing incomplete cache entry before fetching anything'); };
    const cached = await worker.fetch(request, { SEARCH_RUNNER_URL: 'https://runner.test/api/search', RUNNER_TOKEN: 'synthetic-token' });
    assert.equal(cached.status, 503); assert.equal(cached.headers.get('cache-control'), 'no-store'); passed++;
  } finally { globalThis.caches = oldCaches; }
} finally { globalThis.fetch = originalFetch; }
console.log(JSON.stringify({ status: 'passed', contract: 'final-price-readiness', passed, synthetic_only: true, production_writes: 0 }));
