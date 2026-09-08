import assert from 'node:assert/strict';
import { SERIES, money, metricValue, metricIsConsistent, buildTotals, compatibility, groupProducts, validateBuild, dailySeries, percentChange, overviewIndex, priceDateRange, shiftDate, sourceStats, coherentStats, modelPageItems } from '../web-backend/public/pc-tools-core.mjs';
import { pcCatalogResponse } from '../cloudflare/pc-directory-http.mjs';
const p = (id, category, name, specs = {}) => ({ canonical_product_id: id, category_code: category, canonical_display_name: name, key_specs: specs });
const cpu = p('cpu', 'CPU', 'CPU 5600', { socket: 'AM4' });
const board = p('board', 'MOTHERBOARD', 'B650', { socket: 'AM5', memory_generation: 'DDR5' });
const ram = p('ram', 'RAM', 'DDR4 16GB', { memory_generation: 'DDR4' });
const products = new Map([cpu, board, ram].map(p => [p.canonical_product_id, p]));
const categories = new Set(['CPU', 'MOTHERBOARD', 'RAM']);
const entries = validateBuild([{ id: 'cpu' }, { id: 'board', quantity: 2 }], products, categories);
assert.equal(metricValue({ sample_count: 0, mean: 100 }), null);
assert.equal(metricValue({ sample_count: 5, mean: null }), null);
assert.equal(metricValue({ sample_count: 5, mean: 100, max: 50 }), null);
assert.equal(metricValue({ sample_count: 4, min: 100, max: 200, mean: null, median: 150 }), 150,
  'three or four samples must expose their supported median instead of a blank mean');
assert.equal(metricValue({ sample_count: 1, min: 100, max: 100, mean: null, median: null }), null,
  'one asking price must not be relabelled as an aggregate representative price');
assert.equal(metricIsConsistent({ sample_count: 1, min: 100, max: 100, mean: null, median: null }), true,
  'a valid low-sample asking price must not be treated as an integrity failure');
