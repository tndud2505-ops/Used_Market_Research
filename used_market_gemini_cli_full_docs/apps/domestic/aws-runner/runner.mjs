import http from "node:http";
import { AsyncLocalStorage } from "node:async_hooks";
import { createHash, randomUUID, timingSafeEqual } from "node:crypto";
import { statfsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  buildCollectionRequest,
  buildLivePayload,
  categoryQuery,
  collectLiveSite,
  collectOne,
  requestedPriceRange,
  requestedSiteWindow,
  requestedSites,
  requestedSort,
  requestedViewSites,
  sourceCandidateLimit
} from "../cloudflare/live-search.mjs";
import { decodeSearchCursor, encodeSearchCursor } from "./search-cursor.mjs";
import { collectionIdentity, SearchIndex } from "./search-index.mjs";

const PORT = Number.parseInt(process.env.RUNNER_PORT || "8787", 10);
const RUNNER_TOKEN = process.env.CLOUDFLARE_RUNNER_TOKEN || process.env.RUNNER_TOKEN || "";
const SEARCH_CURSOR_SECRET = process.env.RUNNER_CURSOR_SECRET || RUNNER_TOKEN || "used-market-local-cursor-v2";
const IMPORT_URL = (process.env.D1_IMPORT_URL || "").trim();
const IMPORT_TOKEN = process.env.CLOUDFLARE_MANUAL_RUN_TOKEN || process.env.IMPORT_TOKEN || "";
const MAX_BODY_BYTES = 1_048_576;
const TARGET_SITES = Object.freeze(["bunjang", "joonggonara", "hellomarket", "rethinkmall"]);
const configuredSearchCacheTtl = Number(process.env.RUNNER_SEARCH_CACHE_TTL_MS);
const SEARCH_CACHE_TTL_MS = Number.isFinite(configuredSearchCacheTtl)
  ? Math.min(Math.max(configuredSearchCacheTtl, 0), 10 * 60 * 1000)
  : 5 * 60 * 1000;
const SEARCH_CACHE_MAX_ENTRIES = 64;
const SEARCH_COLLECTION_MAX_ITEMS = 1_000;
const FOREGROUND_REFRESH_MIN_AGE_MS = 5 * 60 * 1000;
const SEARCH_MAX_CONCURRENT = 4;
const SEARCH_MAX_QUEUE = 16;
const SEARCH_QUEUE_WAIT_MS = 3_000;
const SEARCH_SOURCE_MAX_CONCURRENT = 16;
const SEARCH_SOURCE_MAX_QUEUE = 32;
const PROCESS_INSTANCE = Object.freeze({ id: randomUUID(), started_at: new Date().toISOString() });
const INDEX_ENABLED = String(process.env.RUNNER_INDEX_ENABLED ?? "true").toLowerCase() !== "false";
const INDEX_MODE = String(process.env.RUNNER_INDEX_MODE || "cache_first").trim().toLowerCase() === "shadow"
  ? "shadow"
  : "cache_first";
const INDEX_ROOT = process.env.RUNNER_INDEX_DIR || (process.platform === "linux"
  ? "/var/lib/used-market-runner"
  : path.join(os.tmpdir(), "used-market-runner"));
const INDEX_PATH = process.env.RUNNER_INDEX_PATH || path.join(INDEX_ROOT, "search-index.sqlite");
const BACKGROUND_MAX_PER_HOUR = 12;
const BACKGROUND_TICK_MS = 60_000;
const SEARCH_ONLY_CATEGORY_IDS = Object.freeze([
  "all", "fashion", "fashion_women", "fashion_men", "fashion_women_outer", "fashion_women_tops",
  "fashion_women_bottoms", "fashion_women_skirts", "fashion_men_outer", "fashion_men_tops",
  "fashion_men_bottoms", "fashion_men_jumpsuit", "fashion_goods", "luxury", "beauty", "kids",
  "mobile", "appliances", "pc", "camera", "furniture", "living", "games", "hobby", "books",
  "tickets", "sports", "travel", "vehicles", "motorcycle", "tools", "free_share"
]);
const SEARCH_ONLY_SOURCES = Object.freeze([
  { key: "hellomarket", name: "헬로마켓", market_kind: "used_market", login_required: false, ui_registered: true, main_search_registered: true, category_mode: "keyword_inferred", classifiable_category_ids: SEARCH_ONLY_CATEGORY_IDS },
  { key: "rethinkmall", name: "리씽크몰", market_kind: "refurb_retail", login_required: false, ui_registered: true, main_search_registered: true, category_mode: "keyword_inferred", classifiable_category_ids: SEARCH_ONLY_CATEGORY_IDS }
]);
const JOB_PLANS = Object.freeze({
  "gpu-fast-scan": { category_id: "pc", keyword: "RTX 3060" },
  "cpu-scan": { category_id: "pc", keyword: "Ryzen 5 5600" },
  "ram-scan": { category_id: "pc", keyword: "RAM 16GB" },
  "ssd-scan": { category_id: "pc", keyword: "SSD 1TB" },
  "psu-scan": { category_id: "pc", keyword: "PSU 600W" },
  "full-pc-scan": { category_id: "pc", keyword: "gaming PC" },
  "iphone-scan": { category_id: "all", keyword: "아이폰 15" },
  "airpods-scan": { category_id: "all", keyword: "에어팟 프로" },
  "switch-scan": { category_id: "all", keyword: "닌텐도 스위치" },
  "fashion-bottoms-scan": { category_id: "all", keyword: "여성 바지" }
});

let activeRun = false;
const idempotencyResults = new Map();
const searchCache = new Map();
const searchInflight = new Map();
let activeSearchJobs = 0;
const waitingSearchJobs = [];
let searchIndex = null;
let searchIndexError = "";
let backgroundRefreshActive = false;
let backgroundWindowStartedAt = Date.now();
let backgroundRunsThisHour = 0;
let lastMaintenanceDate = "";
const searchExecutionStorage = new AsyncLocalStorage();
const searchRuntimeMetrics = {
  index_page_reads_total: 0,
  live_collection_runs_total: 0,
  source_collection_attempts_total: 0,
  index_ingest_commits_total: 0
};

