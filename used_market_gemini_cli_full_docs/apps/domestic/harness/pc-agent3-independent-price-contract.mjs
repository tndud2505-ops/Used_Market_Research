import assert from 'node:assert/strict';
import { inspectPriceMetric, inspectPriceStats, independentQuoteLine, independentQuoteTotals } from './lib/pc-independent-price-audit.mjs';

const empty = () => ({ sample_count: 0, mean: null, median: null, min: null, max: null });
const metric = n => ({ sample_count: n, mean: n >= 5 ? 145000 : null, median: n >= 3 ? 140000 : null, min: n ? 100000 : null, max: n ? 200000 : null });
const expected = { productId: 'ram:g-skill:ddr4:16gb', marketPool: 'KR_C2C_USED', condition: 'USED_WORKING', currency: 'KRW', days: 30,
  versions: { normalization: 18, parser: 'pc-parser-v8', rule: 'pc-rules-v18', filter: 'pc-filter-v7' } };
const stats = () => ({ canonical_product_id: expected.productId, active: metric(5), reserved: empty(), sold: metric(3), confirmed_transactions: empty(),
  methodology: { market_pool: expected.marketPool, condition: expected.condition, currency: expected.currency, days: 30 }, versions: expected.versions,
  as_of: '2026-09-17T05:00:00.000Z', publication_id: 'synthetic-publication', published_window: { from: '2026-08-19', to: '2026-09-17', days: 30 },
  traceability: { member_count: 10, member_checksum: 'a'.repeat(64) }, by_source: [] });
for (const n of [0, 1, 2, 3, 4, 5, 10]) {
  const result = inspectPriceMetric(metric(n));
  assert.deepEqual(result.problems, []);
  assert.equal(result.value, n < 3 ? null : n < 5 ? 140000 : 145000);
}
assert.equal(inspectPriceMetric({ ...metric(2), mean: 123 }).value, null);
assert.ok(inspectPriceMetric({ ...metric(5), median: null }).problems.includes('MEDIAN_MISSING'));
assert.ok(inspectPriceMetric({ ...metric(5), aggregate_incomplete: true }).problems.includes('AGGREGATE_INCOMPLETE'));
assert.equal(inspectPriceStats(stats(), expected).exact_ready, true);
assert.equal(inspectPriceStats({ ...stats(), publication_id: undefined }, expected).cause, 'INTERNAL_STATS_OR_PUBLICATION_ERROR');
assert.ok(inspectPriceStats(stats(), { ...expected, asOfDate: '2026-09-16' }).problems.includes('HISTORICAL_WINDOW_SUBSTITUTED'));
assert.ok(inspectPriceStats(stats(), { ...expected, currency: 'USD' }).problems.includes('SCOPE_MISMATCH:currency'));
assert.ok(inspectPriceStats(stats(), { ...expected, productId: 'other' }).problems.includes('PRODUCT_ID_MISMATCH'));
assert.ok(inspectPriceStats(stats(), { ...expected, browseOnly: true }).problems.includes('BROWSE_FACET_PRICED'));
const line = independentQuoteLine({ id: expected.productId, stats: stats(), quantity: 2, expected });
assert.equal(line.unit_price, 145000); assert.equal(line.line_total, 290000);
const broken = independentQuoteLine({ id: expected.productId, stats: { ...stats(), publication_id: null }, quantity: 2, expected });
assert.equal(broken.line_total, null);
assert.equal(independentQuoteLine({ id: expected.productId, stats: stats(), quantity: 1, sourceId: 'missing', expected }).cause,
  'SELECTED_SOURCE_NO_PUBLISHED_METRIC');
assert.equal(independentQuoteTotals([broken])[0].subtotal, null, 'no priced row is not a zero-won finished build');
assert.equal(independentQuoteTotals([line, { ...line, currency: 'USD' }]).length, 2, 'no exchange-rate-free currency merge');
assert.equal(independentQuoteTotals([line, { ...line, publication_id: 'another' }]).length, 2, 'no cross-publication merge');
assert.throws(() => independentQuoteLine({ id: expected.productId, stats: stats(), quantity: NaN, expected }), /INVALID_QUANTITY/);
console.log(JSON.stringify({ status: 'passed', contract: 'agent3-independent-price', synthetic_only: true, app_aggregation_imports: 0 }));
