import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { canonicalCollectionQuery, collectionIdentity, normalizeSearchQuery, SearchIndex } from "./search-index.mjs";

const tempDir = mkdtempSync(path.join(os.tmpdir(), "used-market-index-"));
let now = Date.UTC(2026, 7, 14, 0, 0, 0);
const index = new SearchIndex({
  filePath: path.join(tempDir, "search.sqlite"),
  backupDir: path.join(tempDir, "backups"),
  now: () => now,
  limits: { maxActiveListings: 10, maxQueries: 10, softBytes: 100_000_000, hardBytes: 200_000_000 }
});

try {
  const legacyPath = path.join(tempDir, "legacy.sqlite");
  const legacyDb = new DatabaseSync(legacyPath);
  const legacyRequest = { keyword: "기존 아이폰", sites: ["bunjang"], category_id: "mobile", sort: "price_asc" };
  const legacyIdentity = collectionIdentity(legacyRequest);
  const emptySiteLegacyRequest = { keyword: "설화수", sites: [], category_id: "beauty" };
  const emptySiteLegacyIdentity = collectionIdentity(emptySiteLegacyRequest);
  const legacyNow = new Date(now).toISOString();
  const legacyOldRefresh = new Date(now - 2 * 60 * 60_000).toISOString();
  const legacyExpires = new Date(now + 60 * 60_000).toISOString();
  legacyDb.exec(`
    CREATE TABLE listings (
      item_id TEXT PRIMARY KEY,
      site TEXT NOT NULL,
      category_id TEXT NOT NULL DEFAULT 'all',
      title TEXT NOT NULL,
      search_text TEXT NOT NULL,
      normalized_text TEXT NOT NULL,
      compact_text TEXT NOT NULL,
      price_value REAL,
      currency TEXT NOT NULL DEFAULT 'KRW',
      url TEXT NOT NULL,
      image_url TEXT,
      location TEXT,
      description TEXT,
      posted_at TEXT,
      first_seen_at TEXT NOT NULL,
      last_seen_at TEXT NOT NULL,
      last_checked_at TEXT NOT NULL,
      inactive_at TEXT,
      active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0, 1)),
      content_hash TEXT NOT NULL
    ) STRICT;

    CREATE TABLE query_index (
      query_key TEXT PRIMARY KEY,
      canonical_query TEXT NOT NULL,
      keyword TEXT NOT NULL,
      category_ids_json TEXT NOT NULL,
      sites_json TEXT NOT NULL,
      first_requested_at TEXT NOT NULL,
      last_requested_at TEXT NOT NULL,
      request_window_started_at TEXT NOT NULL,
      request_count_24h INTEGER NOT NULL DEFAULT 1,
      total_request_count INTEGER NOT NULL DEFAULT 1,
      last_refreshed_at TEXT,
      last_deep_refreshed_at TEXT,
      result_count INTEGER NOT NULL DEFAULT 0,
      last_error TEXT,
      snapshot_version INTEGER NOT NULL DEFAULT 0
    ) STRICT;

    CREATE TABLE query_listings (
      query_key TEXT NOT NULL REFERENCES query_index(query_key) ON DELETE CASCADE,
      item_id TEXT NOT NULL REFERENCES listings(item_id) ON DELETE CASCADE,
      site TEXT NOT NULL,
      last_seen_at TEXT NOT NULL,
      missing_count INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY(query_key, item_id)
    ) STRICT;

    CREATE TABLE query_snapshots (
      query_key TEXT NOT NULL REFERENCES query_index(query_key) ON DELETE CASCADE,
      snapshot_version INTEGER NOT NULL,
      created_at TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      total_count INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY(query_key, snapshot_version)
    ) STRICT;

    CREATE TABLE query_snapshot_items (
      query_key TEXT NOT NULL,
      snapshot_version INTEGER NOT NULL,
      item_id TEXT NOT NULL REFERENCES listings(item_id) ON DELETE CASCADE,
      site TEXT NOT NULL,
      item_json TEXT NOT NULL,
      price_rank INTEGER NOT NULL,
      price_value REAL,
      price_sort REAL NOT NULL,
      posted_sort_at TEXT NOT NULL,
      image_rank INTEGER NOT NULL,
      PRIMARY KEY(query_key, snapshot_version, item_id),
      FOREIGN KEY(query_key, snapshot_version)
        REFERENCES query_snapshots(query_key, snapshot_version) ON DELETE CASCADE
    ) STRICT;
  `);
  legacyDb.prepare(`
    INSERT INTO listings(
      item_id, site, category_id, title, search_text, normalized_text, compact_text,
      price_value, currency, url, first_seen_at, last_seen_at, last_checked_at, active, content_hash
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?)
  `).run(
    "legacy:1", "bunjang", "mobile", "기존 아이폰", "기존 아이폰", "기존 아이폰", "기존아이폰",
    500_000, "KRW", "https://example.com/legacy", new Date(now).toISOString(), new Date(now).toISOString(), new Date(now).toISOString(), "legacy-hash"
  );
  legacyDb.prepare(`
    INSERT INTO query_index(
      query_key, canonical_query, keyword, category_ids_json, sites_json,
      first_requested_at, last_requested_at, request_window_started_at,
      request_count_24h, total_request_count, last_refreshed_at, result_count, snapshot_version
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, 1, ?, 1, 1)
  `).run(
    legacyIdentity.key,
    legacyIdentity.canonicalQuery,
    legacyIdentity.collectionQuery,
    JSON.stringify(legacyIdentity.categoryIds),
    JSON.stringify(legacyIdentity.sites),
    legacyNow,
    legacyNow,
    legacyNow,
    legacyNow
  );
  legacyDb.prepare(`
    INSERT INTO query_index(
      query_key, canonical_query, keyword, category_ids_json, sites_json,
      first_requested_at, last_requested_at, request_window_started_at,
      request_count_24h, total_request_count, last_refreshed_at, result_count, snapshot_version
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 2, 2, ?, 0, 0)
  `).run(
    emptySiteLegacyIdentity.key,
    emptySiteLegacyIdentity.canonicalQuery,
    emptySiteLegacyIdentity.collectionQuery,
    JSON.stringify(emptySiteLegacyIdentity.categoryIds),
    JSON.stringify(emptySiteLegacyIdentity.sites),
    legacyNow,
    legacyNow,
    legacyNow,
    legacyOldRefresh
  );
  legacyDb.prepare("INSERT INTO query_listings(query_key, item_id, site, last_seen_at, missing_count) VALUES (?, ?, ?, ?, 0)")
    .run(legacyIdentity.key, "legacy:1", "bunjang", legacyNow);
  legacyDb.prepare("INSERT INTO query_snapshots(query_key, snapshot_version, created_at, expires_at, total_count) VALUES (?, 1, ?, ?, 1)")
    .run(legacyIdentity.key, legacyNow, legacyExpires);
  const legacyFrozenJson = JSON.stringify({ id: "legacy:1", item_id: "legacy:1", site: "bunjang", title: "고정된 기존 아이폰", price: 500_000, url: "https://example.com/legacy" });
  legacyDb.prepare(`
    INSERT INTO query_snapshot_items(
      query_key, snapshot_version, item_id, site, item_json, price_rank,
      price_value, price_sort, posted_sort_at, image_rank
    ) VALUES (?, 1, ?, ?, ?, 0, ?, ?, ?, 1)
  `).run(legacyIdentity.key, "legacy:1", "bunjang", legacyFrozenJson, 500_000, 500_000, legacyNow);
  legacyDb.close();
  const migratedLegacyIndex = new SearchIndex({ filePath: legacyPath, now: () => now });
  try {
    const migratedLegacyRow = migratedLegacyIndex.db.prepare("SELECT title FROM listings WHERE item_id = ?").get("legacy:1");
    assert.equal(migratedLegacyRow.title, "기존 아이폰", "quality migration preserves existing listings");
    const migratedQueryListingColumns = new Set(migratedLegacyIndex.db.prepare("PRAGMA table_info(query_listings)").all().map((row) => row.name));
    for (const column of ["quality_evaluated", "price_suspect", "quality_suspect", "noise_filtered", "noise_filter_reason", "fraud_risk"]) {
      assert(migratedQueryListingColumns.has(column), `query-scoped quality migration includes ${column}`);
    }
    const migratedMapping = migratedLegacyIndex.db.prepare("SELECT quality_evaluated FROM query_listings WHERE query_key = ? AND item_id = ?")
      .get(legacyIdentity.key, "legacy:1");
    assert.equal(migratedMapping.quality_evaluated, 0, "legacy query quality remains unevaluated until refreshed");
    const migratedSnapshotRows = migratedLegacyIndex.db.prepare("SELECT item_json FROM query_snapshot_items WHERE query_key = ? AND snapshot_version = 1").all(legacyIdentity.key);
    assert.equal(migratedSnapshotRows.length, 1, "snapshot migration preserves active snapshot rows");
    assert.equal(migratedSnapshotRows[0].item_json, legacyFrozenJson, "snapshot migration preserves frozen item JSON");
    const migratedQueryColumns = new Set(migratedLegacyIndex.db.prepare("PRAGMA table_info(query_index)").all().map((row) => row.name));
    for (const column of ["refresh_failure_count", "next_refresh_attempt_at", "refresh_disabled_reason"]) {
      assert(migratedQueryColumns.has(column), `refresh scheduler migration includes ${column}`);
    }
    const quarantinedLegacyQuery = migratedLegacyIndex.getQuery(emptySiteLegacyIdentity.key);
    assert.equal(quarantinedLegacyQuery.refresh_disabled_reason, "no_target_sites", "legacy empty-site queries are quarantined during migration");
    assert.equal(migratedLegacyIndex.dueQueries(10).some((row) => row.query_key === emptySiteLegacyIdentity.key), false, "quarantined legacy queries never consume refresh slots");
    const invalidLegacyToken = "00000000-0000-4000-8000-000000000000";
    migratedLegacyIndex.db.prepare(`
      INSERT INTO refresh_jobs(token, query_key, request_json, state, created_at, expires_at)
      VALUES (?, ?, ?, 'queued', ?, ?)
    `).run(invalidLegacyToken, emptySiteLegacyIdentity.key, JSON.stringify(emptySiteLegacyRequest), legacyNow, legacyExpires);
    const malformedLegacyToken = "00000000-0000-4000-8000-000000000001";
    const unsupportedLegacyToken = "00000000-0000-4000-8000-000000000002";
    const emptySearchLegacyToken = "00000000-0000-4000-8000-000000000003";
    const insertLegacyRefreshJob = migratedLegacyIndex.db.prepare(`
      INSERT INTO refresh_jobs(token, query_key, request_json, state, created_at, expires_at)
      VALUES (?, ?, ?, 'queued', ?, ?)
    `);
    insertLegacyRefreshJob.run(malformedLegacyToken, emptySiteLegacyIdentity.key, "{", legacyNow, legacyExpires);
    insertLegacyRefreshJob.run(unsupportedLegacyToken, emptySiteLegacyIdentity.key, JSON.stringify({ keyword: "설화수", sites: ["bogus"] }), legacyNow, legacyExpires);
    insertLegacyRefreshJob.run(emptySearchLegacyToken, emptySiteLegacyIdentity.key, JSON.stringify({ keyword: "", category_ids: [], sites: ["bunjang"] }), legacyNow, legacyExpires);
    assert.equal(
      migratedLegacyIndex.nextQueuedRefreshJob(["bunjang", "joonggonara", "hellomarket", "rethinkmall"]),
      null,
      "invalid queued jobs are discarded before the runner spends a refresh slot"
    );
    assert.equal(migratedLegacyIndex.getRefreshJob(invalidLegacyToken).state, "failed", "discarded invalid jobs retain an auditable failure state");
    assert.equal(migratedLegacyIndex.getRefreshJob(malformedLegacyToken).state, "failed", "malformed queued JSON is quarantined instead of stopping the scheduler");
    assert.equal(migratedLegacyIndex.getRefreshJob(unsupportedLegacyToken).state, "failed", "unsupported queued sites are quarantined locally");
    assert.equal(migratedLegacyIndex.getRefreshJob(emptySearchLegacyToken).state, "failed", "queued jobs without a keyword or category are quarantined locally");
    const migratedPage = migratedLegacyIndex.searchPage(legacyRequest, { limit: 30, snapshotVersion: 1 });
    assert.equal(migratedPage.items[0].title, "고정된 기존 아이폰", "a continuation can still read the preserved snapshot after migration");
  } finally {
    migratedLegacyIndex.close();
  }
  const reopenedLegacyIndex = new SearchIndex({ filePath: legacyPath, now: () => now });
  try {
    assert.equal(
      Number(reopenedLegacyIndex.db.prepare("SELECT COUNT(*) AS count FROM query_snapshot_items").get().count),
      1,
      "quality migration is idempotent and keeps the preserved snapshot"
    );
    assert.equal(Number(reopenedLegacyIndex.db.prepare("PRAGMA user_version").get().user_version), 5, "refresh scheduler schema version is recorded");
    assert.equal(reopenedLegacyIndex.getQuery(legacyIdentity.key).site_window, 160, "legacy queries receive the initial site window");
  } finally {
    reopenedLegacyIndex.close();
  }

  assert.equal(normalizeSearchQuery("아이폰 15"), "아이폰15");
  assert.equal(normalizeSearchQuery("iPhone-15"), "아이폰15");
  assert.equal(canonicalCollectionQuery("iPhone-15"), "아이폰 15");
  assert.equal(canonicalCollectionQuery("iPhone15"), "아이폰 15");
  assert.equal(canonicalCollectionQuery("아이폰15 프로"), "아이폰 15 프로");
  assert.equal(canonicalCollectionQuery("갤럭시 S24"), "갤럭시 s24");
  assert.equal(canonicalCollectionQuery("갤럭시 S 24"), "갤럭시 s24");
  assert.equal(canonicalCollectionQuery("MacBook M2"), "맥북 m2");
  assert.equal(canonicalCollectionQuery("다이슨 V10"), "다이슨 v10");
  assert.equal(canonicalCollectionQuery("RTX3070"), "rtx 3070");
  assert.notEqual(normalizeSearchQuery("아이폰15"), normalizeSearchQuery("아이폰15 프로"));

  const baseRequest = { keyword: "아이폰 15", sites: ["bunjang"], category_id: "mobile" };
  const priceRequest = { ...baseRequest, sort: "price_asc", min_price: 500_000, max_price: 900_000 };
  assert.equal(collectionIdentity(baseRequest).key, collectionIdentity(priceRequest).key);
  assert.throws(
    () => index.registerQuery({ keyword: "설화수", sites: [], category_id: "beauty" }),
    /at least one target site is required/u,
    "empty-site searches are rejected before they can enter the scheduler"
  );
  assert.throws(
    () => index.createRefreshJob({ keyword: "설화수", sites: [], category_id: "beauty" }),
    /at least one target site is required/u,
    "empty-site refresh jobs are rejected before queueing"
  );

  let query = index.registerQuery(baseRequest);
  assert.equal(query.site_window, 160, "new queries start with the initial source window");
  assert.equal(query.tier, "cold");
  query = index.registerQuery({ ...baseRequest, site_window: 480 });
  assert.equal(query.site_window, 480, "on-demand collection depth is retained for refresh jobs");
  query = index.registerQuery({ ...baseRequest, site_window: 160 });
  assert.equal(query.site_window, 480, "later shallow requests do not shrink a progressively expanded query");

  const firstItems = [
    { id: "bunjang:1", site: "bunjang", category_id: "mobile", title: "아이폰 15 128GB", price: 700_000, currency: "KRW", url: "https://example.com/1", image_url: "https://example.com/1.jpg" },
    { id: "bunjang:2", site: "bunjang", category_id: "mobile", title: "아이폰 15 프로", price: 1_100_000, currency: "KRW", url: "https://example.com/2" }
  ];
  const firstIngest = index.ingest(baseRequest, [firstItems[0], firstItems[0], firstItems[1]], { deep: true, complete: true, successfulSites: ["bunjang"] });
  assert.equal(firstIngest.inserted, 2);
  assert.equal(index.search(baseRequest).items.length, 2);
  assert.deepEqual(index.search(priceRequest).items.map((item) => item.id), ["bunjang:1"]);

  const qualityRequest = { keyword: "갤럭시 S24", sites: ["joonggonara"], category_id: "mobile", sort: "price_asc" };
  const qualityItems = [
    { id: "quality:trusted", site: "joonggonara", category_id: "mobile", title: "갤럭시 S24 256GB 본체", price: 400_000, currency: "KRW", url: "https://example.com/trusted" },
    { id: "quality:price", site: "joonggonara", category_id: "mobile", title: "갤럭시 S24 가격 확인", price: 500, currency: "KRW", url: "https://example.com/price", price_suspect: true },
    { id: "quality:quality", site: "joonggonara", category_id: "mobile", title: "갤럭시 S24 상태 확인", price: 1_000, currency: "KRW", url: "https://example.com/quality", quality_suspect: true },
    { id: "quality:fraud", site: "joonggonara", category_id: "mobile", title: "갤럭시 S24 위험 확인", price: 2_000, currency: "KRW", url: "https://example.com/fraud", fraud_risk: 0.9 },
    { id: "quality:noise", site: "joonggonara", category_id: "mobile", title: "갤럭시 S24 박스만", price: 3_000, currency: "KRW", url: "https://example.com/noise", noise_filtered: true, noise_filter_reason: "accessory_only" },
    { id: "quality:boundary", site: "joonggonara", category_id: "mobile", title: "갤럭시 S24 경계", price: 410_000, currency: "KRW", url: "https://example.com/boundary", fraud_risk: 0.45 },
    { id: "quality:invalid", site: "joonggonara", category_id: "mobile", title: "갤럭시 S24 범위 밖", price: 420_000, currency: "KRW", url: "https://example.com/invalid", fraud_risk: 2 },
    { id: "quality:missing", site: "joonggonara", category_id: "mobile", title: "갤럭시 S24 가격 문의", price: null, currency: "KRW", url: "https://example.com/missing" }
  ];
  index.ingest(qualityRequest, qualityItems, { deep: true, complete: true, successfulSites: ["joonggonara"] });
  const qualityPage = index.searchPage(qualityRequest, { limit: 10 });
  assert.deepEqual(
    qualityPage.items.map((item) => item.id),
    ["quality:price", "quality:quality", "quality:fraud", "quality:noise", "quality:trusted", "quality:boundary", "quality:invalid", "quality:missing"],
    "price sorting keeps numeric price primary while retaining suspicion metadata"
  );
  assert.equal(qualityPage.items[0].price_suspect, true, "price suspicion survives SQLite ingestion");
  assert.equal(qualityPage.items[3].noise_filter_reason, "accessory_only", "noise reason survives SQLite ingestion");
  assert.equal(qualityPage.items[2].fraud_risk, 0.9, "fraud risk survives SQLite ingestion");
  assert.equal(qualityPage.items[5].fraud_risk, 0.45, "fraud boundary remains trusted and is persisted");
  assert.equal(qualityPage.items[6].fraud_risk, null, "out-of-range fraud values are discarded");
  const qualityFirstPage = index.searchPage(qualityRequest, { limit: 2 });
  const qualitySecondPage = index.searchPage(qualityRequest, {
    limit: 2,
    snapshotVersion: qualityFirstPage.snapshotVersion,
    after: qualityFirstPage.nextKey
  });
  assert.deepEqual(qualityFirstPage.items.map((item) => item.id), ["quality:price", "quality:quality"]);
  assert.deepEqual(qualitySecondPage.items.map((item) => item.id), ["quality:fraud", "quality:noise"]);
  assert.equal(qualitySecondPage.snapshotVersion, qualityFirstPage.snapshotVersion, "price-first order preserves snapshot pagination");

  const alternateQualityRequest = { keyword: "삼성 스마트폰", sites: ["joonggonara"], category_id: "mobile", sort: "price_asc" };
  index.ingest(alternateQualityRequest, [{ ...qualityItems[1], price_suspect: false }], { complete: true, successfulSites: ["joonggonara"] });
  const qualityIdentity = collectionIdentity(qualityRequest);
  index.db.prepare("UPDATE query_index SET snapshot_version = snapshot_version + 1 WHERE query_key = ?").run(qualityIdentity.key);
  const rematerializedVersion = Number(index.db.prepare("SELECT snapshot_version FROM query_index WHERE query_key = ?").get(qualityIdentity.key).snapshot_version);
  index.materializeSnapshot(qualityIdentity.key, rematerializedVersion, new Date(now).toISOString());
  const rematerializedQuality = index.searchPage(qualityRequest, { limit: 10, snapshotVersion: rematerializedVersion });
  assert.equal(
    rematerializedQuality.items.find((item) => item.id === "quality:price")?.price_suspect,
    true,
    "another query cannot overwrite this query's suspicion metadata for a shared listing"
  );
  const queryListingColumns = new Set(index.db.prepare("PRAGMA table_info(query_listings)").all().map((row) => row.name));
  for (const column of ["quality_evaluated", "price_suspect", "quality_suspect", "noise_filtered", "noise_filter_reason", "fraud_risk"]) {
    assert(queryListingColumns.has(column), `SQLite query mapping includes ${column}`);
  }

  now += 60_000;
  const priceChange = index.ingest(baseRequest, [{ ...firstItems[0], price: 650_000 }, firstItems[1]], { successfulSites: ["bunjang"] });
  assert.equal(priceChange.priceChanges, 1);
  assert.equal(index.search(priceRequest).items[0].price, 650_000);

  index.db.prepare("UPDATE query_index SET keyword = ? WHERE query_key = ?")
    .run("아이폰 1 5", collectionIdentity(baseRequest).key);
  index.registerQuery(baseRequest);
  query = index.getQuery(collectionIdentity(baseRequest).key);
  assert.equal(query.keyword, "아이폰 15", "a repeated search repairs the stored upstream keyword");
  assert.equal(query.tier, "warm");
  now += 61 * 60_000;
  assert.equal(index.dueQueries(1).length, 1);

  const failedRefresh = index.createRefreshJob(baseRequest);
  index.startRefreshJob(failedRefresh.token);
  index.failRefreshJob(failedRefresh.token, new Error("HTTP_503"));
  let failedQuery = index.getQuery(collectionIdentity(baseRequest).key);
  assert.equal(failedQuery.refresh_failure_count, 1, "upstream refresh failures are counted per query");
  assert.equal(index.dueQueries(1).length, 0, "a failed query backs off instead of starving other refreshes");
  assert.equal(index.dueQueries(1, { includeBackoff: true }).length, 1, "backed-off overdue queries remain visible to health metrics");
  assert.equal(index.createRefreshJob(baseRequest), null, "foreground refresh queueing cannot bypass a query retry delay");
  now += 5 * 60_000 + 1;
  assert.equal(index.dueQueries(1).length, 1, "a failed query becomes eligible after its retry delay");

  index.ingest(baseRequest, [firstItems[0]], { deep: true, complete: true, successfulSites: ["bunjang"] });
  failedQuery = index.getQuery(collectionIdentity(baseRequest).key);
  assert.equal(failedQuery.refresh_failure_count, 0, "a successful ingest clears refresh failure state");
  assert.equal(failedQuery.next_refresh_attempt_at, null, "a successful ingest clears the retry delay");
  assert.equal(index.search(baseRequest).items.length, 2, "one miss remains visible");
  const beforeFailedIngest = index.getQuery(collectionIdentity(baseRequest).key);
  const failedIngest = index.ingest(baseRequest, [firstItems[0]], { deep: true, complete: true, successfulSites: [] });
  const afterFailedIngest = index.getQuery(collectionIdentity(baseRequest).key);
  assert.equal(failedIngest.skipped, true, "an ingest with no successful source is skipped");
  assert.equal(afterFailedIngest.last_refreshed_at, beforeFailedIngest.last_refreshed_at, "an all-source failure cannot forge refreshed_at");
  assert.equal(afterFailedIngest.snapshot_version, beforeFailedIngest.snapshot_version, "an all-source failure cannot replace the snapshot");
  assert.equal(index.search(baseRequest).items.length, 2, "site failure does not increase missing count");
  now += 6 * 60 * 60_000 + 1;
  index.ingest(baseRequest, [firstItems[0]], { deep: true, complete: true, successfulSites: ["bunjang"] });
  assert.deepEqual(index.search(baseRequest).items.map((item) => item.id), ["bunjang:1"], "two confirmed misses hide the listing");

  now += 6 * 60 * 60_000 + 1;
  const expired = index.search(baseRequest);
  assert.equal(expired.freshness.mode, "expired");
  assert.equal(expired.items.length, 0);
  assert.equal(index.search({ ...baseRequest, allow_stale: true }).freshness.mode, "stale");

  const job = index.createRefreshJob(baseRequest);
  assert.equal(job.state, "queued");
  assert.equal(index.createRefreshJob(baseRequest).token, job.token, "pending refresh is reused");
  index.startRefreshJob(job.token);
  index.completeRefreshJob(job.token, 3);
  assert.equal(index.getRefreshJob(job.token).added_count, 3);

  const comparison = index.recordComparison(baseRequest, [firstItems[0], firstItems[1]], [firstItems[0]]);
  assert.equal(comparison.missing_count, 1);
  assert.equal(index.comparisonStatus().runs_24h, 1);
  assert.deepEqual(index.comparisonStatus().covered_sites_24h, ["bunjang"]);

  const freshIndexedOnly = { ...firstItems[1], indexed_last_seen_at: new Date(now).toISOString() };
  const freshAbsence = index.recordComparison(baseRequest, [], [freshIndexedOnly]);
  assert.equal(freshAbsence.stale_count, 0, "a single fresh-window absence is not stale");
  const oldIndexedOnly = { ...firstItems[1], indexed_last_seen_at: new Date(now - 6 * 60 * 60_000 - 1).toISOString() };
  const oldAbsence = index.recordComparison(baseRequest, [], [oldIndexedOnly]);
  assert.equal(oldAbsence.stale_count, 1, "an absent listing older than six hours is stale");

  const runnerSource = readFileSync(new URL("./runner.mjs", import.meta.url), "utf8");
  assert.match(
    runnerSource,
    /if \(searchIndex && INDEX_MODE !== "shadow"\) return searchWithIndex/,
    "shadow mode must keep the live response path until the comparison gate passes"
  );
  assert.match(
    runnerSource,
    /const previous = searchIndex\.search\(body, \{ maxRows: SEARCH_COLLECTION_MAX_ITEMS, allowStale: true \}\)/u,
    "shadow comparison must inspect the full collection window instead of truncating the index at 200"
  );
  assert.doesNotMatch(
    runnerSource,
    /INDEX_MODE === "shadow"[\s\S]{0,1200}return \{ modeOverride: "index"/,
    "shadow mode must not expose indexed results as its primary response"
  );
  assert.doesNotMatch(
    runnerSource,
    /INDEX_MODE === "shadow"[\s\S]{0,500}refresh_index === false[\s\S]{0,200}return buildIndexedPayload/u,
    "shadow mode must not expose a fresh indexed payload when refresh_index is false"
  );
  assert.match(runnerSource, /decodeSearchCursor\(body\.cursor/u, "indexed continuation cursors are decoded without the memory cache");
  assert.match(runnerSource, /searchIndex\.searchPage\(body/u, "indexed pages are read directly from SQLite");
  assert.match(runnerSource, /refreshed_at: indexed\.freshness\.refreshedAt \|\| null/u, "missing refresh timestamps are never replaced with the current time");
  assert.match(runnerSource, /request_metrics: \{ \.\.\.searchRuntimeMetrics \}/u, "index status exposes request-path counters for DB-only proof");
  assert.match(runnerSource, /incrementExecutionMetric\("live_collection_runs"\)/u, "live collection runs are counted");
  assert.match(runnerSource, /incrementExecutionMetric\("source_collection_attempts", sites\.length\)/u, "source collection attempts are counted");
  assert.match(runnerSource, /incrementExecutionMetric\("index_ingest_commits"\)/u, "successful index ingests are counted");
  assert.match(runnerSource, /incrementExecutionMetric\("index_page_reads"\)/u, "SQLite page reads are counted");
  assert.doesNotMatch(runnerSource, /searchCache\.clear\(\)/u, "background refreshes preserve active shadow pagination windows");
  assert.match(runnerSource, /site_window: requestedSiteWindow\(body\)/u, "shadow cache keys separate progressive collection windows");
  assert.match(runnerSource, /body\?\.expand_index === true/u, "cache-first searches can explicitly deepen the live index");
  assert.match(runnerSource, /site_window: query\.site_window/u, "background refreshes retain the deepest requested site window");
  assert.match(runnerSource, /body = resolvedSearchBody\(body\)/u, "search requests persist the category-resolved explicit site list");
  assert(
    runnerSource.indexOf("backgroundRunsThisHour += 1") > runnerSource.indexOf("job = searchIndex.createRefreshJob(requestForIndexedQuery(query))"),
    "background budget is charged only after a valid refresh job is selected"
  );
  assert.match(runnerSource, /execution: \{ \.\.\.execution \}/u, "each search response exposes request-scoped execution proof");
  assert.match(runnerSource, /process_instance: PROCESS_INSTANCE/u, "index status exposes a restart-stable process instance boundary");
  assert.match(runnerSource, /function searchHttpStatus\(error\)/u, "search errors distinguish client errors from service failures");
  assert.match(runnerSource, /return 503/u, "unknown index and collection failures return a fallback-eligible service status");
  const d1SeedSource = readFileSync(new URL("./seed-d1-backup.mjs", import.meta.url), "utf8");
  assert.match(d1SeedSource, /quality_evaluated = 1/u, "D1 backup requires evaluated query quality");
  assert.match(d1SeedSource, /price_suspect = 1/u, "D1 backup excludes price-suspect listings");
  assert.match(d1SeedSource, /quality_suspect = 1/u, "D1 backup excludes quality-suspect listings");
  assert.match(d1SeedSource, /noise_filtered = 1/u, "D1 backup excludes known noise listings");
  assert.match(d1SeedSource, /fraud_risk > 0\.45/u, "D1 backup excludes high-risk listings");

  const retiredSiteRequest = { keyword: "지역 중고 상품", sites: ["bunjang", "daangn"], category_id: "living" };
  index.registerQuery(retiredSiteRequest);
  index.registerQuery(retiredSiteRequest);
  index.ingest(retiredSiteRequest, [{
    id: "retired-site:1",
    site: "bunjang",
    category_id: "living",
    title: "지역 중고 상품",
    price: 10_000,
    url: "https://example.com/retired-site"
  }, {
    id: "retired-site:2",
    site: "daangn",
    category_id: "living",
    title: "지역 중고 상품 당근",
    price: 12_000,
    url: "https://example.com/retired-daangn"
  }], { successfulSites: ["bunjang"] });
  now += 61 * 60_000;
  assert.equal(index.dueQueries(20).some((row) => row.query_key === collectionIdentity(retiredSiteRequest).key), true, "a recent mixed-site query is initially refreshable");
  assert.equal(index.restrictTargetSites(["bunjang", "joonggonara", "hellomarket", "rethinkmall"]), 1, "queries containing a retired source are quarantined");
  assert.equal(index.getQuery(collectionIdentity(retiredSiteRequest).key).refresh_disabled_reason, "unsupported_target_site", "the retired source reason is auditable");
  assert.equal(index.dueQueries(20).some((row) => row.query_key === collectionIdentity(retiredSiteRequest).key), false, "retired-source queries cannot consume background refresh slots");
  const purgedRetired = index.purgeUnsupportedSites(["bunjang", "joonggonara", "hellomarket", "rethinkmall"]);
  assert.equal(purgedRetired.listings, 1, "retired-source listings are removed from the active index");
  assert.equal(index.db.prepare("SELECT COUNT(*) AS count FROM listings WHERE site = 'daangn'").get().count, 0, "retired-source listings do not remain in SQLite");
  assert.deepEqual(
    index.purgeUnsupportedSites(["bunjang", "joonggonara", "hellomarket", "rethinkmall"]),
    { listings: 0, snapshotItems: 0, ftsItems: 0 },
    "a clean supported-site index skips the destructive purge transaction"
  );

  const backup = index.createBackup();
  assert.ok(backup?.endsWith(".sqlite"));
  const status = index.maintenance();
  assert.equal(status.active_listings >= 1, true);
  assert.equal(status.query_count, 4);

  console.log(JSON.stringify({ status: "passed", checks: 117, index: status }, null, 2));
} finally {
  index.close();
  rmSync(tempDir, { recursive: true, force: true });
}
