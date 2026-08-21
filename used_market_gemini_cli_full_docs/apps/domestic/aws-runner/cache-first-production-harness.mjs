import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const DEFAULT_SITES = ["joonggonara", "bunjang", "hellomarket", "rethinkmall"];
const REFRESH_POLL_DELAYS_MS = [2_000, 5_000, 10_000];

export function validateFirstIndexPage(data, options = {}) {
  const limit = positiveInteger(options.limit, 30, 1, 100);
  assertObject(data, "search data");
  assertObject(data.freshness, "freshness");
  assert(data.freshness.mode === "index", "freshness.mode must be index");
  assert(validTimestamp(data.freshness.refreshed_at), "freshness.refreshed_at must be a real timestamp");
  assertObject(data.quality, "quality");
  const snapshotVersion = Number(data.quality.snapshot_version);
  assert(Number.isSafeInteger(snapshotVersion) && snapshotVersion > 0, "quality.snapshot_version must be a positive integer");
  const items = Array.isArray(data.items) ? data.items : [];
  assert(items.length === limit, `first index page must contain exactly ${limit} items`);
  assert(Number(data.quality.returned_count) === items.length, "quality.returned_count must match the returned page");
  assert(Number(data.quality.page_limit) === limit, "quality.page_limit must match the requested limit");
  const ids = itemIds(items);
  assert(ids.length === items.length, "every result must have a stable item ID or URL");
  assert(new Set(ids).size === ids.length, "first index page must not contain duplicate item IDs");
  const available = Number(data.quality.available_count);
  assert(Number.isFinite(available) && available >= items.length, "quality.available_count must cover the returned page");
  const hasMore = data.pagination?.has_more === true;
  const cursor = String(data.pagination?.next_cursor || "");
  if (available > items.length) {
    assert(hasMore, "pagination.has_more must be true when more indexed items are available");
    assert(/^index:v2:[A-Za-z0-9_-]{1,2000}\.[A-Za-z0-9_-]{24}$/u.test(cursor), "continuation cursor must be a signed index:v2 cursor");
  }
  return {
    returned: items.length,
    available,
    snapshot_version: snapshotVersion,
    refreshed_at: data.freshness.refreshed_at,
    has_more: hasMore,
    cursor_kind: cursor.startsWith("index:v2:") ? "index:v2" : cursor ? "unexpected" : "none"
  };
}

export function validateDbOnlyExecution(data) {
  const execution = data?.quality?.execution;
  assertObject(execution, "quality.execution");
  const indexReads = metricValue(execution, "index_page_reads");
  const liveRuns = metricValue(execution, "live_collection_runs");
  const sourceAttempts = metricValue(execution, "source_collection_attempts");
  const ingestCommits = metricValue(execution, "index_ingest_commits");
  assert(indexReads >= 1, "DB-only request must read at least one SQLite index page");
  assert(liveRuns === 0, "DB-only request must not run live collection");
  assert(sourceAttempts === 0, "DB-only request must not attempt original sources");
  assert(ingestCommits === 0, "DB-only request must not commit an index ingest");
  return {
    index_page_reads: indexReads,
    live_collection_runs: liveRuns,
    source_collection_attempts: sourceAttempts,
    index_ingest_commits: ingestCommits
  };
}

export function validateDbOnlyCounters(before, after, minimumIndexReads = 1) {
  assertObject(before, "before request metrics");
  assertObject(after, "after request metrics");
  const delta = (key) => metricValue(after, key) - metricValue(before, key);
  const indexReads = delta("index_page_reads_total");
  const liveRuns = delta("live_collection_runs_total");
  const sourceAttempts = delta("source_collection_attempts_total");
  const ingestCommits = delta("index_ingest_commits_total");
  assert(indexReads >= minimumIndexReads, `DB-only checks must add at least ${minimumIndexReads} index page reads`);
  assert(liveRuns === 0, "DB-only checks must not run live collection");
  assert(sourceAttempts === 0, "DB-only checks must not attempt original sources");
  assert(ingestCommits === 0, "DB-only checks must not commit an index ingest");
  return {
    index_page_reads: indexReads,
    live_collection_runs: liveRuns,
    source_collection_attempts: sourceAttempts,
    index_ingest_commits: ingestCommits
  };
}

