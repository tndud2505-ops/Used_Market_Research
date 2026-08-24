import assert from 'node:assert/strict';
import { createWebSearchRunner, WebSearchValidationError } from '../dist/web-backend/logic/search-service.js';

let now = 1_000;
let collectionCount = 0;
let releaseCollection;
let collectionStarted;

const fixture = {
  status: 'success',
  data: {
    query: 'camera',
    pagination: { has_more: false, next_cursor: null },
    searched_at: '2026-08-18T00:00:00.000Z',
    sources: [
      { key: 'joonggonara', count: 2, normalized_count: 2, extracted_count: 2, filtered_count: 0, warnings: [], errors: [] },
      { key: 'ebay', count: 1, normalized_count: 1, extracted_count: 1, filtered_count: 0, warnings: [], errors: [] }
    ],
    items: [
      { site: 'joonggonara', title: 'Mid', url: 'https://example.test/mid', price: 200, currency: 'KRW', quality_score: 0.8 },
      { site: 'joonggonara', title: 'High', url: 'https://example.test/high', price: 300, currency: 'KRW', quality_score: 0.9 },
      { site: 'ebay', title: 'Low', url: 'https://example.test/low', price: 100, currency: 'USD', quality_score: 0.7 }
    ],
    summary: { item_count: 3, source_count: 2, suspect_count: 0 },
    quality: { raw_count: 3, normalized_count: 3, merged_count: 3, available_count: 3, filtered_out_count: 0, warnings: [] }
  }
};

const runner = createWebSearchRunner({
  cacheTtlMs: 50,
  cacheMaxEntries: 4,
  now: () => now,
  collect: async () => {
    collectionCount += 1;
    if (collectionStarted) {
      collectionStarted();
      await new Promise((resolve) => { releaseCollection = resolve; });
      collectionStarted = null;
    }
    return fixture;
  }
});

const baseRequest = {
  keyword: 'camera',
  sites: ['joonggonara', 'ebay'],
  limit: 12
};

const first = await runner({ ...baseRequest, refresh_index: true, sort: 'recommended' });
assert.equal(collectionCount, 1);
assert.equal(first.data.summary.item_count, 3);

const cachedFiltered = await runner({
  ...baseRequest,
  refresh_index: false,
  sort: 'price_desc',
  min_price: 150,
  max_price: 250
});
assert.equal(collectionCount, 1, 'sort and price controls must not trigger collection');
assert.deepEqual(cachedFiltered.data.items.map((item) => item.price), [200, 300, 100]);
assert.equal(cachedFiltered.data.sources.find((source) => source.key === 'joonggonara').visible_count, 2);
assert.equal(cachedFiltered.data.sources.find((source) => source.key === 'ebay').visible_count, 1);
assert.equal(cachedFiltered.data.summary.item_count, 3);
assert.equal(cachedFiltered.data.summary.source_count, 2);
assert.equal(cachedFiltered.data.quality.merged_count, 3);
assert.equal(cachedFiltered.data.quality.available_count, 3);
assert.equal(cachedFiltered.data.quality.filtered_out_count, 0);
assert.equal(cachedFiltered.data.sort_meta.requested, 'price_desc');
assert.equal(cachedFiltered.data.sort_meta.reason, 'mixed_currency');
assert.equal(cachedFiltered.data.filter_meta.applied, false);
assert.equal(cachedFiltered.data.filter_meta.reason, 'mixed_currency');

now += 51;
await runner({ ...baseRequest, refresh_index: false, sort: 'price_asc' });
assert.equal(collectionCount, 2, 'expired cache must recollect');

collectionStarted = () => {};
const concurrentA = runner({ ...baseRequest, refresh_index: true, sort: 'price_asc' });
await new Promise((resolve) => setImmediate(resolve));
const concurrentB = runner({ ...baseRequest, refresh_index: true, sort: 'price_desc' });
await new Promise((resolve) => setImmediate(resolve));
assert.equal(collectionCount, 3, 'identical in-flight refreshes must share one collection');
releaseCollection();
const [ascending, descending] = await Promise.all([concurrentA, concurrentB]);
assert.deepEqual(ascending.data.items.map((item) => item.price), [200, 300, 100]);
assert.deepEqual(descending.data.items.map((item) => item.price), [200, 300, 100]);

await runner({ ...baseRequest, keyword: 'different', refresh_index: false });
assert.equal(collectionCount, 4, 'collection inputs must participate in the cache key');

await assert.rejects(
  () => runner({
    keyword: 'camera',
    category_ids: ['mobile', 'pc', 'camera', 'fashion', 'sports'],
    sites: ['joonggonara', 'bunjang', 'ebay']
  }),
  (error) => error instanceof WebSearchValidationError && /15 work units; maximum is 12/u.test(error.message)
);

await assert.rejects(
  () => runner({ ...baseRequest, refresh_index: 'false' }),
  (error) => error instanceof WebSearchValidationError && /refresh_index must be a boolean/u.test(error.message)
);

console.log(JSON.stringify({
  status: 'passed',
  checks: 20,
  collection_count: collectionCount,
  cache_policy: 'ttl-with-inflight-dedupe'
}, null, 2));
