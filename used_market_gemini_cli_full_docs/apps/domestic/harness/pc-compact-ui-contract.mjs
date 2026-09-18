// Deterministic source/HTTP-boundary regressions, NOT a browser or production pass.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { guardPriceStatsResponse } from '../cloudflare/pc-price-response-guard.mjs';
import { parsePriceStatsRequest } from '../aws-runner/pc-price-stats-http.mjs';
import { createPriceStore } from '../web-backend/public/pc-tools-data.mjs';

const read = name => readFileSync(new URL(`../web-backend/public/${name}`, import.meta.url), 'utf8');
test('functional pages have no promotional heading block but retain accessible document titles', () => {
  for (const name of ['index.html', 'computer-builder.html', 'price-analysis.html']) {
    const html = read(name);
    assert.doesNotMatch(html, /up-page-heading|up-eyebrow|up-service-note/);
    assert.equal([...html.matchAll(/<h1\b/g)].length, 1, name);
    assert.match(html, /<link rel="canonical"/);
  }
  const home = read('index.html');
  assert.match(home, /id="workspace-title"/); assert.match(home, /id="workspace-intro"/);
  for (const phrase of ['USED PARTS, CLEAR PRICES.', '중고 부품, 가격부터 비교하세요.', 'YOUR BUILD, YOUR BUDGET.', '내 PC 구성, 시세로 확인하세요.', 'READ THE MARKET.', '표시가격 비교 서비스']) {
    for (const name of ['index.html', 'computer-builder.html', 'price-analysis.html', 'app.js']) assert.ok(!read(name).includes(phrase), `${name}: ${phrase}`);
  }
});
test('builder has one inline total, seven columns and accessible optional details, not a right sidebar', () => {
  const html = read('computer-builder.html'), script = read('pc-tools.js');
  assert.doesNotMatch(html, /class="build-result|내 구성 요약/);
  assert.equal([...html.matchAll(/id="tools-summary"/g)].length, 1);
  assert.match(script, /makeTable\(\['부품', '모델명', '수량', '판매중 단가', '판매완료 표시가\(단가\)', '변경', '×'\]\)/);
  assert.match(html, /<dialog id="build-detail-dialog"/);
  assert.match(script, /합계\(판매중\)/); assert.match(script, /합계 계산 불가/);
  assert.doesNotMatch(script, /판매완료 합계/);
});
test('all viewport sizes retain native table rows and local horizontal scrolling', () => {
  const css = read('ui-concept-a.css');
  assert.match(css, /#build-table\s*\{[^}]*overflow-x:auto/);
  assert.match(css, /#build-table table\s*\{[^}]*min-width:980px/);
  assert.doesNotMatch(css, /#build-table tbody tr\s*\{[^}]*display:grid/);
  assert.doesNotMatch(css, /#build-table td\s*\{[^}]*display:block/);
  assert.doesNotMatch(css, /(?:html|body)[^{]*\{[^}]*overflow-x\s*:\s*(?:hidden|clip)/);
});
test('category landing page shares the functional navigation and stylesheet', () => {
  const html = read('used-market-categories.html');
  assert.match(html, /ui-concept-a\.css\?v=compact-ui-v1/);
  assert.match(html, /class="skip-link" href="#main"/);
  for (const href of ['/', '/computer-builder.html', '/price-analysis.html', '/guide.html']) assert.ok(html.includes(`href="${href}"`));
});

const date = offset => new Date(Date.now() + offset * 86400000).toISOString().slice(0, 10);
const path = 'https://example.test/api/products/cpu%3Asynthetic/price-stats?days=30&currency=KRW&market_pool=KR_C2C_USED&condition=USED_WORKING';
const response = data => new Response(JSON.stringify({ status: 'success', data }), { headers: { 'content-type': 'application/json', 'cache-control': 'public,max-age=300' } });
test('today and implicit-current requests cannot return a stale publication as HTTP 200', async () => {
  for (const suffix of ['', `&as_of=${date(0)}`]) {
    const request = new Request(path + suffix), query = parsePriceStatsRequest(new URL(request.url));
    const oldQuery = parsePriceStatsRequest(new URL(path + `&as_of=${date(-1)}`));
    const result = await guardPriceStatsResponse(request, response({ canonical_product_id: 'cpu:synthetic', publication_id: 'synthetic-old',
      window: query.window, published_window: oldQuery.window, as_of: `${date(-1)}T05:00:00Z`,
      active: { sample_count: 5, mean: 123.45, median: 123.45, min: 123.45, max: 123.45 } }));
    assert.equal(result.status, 503); assert.equal(result.headers.get('cache-control'), 'no-store');
    const data = await result.json(); assert.equal(data.error, 'EXACT_STATS_NOT_READY'); assert.equal(data.data, undefined);
    assert.equal(data.availability.reason, 'PUBLISHED_WINDOW_MISMATCH');
  }
});
test('a different current-period length also requires its own exact publication', async () => {
  const request = new Request(path.replace('days=30', 'days=7')), query = parsePriceStatsRequest(new URL(request.url));
  const oldQuery = parsePriceStatsRequest(new URL(path));
  const result = await guardPriceStatsResponse(request, response({ publication_id: 'synthetic-30', window: query.window,
    published_window: oldQuery.window, as_of: `${date(0)}T05:00:00Z`, active: { sample_count: 0 } }));
  assert.equal(result.status, 503);
});
test('real low samples in an exact current publication remain an honest successful response', async () => {
  const request = new Request(path), query = parsePriceStatsRequest(new URL(path));
  const result = await guardPriceStatsResponse(request, response({ publication_id: 'synthetic-current',
    window: query.window, published_window: query.window, as_of: `${date(0)}T05:00:00Z`,
    active: { sample_count: 0, mean: null, median: null }, sold: { sample_count: 1, min: 100, max: 100, mean: null, median: null } }));
  assert.equal(result.status, 200);
});
test('client validation retains the actual HTTP 200 and safe request URL rather than claiming an HTTP failure', async () => {
  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = async () => response({ canonical_product_id: 'cpu:synthetic',
      window: { from: '2026-08-20', to: '2026-09-18' }, published_window: { from: '2026-08-19', to: '2026-09-17' } });
    const store = createPriceStore(() => {}); await store.load([{ canonical_product_id: 'cpu:synthetic' }]);
    const result = store.get('cpu:synthetic'); assert.equal(result.state, 'error'); assert.equal(result.httpStatus, 200);
    assert.equal(result.errorCode, 'HISTORICAL_PRICE_STATS_UNAVAILABLE');
    const url = new URL(result.requestUrl, 'https://example.test'); assert.equal(url.pathname, '/api/products/cpu%3Asynthetic/price-stats');
    assert.equal(url.searchParams.get('currency'), 'KRW'); assert.equal(url.searchParams.get('market_pool'), 'KR_C2C_USED');
    assert.equal(result.data, undefined, 'rejected metric payload must not remain available for a quote');
    store.clear();
    globalThis.fetch = async () => new Response(JSON.stringify({ error: { code: 'EXACT_STATS_NOT_READY', message: 'DO_NOT_DISCLOSE_RAW_BODY' } }), { status: 503 });
    await store.load([{ canonical_product_id: 'cpu:synthetic' }]); const failed = store.get('cpu:synthetic');
    assert.equal(failed.httpStatus, 503); assert.equal(failed.errorCode, 'EXACT_STATS_NOT_READY');
    assert.ok(!JSON.stringify(failed).includes('DO_NOT_DISCLOSE_RAW_BODY'));
  } finally { globalThis.fetch = originalFetch; }
});
