import assert from 'node:assert/strict';
import { parsePriceStatsRequest, priceStatsResponse } from '../aws-runner/pc-price-stats-http.mjs';
const now = Date.parse('2026-09-17T06:00:00.000Z');
const request = parsePriceStatsRequest(new URL('https://test.invalid/api/products/ram%3Ag-skill%3Addr4%3A16gb/price-stats?days=30'), now);
const incomplete = { active: { sample_count: 37, mean: null, median: null, aggregate_incomplete: true },
  sold: { sample_count: 8, mean: null, median: null, aggregate_incomplete: true } };
const response = priceStatsResponse(request, incomplete);
assert.equal(response.availability.status, 'UNAVAILABLE');
assert.equal(response.availability.code, 'EXACT_STATS_NOT_READY');
assert.equal(response.availability.counts_are_unique_period_listings, false);
assert.equal(response.reference_price.amount, null);
assert.equal(response.confidence.level, '통계 준비 미완료');
const historical = parsePriceStatsRequest(new URL('https://test.invalid/api/products/ram%3Ag-skill%3Addr4%3A16gb/price-stats?days=30&as_of=2026-09-16'), now);
assert.equal(priceStatsResponse(historical, incomplete).availability.code, 'HISTORICAL_EXACT_STATS_UNAVAILABLE');
const exact = { publication_id: 'synthetic-only', published_window: { from: '2026-08-19', to: '2026-09-17', days: 30 },
  active: { sample_count: 15, mean: 129500, median: 130000 }, sold: { sample_count: 8, mean: 126237.5, median: 132500 } };
assert.equal(priceStatsResponse(request, exact).reference_price.amount, 132500);
assert.equal(priceStatsResponse(request, exact).availability.status, 'EXACT_PUBLISHED');
assert.throws(() => priceStatsResponse(historical, exact), error => error.code === 'HISTORICAL_PRICE_STATS_UNAVAILABLE'
  && error.reason === 'PUBLISHED_WINDOW_MISMATCH');
const low = priceStatsResponse(request, { publication_id: 'synthetic-only', sold: { sample_count: 2, median: null, mean: null } });
assert.equal(low.confidence.level, '자료 부족', 'genuine low sample size remains distinct');
assert.equal(low.reference_price.amount, null);
console.log(JSON.stringify({ status: 'passed', contract: 'agent3-stats-readiness', synthetic_only: true,
  incomplete_not_market_scarcity: true, historical_latest_substitution_rejected: true }));