assert.equal(SERIES.find((series) => series.key === 'active').label, '판매중 가격');
assert.equal(money(1234.5, 'USD'), '$1,234.50');
const totals = buildTotals(entries, e => ({ active: { mean: e.id === 'cpu' ? 100 : 50, sample_count: 5 }, sold: e.id === 'cpu' ? { mean: 80, sample_count: 5 } : null }));
assert.equal(totals.active.amount, 200);
assert.equal(totals.sold.amount, 80);
assert.equal(totals.sold.complete, false);
assert.equal(totals.confirmed_transactions.amount, null);
assert.equal(compatibility([...entries, { id: 'ram' }], products).checks.filter(c => c.status === 'conflict').length, 2);
assert.throws(() => validateBuild([{ id: 'unknown' }], products, categories));
assert.throws(() => validateBuild([{ id: 'cpu', quantity: 0 }], products, categories));
assert.throws(() => validateBuild([{ id: 'cpu' }, { id: 'cpu' }], products, categories));
const groups = groupProducts([p('a', 'GPU', 'ASUS RTX 3070', { gpu_model: 'RTX 3070', vram_gb: 8 }), p('b', 'GPU', 'MSI RTX 3070', { gpu_model: 'RTX 3070', vram_gb: 8 }), p('c', 'GPU', 'RTX 3070 Ti', { gpu_model: 'RTX 3070 Ti', vram_gb: 8 })]);
assert.equal(groups.length, 2);
assert.equal(groups[0].products.length, 2);
const data = { as_of: '2026-09-08', daily: [{ date: '2026-09-06', active: { sample_count: 5, mean: 100 } }, { date: '2026-09-08', active: { sample_count: 5, mean: 110 } }] };
const points = dailySeries(data, 'active', 3);
assert.equal(points[1].value, null, 'missing dates must be gaps, never zero or interpolated');
assert.ok(Math.abs(percentChange(points) - 10) < 0.00001);
assert.equal(overviewIndex([data], 'active', 3).points[1].value, null);
assert.equal(overviewIndex([data], 'sold', 3).covered, 0);
const range = priceDateRange('2026-08-01', '2026-08-14', '2026-09-08');
assert.equal(range.days, 14);
assert.equal(range.from, '2026-08-01');
assert.equal(range.to, '2026-08-14');
assert.equal(priceDateRange('', '', '2026-09-08').from, '2026-08-10');
assert.equal(priceDateRange('2026-09-08', '2026-09-08', '2026-09-08').days, 1);
assert.equal(priceDateRange('2024-09-09', '2026-09-08', '2026-09-08').days, 730);
assert.equal(priceDateRange('2025-02-28', '2025-03-01', '2026-09-08').days, 2);
assert.throws(() => priceDateRange('2026-08-20', '2026-08-01', '2026-09-08'));
assert.throws(() => priceDateRange('2024-09-08', '2026-09-08', '2026-09-08'));
assert.throws(() => priceDateRange('2026-09-01', '2026-09-09', '2026-09-08'));
assert.throws(() => priceDateRange('2026-02-30', '2026-03-01', '2026-09-08'));
assert.equal(shiftDate('2026-03-31', -1, 'month'), '2026-02-28');
assert.equal(shiftDate('2024-03-31', -1, 'month'), '2024-02-29');
assert.equal(sourceStats({ active: { mean: 100, sample_count: 10 }, by_source: [] }, 'bunjang'), null, 'missing site must not fall back to overall averages');
const scoped = coherentStats({ active: { mean: 41862.5, sample_count: 64 }, by_manufacturer: [{ manufacturer: 'Intel' }], by_source: [
  { source_id: 'bunjang', active: { mean: 43269.39, sample_count: 49, min: 9000, max: 200000 }, daily: data.daily },
  { source_id: 'joonggonara', active: { mean: 15866.67, sample_count: 15, min: 20000, max: 45000 }, daily: data.daily },
] });
assert.equal(scoped.active.mean, 43269.39);
assert.equal(scoped.active.sample_count, 49);
assert.equal(scoped.by_source.length, 1);
assert.equal(scoped.by_manufacturer.length, 0);
assert.equal(scoped.daily.length, 2);
assert.equal(scoped.integrity_filtered_source_count, 1);
const lowSample = coherentStats({
  active: { sample_count: 1, min: 50_000, max: 50_000, mean: null, median: null },
  by_source: [{
    source_id: 'bunjang',
    active: { sample_count: 1, min: 50_000, max: 50_000, mean: null, median: null },
    sold: { sample_count: 0, mean: null, median: null },
  }],
});
assert.equal(lowSample.active.sample_count, 1);
assert.equal(lowSample.by_source.length, 1);
const mixedLowSamples = coherentStats({
  active: { sample_count: 9, min: 1, max: 2, mean: 0 },
  by_source: [
    { source_id: 'good-a', active: { sample_count: 4, min: 40_000, max: 60_000, mean: null, median: 50_000 } },
    { source_id: 'good-b', active: { sample_count: 3, min: 55_000, max: 70_000, mean: null, median: 60_000 } },
    { source_id: 'broken', active: { sample_count: 2, min: 80_000, max: 90_000, mean: 10_000 } },
  ],
});
assert.equal(mixedLowSamples.active.sample_count, 7);
assert.equal(mixedLowSamples.active.mean, null,
  'source medians must not be relabelled as a fabricated combined mean');
assert.equal(mixedLowSamples.active.min, 40_000);
assert.equal(mixedLowSamples.active.max, 70_000);
assert.equal(mixedLowSamples.active.aggregate_incomplete, true);
assert.equal(metricIsConsistent(mixedLowSamples.active), true,
  'a combined low-sample range must stay usable after an invalid source is removed');
assert.deepEqual(modelPageItems(1, 18), [1, 2, 3, 4, 5, 'ellipsis', 18]);
assert.deepEqual(modelPageItems(18, 18), [1, 'ellipsis', 14, 15, 16, 17, 18]);
assert.deepEqual(modelPageItems(3, 4), [1, 2, 3, 4]);
const catalog = pcCatalogResponse();
assert.ok(catalog.tools_catalog.products.some(p => p.category_code === 'CASE'));
assert.ok(catalog.tools_catalog.products.some(p => p.category_code === 'COOLING'));
assert.equal(catalog.categories.some(c => c.code === 'CASE'), false, 'builder extension must not alter current marketplace search scope');
console.log('PC tools: grouping, independent prices, partial sums, quantity, compatibility, storage validation and chart gaps passed');
