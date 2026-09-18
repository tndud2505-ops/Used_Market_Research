// Deterministic frontend regression checks. No production credentials/network/browser.
import assert from 'node:assert/strict';
import { metricValue, metricPresentation, priceRecordIssue, analysisSelectionUrl, sourceStats, scopedStats, buildTotals, validateBuild } from '../web-backend/public/pc-tools-core.mjs';
import { createPriceStore, readJson } from '../web-backend/public/pc-tools-data.mjs';
import { filterToolProducts, toolBrand, toolFilterSchema, toolFacetValues } from '../web-backend/public/pc-tools-catalog.mjs';
import { pcCatalogResponse } from '../cloudflare/pc-directory-http.mjs';
import { readFileSync } from 'node:fs';

const incomplete = { sample_count: 37, min: 100, max: 300, mean: 200, median: 200, aggregate_incomplete: true };
assert.equal(metricValue(incomplete), null, 'unfinished exact publication cannot enter a quote, even if a central value is present');
assert.equal(metricPresentation(incomplete).state, 'incomplete');
assert.match(metricPresentation(incomplete).text, /집계 준비/);
assert.equal(metricValue({ sample_count: 3.5, median: 100, min: 90, max: 110 }), null);
assert.equal(metricValue({ sample_count: 5, mean: 100, median: 900, min: 90, max: 110 }), null);
assert.equal(metricPresentation({ sample_count: 37, min: 100, max: 200, mean: null, median: null }).state, 'invalid');
assert.equal(metricPresentation({ sample_count: 4, min: 100, max: 300, mean: 200, median: 200 }).label, '중앙값', '3–4 samples are never labelled mean');
const low = { sample_count: 2, min: 100, max: 200, mean: null, median: null };
assert.equal(metricPresentation(low).state, 'insufficient');
assert.equal(metricValue(low), null);
assert.match(priceRecordIssue({ state: 'ready', data: { active: incomplete } }), /고유 매물/);
assert.match(priceRecordIssue({ state: 'error', error: 'HTTP 503' }), /조회 실패/);
assert.match(priceRecordIssue({ state: 'ready', data: { availability: { status: 'unavailable' } } }), /표본 부족 여부/);
assert.equal(priceRecordIssue({ state: 'ready', data: { active: low } }), '');
const facet = { canonical_product_id: 'board-facet', category_code: 'MOTHERBOARD', key_specs: { directory_node_type: 'BROWSE_FACET' } };
assert.throws(() => validateBuild([{ id: 'board-facet' }], new Map([['board-facet', facet]]), new Set(['MOTHERBOARD'])),
  /정확 모델/, 'saved/shared builds cannot bypass the exclusion of exploration-only motherboard nodes');

const href = 'https://example.test/price-analysis.html?model=old&manufacturer=old-maker&keep=1';
const switched = new URL(analysisSelectionUrl(href, 'ram:g-skill:ddr4:16gb'));
assert.equal(switched.searchParams.get('model'), 'ram:g-skill:ddr4:16gb');
assert.equal(switched.searchParams.has('manufacturer'), false);
assert.equal(switched.searchParams.get('keep'), '1');
const cleared = new URL(analysisSelectionUrl(href));
assert.equal(cleared.searchParams.has('model'), false);
assert.equal(cleared.searchParams.has('manufacturer'), false);
const source = sourceStats({ publication_id: 'p-test', traceability: { member_count: 99 }, methodology: { currency: 'USD', market_pool: 'OVERSEAS_USED' },
  by_source: [{ source_id: 'ebay', active: low, traceability: { member_count: 2 } }], window: { to: '2026-09-17' } }, 'ebay');
assert.equal(source.methodology.currency, 'USD');
assert.equal(source.publication_id, 'p-test');
assert.equal(source.traceability.member_count, 2, 'source traceability cannot be borrowed from the market total');
assert.equal(sourceStats({ by_source: [] }, 'bunjang'), null);
assert.equal(scopedStats({ active: low, by_manufacturer: [] }, 'unknown-maker'), null);
const totals = buildTotals([{ id: 'ram', quantity: 2 }, { id: 'gpu', quantity: 1 }], e => ({ active: e.id === 'ram'
  ? { sample_count: 4, min: 100, max: 300, median: 200 } : incomplete }));