export function validateRepeatedIndexPage(first, repeated) {
  const limit = Array.isArray(first?.items) ? first.items.length : 30;
  const firstSummary = validateFirstIndexPage(first, { limit });
  const repeatedSummary = validateFirstIndexPage(repeated, { limit });
  assert(firstSummary.snapshot_version === repeatedSummary.snapshot_version, "repeated DB page must keep the same snapshot version");
  assert(firstSummary.refreshed_at === repeatedSummary.refreshed_at, "repeated DB page must not invent or change refreshed_at");
  const firstIds = itemIds(first.items);
  const repeatedIds = itemIds(repeated.items);
  assert(JSON.stringify(firstIds) === JSON.stringify(repeatedIds), "repeated DB page must return the same ordered item IDs");
  return {
    same_order: true,
    snapshot_version: firstSummary.snapshot_version,
    refreshed_at: firstSummary.refreshed_at
  };
}

export function validateContinuation(first, second) {
  assertObject(first, "first page");
  assertObject(second, "continuation page");
  const cursor = String(first.pagination?.next_cursor || "");
  assert(cursor.startsWith("index:v2:"), "first page must expose an index:v2 continuation cursor");
  assert(second.freshness?.mode === "index", "continuation freshness.mode must be index");
  const firstSnapshot = Number(first.quality?.snapshot_version);
  const secondSnapshot = Number(second.quality?.snapshot_version);
  assert(Number.isSafeInteger(firstSnapshot) && firstSnapshot > 0, "first page snapshot version is invalid");
  assert(secondSnapshot === firstSnapshot, "continuation must keep the same snapshot version");
  const firstIds = new Set(itemIds(first.items));
  const secondIds = itemIds(second.items);
  assert(secondIds.length > 0, "continuation page must contain at least one item");
  const overlap = secondIds.filter((id) => firstIds.has(id)).length;
  assert(overlap === 0, "continuation page must not overlap the first page");
  assert(new Set(secondIds).size === secondIds.length, "continuation page must not contain duplicate item IDs");
  return {
    returned: secondIds.length,
    overlap,
    snapshot_version: secondSnapshot
  };
}

export function validatePriceSort(data) {
  assert(data?.freshness?.mode === "index", "price sort must be served from index mode");
  const prices = (Array.isArray(data?.items) ? data.items : [])
    .map((item) => numericPrice(item?.price))
    .filter((price) => price !== null);
  assert(prices.length > 0, "price sort must contain at least one priced item");
  const normalPrices = prices.filter((price) => price > 100);
  const firstSuspectIndex = prices.findIndex((price) => price <= 100);
  if (firstSuspectIndex >= 0) {
    assert(prices.slice(firstSuspectIndex).every((price) => price <= 100), "missing or implausible prices must sort after normal prices");
  }
  for (let index = 1; index < normalPrices.length; index += 1) {
    assert(normalPrices[index - 1] <= normalPrices[index], "priced items must be ascending");
  }
  return {
    priced_items: prices.length,
    normal_priced_items: normalPrices.length,
    first_price: normalPrices[0] ?? null,
    last_price: normalPrices.at(-1) ?? null,
    suspect_price_items: prices.length - normalPrices.length
  };
}

export function validatePriceRange(data, minPrice, maxPrice) {
  assert(data?.freshness?.mode === "index", "price range must be served from index mode");
  const min = Number(minPrice);
  const max = Number(maxPrice);
  assert(Number.isFinite(min) && Number.isFinite(max) && min <= max, "price range bounds are invalid");
  const items = Array.isArray(data?.items) ? data.items : [];
  assert(items.length > 0, "price range must return at least one item");
  for (const item of items) {
    const price = Number(item?.price);
    assert(Number.isFinite(price) && price >= min && price <= max, "an item is outside the requested price range");
  }
  return { checked_items: items.length, min_price: min, max_price: max };
}

export function buildRestartProbe(body, first, now = new Date(), expectedSecond = null, processInstance = null) {
  const limit = positiveInteger(body?.limit, 30, 1, 100);
  const summary = validateFirstIndexPage(first, { limit });
  const cursor = String(first.pagination?.next_cursor || "");
  assert(cursor.startsWith("index:v2:"), "restart probe requires an index:v2 continuation cursor");
  return {
    version: 1,
    created_at: now.toISOString(),
    request: {
      keyword: String(body?.keyword || ""),
      category_id: String(body?.category_id || ""),
      sites: sortedStrings(body?.sites),
      sort: String(body?.sort || "recommended"),
      limit,
      site_window: positiveInteger(body?.site_window, 160, 1, 640),
      refresh_index: false
    },
    cursor,
    first_ids: itemIds(first.items),
    expected_second_ids: expectedSecond ? itemIds(expectedSecond.items) : [],
    snapshot_version: summary.snapshot_version,
    refreshed_at: summary.refreshed_at,
    process_instance_id: String(processInstance?.id || "")
  };
}

