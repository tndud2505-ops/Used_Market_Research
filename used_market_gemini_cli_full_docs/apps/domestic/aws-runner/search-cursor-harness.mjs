import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { decodeSearchCursor, encodeSearchCursor } from "./search-cursor.mjs";
import { SEARCH_INDEX_POLICY, SearchIndex } from "./search-index.mjs";

const tempDir = mkdtempSync(path.join(os.tmpdir(), "used-market-cursor-"));
const filePath = path.join(tempDir, "search.sqlite");
const secret = "cursor-harness-secret";
let now = Date.UTC(2026, 7, 14, 0, 0, 0);
let index = new SearchIndex({
  filePath,
  backupDir: path.join(tempDir, "backups"),
  now: () => now,
  limits: { maxActiveListings: 1_000, maxQueries: 100, softBytes: 100_000_000, hardBytes: 200_000_000 }
});

function listing(number, overrides = {}) {
  const id = `item-${String(number).padStart(3, "0")}`;
  return {
    id,
    site: number % 2 ? "bunjang" : "joonggonara",
    category_id: "mobile",
    title: `아이폰 15 ${number}`,
    price: number * 10_000,
    currency: "KRW",
    url: `https://example.com/${id}`,
    image_url: number % 3 ? `https://example.com/${id}.jpg` : null,
    posted_at: new Date(now - number * 60_000).toISOString(),
    ...overrides
  };
}

