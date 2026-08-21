import assert from 'node:assert/strict';
import {
  WebSearchValidationError,
  applySearchControls,
  mergeCombinedSearchPayload,
  validateWebSearchRequest
} from '../dist/web-backend/logic/search-service.js';

let checks = 0;
const check = (condition, message) => {
  assert.ok(condition, message);
  checks += 1;
};

const baseItems = [
  { id: 'mid', title: 'Mid', price: 300, currency: 'USD', score: 92, posted_at: '2026-08-16T09:00:00Z', image_url: 'mid.jpg', url: 'https://example.test/mid' },
  { id: 'low', title: 'Low', price: 100, currency: 'USD', score: 20, posted_at: '2026-08-15T09:00:00Z', url: 'https://example.test/low' },
  { id: 'high', title: 'High', price: 500, currency: 'USD', score: 65, posted_at: '2026-08-17T09:00:00Z', condition: 'Good', url: 'https://example.test/high' }
];

const ascending = applySearchControls(baseItems, { sort: 'price_asc', minPrice: null, maxPrice: null });
check(ascending.items.map((item) => item.id).join(',') === 'low,mid,high', 'price_asc should order a single currency by price');
check(ascending.sort_meta.applied === true && ascending.sort_meta.reason === 'applied', 'price_asc should report an applied machine-readable status');

const descending = applySearchControls(baseItems, { sort: 'price_desc', minPrice: null, maxPrice: null });
check(descending.items.map((item) => item.id).join(',') === 'high,mid,low', 'price_desc should order a single currency by price');

const recent = applySearchControls([
  ...baseItems,
  { id: 'invalid-date', title: 'Auction ending soon', price: 250, currency: 'USD', score: 99, posted_at: '2 hours' }
], { sort: 'recent', minPrice: null, maxPrice: null });
check(recent.items.map((item) => item.id).join(',') === 'high,mid,low,invalid-date', 'recent should use only valid absolute dates and keep invalid dates last');
check(recent.sort_meta.applied === true && recent.sort_meta.reason === 'applied', 'recent should report an applied sort');

const noDates = applySearchControls([
  { id: 'relative', price: 10, currency: 'USD', posted_at: '2\u6642\u9593' },
  { id: 'blank', price: 20, currency: 'USD', posted_at: '' },
  { id: 'invalid-calendar', price: 30, currency: 'USD', posted_at: '2026-02-30' }
], { sort: 'recent', minPrice: null, maxPrice: null });
check(noDates.items.map((item) => item.id).join(',') === 'relative,blank,invalid-calendar', 'recent should preserve source order when no valid date exists');
check(noDates.sort_meta.applied === false && noDates.sort_meta.reason === 'no_valid_dates', 'recent should explain why it was not applied');

const mixedItems = [
  { id: 'won', title: 'Won', price: 20_000, currency: 'KRW', score: 90 },
  { id: 'yen', title: 'Yen', price: 10_000, currency: 'JPY', score: 30 }
];
const mixedSort = applySearchControls(mixedItems, { sort: 'price_asc', minPrice: null, maxPrice: null });
check(mixedSort.items.map((item) => item.id).join(',') === 'won,yen', 'mixed-currency price sorting should preserve source order');
check(mixedSort.sort_meta.applied === false && mixedSort.sort_meta.reason === 'mixed_currency', 'mixed-currency sorting should expose its reason');

const mixedFilter = applySearchControls(mixedItems, { sort: 'recommended', minPrice: 15_000, maxPrice: 25_000 });
check(mixedFilter.items.length === 2, 'mixed-currency range filtering should not compare unlike currencies');
check(mixedFilter.filter_meta.applied === false && mixedFilter.filter_meta.reason === 'mixed_currency', 'mixed-currency filtering should expose its reason');

const ranged = applySearchControls(baseItems, { sort: 'price_desc', minPrice: 200, maxPrice: 400 });
check(ranged.items.map((item) => item.id).join(',') === 'mid', 'price range should filter before returning items');
check(ranged.available_count === ranged.items.length && ranged.available_count === 1, 'available_count should match the post-filter item count');
check(ranged.filter_meta.before_count === 3 && ranged.filter_meta.after_count === 1, 'filter metadata should report before and after counts');

const recommended = applySearchControls(baseItems, { sort: 'recommended', minPrice: null, maxPrice: null });
check(recommended.items.map((item) => item.id).join(',') === 'mid,high,low', 'recommended should rank stable quality/score signals instead of raw price');
check(recommended.sort_meta.reason === 'quality_signals', 'recommended should describe its restrained ranking basis');

const stableRecommended = applySearchControls([
  { id: 'first', title: 'Same', price: 200, currency: 'USD', score: 50 },
  { id: 'second', title: 'Same', price: 100, currency: 'USD', score: 50 }
], { sort: 'recommended', minPrice: null, maxPrice: null });
check(stableRecommended.items.map((item) => item.id).join(',') === 'first,second', 'recommended ties should preserve source order');

const controlledPayload = mergeCombinedSearchPayload([{
  category: { id: 'mobile', label: 'Mobile', path: ['Mobile'] },
  items: baseItems.map((item) => ({ ...item, site: 'vinted' })),
  sources: [{ key: 'vinted', count: 3, normalized_count: 3, extracted_count: 3, filtered_count: 0, warnings: [], errors: [] }],
  quality: { raw_count: 3, normalized_count: 3, warnings: [] },
  pagination: { has_more: false, next_cursor: null }
}], [{ id: 'mobile', label: 'Mobile', path: ['Mobile'] }], [], {
  sort: 'price_desc',
  minPrice: 200,
  maxPrice: 400
});
check(controlledPayload.items.map((item) => item.id).join(',') === 'mid', 'combined payload should return only post-filter items');
check(controlledPayload.summary.item_count === 1 && controlledPayload.quality.available_count === 1, 'summary and quality counts should match displayed items');
check(controlledPayload.sources[0].visible_count === 1, 'source visible_count should match displayed items');
check(controlledPayload.sort_meta.applied === true && controlledPayload.filter_meta.applied === true, 'combined payload should expose applied control metadata');

const validRequest = validateWebSearchRequest({
  keyword: 'iphone 13',
  sites: ['vinted'],
  sort: 'price_desc',
  min_price: 100,
  max_price: 500
});
check(validRequest.sort === 'price_desc' && validRequest.minPrice === 100 && validRequest.maxPrice === 500, 'validated controls should be reflected in the request');

for (const input of [
  { keyword: 'iphone', sort: 'cheap_first' },
  { keyword: 'iphone', min_price: '100' },
  { keyword: 'iphone', max_price: Number.NaN },
  { keyword: 'iphone', min_price: -1 },
  { keyword: 'iphone', min_price: 500, max_price: 100 }
]) {
  assert.throws(
    () => validateWebSearchRequest(input),
    (error) => error instanceof WebSearchValidationError,
    `invalid controls should be rejected: ${JSON.stringify(input)}`
  );
  checks += 1;
}

console.log(JSON.stringify({ ok: true, checks }, null, 2));