export function validateRestartContinuation(probe, second, processInstance = null) {
  assertObject(probe, "restart probe");
  const syntheticFirst = {
    items: (Array.isArray(probe.first_ids) ? probe.first_ids : []).map((id) => ({ id })),
    pagination: { has_more: true, next_cursor: probe.cursor },
    quality: { snapshot_version: probe.snapshot_version },
    freshness: { mode: "index", refreshed_at: probe.refreshed_at }
  };
  const summary = validateContinuation(syntheticFirst, second);
  const expectedIds = Array.isArray(probe.expected_second_ids) ? probe.expected_second_ids : [];
  if (expectedIds.length > 0) {
    assert(JSON.stringify(expectedIds) === JSON.stringify(itemIds(second.items)), "restart continuation must return the same ordered second-page item IDs");
  }
  const priorProcess = String(probe.process_instance_id || "");
  const currentProcess = String(processInstance?.id || "");
  if (priorProcess) {
    assert(currentProcess && currentProcess !== priorProcess, "runner process instance must change before restart continuation validation");
  }
  return summary;
}

export async function runProductionCheck(config = configFromEnvironment()) {
  const client = runnerClient(config);
  const status = await client.indexStatus();
  validateRuntimeStatus(status);

  const baseRequest = searchRequest(config, { sort: "recommended", refresh_index: false });
  const first = await client.search(baseRequest);
  const firstSummary = validateFirstIndexPage(first, { limit: config.limit });
  validateDbOnlyExecution(first);
  const repeated = await client.search(baseRequest);
  const repeatedSummary = validateRepeatedIndexPage(first, repeated);
  validateDbOnlyExecution(repeated);
  const second = await client.search({ ...baseRequest, cursor: first.pagination.next_cursor });
  const continuationSummary = validateContinuation(first, second);
  validateDbOnlyExecution(second);

  const priceRequest = searchRequest(config, { sort: "price_asc", refresh_index: false });
  const pricePage = await client.search(priceRequest);
  const priceSummary = validatePriceSort(pricePage);
  validateDbOnlyExecution(pricePage);
  assert(
    pricePage.freshness.refreshed_at === first.freshness.refreshed_at,
    "price sort must not recollect or change refreshed_at"
  );

  const sortedPrices = pricePage.items
    .map((item) => numericPrice(item?.price))
    .filter((price) => price !== null);
  const minPrice = sortedPrices[Math.floor(sortedPrices.length * 0.2)];
  const maxPrice = sortedPrices[Math.max(0, Math.ceil(sortedPrices.length * 0.8) - 1)];
  const rangePage = await client.search({ ...priceRequest, min_price: minPrice, max_price: maxPrice });
  const rangeSummary = validatePriceRange(rangePage, minPrice, maxPrice);
  validateDbOnlyExecution(rangePage);
  assert(
    rangePage.freshness.refreshed_at === first.freshness.refreshed_at,
    "price range must not recollect or change refreshed_at"
  );

  const mismatch = await client.searchRaw({ ...baseRequest, sort: "recent", cursor: first.pagination.next_cursor });
  assert(mismatch.status === 400, "a cursor reused after sort change must be rejected with HTTP 400");
  assert(String(mismatch.payload?.error || "").startsWith("CURSOR_INVALID:"), "sort-mismatched cursor must report CURSOR_INVALID");

  const afterDbOnlyStatus = await client.indexStatus();
  validateRuntimeStatus(afterDbOnlyStatus);
  const dbOnlyCounters = validateDbOnlyCounters(status.request_metrics, afterDbOnlyStatus.request_metrics, 5);
  const refreshSummary = await verifyRefresh(client, baseRequest, config.requireRefreshToken, first.freshness.refreshed_at);
  const afterStatus = await client.indexStatus();
  validateRuntimeStatus(afterStatus);

  return {
    status: "passed",
    runtime: statusSummary(afterStatus),
    first_page: firstSummary,
    repeated_page: repeatedSummary,
    continuation: continuationSummary,
    price_sort: priceSummary,
    price_range: rangeSummary,
    db_only: dbOnlyCounters,
    mismatched_cursor_rejected: true,
    refresh: refreshSummary
  };
}

