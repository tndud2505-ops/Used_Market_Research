import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { Worker } from "node:worker_threads";
import { SEARCH_INDEX_POLICY, SearchIndex } from "./search-index.mjs";

const LISTING_COUNT = Math.max(1, Number(process.env.INDEX_LOAD_LISTING_COUNT) || 100_000);
const sites = ["joonggonara", "bunjang", "hellomarket", "rethinkmall"];
const tempDir = mkdtempSync(path.join(os.tmpdir(), "used-market-index-load-"));
const request = { keyword: "아이폰 15", category_id: "mobile", sites };
const index = new SearchIndex({
  filePath: path.join(tempDir, "search.sqlite"),
  backupDir: path.join(tempDir, "backups"),
  limits: {
    maxActiveListings: LISTING_COUNT,
    maxQueries: 10_000,
    softBytes: 750 * 1024 * 1024,
    hardBytes: 1024 * 1024 * 1024
  }
});

function runConcurrentRead(query) {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL("./search-index-read-worker.mjs", import.meta.url), {
      workerData: { filePath: index.filePath, query }
    });
    worker.once("message", resolve);
    worker.once("error", reject);
    worker.once("exit", (code) => {
      if (code !== 0) reject(new Error(`read worker exited with code ${code}`));
    });
  });
}

try {
  const query = index.registerQuery(request);
  if (process.env.INDEX_LOAD_PROGRESS === "1") console.error(`[load] preparing ${LISTING_COUNT} listings`);
  const setupStarted = performance.now();
  index.transaction(() => {
    index.db.exec(`
      WITH RECURSIVE generated(position) AS (
        VALUES(0)
        UNION ALL
        SELECT position + 1 FROM generated WHERE position < ${LISTING_COUNT - 1}
      ), prepared AS (
        SELECT
          CASE position % 4
            WHEN 0 THEN 'joonggonara'
            WHEN 1 THEN 'bunjang'
            WHEN 2 THEN 'hellomarket'
            ELSE 'rethinkmall'
          END AS site,
          position
        FROM generated
      )
      INSERT INTO listings (
        item_id, site, category_id, title, search_text, normalized_text, compact_text,
        price_value, currency, url, image_url, location, description, posted_at,
        first_seen_at, last_seen_at, last_checked_at, inactive_at, active, content_hash
      )
      SELECT
        site || ':load-' || position,
        site,
        'mobile',
        '아이폰 15 ' || CASE WHEN position % 4 = 0 THEN '프로 ' ELSE '' END || (128 + (position % 3) * 128) || 'GB 테스트 매물 ' || position,
        '아이폰15 휴대폰 스마트폰 ' || position,
        '아이폰 15 휴대폰 스마트폰 ' || position,
        '아이폰15휴대폰스마트폰' || position,
        250000 + (position % 1500) * 1000,
        'KRW',
        'https://example.com/' || site || '/load-' || position,
        CASE WHEN position % 4 = 0 THEN NULL ELSE 'https://example.com/images/' || position || '.jpg' END,
        NULL,
        NULL,
        datetime('now', '-' || (position % 2000) || ' minutes'),
        datetime('now'), datetime('now'), datetime('now'), NULL, 1, 'load'
      FROM prepared;

      INSERT INTO query_listings(query_key, item_id, site, last_seen_at, missing_count)
      SELECT '${query.query_key}', item_id, site, datetime('now'), 0 FROM listings;
    `);
  });
  index.db.exec("PRAGMA wal_checkpoint(TRUNCATE)");
  const setupMs = Math.round(performance.now() - setupStarted);
  if (process.env.INDEX_LOAD_PROGRESS === "1") console.error(`[load] fixture ready in ${setupMs}ms; refreshing snapshot`);
  const refreshStarted = performance.now();
  const refreshResult = index.ingest(request, [], { successfulSites: sites, profile: true });
  const refreshMs = Math.round(performance.now() - refreshStarted);
  if (process.env.INDEX_LOAD_PROGRESS === "1") console.error(`[load] snapshot ready in ${refreshMs}ms; reading`);

  const queries = [
    request,
    { ...request, keyword: "iPhone15", sort: "price_asc", min_price: 300_000, max_price: 900_000 },
    { ...request, sort: "recent" },
    { ...request, sort: "recommended", min_price: 1_000_000 }
  ];
  const timings = queries.map((query) => {
    const started = performance.now();
    const result = index.search(query, { maxRows: 200 });
    return { elapsed_ms: Number((performance.now() - started).toFixed(2)), count: result.items.length };
  });
  const concurrentStarted = performance.now();
  const concurrentTimings = await Promise.all(queries.map((query) => runConcurrentRead(query)));
  const concurrentWallMs = Number((performance.now() - concurrentStarted).toFixed(2));
  const status = index.status();
  const snapshot = index.searchPage(request, { limit: SEARCH_INDEX_POLICY.maxSnapshotItems + 1 });

  assert.equal(status.active_listings, LISTING_COUNT);
  assert.equal(timings.every((result) => result.count > 0), true);
  assert.equal(concurrentTimings.every((result) => result.count > 0), true);
  assert.equal(status.database_size_bytes < 1024 * 1024 * 1024, true);
  assert.equal(status.process_memory.rss < 3 * 1024 * 1024 * 1024, true);
  assert.equal(snapshot.total, Math.min(LISTING_COUNT, SEARCH_INDEX_POLICY.maxSnapshotItems), "a single query snapshot has a bounded CPU and storage cost");
  assert.equal(refreshMs < 30_000, true, `snapshot refresh took too long: ${refreshMs}ms (${JSON.stringify(refreshResult.profile)})`);

  console.log(JSON.stringify({
    status: "passed",
    listings: LISTING_COUNT,
    fixture_setup_ms: setupMs,
    snapshot_refresh_ms: refreshMs,
    snapshot_refresh_profile: refreshResult.profile,
    query_timings: timings,
    concurrent_users: 4,
    concurrent_wall_ms: concurrentWallMs,
    concurrent_query_timings: concurrentTimings,
    database_size_bytes: status.database_size_bytes,
    rss_bytes: status.process_memory.rss
  }, null, 2));
} finally {
  index.close();
  rmSync(tempDir, { recursive: true, force: true });
}