assert.deepEqual(totals.active, { amount: 400, covered: 2, total: 3, complete: false });

const catalog = pcCatalogResponse(), products = catalog.tools_catalog.products;
const priceProducts = filterToolProducts(products), groups = {};
for (const product of priceProducts) {
  const facets = Object.fromEntries(toolFilterSchema(product.category_code).map(([key]) => [key, toolFacetValues(product, key)[0] || '']));
  assert.ok(filterToolProducts(products, { category: product.category_code, manufacturer: toolBrand(product), facets })
    .some(row => row.canonical_product_id === product.canonical_product_id));
  groups[product.category_code] = (groups[product.category_code] || 0) + 1;
}
assert.equal(Object.keys(groups).length, 9);
const exploration = products.filter(p => p.category_code === 'MOTHERBOARD' && p.key_specs?.directory_node_type !== 'PRODUCT');
assert.equal(exploration.length, 10);
for (const product of exploration) assert.throws(() => validateBuild([{ id: product.canonical_product_id }],
  new Map(products.map(p => [p.canonical_product_id, p])), new Set(catalog.tools_catalog.categories.map(c => c.code))), /정확 모델/);

const originalFetch = globalThis.fetch;
try {
  globalThis.fetch = async () => new Response(JSON.stringify({ error: { code: 'HISTORICAL_PRICE_STATS_UNAVAILABLE', message: 'raw-private-response' } }), { status: 503 });
  await assert.rejects(readJson('/api/test'), error => error.code === 'HISTORICAL_PRICE_STATS_UNAVAILABLE' && error.httpStatus === 503
    && !error.message.includes('raw-private-response'));
  globalThis.fetch = async () => new Response('upstream unavailable', { status: 502 });
  await assert.rejects(readJson('/api/test'), /502/);
  globalThis.fetch = async () => new Response(JSON.stringify({ canonical_product_id: 'ram', methodology: { currency: 'USD' }, active: low }));
  const store = createPriceStore(() => {});
  await store.load([{ canonical_product_id: 'ram' }]);
  assert.equal(store.get('ram').state, 'error', 'USD cannot enter the KRW build store');
  globalThis.fetch = async () => new Response(JSON.stringify({ canonical_product_id: 'ram', methodology: { currency: 'KRW' }, active: incomplete }));
  await store.load([{ canonical_product_id: 'ram' }]);
  assert.equal(metricValue(store.get('ram').data.active), null);
  store.clear();
} finally { globalThis.fetch = originalFetch; }

// Wiring assertions supplement pure contracts; they do not claim DOM/browser execution.
const script = readFileSync(new URL('../web-backend/public/pc-tools.js', import.meta.url), 'utf8');
assert.match(script, /state\.selectedId = idOf\(currentProducts\(\)\[0\]\);\s+syncAnalysisUrl\(\)/);
assert.match(script, /const sortData = builder \? payload : analysisData/);
assert.match(script, /overseasPrices\.load\(overseas \? targets : \[\]/);
assert.match(script, /refreshBuildPriceDetails\(\)/);
for (const name of ['computer-builder.html', 'price-analysis.html']) {
  const html = readFileSync(new URL(`../web-backend/public/${name}`, import.meta.url), 'utf8');
  // Approved UI-A candidate preserves the parts-ux-v4 data/calculation modules.
  // This is a source manifest assertion, NOT a claim of public deployment.
  assert.match(html, /pc-tools\.js\?v=ui-a-v2/);
  assert.match(html, /pc-tools\.css\?v=parts-ux-v4/);
  assert.match(html, /ui-concept-a\.css\?v=ui-a-v2/);
}
console.log(JSON.stringify({ status: 'PASS', kind: 'deterministic frontend; synthetic responses; no browser/live claim',
  price_products: priceProducts.length, exploration_excluded: exploration.length, category_counts: groups,
  checks: ['incomplete and invalid representatives excluded', '3–4 sample median label', 'API failure vs low sample',
    'URL model/manufacturer synchronization helper and wiring', 'source scope/traceability inheritance', 'RAM quantity partial totals',
    'all registered category/facet paths', 'exploration-only saved build rejection', 'HTTP failure code without raw body',
    'currency contract rejection', 'site-specific price-sort wiring', 'asset cache version references'] }, null, 2));