export async function prepareRestartProbe(config = configFromEnvironment()) {
  const client = runnerClient(config);
  const status = await client.indexStatus();
  validateRuntimeStatus(status);
  const request = searchRequest(config, { sort: "recommended", refresh_index: false });
  const first = await client.search(request);
  validateDbOnlyExecution(first);
  const second = await client.search({ ...request, cursor: first.pagination.next_cursor });
  validateDbOnlyExecution(second);
  const probe = buildRestartProbe(request, first, new Date(), second, status.process_instance);
  mkdirSync(path.dirname(config.restartProbeFile), { recursive: true });
  writeFileSync(config.restartProbeFile, `${JSON.stringify(probe, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  return {
    status: "prepared",
    probe_file: config.restartProbeFile,
    snapshot_version: probe.snapshot_version,
    first_count: probe.first_ids.length,
    second_count: probe.expected_second_ids.length,
    process_instance_recorded: Boolean(probe.process_instance_id),
    cursor_kind: "index:v2"
  };
}

export async function resumeRestartProbe(config = configFromEnvironment()) {
  const client = runnerClient(config);
  const status = await client.indexStatus();
  validateRuntimeStatus(status);
  const probe = JSON.parse(readFileSync(config.restartProbeFile, "utf8"));
  const second = await client.search({ ...probe.request, cursor: probe.cursor });
  validateDbOnlyExecution(second);
  const summary = validateRestartContinuation(probe, second, status.process_instance);
  return {
    status: "passed_after_restart",
    probe_file: config.restartProbeFile,
    ...summary
  };
}

function configFromEnvironment() {
  const sites = sortedStrings(String(process.env.SEARCH_SITES || DEFAULT_SITES.join(",")).split(","));
  assert(sites.length > 0, "SEARCH_SITES must contain at least one site");
  const token = String(process.env.RUNNER_TOKEN || process.env.CLOUDFLARE_RUNNER_TOKEN || "").trim();
  assert(token, "RUNNER_TOKEN or CLOUDFLARE_RUNNER_TOKEN is required");
  return {
    baseUrl: String(process.env.RUNNER_BASE_URL || "http://127.0.0.1:8787").replace(/\/$/, ""),
    token,
    keyword: String(process.env.SEARCH_KEYWORD || "아이폰 15").trim(),
    categoryId: String(process.env.SEARCH_CATEGORY_ID || "mobile").trim(),
    sites,
    limit: positiveInteger(process.env.SEARCH_LIMIT, 30, 1, 60),
    siteWindow: positiveInteger(process.env.SEARCH_SITE_WINDOW, 160, 1, 640),
    timeoutMs: positiveInteger(process.env.RUNNER_HTTP_TIMEOUT_MS, 150_000, 1_000, 300_000),
    requireRefreshToken: String(process.env.REQUIRE_REFRESH_TOKEN || "false").toLowerCase() === "true",
    restartProbeFile: path.resolve(process.env.RESTART_PROBE_FILE || "/tmp/used-market-cache-first-restart-probe.json")
  };
}

function runnerClient(config) {
  const headers = {
    authorization: `Bearer ${config.token}`,
    "content-type": "application/json"
  };
  const request = async (pathname, options = {}) => {
    const response = await fetch(`${config.baseUrl}${pathname}`, {
      ...options,
      headers: { ...headers, ...(options.headers || {}) },
      signal: AbortSignal.timeout(config.timeoutMs)
    });
    let payload = null;
    try {
      payload = await response.json();
    } catch {
      throw new Error(`${pathname} returned non-JSON HTTP ${response.status}`);
    }
    return { status: response.status, payload };
  };
  return {
    async indexStatus() {
      const result = await request("/api/index/status", { method: "GET" });
      assert(result.status === 200, `/api/index/status returned HTTP ${result.status}`);
      return result.payload?.data;
    },
    async search(body) {
      const result = await this.searchRaw(body);
      assert(result.status === 200, `/api/search returned HTTP ${result.status}: ${safeError(result.payload)}`);
      assert(result.payload?.status === "success", "/api/search did not return status=success");
      return result.payload.data;
    },
    async searchRaw(body) {
      return request("/api/search", { method: "POST", body: JSON.stringify(body) });
    },
    async refresh(token) {
      return request(`/api/search/refresh/${encodeURIComponent(token)}`, { method: "GET" });
    }
  };
}

function searchRequest(config, overrides = {}) {
  return {
    keyword: config.keyword,
    category_id: config.categoryId,
    sites: config.sites,
    sort: "recommended",
    limit: config.limit,
    site_window: config.siteWindow,
    ...overrides
  };
}

async function verifyRefresh(client, baseRequest, requireToken, previousRefreshedAt) {
  const response = await client.search({ ...baseRequest, refresh_index: true });
  const token = String(response.freshness?.refresh_token || response.refresh?.token || "");
  if (!token) {
    assert(!requireToken, "refresh token was required but the query was not due for refresh");
    return { state: "not_due", polled: 0 };
  }
  for (let index = 0; index < REFRESH_POLL_DELAYS_MS.length; index += 1) {
    await wait(REFRESH_POLL_DELAYS_MS[index]);
    const result = await client.refresh(token);
    if (result.status === 202) continue;
    assert(result.status === 200, `refresh token returned HTTP ${result.status}`);
    const state = String(result.payload?.data?.refresh?.state || "");
    assert(state === "completed", `refresh token must finish as completed: ${safeError(result.payload?.data?.refresh)}`);
    assert(result.payload?.status === "success", "completed refresh token did not return status=success");
    validateFirstIndexPage(result.payload.data, { limit: Number(baseRequest.limit) || 30 });
    assert(
      Date.parse(result.payload.data.freshness.refreshed_at) > Date.parse(previousRefreshedAt),
      "completed refresh must advance refreshed_at"
    );
    return { state: "completed", polled: index + 1, added_count: Number(result.payload.data.refresh?.added_count || 0) };
  }
  throw new Error("refresh token did not complete after 2s, 5s, and 10s polls");
}

function validateRuntimeStatus(status) {
  assertObject(status, "index runtime status");
  assert(status.enabled === true, "search index must be enabled");
  assert(status.mode === "cache_first", "RUNNER_INDEX_MODE must be cache_first");
  assert(status.soft_limit_reached !== true && status.hard_limit_reached !== true, "SQLite size limit warning is active");
  assert(status.disk_warning !== true, "disk warning is active");
  assert(status.memory_warning !== true, "memory warning is active");
  assert(status.refresh_lag_warning !== true, "refresh lag warning is active");
}

function statusSummary(status) {
  return {
    mode: status.mode,
    database_size_bytes: Number(status.database_size_bytes || 0),
    active_listings: Number(status.active_listings || 0),
    pending_refresh_jobs: Number(status.pending_refresh_jobs || 0),
    rss_bytes: Number(status.process_memory?.rss || 0),
    disk_free_bytes: Number(status.disk_free_bytes || 0),
    warnings: {
      soft_limit: status.soft_limit_reached === true,
      hard_limit: status.hard_limit_reached === true,
      disk: status.disk_warning === true,
      memory: status.memory_warning === true,
      refresh_lag: status.refresh_lag_warning === true
    }
  };
}

function itemIds(items) {
  return (Array.isArray(items) ? items : [])
    .map((item) => String(item?.item_id || item?.id || item?.url || "").trim())
    .filter(Boolean);
}

function sortedStrings(values) {
  return [...new Set((Array.isArray(values) ? values : []).map((value) => String(value || "").trim()).filter(Boolean))].sort();
}

function positiveInteger(value, fallback, min, max) {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(Math.max(parsed, min), max);
}

function validTimestamp(value) {
  return typeof value === "string" && value.length > 0 && Number.isFinite(Date.parse(value));
}

function numericPrice(value) {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function metricValue(metrics, key) {
  const value = Number(metrics?.[key]);
  assert(Number.isSafeInteger(value) && value >= 0, `${key} must be a non-negative integer counter`);
  return value;
}

function safeError(payload) {
  return String(payload?.error || payload?.message || "unknown error").slice(0, 300);
}

function assertObject(value, label) {
  assert(value && typeof value === "object" && !Array.isArray(value), `${label} must be an object`);
}

function assert(condition, message) {
  if (!condition) throw new Error(`CACHE_FIRST_PRODUCTION_CHECK_FAILED: ${message}`);
}

function wait(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function main() {
  const command = String(process.argv[2] || "check").trim();
  const config = configFromEnvironment();
  const result = command === "check"
    ? await runProductionCheck(config)
    : command === "prepare-restart"
      ? await prepareRestartProbe(config)
      : command === "resume-restart"
        ? await resumeRestartProbe(config)
        : (() => { throw new Error("command must be check, prepare-restart, or resume-restart"); })();
  console.log(JSON.stringify(result, null, 2));
}

const isMain = process.argv[1]
  && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;
if (isMain) {
  main().catch((error) => {
    console.error(JSON.stringify({
      status: "failed",
      error: error instanceof Error ? error.message : String(error)
    }, null, 2));
    process.exitCode = 1;
  });
}