if (INDEX_ENABLED) {
  try {
    searchIndex = new SearchIndex({ filePath: INDEX_PATH, backupDir: path.join(INDEX_ROOT, "backups") });
    searchIndex.restrictTargetSites(TARGET_SITES);
    searchIndex.purgeUnsupportedSites(TARGET_SITES);
  } catch (error) {
    searchIndexError = error instanceof Error ? error.message : String(error);
    console.error("[aws-runner] search index unavailable; live search remains enabled", error);
  }
}
let activeSearchSourceJobs = 0;
const waitingSearchSourceJobs = [];

class SearchBusyError extends Error {
  constructor() {
    super("SEARCH_BUSY: search queue is full");
    this.statusCode = 429;
  }
}

class SearchCursorExpiredError extends Error {
  constructor() {
    super("CURSOR_EXPIRED: search results expired; start a new search");
    this.statusCode = 410;
  }
}

function incrementExecutionMetric(key, amount = 1) {
  const runtimeKey = `${key}_total`;
  searchRuntimeMetrics[runtimeKey] += amount;
  const execution = searchExecutionStorage.getStore();
  if (execution) execution[key] += amount;
}

function searchExecutionSnapshot() {
  return {
    index_page_reads: 0,
    live_collection_runs: 0,
    source_collection_attempts: 0,
    index_ingest_commits: 0
  };
}

function searchHttpStatus(error) {
  const explicit = Number(error?.statusCode);
  if ([400, 410, 429, 503].includes(explicit)) return explicit;
  const message = error instanceof Error ? error.message : String(error || "");
  if (/^(?:payload too large|keyword or category_id is required|at least one target site is required|view_sites must |focus_sites must |limit must |sort must |min_price must |max_price must |cursor must |cursor is |CURSOR_INVALID:|Selected categories are unavailable|No selected site has |site_window must )/u.test(message)) {
    return 400;
  }
  return 503;
}

function withSearchJobSlot(task) {
  return new Promise((resolve, reject) => {
    let queueTimer;
    const run = async () => {
      if (queueTimer) clearTimeout(queueTimer);
      activeSearchJobs += 1;
      try {
        resolve(await task());
      } catch (error) {
        reject(error);
      } finally {
        activeSearchJobs -= 1;
        const next = waitingSearchJobs.shift();
        if (next) next();
      }
    };
    if (activeSearchJobs < SEARCH_MAX_CONCURRENT) run();
    else if (waitingSearchJobs.length < SEARCH_MAX_QUEUE) {
      waitingSearchJobs.push(run);
      queueTimer = setTimeout(() => {
        const index = waitingSearchJobs.indexOf(run);
        if (index >= 0) {
          waitingSearchJobs.splice(index, 1);
          reject(new SearchBusyError());
        }
      }, SEARCH_QUEUE_WAIT_MS);
    }
    else reject(new SearchBusyError());
  });
}

function withSearchSourceSlot(task) {
  return new Promise((resolve, reject) => {
    let queueTimer;
    const run = async () => {
      if (queueTimer) clearTimeout(queueTimer);
      activeSearchSourceJobs += 1;
      try {
        resolve(await task());
      } catch (error) {
        reject(error);
      } finally {
        activeSearchSourceJobs -= 1;
        const next = waitingSearchSourceJobs.shift();
        if (next) next();
      }
    };
    if (activeSearchSourceJobs < SEARCH_SOURCE_MAX_CONCURRENT) run();
    else if (waitingSearchSourceJobs.length < SEARCH_SOURCE_MAX_QUEUE) {
      waitingSearchSourceJobs.push(run);
      queueTimer = setTimeout(() => {
        const index = waitingSearchSourceJobs.indexOf(run);
        if (index >= 0) {
          waitingSearchSourceJobs.splice(index, 1);
          reject(new SearchBusyError());
        }
      }, SEARCH_QUEUE_WAIT_MS);
    } else reject(new SearchBusyError());
  });
}

function json(res, status, body) {
  res.statusCode = status;
  res.setHeader("content-type", "application/json; charset=utf-8");
  res.end(JSON.stringify(body, null, 2));
}

function tokenMatches(received, expected) {
  if (!received || !expected) return false;
  const left = Buffer.from(received);
  const right = Buffer.from(expected);
  return left.length === right.length && timingSafeEqual(left, right);
}

