import assert from "node:assert/strict";

import {
  buildRestartProbe,
  validateContinuation,
  validateDbOnlyCounters,
  validateDbOnlyExecution,
  validateFirstIndexPage,
  validatePriceRange,
  validatePriceSort,
  validateRepeatedIndexPage,
  validateRestartContinuation
} from "./cache-first-production-harness.mjs";

const signedCursor = `index:v2:abcDEF_123.${"s".repeat(24)}`;

const items = Array.from({ length: 60 }, (_, index) => ({
  id: `item-${index + 1}`,
  site: index % 2 === 0 ? "bunjang" : "joonggonara",
  title: `phone ${index + 1}`,
  price: 300_000 + index * 1_000,
  url: `https://example.test/items/${index + 1}`
}));

const first = page(items.slice(0, 30), {
  available: 60,
  cursor: signedCursor,
  snapshotVersion: 7,
  refreshedAt: "2026-08-14T10:00:00.000Z"
});
const repeated = structuredClone(first);
const second = page(items.slice(30), {
  available: 60,
  cursor: null,
  snapshotVersion: 7,
  refreshedAt: "2026-08-14T10:00:00.000Z"
});

assert.equal(validateFirstIndexPage(first, { limit: 30 }).returned, 30);
assert.equal(validateRepeatedIndexPage(first, repeated).same_order, true);
assert.equal(validateContinuation(first, second).overlap, 0);
assert.equal(validateDbOnlyCounters(
  { index_page_reads_total: 10, live_collection_runs_total: 4, source_collection_attempts_total: 20, index_ingest_commits_total: 4 },
  { index_page_reads_total: 15, live_collection_runs_total: 4, source_collection_attempts_total: 20, index_ingest_commits_total: 4 },
  5
).index_page_reads, 5);
assert.equal(validateDbOnlyExecution(first).index_page_reads, 1);
assert.equal(validatePriceSort(first).priced_items, 30);
assert.equal(validatePriceSort({
  ...first,
  items: [...first.items.slice(0, 29), { ...first.items[29], price: null }]
}).priced_items, 29);
assert.equal(validatePriceRange(first, 300_000, 329_000).checked_items, 30);

const probe = buildRestartProbe({
  keyword: "phone",
  category_id: "mobile",
  sites: ["bunjang", "joonggonara"],
  sort: "recommended",
  limit: 30,
  refresh_index: false
}, first, new Date("2026-08-14T10:01:00.000Z"), second, { id: "process-before" });
assert.equal(probe.cursor, signedCursor);
assert.equal(probe.first_ids.length, 30);
assert.equal(validateRestartContinuation(probe, second, { id: "process-after" }).snapshot_version, 7);

assert.throws(
  () => validateDbOnlyExecution({
    ...first,
    quality: {
      ...first.quality,
      execution: { index_page_reads: 1, live_collection_runs: 1, source_collection_attempts: 2, index_ingest_commits: 1 }
    }
  }),
  /must not run live collection/
);
assert.throws(
  () => validateDbOnlyCounters(
    { index_page_reads_total: 10, live_collection_runs_total: 4, source_collection_attempts_total: 20, index_ingest_commits_total: 4 },
    { index_page_reads_total: 15, live_collection_runs_total: 5, source_collection_attempts_total: 25, index_ingest_commits_total: 5 },
    5
  ),
  /must not run live collection/
);
assert.throws(
  () => validateFirstIndexPage({ ...first, freshness: { ...first.freshness, mode: "live" } }, { limit: 30 }),
  /freshness\.mode must be index/
);
assert.throws(
  () => validateFirstIndexPage({ ...first, pagination: { ...first.pagination, next_cursor: "offset:v1:legacy" } }, { limit: 30 }),
  /index:v2/
);
assert.throws(
  () => validateRepeatedIndexPage(first, { ...repeated, items: [...repeated.items].reverse() }),
  /same ordered item IDs/
);
assert.throws(
  () => validateContinuation(first, page([items[0], ...items.slice(30, 59)], {
    available: 60,
    cursor: null,
    snapshotVersion: 7,
    refreshedAt: "2026-08-14T10:00:00.000Z"
  })),
  /must not overlap/
);
assert.throws(
  () => validatePriceSort({ ...first, items: [items[1], items[0], ...items.slice(2, 30)] }),
  /ascending/
);
assert.throws(
  () => validatePriceRange(first, 301_000, 329_000),
  /outside the requested price range/
);
assert.throws(
  () => validateRestartContinuation({ ...probe, snapshot_version: 8 }, second, { id: "process-after" }),
  /snapshot version/
);
assert.throws(
  () => validateRestartContinuation(probe, second, { id: "process-before" }),
  /process instance must change/
);

console.log(JSON.stringify({ status: "passed", checks: 19 }, null, 2));

function page(pageItems, { available, cursor, snapshotVersion, refreshedAt }) {
  return {
    items: pageItems,
    pagination: {
      has_more: Boolean(cursor),
      next_cursor: cursor
    },
    quality: {
      available_count: available,
      returned_count: pageItems.length,
      page_limit: 30,
      snapshot_version: snapshotVersion,
      execution: {
        index_page_reads: 1,
        live_collection_runs: 0,
        source_collection_attempts: 0,
        index_ingest_commits: 0
      }
    },
    freshness: {
      mode: "index",
      refreshed_at: refreshedAt,
      age_seconds: 60,
      refresh_state: "fresh",
      refresh_token: null
    }
  };
}