try {
  const request = {
    keyword: "아이폰 15",
    sites: ["bunjang", "joonggonara"],
    category_id: "mobile",
    sort: "price_asc"
  };
  const initialItems = Array.from({ length: 65 }, (_, indexValue) => listing(indexValue + 1));
  index.registerQuery(request);
  index.ingest(request, initialItems, {
    deep: true,
    complete: true,
    successfulSites: ["bunjang", "joonggonara"]
  });

  const firstPage = index.searchPage(request, { limit: 30 });
  assert.equal(firstPage.items.length, 30);
  assert.equal(firstPage.total, 65);
  assert.deepEqual(firstPage.items.slice(0, 3).map((item) => item.id), ["item-001", "item-002", "item-003"]);
  assert.equal(firstPage.hasMore, true);
  assert.equal(firstPage.nextKey.priceValue, 300_000);
  assert.equal(firstPage.nextKey.itemId, "item-030");

  const descendingRequest = { ...request, sort: "price_desc" };
  const descendingFirstPage = index.searchPage(descendingRequest, { limit: 30 });
  assert.deepEqual(descendingFirstPage.items.slice(0, 3).map((item) => item.id), ["item-065", "item-064", "item-063"]);
  assert.equal(descendingFirstPage.nextKey.priceValue, 360_000);
  const descendingSecondPage = index.searchPage(descendingRequest, {
    limit: 30,
    snapshotVersion: descendingFirstPage.snapshotVersion,
    after: descendingFirstPage.nextKey
  });
  assert.equal(descendingSecondPage.items[0].id, "item-035");
  assert.equal(descendingSecondPage.items.at(-1).id, "item-006");
  const descendingThirdPage = index.searchPage(descendingRequest, {
    limit: 30,
    snapshotVersion: descendingFirstPage.snapshotVersion,
    after: descendingSecondPage.nextKey
  });
  const descendingIds = [
    ...descendingFirstPage.items,
    ...descendingSecondPage.items,
    ...descendingThirdPage.items
  ].map((item) => item.id);
  assert.equal(descendingIds.length, initialItems.length, "descending cursor pagination returns every item");
  assert.equal(new Set(descendingIds).size, descendingIds.length, "descending cursor pagination has no overlap");
  assert.deepEqual(
    descendingIds,
    [...initialItems].sort((left, right) => right.price - left.price).map((item) => item.id),
    "descending cursor pagination has no omissions and preserves global order"
  );

  const cacheKey = JSON.stringify({ keyword: "아이폰 15", sort: "price_asc" });
  const cursor = encodeSearchCursor({
    cacheKey,
    sort: request.sort,
    snapshotVersion: firstPage.snapshotVersion,
    after: firstPage.nextKey
  }, secret);
  const decoded = decodeSearchCursor(cursor, { cacheKey, sort: request.sort, secret });
  assert.equal(decoded.snapshotVersion, firstPage.snapshotVersion);
  assert.deepEqual(decoded.after, firstPage.nextKey);
  assert.throws(
    () => decodeSearchCursor(cursor, { cacheKey, sort: "recent", secret }),
    /CURSOR_INVALID: cursor does not match the current search/
  );
  assert.throws(
    () => decodeSearchCursor(`${cursor.slice(0, -1)}x`, { cacheKey, sort: request.sort, secret }),
    /CURSOR_INVALID: cursor signature is invalid/
  );

  now += 1_000;
  const cheaperNewItem = listing(999, {
    id: "item-000",
    title: "아이폰 15 신규 최저가",
    price: 5_000,
    url: "https://example.com/item-000",
    posted_at: new Date(now).toISOString()
  });
  const changedItems = initialItems.map((item) => item.id === "item-031"
    ? { ...item, price: 7_000, title: "아이폰 15 가격 변경" }
    : item);
  index.ingest(request, [cheaperNewItem, ...changedItems], { successfulSites: ["bunjang", "joonggonara"] });

  const secondPage = index.searchPage(request, {
    limit: 30,
    snapshotVersion: decoded.snapshotVersion,
    after: decoded.after
  });
  assert.equal(secondPage.items.length, 30);
  assert.equal(secondPage.total, 65, "the old snapshot keeps its original result set");
  assert.equal(secondPage.items[0].id, "item-031");
  assert.equal(secondPage.items[0].price, 310_000, "the old snapshot keeps the displayed price used for its ordering");
  assert.equal(secondPage.items.at(-1).id, "item-060");
  assert.equal(secondPage.items.some((item) => item.id === "item-000"), false);
  assert.equal(secondPage.items.some((item) => firstPage.items.some((first) => first.id === item.id)), false);

  const newFirstPage = index.searchPage(request, { limit: 30 });
  assert.equal(newFirstPage.total, 66);
  assert.equal(newFirstPage.items[0].id, "item-000");
  assert.equal(newFirstPage.items[1].id, "item-031");
  assert.equal(newFirstPage.items[1].price, 7_000);
  assert.notEqual(newFirstPage.snapshotVersion, firstPage.snapshotVersion);

  index.close();
  index = new SearchIndex({
    filePath,
    backupDir: path.join(tempDir, "backups"),
    now: () => now,
    limits: { maxActiveListings: 1_000, maxQueries: 100, softBytes: 100_000_000, hardBytes: 200_000_000 }
  });
  const resumedPage = index.searchPage(request, {
    limit: 30,
    snapshotVersion: decoded.snapshotVersion,
    after: decoded.after
  });
  assert.deepEqual(
    resumedPage.items.map((item) => item.id),
    secondPage.items.map((item) => item.id),
    "a persisted snapshot survives a runner restart"
  );

  const equalPriceRequest = { ...request, min_price: 100_000, max_price: 100_000 };
  index.ingest(request, [
    ...initialItems,
    listing(998, { id: "item-010-b", price: 100_000, url: "https://example.com/item-010-b" })
  ], { successfulSites: ["bunjang", "joonggonara"] });
  const equalPricePage = index.searchPage(equalPriceRequest, { limit: 10 });
  assert.deepEqual(equalPricePage.items.map((item) => item.id), ["item-010", "item-010-b"]);

  const recentPage = index.searchPage({ ...request, sort: "recent" }, { limit: 3 });
  assert.deepEqual(recentPage.items.map((item) => item.id), ["item-000", "item-001", "item-002"]);

  index.ingest(request, [
    ...initialItems,
    listing(997, { id: "item-null", price: null, url: "https://example.com/item-null" })
  ], { successfulSites: ["bunjang", "joonggonara"] });
  const allPriceItems = index.searchPage(request, { limit: 100 });
  assert.equal(allPriceItems.items.at(-1).id, "item-null", "missing prices sort last");
  const allDescendingPriceItems = index.searchPage({ ...request, sort: "price_desc" }, { limit: 100 });
  assert.equal(allDescendingPriceItems.items.at(-1).id, "item-null", "missing prices also sort last descending");

  const cappedIndex = new SearchIndex({
    filePath: ":memory:",
    now: () => now,
    limits: { maxActiveListings: 3, maxQueries: 100, softBytes: 100_000_000, hardBytes: 200_000_000 }
  });
  const cappedRequest = { keyword: "스냅샷 보존", sites: ["bunjang"], sort: "price_asc" };
  cappedIndex.ingest(cappedRequest, [
    listing(701, { id: "cap-a1", url: "https://example.com/cap-a1" }),
    listing(702, { id: "cap-a2", url: "https://example.com/cap-a2" }),
    listing(703, { id: "cap-a3", url: "https://example.com/cap-a3" })
  ], { successfulSites: ["bunjang"] });
  const cappedFirstPage = cappedIndex.searchPage(cappedRequest, { limit: 1 });
  now += 1_000;
  cappedIndex.ingest({ keyword: "새 검색", sites: ["joonggonara"] }, [
    listing(801, { id: "cap-b1", site: "joonggonara", url: "https://example.com/cap-b1" }),
    listing(802, { id: "cap-b2", site: "joonggonara", url: "https://example.com/cap-b2" }),
    listing(803, { id: "cap-b3", site: "joonggonara", url: "https://example.com/cap-b3" })
  ], { successfulSites: ["joonggonara"] });
  const cappedSecondPage = cappedIndex.searchPage(cappedRequest, {
    limit: 5,
    snapshotVersion: cappedFirstPage.snapshotVersion,
    after: cappedFirstPage.nextKey
  });
  assert.equal(cappedSecondPage.total, 3, "global listing cleanup does not shrink an active snapshot");
  assert.deepEqual(cappedSecondPage.items.map((item) => item.id), ["cap-a2", "cap-a3"]);
  cappedIndex.close();

  now += SEARCH_INDEX_POLICY.searchSnapshotRetentionMs + 1;
  assert.throws(
    () => index.searchPage(request, {
      limit: 30,
      snapshotVersion: decoded.snapshotVersion,
      after: decoded.after,
      allowStale: true
    }),
    /CURSOR_EXPIRED: search snapshot expired/
  );

  console.log(JSON.stringify({ status: "passed", checks: 39 }, null, 2));
} finally {
  try { index.close(); } catch {}
  rmSync(tempDir, { recursive: true, force: true });
}