async function readJson(req) {
  const chunks = [];
  let total = 0;
  for await (const chunk of req) {
    total += chunk.length;
    if (total > MAX_BODY_BYTES) throw new Error("payload too large");
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

function jobNamesFrom(body) {
  const values = Array.isArray(body?.job_names)
    ? body.job_names
    : typeof body?.job_name === "string" ? [body.job_name] : [];
  return [...new Set(values.filter((value) => typeof value === "string").map((value) => value.trim()).filter(Boolean))];
}

function toImportItem(item) {
  return {
    item_id: item.item_id || item.id,
    site: item.site,
    category_id: item.category_id || "all",
    title: item.title,
    search_text: item.search_text || item.title,
    price_value: item.price,
    currency: item.currency || "KRW",
    url: item.url,
    image_url: item.image_url || null,
    seller_name: item.seller_name || null,
    posted_at: item.posted_at || null,
    updated_at: item.updated_at || new Date().toISOString()
  };
}

async function importToD1(items) {
  if (!items.length) return { inserted: 0, skipped: true };
  if (!IMPORT_URL || !IMPORT_TOKEN) {
    return { inserted: 0, skipped: true, warning: "D1_IMPORT_URL or import token is not configured" };
  }
  const response = await fetch(IMPORT_URL, {
    method: "POST",
    headers: {
      authorization: `Bearer ${IMPORT_TOKEN}`,
      "content-type": "application/json"
    },
    body: JSON.stringify({ items: items.map(toImportItem) })
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`D1_IMPORT_HTTP_${response.status}: ${JSON.stringify(payload)}`);
  return payload.data || payload;
}

async function collectJob(jobName) {
  if (jobName === "daily-price-refresh") {
    return { status: "completed", job_name: jobName, mode: "local-runner", items: 0, note: "D1-backed search does not need a separate refresh scrape" };
  }
  const plan = JOB_PLANS[jobName];
  if (!plan) throw new Error(`Unknown job: ${jobName}`);

  const collected = [];
  const sites = [];
  for (const site of TARGET_SITES) {
    try {
      const items = await collectOne(site, plan.keyword, plan.category_id, 20) || [];
      collected.push(...items);
      sites.push({ site, status: "completed", items: items.length });
    } catch (error) {
      sites.push({ site, status: "failed", items: 0, error: error instanceof Error ? error.message : String(error) });
    }
  }
  const importResult = await importToD1(collected);
  const failedSiteCount = sites.filter((site) => site.status === "failed").length;
  return {
    status: failedSiteCount > 0
      ? (collected.length > 0 ? "partial_success" : "failed")
      : collected.length > 0 ? "completed" : "partial_success",
    job_name: jobName,
    mode: "aws-local-runner",
    keyword: plan.keyword,
    category_id: plan.category_id,
    target_sites: TARGET_SITES,
    items: collected.length,
    imported: importResult,
    sites
  };
}

function requestedLimit(body) {
  if (!Object.hasOwn(body || {}, "limit")) return 40;
  const value = Number(body?.limit);
  if (!Number.isInteger(value) || value < 1 || value > SEARCH_COLLECTION_MAX_ITEMS) {
    throw new Error(`limit must be an integer between 1 and ${SEARCH_COLLECTION_MAX_ITEMS}`);
  }
  return value;
}

function resolvedSearchBody(body) {
  const sites = requestedSites(body);
  if (!sites.length) throw new Error("at least one target site is required");
  return { ...body, sites };
}

function searchCacheKey(body) {
  const priceRange = requestedPriceRange(body);
  return JSON.stringify({
    keyword: typeof body?.keyword === "string" ? body.keyword.trim() : "",
    category_id: typeof body?.category_id === "string" ? body.category_id.trim() : "",
    category_ids: Array.isArray(body?.category_ids)
      ? [...new Set(body.category_ids.map((value) => String(value).trim()).filter(Boolean))].sort()
      : [],
    sites: requestedSites(body).sort(),
    view_sites: requestedViewSites(body).sort(),
    site_window: requestedSiteWindow(body),
    sort: requestedSort(body),
    min_price: priceRange.min,
    max_price: priceRange.max
  });
}

function searchCursorFingerprint(cacheKey) {
  return createHash("sha256").update(cacheKey).digest("base64url").slice(0, 16);
}

function encodeOffsetSearchCursor(cacheKey, offset) {
  return `offset:v1:${searchCursorFingerprint(cacheKey)}:${offset}`;
}

function parseSearchOffset(cursor, cacheKey) {
  if (cursor === undefined || cursor === null || cursor === "") return 0;
  const match = typeof cursor === "string"
    ? cursor.match(/^offset:v1:([A-Za-z0-9_-]{16}):(\d+)$/)
    : null;
  if (!match || match[1] !== searchCursorFingerprint(cacheKey)) {
    throw new Error("cursor must be an offset cursor from the same search");
  }
  const offset = Number(match[2]);
  if (!Number.isSafeInteger(offset) || offset < 0 || offset > SEARCH_COLLECTION_MAX_ITEMS) {
    throw new Error("cursor is outside the available search window");
  }
  return offset;
}

function pageSearchData(fullData, offset, limit, cacheKey) {
  const allItems = Array.isArray(fullData?.items) ? fullData.items : [];
  const items = allItems.slice(offset, offset + limit);
  const nextOffset = offset + items.length;
  const hasMore = nextOffset < allItems.length;
  const prices = items
    .map((item) => item?.price)
    .filter((value) => Number.isFinite(value) && value > 0);
  const sources = Array.isArray(fullData?.sources)
    ? fullData.sources.map((source) => {
      const pageCount = items.filter((item) => item?.site === source?.key).length;
      const totalCount = allItems.filter((item) => item?.site === source?.key).length;
      return {
        ...source,
        total_count: totalCount,
        count: pageCount,
        normalized_count: pageCount,
        visible_count: pageCount,
        collection_state: pageCount > 0 ? "ready" : "empty",
        status: pageCount > 0 ? "ready" : "warning"
      };
    })
    : [];
  return {
    ...fullData,
    items,
    sources,
    pagination: {
      has_more: hasMore,
      next_cursor: hasMore ? encodeOffsetSearchCursor(cacheKey, nextOffset) : null
    },
    summary: {
      ...(fullData?.summary || {}),
      item_count: items.length,
      source_count: sources.filter((source) => source.visible_count > 0).length,
      median_price: median(prices),
      average_price: prices.length ? Math.round(prices.reduce((sum, value) => sum + value, 0) / prices.length) : null,
      lowest_price: prices.length ? Math.min(...prices) : null,
      highest_price: prices.length ? Math.max(...prices) : null
    },
    quality: {
      ...(fullData?.quality || {}),
      returned_count: items.length,
      available_count: allItems.length,
      page_offset: offset,
      page_limit: limit
    }
  };
}

function median(values) {
  const sorted = values.filter((value) => Number.isFinite(value) && value > 0).sort((a, b) => a - b);
  if (!sorted.length) return null;
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : Math.round((sorted[middle - 1] + sorted[middle]) / 2);
}

function searchOnlySource(sourceKey) {
  return SEARCH_ONLY_SOURCES.find((source) => source.key === sourceKey) || null;
}

function runnerStatus() {
  return {
    jobs: Object.entries(JOB_PLANS).map(([job_name, plan]) => ({
      job_name,
      category_id: plan.category_id,
      keyword: plan.keyword,
      target_sites: TARGET_SITES
    })),
    active_run: activeRun,
    coordination_scope: "aws-local-runner",
    search_index: indexRuntimeStatus()
  };
}

function indexRuntimeStatus() {
  if (!searchIndex) return {
    enabled: false,
    error: searchIndexError || (INDEX_ENABLED ? "unavailable" : "disabled"),
    mode: INDEX_MODE,
    process_instance: PROCESS_INSTANCE,
    request_metrics: { ...searchRuntimeMetrics }
  };
  const status = searchIndex.status();
  try {
    const fileSystem = statfsSync(INDEX_ROOT);
    const blockSize = Number(fileSystem.bsize || 0);
    status.disk_free_bytes = Number(fileSystem.bavail || 0) * blockSize;
    status.disk_total_bytes = Number(fileSystem.blocks || 0) * blockSize;
    status.disk_warning = status.disk_free_bytes < 2 * 1024 * 1024 * 1024;
  } catch (error) {
    status.disk_free_bytes = null;
    status.disk_total_bytes = null;
    status.disk_warning = true;
    status.disk_error = error instanceof Error ? error.message : String(error);
  }
  status.background = {
    active: backgroundRefreshActive,
    runs_this_hour: backgroundRunsThisHour,
    max_per_hour: BACKGROUND_MAX_PER_HOUR
  };
  status.memory_high_bytes = 2_560 * 1024 * 1024;
  status.memory_max_bytes = 3_072 * 1024 * 1024;
  status.memory_warning = Number(status.process_memory?.rss || 0) >= status.memory_high_bytes;
  status.refresh_lag_warning = Number(status.refresh_overdue_2x_queries || 0) > 0;
  status.mode = INDEX_MODE;
  status.process_instance = PROCESS_INSTANCE;
  status.request_metrics = { ...searchRuntimeMetrics };
  return status;
}

function searchOnlyItem(site, item) {
  const sourceId = String(item?.id || item?.item_id || item?.url || "").replace(`${site}:`, "");
  return {
    id: sourceId || `${site}:${item.url}`,
    title: item.title,
    price: item.price,
    sale_price: item.price,
    original_price: null,
    currency: item.currency || "KRW",
    seller: item.seller_name || "",
    status: "unknown",
    shipping: "unknown",
    posted_at: item.posted_at || "",
    url: item.url,
    image_url: item.image_url || "",
    raw_text: item.search_text || item.title,
    canonical_category_id: "",
    canonical_category_path: []
  };
}

async function searchOnly(body) {
  const sourceKey = typeof body?.source === "string" ? body.source.trim() : "";
  const source = searchOnlySource(sourceKey);
  if (!source) throw new Error("source must be one of: hellomarket, rethinkmall");
  const keyword = typeof body?.keyword === "string" ? body.keyword.trim() : "";
  if (!keyword || keyword.length > 80) throw new Error("keyword must be between 1 and 80 characters");
  if (Object.hasOwn(body || {}, "limit") || Object.hasOwn(body || {}, "cursor")) {
    throw new Error("search-only sources do not provide a stable pagination cursor; open the original search link for more results");
  }
  const items = (await collectOne(sourceKey, keyword, "all", 24, keyword) || []).map((item) => searchOnlyItem(sourceKey, item));
  const prices = items.map((item) => item.price).filter((value) => Number.isFinite(value) && value > 0);
  const result = {
    source,
    source_key: sourceKey,
    state: items.length ? "ready" : "unavailable",
    raw_items: items,
    items,
    relevant_items: items,
    requested_url: sourceKey === "hellomarket"
      ? `https://www.hellomarket.com/search?q=${encodeURIComponent(keyword)}`
      : `https://web.rethinkmall.com/search?utm_source=bu&keyword=${encodeURIComponent(keyword)}`,
    response_url: "",
    reported_count: null,
    pagination: { has_more: false, next_cursor: null },
    category_summary: [],
    uncategorized_count: items.length,
    summary: {
      item_count: items.length,
      priced_item_count: prices.length,
      currency: "KRW",
      median_price: median(prices),
      average_price: prices.length ? Math.round(prices.reduce((sum, value) => sum + value, 0) / prices.length) : null,
      lowest_price: prices.length ? Math.min(...prices) : null,
      highest_price: prices.length ? Math.max(...prices) : null
    },
    validation: {
      status: items.length ? "pass" : "warn",
      extracted_count: items.length,
      structurally_valid_count: items.length,
      relevant_count: items.length,
      active_relevant_count: 0,
      relevance_rate: items.length ? 1 : 0,
      duplicate_count: 0,
      missing_field_count: items.filter((item) => !item.title || !item.url).length,
      warnings: items.length ? [] : ["SEARCH_ONLY_SOURCE_UNAVAILABLE"],
      errors: []
    }
  };
  return { status: items.length ? "success" : "warning", data: result };
}

async function collectSearchData(body, { incremental = false } = {}) {
  body = resolvedSearchBody(body);
  const canonicalKeyword = collectionIdentity(body).collectionQuery;
  const collectionRequest = canonicalKeyword ? { ...body, keyword: canonicalKeyword } : body;
  const keyword = categoryQuery(collectionRequest);
  if (!keyword) throw new Error("keyword or category_id is required");
  const collectionBody = buildCollectionRequest(
    body,
    canonicalKeyword,
    SEARCH_COLLECTION_MAX_ITEMS
  );
  const sites = requestedSites(collectionBody);
  if (!sites.length) throw new Error("at least one target site is required");
  const candidateLimit = incremental ? 40 : sourceCandidateLimit(collectionBody);
  return withSearchJobSlot(async () => {
    incrementExecutionMetric("live_collection_runs");
    incrementExecutionMetric("source_collection_attempts", sites.length);
    const results = await Promise.all(sites.map(async (site) => {
      try {
        const rawKeyword = canonicalKeyword;
        return await withSearchSourceSlot(() => collectLiveSite(
          site,
          collectionBody,
          candidateLimit,
          rawKeyword
        ));
      } catch (error) {
        return {
          site,
          supported: true,
          items: [],
          raw_count: 0,
          filtered_count: 0,
          error: error instanceof Error ? error.message : String(error)
        };
      }
    }));
    return {
      data: buildLivePayload(collectionBody, results, { items: [] }),
      results,
      successfulSites: results.filter((result) => !result.error && !result.stale_cache).map((result) => result.site)
    };
  });
}

function buildIndexedPayload(body, indexed, refreshJob = null, modeOverride = "") {
  const sites = requestedViewSites(body);
  const liveResults = sites.map((site) => {
    const items = indexed.items.filter((item) => item.site === site);
    return { site, supported: true, items, raw_count: items.length, filtered_count: 0 };
  });
  const collectionBody = { ...body, limit: SEARCH_COLLECTION_MAX_ITEMS, cursor: undefined };
  const data = buildLivePayload(collectionBody, liveResults, { items: [] });
  data.items = indexed.items;
  data.pagination = {
    has_more: indexed.hasMore === true,
    next_cursor: indexed.hasMore && indexed.nextKey
      ? encodeSearchCursor({
          cacheKey: searchCacheKey(body),
          sort: requestedSort(body),
          snapshotVersion: indexed.snapshotVersion,
          after: indexed.nextKey
        }, SEARCH_CURSOR_SECRET)
      : null
  };
  data.sources = data.sources.map((source) => ({
    ...source,
    total_count: Number(indexed.sourceTotals?.[source.key] || 0)
  }));
  data.quality = {
    ...(data.quality || {}),
    returned_count: indexed.items.length,
    available_count: indexed.total,
    page_limit: Number(body?.limit) || indexed.items.length,
    snapshot_version: indexed.snapshotVersion
  };
  const mode = modeOverride || indexed.freshness.mode;
  data.freshness = {
    mode,
    refreshed_at: indexed.freshness.refreshedAt || null,
    age_seconds: Number.isFinite(indexed.freshness.ageMs) ? Math.max(0, Math.floor(indexed.freshness.ageMs / 1000)) : null,
    tier: indexed.freshness.tier || "cold",
    refresh_state: refreshJob?.state || (indexed.freshness.due ? "due" : "fresh"),
    refresh_token: refreshJob?.token || null
  };
  data.refresh = refreshJob
    ? {
        state: refreshJob.state,
        token: refreshJob.token,
        poll_after_ms: 2_000,
        added_count: Math.max(0, Number(refreshJob.added_count) || 0)
      }
    : { state: data.freshness.refresh_state, token: null, poll_after_ms: null };
  return data;
}

function mergeLiveDiagnostics(indexedData, liveData) {
  if (!liveData) return indexedData;
  const diagnostics = new Map((liveData.sources || []).map((source) => [source.key, source]));
  indexedData.sources = (indexedData.sources || []).map((source) => {
    const live = diagnostics.get(source.key);
    if (!live?.error) return source;
    return {
      ...source,
      error: live.error,
      errors: live.errors,
      status: source.visible_count > 0 ? "warning" : "failed",
      collection_state: source.visible_count > 0 ? "partial" : "failed"
    };
  });
  indexedData.quality = {
    ...(indexedData.quality || {}),
    warnings: Array.isArray(liveData.quality?.warnings) ? liveData.quality.warnings : []
  };
  return indexedData;
}

async function persistCollectedSearch(body, collected, { deep = false, complete = false } = {}) {
  if (!searchIndex) return null;
  if (!collected.successfulSites.length) return { skipped: true, reason: "all_sources_failed" };
  const ingest = searchIndex.ingest(body, collected.data.items, {
    deep,
    complete,
    successfulSites: collected.successfulSites
  });
  incrementExecutionMetric("index_ingest_commits");
  const changed = new Set(ingest.changedItemIds || []);
  const changedItems = collected.data.items.filter((item) => changed.has(String(item.item_id || item.id || "")));
  if (changedItems.length > 0) {
    try {
      await importToD1(changedItems);
    } catch (error) {
      console.warn("[aws-runner] D1 fallback backup failed", error instanceof Error ? error.message : String(error));
    }
  }
  return ingest;
}

async function refreshIndexedSearch(body, { incremental = true, deep = false, token = "" } = {}) {
  if (!searchIndex) throw new Error("Search index is unavailable");
  if (token) searchIndex.startRefreshJob(token);
  try {
    const collected = await collectSearchData(body, { incremental });
    if (!collected.successfulSites.length) throw new Error("ALL_SEARCH_SOURCES_FAILED: cached listings were preserved");
    const ingest = await persistCollectedSearch(body, collected, { deep, complete: deep });
    if (token) searchIndex.completeRefreshJob(token, ingest?.inserted || 0);
    const indexed = searchIndex.searchPage(body, { limit: requestedLimit(body), allowStale: true });
    return buildIndexedPayload(body, indexed, token ? searchIndex.getRefreshJob(token) : null, "live");
  } catch (error) {
    if (token) searchIndex.failRefreshJob(token, error);
    throw error;
  }
}

function queueIndexedRefresh(body) {
  if (!searchIndex || !searchIndex.canBackgroundWrite()) return null;
  const job = searchIndex.createRefreshJob(body);
  queueMicrotask(() => { void runBackgroundRefreshTick(); });
  return job;
}

function indexedPage(body, limit, cursorState = null, options = {}) {
  incrementExecutionMetric("index_page_reads");
  const indexed = searchIndex.searchPage(body, {
    limit,
    snapshotVersion: cursorState?.snapshotVersion,
    after: cursorState?.after,
    allowStale: options.allowStale === true
  });
  return buildIndexedPayload(body, indexed, options.refreshJob || null, options.modeOverride || "");
}

async function searchWithIndex(body, { limit, cacheKey, hasCursor }) {
  if (hasCursor) {
    if (String(body.cursor).startsWith("offset:v1:")) throw new SearchCursorExpiredError();
    const cursorState = decodeSearchCursor(body.cursor, {
      cacheKey,
      sort: requestedSort(body),
      secret: SEARCH_CURSOR_SECRET
    });
    return indexedPage(body, limit, cursorState, { allowStale: true });
  }

  let pending = searchInflight.get(cacheKey);
  if (!pending) {
    pending = (async () => {
      const knownQuery = searchIndex.getQuery(collectionIdentity(body).key);
      if (!knownQuery || body?.refresh_index !== false || body?.expand_index === true || body?.collect_view === true) searchIndex.registerQuery(body);

      if (body?.expand_index === true || body?.collect_view === true) {
        const previous = searchIndex.search(body, { maxRows: SEARCH_COLLECTION_MAX_ITEMS, allowStale: true });
        const collected = await collectSearchData(body, { incremental: false });
        if (!collected.successfulSites.length) {
          if (previous?.items?.length) return { modeOverride: "index", refreshJob: null, liveData: collected.data };
          return { directData: collected.data };
        }
        await persistCollectedSearch(body, collected, { deep: false, complete: false });
        return { modeOverride: "live", refreshJob: null, liveData: collected.data };
      }

      const cachedIndex = searchIndex.search(body, { maxRows: SEARCH_COLLECTION_MAX_ITEMS, allowStale: true });
      if (cachedIndex?.items?.length) {
        const shouldRefresh = body?.refresh_index !== false
          && (!cachedIndex.freshness.fresh
            || cachedIndex.freshness.due
            || cachedIndex.freshness.ageMs >= FOREGROUND_REFRESH_MIN_AGE_MS);
        const refreshJob = shouldRefresh ? queueIndexedRefresh(body) : null;
        return {
          modeOverride: cachedIndex.freshness.fresh ? "index" : "stale",
          refreshJob,
          liveData: null,
          allowStale: true
        };
      }
      const collected = await collectSearchData(body, { incremental: false });
      await persistCollectedSearch(body, collected, { deep: true, complete: true });
      return { modeOverride: "live", refreshJob: null, liveData: collected.data };
    })();
    searchInflight.set(cacheKey, pending);
  }

  try {
    const result = await pending;
    if (result.directData) return result.directData;
    const data = indexedPage(body, limit, null, {
      refreshJob: result.refreshJob,
      modeOverride: result.modeOverride,
      allowStale: result.allowStale === true
    });
    return mergeLiveDiagnostics(data, result.liveData);
  } finally {
    if (searchInflight.get(cacheKey) === pending) searchInflight.delete(cacheKey);
  }
}

async function searchLive(body) {
  body = resolvedSearchBody(body);
  const keyword = categoryQuery(body);
  if (!keyword) throw new Error("keyword or category_id is required");
  const sites = requestedSites(body);
  if (!sites.length) throw new Error("at least one target site is required");
  const limit = requestedLimit(body);
  const cacheKey = searchCacheKey(body);
  const hasCursor = typeof body?.cursor === "string" && body.cursor.trim() !== "";
  if (INDEX_MODE !== "shadow" && INDEX_ENABLED && !searchIndex) {
    const error = new Error("SEARCH_INDEX_UNAVAILABLE: SQLite search index is unavailable");
    error.statusCode = 503;
    throw error;
  }
  if (searchIndex && INDEX_MODE !== "shadow") return searchWithIndex(body, { limit, cacheKey, hasCursor });
  if (
    searchIndex
    && INDEX_MODE === "shadow"
    && body?.refresh_index === false
    && body?.collect_view !== true
    && body?.expand_index !== true
  ) {
    if (hasCursor) return searchWithIndex(body, { limit, cacheKey, hasCursor });
    try {
      const indexed = searchIndex.searchPage(body, { limit, allowStale: true });
      if (indexed) {
        incrementExecutionMetric("index_page_reads");
        return buildIndexedPayload(body, indexed, null, "index_view");
      }
    } catch (error) {
      if (Number(error?.statusCode) !== 410) throw error;
    }
  }

  let cached = searchCache.get(cacheKey);
  if (hasCursor && (!cached || cached.expiresAt <= Date.now())) {
    throw new SearchCursorExpiredError();
  }
  const offset = parseSearchOffset(body?.cursor, cacheKey);
  if (!cached || cached.expiresAt <= Date.now()) {
    if (cached) searchCache.delete(cacheKey);
    let pending = searchInflight.get(cacheKey);
    if (!pending) {
      pending = (async () => {
        if (!searchIndex) return (await collectSearchData(body)).data;
        if (!hasCursor) {
          const knownQuery = searchIndex.getQuery(collectionIdentity(body).key);
          if (!knownQuery || body?.refresh_index !== false || body?.expand_index === true) searchIndex.registerQuery(body);
        }
        if (INDEX_MODE === "shadow") {
          const previous = searchIndex.search(body, { maxRows: SEARCH_COLLECTION_MAX_ITEMS, allowStale: true });
          const collected = await collectSearchData(body, { incremental: false });
          const liveData = buildLivePayload(
            {
              ...body,
              keyword: collectionIdentity(body).collectionQuery,
              limit: SEARCH_COLLECTION_MAX_ITEMS,
              cursor: undefined
            },
            collected.results,
            { items: [] }
          );
          if (!collected.successfulSites.length && previous?.items?.length) {
            liveData.stale_fallback = buildIndexedPayload(body, previous, null, "stale");
            liveData.freshness = {
              mode: "unavailable",
              refreshed_at: previous.freshness.refreshedAt,
              age_seconds: Math.max(0, Math.floor(previous.freshness.ageMs / 1000)),
              tier: previous.freshness.tier || "cold",
              refresh_state: "failed",
              refresh_token: null
            };
            liveData.refresh = { state: "failed", token: null, poll_after_ms: null };
            return liveData;
          }
          if (previous?.items?.length) {
            searchIndex.recordComparison(body, liveData.items, previous.items, { sites: collected.successfulSites });
          }
          await persistCollectedSearch(body, collected, {
            deep: !previous?.items?.length,
            complete: !previous?.items?.length
          });
          const query = searchIndex.getQuery(previous?.queryKey || searchIndex.search(body, { maxRows: 1, allowStale: true })?.queryKey);
          liveData.freshness = {
            mode: "live_compare",
            refreshed_at: query?.last_refreshed_at || null,
            age_seconds: 0,
            tier: query?.tier || "cold",
            refresh_state: "shadow",
            refresh_token: null
          };
          liveData.refresh = { state: "shadow", token: null, poll_after_ms: null };
          return liveData;
        }
        const indexed = searchIndex.search(body, { maxRows: 200 });
        if (indexed?.freshness?.fresh) {
          const shouldRefresh = body?.refresh_index !== false
            && (indexed.freshness.due || indexed.freshness.ageMs >= FOREGROUND_REFRESH_MIN_AGE_MS);
          const job = shouldRefresh ? queueIndexedRefresh(body) : null;
          return buildIndexedPayload(body, indexed, job);
        }
        const stale = indexed?.freshness?.fresh ? null : searchIndex.search(body, { maxRows: 200, allowStale: true });
        const collected = await collectSearchData(body, { incremental: false });
        if (!collected.successfulSites.length && stale?.items?.length) {
          const unavailable = collected.data;
          unavailable.stale_fallback = buildIndexedPayload(body, stale, null, "stale");
          unavailable.freshness = {
            mode: "unavailable",
            refreshed_at: stale.freshness.refreshedAt,
            age_seconds: Math.max(0, Math.floor(stale.freshness.ageMs / 1000)),
            tier: stale.freshness.tier || "cold",
            refresh_state: "failed",
            refresh_token: null
          };
          unavailable.refresh = { state: "failed", token: null, poll_after_ms: null };
          return unavailable;
        }
        await persistCollectedSearch(body, collected, { deep: true, complete: true });
        const refreshed = searchIndex.search(body, { maxRows: 200, allowStale: true });
        return buildIndexedPayload(body, refreshed, null, "live");
      })();
      searchInflight.set(cacheKey, pending);
    }
    try {
      const fullData = await pending;
      cached = { data: fullData, expiresAt: Date.now() + SEARCH_CACHE_TTL_MS };
      searchCache.set(cacheKey, cached);
      while (searchCache.size > SEARCH_CACHE_MAX_ENTRIES) {
        searchCache.delete(searchCache.keys().next().value);
      }
    } finally {
      if (searchInflight.get(cacheKey) === pending) searchInflight.delete(cacheKey);
    }
  }
  return pageSearchData(cached.data, offset, limit, cacheKey);
}

function refreshBudgetAvailable() {
  const now = Date.now();
  if (now - backgroundWindowStartedAt >= 60 * 60 * 1000) {
    backgroundWindowStartedAt = now;
    backgroundRunsThisHour = 0;
  }
  return backgroundRunsThisHour < BACKGROUND_MAX_PER_HOUR;
}

function requestForIndexedQuery(query) {
  return {
    keyword: query.keyword,
    category_ids: query.category_ids,
    sites: query.sites,
    site_window: query.site_window,
    sort: "recent",
    limit: SEARCH_COLLECTION_MAX_ITEMS
  };
}

async function runBackgroundRefreshTick() {
  if (!searchIndex || backgroundRefreshActive || !refreshBudgetAvailable()) return;
  if (activeSearchJobs >= Math.max(1, SEARCH_MAX_CONCURRENT - 1) || waitingSearchJobs.length > 0) return;
  if (!searchIndex.canBackgroundWrite()) return;

  const today = new Date().toISOString().slice(0, 10);
  if (lastMaintenanceDate !== today) {
    lastMaintenanceDate = today;
    try {
      searchIndex.maintenance();
      searchIndex.createBackup();
    } catch (error) {
      console.warn("[aws-runner] index maintenance failed", error instanceof Error ? error.message : String(error));
    }
  }

  let job = searchIndex.nextQueuedRefreshJob(TARGET_SITES);
  let deep = false;
  if (!job) {
    const due = searchIndex.dueQueries(1)[0];
    if (!due) return;
    const query = searchIndex.getQuery(due.query_key);
    if (!query) return;
    deep = due.deepDue === true;
    job = searchIndex.createRefreshJob(requestForIndexedQuery(query));
  } else {
    const query = searchIndex.getQuery(job.query_key);
    deep = Boolean(query && (!query.last_deep_refreshed_at || Date.now() - Date.parse(query.last_deep_refreshed_at) >= 24 * 60 * 60 * 1000));
  }

  backgroundRefreshActive = true;
  backgroundRunsThisHour += 1;
  try {
    await refreshIndexedSearch(job.request, { incremental: !deep, deep, token: job.token });
  } catch (error) {
    console.warn("[aws-runner] background index refresh failed", error instanceof Error ? error.message : String(error));
  } finally {
    backgroundRefreshActive = false;
  }
}

async function runJobs(jobNames, idempotencyKey) {
  if (idempotencyKey && idempotencyResults.has(idempotencyKey)) return idempotencyResults.get(idempotencyKey);
  if (activeRun) {
    return {
      status: "partial_success",
      job_names: jobNames,
      results: jobNames.map((job_name) => ({ status: "already_running", job_name }))
    };
  }
  activeRun = true;
  try {
    const results = [];
    for (const jobName of jobNames) {
      try {
        results.push(await collectJob(jobName));
      } catch (error) {
        results.push({ status: "failed", job_name: jobName, error: error instanceof Error ? error.message : String(error) });
      }
    }
    const result = {
      status: results.some((item) => item.status === "failed")
        ? "failed"
        : results.some((item) => item.status === "partial_success")
          ? "partial_success"
          : "completed",
      job_names: jobNames,
      results
    };
    if (idempotencyKey) idempotencyResults.set(idempotencyKey, result);
    return result;
  } finally {
    activeRun = false;
  }
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
  if (req.method === "GET" && url.pathname === "/health") {
    return json(res, 200, {
      ok: true,
      service: "used-market-aws-runner",
      target_sites: TARGET_SITES,
      active_run: activeRun,
      search_capacity: {
        active: activeSearchJobs,
        queued: waitingSearchJobs.length,
        max_concurrent: SEARCH_MAX_CONCURRENT,
        max_queue: SEARCH_MAX_QUEUE,
        queue_wait_ms: SEARCH_QUEUE_WAIT_MS,
        collection_window: SEARCH_COLLECTION_MAX_ITEMS
      },
      search_index: indexRuntimeStatus()
    });
  }
  if (req.method === "POST" && url.pathname === "/api/search") {
    if (!tokenMatches((req.headers.authorization || "").replace(/^Bearer\s+/i, ""), RUNNER_TOKEN)) {
      return json(res, 401, { ok: false, error: "Unauthorized" });
    }
    try {
      const body = await readJson(req);
      const execution = searchExecutionSnapshot();
      const data = await searchExecutionStorage.run(execution, () => searchLive(body));
      data.quality = {
        ...(data.quality || {}),
        execution: { ...execution }
      };
      return json(res, 200, { status: "success", data });
    } catch (error) {
      const status = searchHttpStatus(error);
      if (status === 429) res.setHeader("retry-after", "2");
      return json(res, status, { status: "error", error: error instanceof Error ? error.message : String(error) });
    }
  }
  const refreshMatch = req.method === "GET" ? url.pathname.match(/^\/api\/search\/refresh\/([A-Za-z0-9-]{20,100})$/) : null;
  if (refreshMatch) {
    if (!tokenMatches((req.headers.authorization || "").replace(/^Bearer\s+/i, ""), RUNNER_TOKEN)) {
      return json(res, 401, { ok: false, error: "Unauthorized" });
    }
    if (!searchIndex) return json(res, 503, { status: "error", error: "Search index is unavailable" });
    const job = searchIndex.getRefreshJob(refreshMatch[1]);
    if (!job || Date.parse(job.expires_at) <= Date.now()) {
      return json(res, 410, { status: "error", error: "REFRESH_EXPIRED: refresh result expired" });
    }
    if (job.state === "queued" || job.state === "running") {
      return json(res, 202, {
        status: "pending",
        data: { refresh: { state: job.state, token: job.token, poll_after_ms: 2_000 } }
      });
    }
    if (job.state === "failed") {
      return json(res, 200, {
        status: "warning",
        data: { refresh: { state: "failed", token: job.token, error: job.error_message } }
      });
    }
    const indexed = searchIndex.searchPage(job.request, { limit: requestedLimit(job.request), allowStale: true });
    return json(res, 200, { status: "success", data: buildIndexedPayload(job.request, indexed, job, "index") });
  }
  if (req.method === "GET" && url.pathname === "/api/index/status") {
    if (!tokenMatches((req.headers.authorization || "").replace(/^Bearer\s+/i, ""), RUNNER_TOKEN)) {
      return json(res, 401, { ok: false, error: "Unauthorized" });
    }
    return json(res, 200, { status: "success", data: indexRuntimeStatus() });
  }
  if (req.method === "GET" && url.pathname === "/api/search-only/sources") {
    if (!tokenMatches((req.headers.authorization || "").replace(/^Bearer\s+/i, ""), RUNNER_TOKEN)) {
      return json(res, 401, { ok: false, error: "Unauthorized" });
    }
    return json(res, 200, {
      status: "success",
      data: {
        sources: SEARCH_ONLY_SOURCES,
        mode: "search_only",
        note: "메인 검색에 통합되어 있으며, 공식 카테고리 ID 대신 명시 검색어와 결과 분류 필터를 사용합니다."
      }
    });
  }
  if (req.method === "GET" && url.pathname === "/api/runner/status") {
    if (!tokenMatches((req.headers.authorization || "").replace(/^Bearer\s+/i, ""), RUNNER_TOKEN)) {
      return json(res, 401, { ok: false, error: "Unauthorized" });
    }
    return json(res, 200, { status: "success", data: runnerStatus() });
  }
  if (req.method === "POST" && url.pathname === "/api/search-only") {
    if (!tokenMatches((req.headers.authorization || "").replace(/^Bearer\s+/i, ""), RUNNER_TOKEN)) {
      return json(res, 401, { ok: false, error: "Unauthorized" });
    }
    try {
      const body = await readJson(req);
      const result = await searchOnly(body);
      return json(res, 200, result);
    } catch (error) {
      return json(res, 400, { status: "error", error: error instanceof Error ? error.message : String(error) });
    }
  }
  if (req.method !== "POST" || url.pathname !== "/api/runner/run") {
    return json(res, 404, { ok: false, error: "Not found" });
  }
  if (!tokenMatches((req.headers.authorization || "").replace(/^Bearer\s+/i, ""), RUNNER_TOKEN)) {
    return json(res, 401, { ok: false, error: "Unauthorized" });
  }
  try {
    const body = await readJson(req);
    const jobNames = jobNamesFrom(body);
    if (!jobNames.length) return json(res, 400, { ok: false, error: "job_name or job_names is required" });
    const result = await runJobs(jobNames, req.headers["idempotency-key"] || body.idempotency_key || "");
    return json(res, 200, { ok: result.status !== "failed", trigger: result });
  } catch (error) {
    return json(res, 400, { ok: false, error: error instanceof Error ? error.message : String(error) });
  }
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`[aws-runner] listening on ${PORT}; targets=${TARGET_SITES.join(",")}`);
});

const backgroundTimer = setInterval(() => { void runBackgroundRefreshTick(); }, BACKGROUND_TICK_MS);
backgroundTimer.unref();

for (const signal of ["SIGTERM", "SIGINT"]) {
  process.once(signal, () => {
    clearInterval(backgroundTimer);
    try { searchIndex?.close(); } catch {}
    server.close(() => process.exit(0));
  });
}
