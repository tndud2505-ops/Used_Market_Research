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
import { PcPartsLedger } from "./pc-parts-ledger.mjs";
import { stabilizeIncrementalPcProjections } from "./pc-projection-republish-policy.mjs";
import { parsePriceStatsRequest, priceStatsResponse } from "./pc-price-stats-http.mjs";
import { PcShadowPipeline } from "./pc-shadow-pipeline.mjs";
import { evaluatePipelineQualityReports, loadPipelineQualityReports } from "./pc-pipeline-governance.mjs";
import { explicitSoldText, structuredSoldEvidenceFromHtml } from "../market/logic/listing-lifecycle.mjs";
import { compactStatsForPublication, statsChecksum, statsPublicationKey } from "../cloudflare/public-product-stats.mjs";
import { pcCatalogResponse, pcCollectionTargetSetV2, pcProductsResponse } from "../cloudflare/pc-directory-http.mjs";
import { publicPcModelsForApi } from "../market/logic/pc-public-catalog.mjs";
import {
  decodePcListingsCursor,
  encodePcListingsCursor,
  parsePcListingsRequest,
  pcListingsFreshness
} from "../cloudflare/pc-listings-contract.mjs";
import {
  PC_SOURCE_REGISTRY,
  getSourceRuntimeDefaults,
  operatorAttestedSourceGovernance,
  runDueSourceCollections,
  sourceRuntimeForScheduler,
  sourceRuntimeAfterFailure,
  validateSourceGovernance
} from "../collector/logic/pc-source-registry.mjs";
import {
  SPECIALIST_FIXTURE_PARSERS,
  collectDanawaCategoryListings,
  createSourceAdapter,
  filterIncrementalListings
} from "../collector/logic/pc-source-adapters.mjs";

const PORT = Number.parseInt(process.env.RUNNER_PORT || "8787", 10);
const RUNNER_TOKEN = process.env.CLOUDFLARE_RUNNER_TOKEN || process.env.RUNNER_TOKEN || "";
const SEARCH_CURSOR_SECRET = process.env.RUNNER_CURSOR_SECRET || RUNNER_TOKEN || "used-market-local-cursor-v2";
const IMPORT_URL = (process.env.D1_IMPORT_URL || "").trim();
const IMPORT_TOKEN = process.env.CLOUDFLARE_MANUAL_RUN_TOKEN || process.env.IMPORT_TOKEN || "";
const STATS_IMPORT_URL = (process.env.D1_STATS_IMPORT_URL || "").trim();
const PC_LISTING_COLLECTION_MANIFEST_VERSION = "pc-listing-collection-v1";
const PC_COLLECTION_TARGET_SET = pcCollectionTargetSetV2();
const PC_HOURLY_COLLECTION_TARGET_IDS = new Set(PC_COLLECTION_TARGET_SET.targets
  .filter((target) => target.enabled !== false && target.cadenceClass === "HOURLY_CATEGORY")
  .map((target) => target.targetId));
const MAX_BODY_BYTES = 1_048_576;
const TARGET_SITES = Object.freeze(PC_SOURCE_REGISTRY
  .filter((source) => source.public_search && source.policy_status === "APPROVED" && source.runtime_status === "ENABLED")
  .sort((left, right) => left.public_search_order - right.public_search_order)
  .map((source) => source.key));
const PC_DIRECTORY_SITES = Object.freeze(PC_SOURCE_REGISTRY
  .filter((source) => source.directory_source === true && source.policy_status === "APPROVED" && source.runtime_status === "ENABLED")
  .map((source) => source.key));
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
const INDEX_SOFT_LIMIT_BYTES = Math.min(8 * 1024 * 1024 * 1024, Math.max(1024 * 1024 * 1024,
  Number.parseInt(process.env.RUNNER_INDEX_SOFT_LIMIT_BYTES || String(3 * 1024 * 1024 * 1024), 10)
    || 3 * 1024 * 1024 * 1024));
const INDEX_HARD_LIMIT_BYTES = Math.min(16 * 1024 * 1024 * 1024, Math.max(INDEX_SOFT_LIMIT_BYTES + 512 * 1024 * 1024,
  Number.parseInt(process.env.RUNNER_INDEX_HARD_LIMIT_BYTES || String(4 * 1024 * 1024 * 1024), 10)
    || 4 * 1024 * 1024 * 1024));
const BACKGROUND_MAX_PER_HOUR = 12;
const BACKGROUND_TICK_MS = 60_000;
const PC_SCHEDULER_TICK_MS = 30_000;
// Do not replay a multi-hour backlog synchronously during process startup.
// The persisted per-target runtime still catches up on the normal cadence,
// while the HTTP server remains responsive for health and search requests.
const PC_SCHEDULER_CATCHUP_MS = 0;
const PC_PARTS_SHADOW_WRITE_ENABLED = String(process.env.PC_PARTS_SHADOW_WRITE_ENABLED ?? "true").toLowerCase() !== "false";
const PC_PARTS_SCHEDULER_ENABLED = String(process.env.PC_PARTS_SCHEDULER_ENABLED ?? "false").toLowerCase() === "true";
const PC_SOURCE_RECENT_MS = 2 * 60 * 60 * 1000;
const PC_SHADOW_READY_MS = 7 * 24 * 60 * 60 * 1000;
const PC_PUBLICATION_RECENT_MS = 26 * 60 * 60 * 1000;
const PC_RECHECK_LIMIT_PER_RUN = 20;
const PC_SOURCE_TARGETS_PER_RUN = Math.min(128, Math.max(20,
  Number.parseInt(process.env.PC_SOURCE_TARGETS_PER_RUN || "64", 10) || 64));
const PC_SOURCE_TARGET_CONCURRENCY = Math.min(8, Math.max(1,
  Number.parseInt(process.env.PC_SOURCE_TARGET_CONCURRENCY || "6", 10) || 6));
const PC_EXTERNAL_FETCH_TIMEOUT_MS = 30_000;
const PC_SCHEDULER_WATCHDOG_MS = Math.min(30 * 60 * 1000, Math.max(5 * 60 * 1000,
  Number.parseInt(process.env.PC_SCHEDULER_WATCHDOG_MS || String(20 * 60 * 1000), 10) || 20 * 60 * 1000));

function boundedFetchSignal(parentSignal, timeoutMs = PC_EXTERNAL_FETCH_TIMEOUT_MS) {
  const timeoutSignal = AbortSignal.timeout(timeoutMs);
  return parentSignal ? AbortSignal.any([parentSignal, timeoutSignal]) : timeoutSignal;
}

function throwIfAborted(signal) {
  if (!signal?.aborted) return;
  throw signal.reason instanceof Error ? signal.reason : new Error("PC_SCHEDULER_ABORTED");
}

const PC_LEDGER_RECORD_YIELD_EVERY = 4;
const PC_INDEX_WRITE_BATCH_SIZE = 25;

function yieldToEventLoop() {
  return new Promise((resolve) => setImmediate(resolve));
}

async function recordPcItemsIncrementally(items, observedAt) {
  const sourceItems = Array.isArray(items) ? items : [];
  const recorded = [];
  for (let index = 0; index < sourceItems.length; index += 1) {
    recorded.push(pcPipeline.recordItem(sourceItems[index], observedAt));
    if ((index + 1) % PC_LEDGER_RECORD_YIELD_EVERY === 0 && index + 1 < sourceItems.length) {
      await yieldToEventLoop();
    }
  }
  return recorded;
}

async function upsertPcProjectionsIncrementally(items, options) {
  const projections = Array.isArray(items) ? items : [];
  if (!searchIndex || projections.length === 0) return;
  for (let offset = 0; offset < projections.length; offset += PC_INDEX_WRITE_BATCH_SIZE) {
    searchIndex.upsertPublicProjections(projections.slice(offset, offset + PC_INDEX_WRITE_BATCH_SIZE), options);
    if (offset + PC_INDEX_WRITE_BATCH_SIZE < projections.length) await yieldToEventLoop();
  }
}

function jsonEnvironment(name) {
  const raw = String(process.env[name] || "").trim();
  if (!raw) return {};
  try {
    const value = JSON.parse(raw);
    return value && typeof value === "object" && !Array.isArray(value) ? value : {};
  } catch (error) {
    console.warn(`[aws-runner] ignoring invalid ${name}`, error instanceof Error ? error.message : String(error));
    return {};
  }
}

const PC_SOURCE_GOVERNANCE = jsonEnvironment("PC_SOURCE_GOVERNANCE_JSON");
const EFFECTIVE_PC_SOURCE_GOVERNANCE = Object.freeze(Object.fromEntries(PC_SOURCE_REGISTRY.map((source) => [
  source.key,
  Object.hasOwn(PC_SOURCE_GOVERNANCE, source.key)
    ? PC_SOURCE_GOVERNANCE[source.key]
    : operatorAttestedSourceGovernance(source)
])));
const PC_SPECIALIST_SEARCH_URLS = Object.freeze({
  coolenjoy: "https://coolenjoy.net/bbs/mart2?sfl=wr_subject&stx={query}&sop=and",
  ...jsonEnvironment("PC_SPECIALIST_SEARCH_URLS_JSON")
});
const PC_SPECIALIST_SEARCH_HOSTS = Object.freeze({
  coolenjoy: new Set(["coolenjoy.net", "www.coolenjoy.net"])
});
const PC_SPECIALIST_PUBLIC_QUERY_OVERRIDES = Object.freeze({});
const PC_SOURCE_TARGET_PACING_MS = Object.freeze({
  coolenjoy: 200,
  ebay: 300,
  // RethinkMall starts returning 429s when a 64-target batch is paced below
  // roughly a minute. Keep the normal public route but leave more room
  // between requests so a partial batch can still be committed.
  rethinkmall: 1_500
});
const DANAWA_REQUEST_MIN_INTERVAL_MS = 650;
let lastDanawaRequestAt = 0;

async function fetchDanawaPublicWithPacing(input, init = {}) {
  const remaining = DANAWA_REQUEST_MIN_INTERVAL_MS - (Date.now() - lastDanawaRequestAt);
  if (remaining > 0) await new Promise((resolve) => setTimeout(resolve, remaining));
  lastDanawaRequestAt = Date.now();
  return fetch(input, { ...init, signal: boundedFetchSignal(init.signal, 20_000) });
}
const PC_ALIAS_PROMOTION_EVIDENCE = jsonEnvironment("PC_ALIAS_PROMOTION_EVIDENCE_JSON");
const PC_PIPELINE_QUALITY_REPORTS_PATH = String(process.env.PC_PIPELINE_QUALITY_REPORTS_PATH || "").trim();
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
const OPERATIONAL_SEARCH_ONLY_SOURCES = Object.freeze(
  SEARCH_ONLY_SOURCES.filter((source) => TARGET_SITES.includes(source.key))
);
const JOB_PLANS = Object.freeze({
  "gpu-fast-scan": { category_id: "pc", keyword: "RTX 3060" },
  "cpu-scan": { category_id: "pc", keyword: "Ryzen 5 5600" },
  "ram-scan": { category_id: "pc", keyword: "RAM 16GB" },
  "ssd-scan": { category_id: "pc", keyword: "SSD 1TB" },
  "psu-scan": { category_id: "pc", keyword: "PSU 600W" },
  "full-pc-scan": { category_id: "pc", keyword: "gaming PC" }
});

let activeRun = false;
const idempotencyResults = new Map();
const searchCache = new Map();
const searchInflight = new Map();
let activeSearchJobs = 0;
const waitingSearchJobs = [];
let searchIndex = null;
let searchIndexError = "";
let pcLedger = null;
let pcPipeline = null;
let pcPipelineError = "";
let pcSchedulerAfter = new Date(Date.now() - PC_SCHEDULER_CATCHUP_MS).toISOString();
let pcSchedulerRuntime = Object.fromEntries(PC_SOURCE_REGISTRY.map((source) => [source.key, getSourceRuntimeDefaults(source.key)]));
let pcSchedulerActive = false;
let pcSchedulerLastTickAt = null;
let pcSchedulerLastSucceededAt = null;
let pcSchedulerLastError = null;
let pcPublicationLastSucceededAt = null;
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
    searchIndex = new SearchIndex({
      filePath: INDEX_PATH,
      backupDir: path.join(INDEX_ROOT, "backups"),
      limits: { softBytes: INDEX_SOFT_LIMIT_BYTES, hardBytes: INDEX_HARD_LIMIT_BYTES }
    });
    if (PC_PARTS_SHADOW_WRITE_ENABLED) {
      try {
        searchIndex.createBackup();
        pcLedger = new PcPartsLedger({ db: searchIndex.db });
        pcLedger.migrate();
        pcPipeline = new PcShadowPipeline({ ledger: pcLedger });
        await pcPipeline.initialize();
        for (const source of PC_SOURCE_REGISTRY) {
          const governance = EFFECTIVE_PC_SOURCE_GOVERNANCE[source.key];
          if (!governance || !validateSourceGovernance(source, governance).ok) continue;
          const governanceOrigin = governance.governance_origin === "REGISTRY_OPERATOR_ATTESTATION"
            ? "operator-attested-registry"
            : "configured-canary";
          pcLedger.upsertSource({
            sourceId: source.key,
            displayName: source.name,
            marketPool: source.market_pool,
            marketPools: source.market_pools,
            policyStatus: "APPROVED",
            policyReviewedAt: governance.policy_reviewed_at,
            runtimeStatus: governance.runtime_status || "ENABLED",
            policyNote: `access=${governance.approved_access_mode}; approval=${governanceOrigin}; operator=enabled; constraints=${source.access_constraints || "configured-governance"}`
          });
        }
        pcLedger.activateCollectionTargets(PC_COLLECTION_TARGET_SET);
        pcSchedulerRuntime = Object.fromEntries(PC_SOURCE_REGISTRY.map((source) => {
          const persisted = pcLedger.getSource(source.key);
          const governance = EFFECTIVE_PC_SOURCE_GOVERNANCE[source.key];
          const governedRuntime = source.policy_status === "APPROVED" && governance
            && validateSourceGovernance(source, governance).ok
            ? governance.runtime_status
            : null;
          return [source.key, sourceRuntimeForScheduler(source.key, {
            persisted,
            governedRuntimeStatus: governedRuntime || source.runtime_status
          })];
        }));
        const persistedSchedulerSuccesses = Object.values(pcSchedulerRuntime)
          .map((runtime) => runtime.last_succeeded_at)
          .filter((value) => typeof value === "string" && Number.isFinite(Date.parse(value)))
          .sort();
        pcSchedulerLastSucceededAt = persistedSchedulerSuccesses.at(-1) || null;
        pcPublicationLastSucceededAt = pcLedger.getPublicationRuntime("PRODUCT_STATS")?.published_at || null;
      } catch (error) {
        pcLedger = null;
        pcPipeline = null;
        pcPipelineError = error instanceof Error ? error.message : String(error);
        console.error("[aws-runner] PC shadow ledger unavailable; search index remains enabled", error);
      }
    }
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
  res.setHeader("content-security-policy", "default-src 'none'; frame-ancestors 'none'");
  res.setHeader("strict-transport-security", "max-age=31536000; includeSubDomains");
  res.setHeader("x-content-type-options", "nosniff");
  res.setHeader("referrer-policy", "strict-origin-when-cross-origin");
  res.setHeader("x-frame-options", "DENY");
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
    updated_at: item.updated_at || new Date().toISOString(),
    canonical_product_id: item.canonical_product_id || null,
    canonical_display_name: item.canonical_display_name || null,
    canonical_manufacturer: item.canonical_manufacturer || null,
    board_manufacturer: item.board_manufacturer || null,
    listing_kind: item.listing_kind || "UNKNOWN",
    pc_category_code: item.category_code || null,
    quantity: item.quantity || null,
    price_scope: item.price_scope || "UNKNOWN",
    condition_code: item.condition_code || "UNKNOWN",
    lifecycle_status: item.lifecycle_status || "ACTIVE",
    market_pool: item.market_pool || null,
    confidence: item.confidence || {},
    evidence: item.evidence || {},
    price_eligible: item.price_eligible === true,
    exclusion_reasons: item.exclusion_reasons || [],
    good_listing_eligible: item.good_listing_eligible === true,
    reference_price: item.reference_price ?? null
  };
}

async function importToD1(items, parentSignal) {
  if (!items.length) return { inserted: 0, skipped: true };
  if (!IMPORT_URL || !IMPORT_TOKEN) {
    return { inserted: 0, skipped: true, warning: "D1_IMPORT_URL or import token is not configured" };
  }
  const chunkSize = 400;
  const aggregate = { inserted: 0, rejected: 0, batches: 0 };
  for (let offset = 0; offset < items.length; offset += chunkSize) {
    const chunk = items.slice(offset, offset + chunkSize);
    const response = await fetch(IMPORT_URL, {
      method: "POST",
      headers: {
        authorization: `Bearer ${IMPORT_TOKEN}`,
        "content-type": "application/json"
      },
      body: JSON.stringify({ items: chunk.map(toImportItem) }),
      signal: boundedFetchSignal(parentSignal)
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(`D1_IMPORT_HTTP_${response.status}: ${JSON.stringify(payload)}`);
    const result = payload.data || payload;
    aggregate.inserted += Number(result.inserted || 0);
    aggregate.rejected += Number(result.rejected || 0);
    aggregate.batches += 1;
  }
  return aggregate;
}

function isD1DailyRowWriteLimitError(error) {
  const message = error instanceof Error ? error.message : String(error);
  return /(?:free tier daily row write limit|daily row write limit)/iu.test(message);
}

async function importToD1BestEffort(items, parentSignal) {
  try {
    return await importToD1(items, parentSignal);
  } catch (error) {
    if (!isD1DailyRowWriteLimitError(error)) throw error;
    console.warn("[aws-runner] D1 public projection deferred", "D1_DAILY_ROW_WRITE_LIMIT");
    return {
      inserted: 0,
      rejected: 0,
      batches: 0,
      skipped: true,
      deferred: true,
      warning: "D1_DAILY_ROW_WRITE_LIMIT"
    };
  }
}

async function mirrorPcListingCollectionManifest({ sourceId, asOf, successfulTargetIds }, parentSignal) {
  if (!IMPORT_URL || !IMPORT_TOKEN) {
    return { mirrored: false, skipped: true, warning: "D1_IMPORT_URL or import token is not configured" };
  }
  const source = String(sourceId || "").trim().toLowerCase();
  if (!PC_DIRECTORY_SITES.includes(source)) throw new Error(`PC_COLLECTION_MANIFEST_SOURCE_INVALID:${source || "unknown"}`);
  const timestamp = new Date(asOf).toISOString();
  const targetIds = [...new Set((Array.isArray(successfulTargetIds) ? successfulTargetIds : [])
    .map((targetId) => String(targetId || "").trim()).filter(Boolean))].sort();
  const response = await fetch(IMPORT_URL, {
    method: "POST",
    headers: {
      authorization: `Bearer ${IMPORT_TOKEN}`,
      "content-type": "application/json"
    },
    body: JSON.stringify({
      items: [],
      collection_manifest: {
        manifest_version: PC_LISTING_COLLECTION_MANIFEST_VERSION,
        source_id: source,
        status: "SUCCEEDED",
        as_of: timestamp,
        successful_target_ids: targetIds
      }
    }),
    signal: boundedFetchSignal(parentSignal)
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`D1_COLLECTION_MANIFEST_HTTP_${response.status}: ${JSON.stringify(payload)}`);
  const mirrored = payload?.collection_manifest || payload?.data?.collection_manifest;
  const mirroredTargetIds = Array.isArray(mirrored?.successful_target_ids) ? mirrored.successful_target_ids : [];
  if (mirrored?.source_id !== source
    || mirrored?.manifest_version !== PC_LISTING_COLLECTION_MANIFEST_VERSION
    || mirrored?.as_of !== timestamp
    || Number(mirrored?.successful_target_count) !== targetIds.length
    || JSON.stringify(mirroredTargetIds) !== JSON.stringify(targetIds)) {
    throw new Error("D1_COLLECTION_MANIFEST_MISMATCH");
  }
  return {
    mirrored: true,
    source_id: source,
    as_of: mirrored.as_of,
    successful_target_count: targetIds.length
  };
}

async function publishPcProductStats() {
  if (!pcLedger) return { published: false, skipped: true, warning: "PC parts ledger is unavailable" };
  const asOf = new Date().toISOString();
  const integrityAudit = pcLedger.runIntegrityAudit(asOf);
  const aliasEvaluations = pcLedger.evaluateDueAliasShadows(asOf, PC_ALIAS_PROMOTION_EVIDENCE);
  const pipelineDecisions = evaluatePipelineQualityReports({
    ledger: pcLedger,
    reports: loadPipelineQualityReports(PC_PIPELINE_QUALITY_REPORTS_PATH),
    evaluatedAt: asOf
  });
  const activePipelineVersion = pcLedger.getActivePipelineVersion();
  const priceVersionOptions = activePipelineVersion ? {
    normalizationVersion: activePipelineVersion.normalization_version,
    parserVersion: activePipelineVersion.parser_version,
    ruleVersion: activePipelineVersion.rule_version,
    filterVersion: activePipelineVersion.filter_version
  } : {};
  const scopes = pcLedger.db.prepare(`SELECT DISTINCT n.canonical_product_id, n.market_pool,
      n.condition_code, s.currency
    FROM normalized_listings n
    JOIN listing_snapshots s ON s.id = n.snapshot_id
    WHERE n.canonical_product_id IS NOT NULL
      AND n.normalization_version = ?
      AND n.parser_version = ? AND n.rule_version = ? AND n.filter_version = ?
    ORDER BY n.canonical_product_id, n.market_pool, n.condition_code, s.currency`).all(
      Number(activePipelineVersion?.normalization_version || 1),
      priceVersionOptions.parserVersion || "pc-parser-v1",
      priceVersionOptions.ruleVersion || "pc-rules-v1",
      priceVersionOptions.filterVersion || "pc-filter-v1"
    );
  const rows = [];
  for (const scope of scopes) {
    const options = {
      canonicalProductId: scope.canonical_product_id,
      days: 30,
      marketPool: scope.market_pool,
      condition: scope.condition_code,
      currency: scope.currency,
      asOf,
      ...priceVersionOptions
    };
    const stats = compactStatsForPublication(pcLedger.rebuildAndGetPriceStats(options));
    const memberCount = pcLedger.traceStatMembers(options).length;
    rows.push({
      canonical_product_id: scope.canonical_product_id,
      market_pool: scope.market_pool,
      condition_code: scope.condition_code,
      currency: scope.currency,
      days: 30,
      stats_json: { ...stats, traceability: { member_count: memberCount } },
      as_of: asOf
    });
  }
  const nonEmptyScopeCount = rows.filter((row) => {
    const stats = row.stats_json || {};
    return Number(stats.active?.sample_count || 0) + Number(stats.reserved?.sample_count || 0) + Number(stats.sold?.sample_count || 0)
      + Number(stats.confirmed_transactions?.sample_count || 0) > 0;
  }).length;
  if (nonEmptyScopeCount === 0) throw new Error("STATS_PUBLICATION_HAS_NO_SAMPLES");
  const checksum = await statsChecksum(rows);
  const publication = {
    publication_id: randomUUID(),
    checksum,
    expected_row_count: rows.length,
    merge_with_active: true,
    parser_version: priceVersionOptions.parserVersion || "pc-parser-v1",
    rule_version: priceVersionOptions.ruleVersion || "pc-rules-v1",
    filter_version: priceVersionOptions.filterVersion || "pc-filter-v1",
    created_at: asOf,
    expected_non_empty_scope_count: nonEmptyScopeCount,
    expected_keys: rows.map(statsPublicationKey).sort(),
    rows
  };
  if (!STATS_IMPORT_URL || !IMPORT_TOKEN) {
    throw new Error("D1_STATS_PUBLICATION_NOT_CONFIGURED");
  }
  const publicationBody = JSON.stringify(publication);
  console.info("pc stats publication payload prepared", {
    publication_id: publication.publication_id,
    row_count: rows.length,
    non_empty_scope_count: nonEmptyScopeCount,
    body_bytes: Buffer.byteLength(publicationBody)
  });
  const response = await fetch(STATS_IMPORT_URL, {
    method: "POST",
    headers: { authorization: `Bearer ${IMPORT_TOKEN}`, "content-type": "application/json" },
    body: publicationBody,
    signal: boundedFetchSignal()
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`D1_STATS_IMPORT_HTTP_${response.status}: ${JSON.stringify(payload)}`);
  const activatedPublication = payload?.publication;
  const activatedPublicationId = String(activatedPublication?.publication_id || "");
  const activatedChecksum = String(activatedPublication?.checksum || "");
  const activatedRowCount = Number(activatedPublication?.row_count);
  const activatedInputRowCount = Number(activatedPublication?.input_row_count);
  const activatedScopeKeyCount = Number(activatedPublication?.scope_key_count);
  if (payload?.ok !== true || activatedPublication?.active !== true
    || activatedPublicationId !== publication.publication_id
    || !/^[a-f0-9]{64}$/iu.test(activatedChecksum)
    || !Number.isInteger(activatedRowCount) || activatedRowCount < rows.length
    || activatedInputRowCount !== rows.length
    || activatedScopeKeyCount !== activatedRowCount) {
    throw new Error("D1_STATS_IMPORT_ACTIVATION_MANIFEST_MISMATCH");
  }
  pcPublicationLastSucceededAt = new Date().toISOString();
  pcLedger.recordPublicationSuccess({
    publicationId: activatedPublicationId,
    checksum: activatedChecksum,
    rowCount: activatedRowCount,
    publishedAt: pcPublicationLastSucceededAt
  });
  return {
    published: true,
    row_count: activatedRowCount,
    input_row_count: rows.length,
    preserved_row_count: Number(activatedPublication.preserved_row_count || 0),
    overwritten_row_count: Number(activatedPublication.overwritten_row_count || 0),
    checksum: activatedChecksum,
    publication_id: activatedPublicationId,
    integrity_audit: integrityAudit,
    alias_evaluations: aliasEvaluations,
    pipeline_decisions: pipelineDecisions
  };
}

async function collectJob(jobName) {
  if (jobName === "daily-price-refresh") {
    const publication = await publishPcProductStats();
    return { status: "completed", job_name: jobName, mode: "pc-parts-ledger", items: publication.row_count || 0, publication };
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
  const projected = pcPipeline ? pcPipeline.recordItems(collected, { observedAt: new Date().toISOString() }) : collected;
  const importResult = await importToD1(projected);
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
    pc_category_code: typeof body?.pc_category_code === "string" ? body.pc_category_code.trim().toUpperCase() : "",
    manufacturer: typeof body?.manufacturer === "string" ? body.manufacturer.trim() : "",
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
  return OPERATIONAL_SEARCH_ONLY_SOURCES.find((source) => source.key === sourceKey) || null;
}

function recentTimestamp(value, maxAgeMs, now = Date.now()) {
  const parsed = Date.parse(String(value || ""));
  return Number.isFinite(parsed) && parsed <= now && now - parsed <= maxAgeMs;
}

function pcOperationalReadiness() {
  const now = Date.now();
  const requiredSources = PC_SOURCE_REGISTRY.filter((source) => (
    source.directory_source === true && source.policy_status === "APPROVED" && source.runtime_status === "ENABLED"
  ));
  const reviewRequiredActiveSources = PC_SOURCE_REGISTRY.filter((source) => {
    if (source.policy_status !== "REVIEW_REQUIRED") return false;
    const persisted = pcLedger?.getSource(source.key);
    return TARGET_SITES.includes(source.key)
      || persisted?.runtime_status === "ENABLED"
      || pcSchedulerRuntime[source.key]?.runtime_status === "ENABLED";
  }).map((source) => source.key).sort();
  const sourceReadiness = requiredSources.map((source) => {
    const governance = EFFECTIVE_PC_SOURCE_GOVERNANCE[source.key];
    const activation = governance ? validateSourceGovernance(source, governance) : { ok: false, reason: "POLICY_REVIEW_MISSING" };
    const persisted = pcLedger?.getSource(source.key);
    const coverage = pcLedger?.getSourceCollectionCoverage(source.key, new Date(now));
    const firstCommittedCrawlAt = coverage?.first_committed_crawl_at || null;
    const lastCommittedCrawlAt = coverage?.last_committed_crawl_at || null;
    const policyApproved = source.policy_status === "APPROVED" && persisted?.policy_status === "APPROVED";
    const runtimeEnabled = persisted?.runtime_status === "ENABLED"
      && pcSchedulerRuntime[source.key]?.runtime_status === "ENABLED";
    const canaryEvidence = activation.ok === true;
    const recentCommittedCrawl = recentTimestamp(lastCommittedCrawlAt, PC_SOURCE_RECENT_MS, now);
    const successDayCount = Number(coverage?.success_day_count_31d || 0);
    const maxGapDays = Number(coverage?.max_gap_days_31d || 0);
    const continuousCoverage = coverage?.continuous_30_day_coverage === true;
    const reasons = [];
    if (!policyApproved) reasons.push("SOURCE_POLICY_NOT_APPROVED");
    if (!runtimeEnabled) reasons.push("SOURCE_RUNTIME_NOT_ENABLED");
    if (!canaryEvidence) reasons.push(activation.reason || "SOURCE_CANARY_EVIDENCE_MISSING");
    if (!recentCommittedCrawl) reasons.push("SOURCE_COMMITTED_CRAWL_NOT_RECENT");
    return {
      source_key: source.key,
      policy_status: persisted?.policy_status || source.policy_status,
      runtime_status: persisted?.runtime_status || pcSchedulerRuntime[source.key]?.runtime_status || source.runtime_status,
      policy_approved: policyApproved,
      runtime_enabled: runtimeEnabled,
      canary_evidence: canaryEvidence,
      first_committed_crawl_at: firstCommittedCrawlAt,
      last_committed_crawl_at: lastCommittedCrawlAt,
      recent_committed_crawl: recentCommittedCrawl,
      success_day_count_31d: successDayCount,
      max_gap_days_31d: maxGapDays,
      continuous_30_day_coverage: continuousCoverage,
      coverage_warning: continuousCoverage ? null : "SOURCE_30_DAY_COVERAGE_INSUFFICIENT",
      activation_basis: governance?.governance_origin === "REGISTRY_OPERATOR_ATTESTATION"
        ? "OPERATOR_ATTESTED_DIRECT_PERMISSION"
        : "CONFIGURED_GOVERNANCE_AND_CANARY",
      ready: reasons.length === 0,
      reasons
    };
  });
  const firstCommittedTimes = sourceReadiness
    .map((source) => source.first_committed_crawl_at)
    .filter((value) => Number.isFinite(Date.parse(String(value || ""))));
  const shadowStartedAt = firstCommittedTimes.length === requiredSources.length
    ? firstCommittedTimes.sort((left, right) => Date.parse(left) - Date.parse(right)).at(-1)
    : null;
  const shadowStartedMs = Date.parse(String(shadowStartedAt || ""));
  const shadowElapsedMs = Number.isFinite(shadowStartedMs) ? Math.max(0, now - shadowStartedMs) : 0;
  const shadowElapsedDays = Number((shadowElapsedMs / (24 * 60 * 60 * 1000)).toFixed(2));
  const allSourcesReady = sourceReadiness.length === requiredSources.length
    && sourceReadiness.every((source) => source.ready);
  const indexStatus = searchIndex?.status();
  const legacyProjection = searchIndex?.db.prepare(`
    SELECT COUNT(DISTINCT q.query_key) AS query_count
      FROM query_index q
      JOIN query_listings ql USING(query_key)
      JOIN listings l ON l.item_id = ql.item_id
     WHERE q.collection_namespace = 'legacy_general'
       AND ql.missing_count < 2
       AND l.active = 1
  `).get();
  const rollbackProjectionReady = Boolean(indexStatus?.enabled
    && Number(indexStatus.active_listings || 0) > 0
    && Number(legacyProjection?.query_count || 0) > 0);
  const publicationRecent = recentTimestamp(pcPublicationLastSucceededAt, PC_PUBLICATION_RECENT_MS, now);

  return {
    collection_targets: pcLedger?.getActiveCollectionTargetSummary() || null,
    required_source_keys: requiredSources.map((source) => source.key).sort(),
    source_readiness: sourceReadiness,
    all_sources_ready: allSourcesReady,
    review_required_active_sources: reviewRequiredActiveSources,
    shadow_started_at: shadowStartedAt,
    shadow_elapsed_days: shadowElapsedDays,
    shadow_ready: Boolean(PC_PARTS_SHADOW_WRITE_ENABLED
      && shadowElapsedMs >= PC_SHADOW_READY_MS
      && allSourcesReady
      && reviewRequiredActiveSources.length === 0),
    rollback_projection_ready: rollbackProjectionReady,
    publication_last_success_at: pcPublicationLastSucceededAt,
    publication_recent: publicationRecent
  };
}

function runnerStatus() {
  const readiness = pcOperationalReadiness();
  return {
    jobs: Object.entries(JOB_PLANS).map(([job_name, plan]) => ({
      job_name,
      category_id: plan.category_id,
      keyword: plan.keyword,
      target_sites: TARGET_SITES
    })),
    active_run: activeRun,
    coordination_scope: "aws-local-runner",
    search_index: indexRuntimeStatus(),
    pc_parts: {
      shadow_write_enabled: PC_PARTS_SHADOW_WRITE_ENABLED,
      ledger_ready: Boolean(pcLedger),
      scheduler_enabled: PC_PARTS_SCHEDULER_ENABLED,
      scheduler_active: pcSchedulerActive,
      publication_configured: Boolean(STATS_IMPORT_URL && IMPORT_TOKEN),
      publication_last_succeeded_at: pcPublicationLastSucceededAt,
      ...readiness,
      last_tick_at: pcSchedulerLastTickAt,
      last_succeeded_at: pcSchedulerLastSucceededAt,
      last_error: pcSchedulerLastError || pcPipelineError || null
    }
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
  if (!source) throw new Error(`source is not approved for live collection: ${sourceKey || "unknown"}`);
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
  const operationalSites = requestedSites(body).filter((site) => TARGET_SITES.includes(site));
  if (!operationalSites.length) throw new Error("No approved source was requested");
  const canonicalKeyword = collectionIdentity(body).collectionQuery;
  const collectionRequest = canonicalKeyword ? { ...body, keyword: canonicalKeyword } : body;
  const keyword = categoryQuery(collectionRequest);
  if (!keyword) throw new Error("keyword or category_id is required");
  const collectionBody = buildCollectionRequest(
    body,
    canonicalKeyword,
    SEARCH_COLLECTION_MAX_ITEMS
  );
  collectionBody.sites = operationalSites;
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
  const observedAt = new Date().toISOString();
  const shadowCandidates = collected.results
    .filter((result) => !result.error && !result.stale_cache)
    .flatMap((result) => result.items || []);
  const projectedByIdentity = new Map();
  if (pcPipeline) {
    for (const item of shadowCandidates) {
      try {
        const projected = pcPipeline.recordItem(item, observedAt);
        projectedByIdentity.set(String(item.item_id || item.id || item.url || ""), projected);
      } catch (error) {
        pcPipelineError = error instanceof Error ? error.message : String(error);
        console.warn("[aws-runner] PC shadow observation failed", pcPipelineError);
      }
    }
  }
  const indexedItems = pcPipeline
    ? collected.data.items.map((item) => {
        const projected = projectedByIdentity.get(String(item.item_id || item.id || item.url || ""));
        if (projected) return projected;
        try {
          return pcPipeline.recordItem(item, observedAt);
        } catch (error) {
          pcPipelineError = error instanceof Error ? error.message : String(error);
          console.warn("[aws-runner] PC shadow observation failed", pcPipelineError);
          return {
            ...item,
            price_eligible: false,
            good_listing_eligible: false,
            exclusion_reasons: [...new Set([...(item.exclusion_reasons || []), "PC_PIPELINE_ERROR"])]
          };
        }
      })
    : collected.data.items;
  const ingest = searchIndex.ingest(body, indexedItems, {
    deep,
    complete,
    successfulSites: collected.successfulSites
  });
  incrementExecutionMetric("index_ingest_commits");
  const changed = new Set(ingest.changedItemIds || []);
  const changedItems = indexedItems.filter((item) => changed.has(String(item.item_id || item.id || "")));
  if (changedItems.length > 0) {
    try {
      await importToD1(changedItems);
    } catch (error) {
      console.warn("[aws-runner] D1 fallback backup failed", error instanceof Error ? error.message : String(error));
    }
  }
  return ingest;
}

function dedupeCollectedItems(items) {
  const seen = new Set();
  return items.filter((item) => {
    const key = String(item.source_listing_id || item.item_id || item.id || item.url || "");
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

async function collectSpecialistSource(sourceKey, target, parentSignal) {
  if (sourceKey === "danawa") {
    return (await collectDanawaCategoryListings({
      categoryCode: target.category_code,
      fetchImpl: (input, init = {}) => fetchDanawaPublicWithPacing(input, {
        ...init,
        signal: boundedFetchSignal(parentSignal, 20_000)
      })
    })).items;
  }
  const template = String(PC_SPECIALIST_SEARCH_URLS[sourceKey] || "").trim();
  if (!template) throw new Error(`SPECIALIST_SEARCH_URL_NOT_CONFIGURED:${sourceKey}`);
  const parser = SPECIALIST_FIXTURE_PARSERS[sourceKey];
  if (!parser) throw new Error(`SPECIALIST_PARSER_NOT_CONFIGURED:${sourceKey}`);
  const sourceQuery = PC_SPECIALIST_PUBLIC_QUERY_OVERRIDES[sourceKey]?.[target.query_text] || target.query_text;
  const url = new URL(template.replace("{query}", encodeURIComponent(sourceQuery)));
  if (url.protocol !== "https:" || !PC_SPECIALIST_SEARCH_HOSTS[sourceKey]?.has(url.hostname.toLowerCase())) {
    throw new Error(`SPECIALIST_SEARCH_URL_NOT_ALLOWED:${sourceKey}`);
  }
  const response = await fetch(url, {
    headers: {
      accept: "text/html,application/xhtml+xml",
      "accept-language": "ko-KR,ko;q=0.9,en;q=0.7",
      referer: `${url.origin}/`,
      "user-agent": "USED-PICK-PC-Collector/2.0 (+https://used-pick.com/)"
    },
    signal: boundedFetchSignal(parentSignal, 20_000)
  });
  if (!response.ok) throw new Error(`SPECIALIST_HTTP_${response.status}:${sourceKey}`);
  return parser(await response.text()).map((item) => ({ ...item, site: sourceKey }));
}

function listingIdentityIsPresent(html, listing) {
  const haystack = String(html || "").replace(/<[^>]*>/gu, " ").replace(/\s+/gu, " ").toLowerCase();
  const sourceId = String(listing.source_listing_id || "").trim().toLowerCase();
  if (sourceId.length >= 4 && haystack.includes(sourceId)) return true;
  const titleTokens = String(listing.title || "").toLowerCase().match(/[a-z0-9가-힣]{3,}/gu) || [];
  return titleTokens.slice(0, 5).filter((token) => haystack.includes(token)).length >= Math.min(2, titleTokens.length || 2);
}

async function recheckKnownListings(sourceKey, checkedAt, parentSignal) {
  const changedProjections = [];
  const captureProjection = (sourceListingId, result) => {
    if (result?.snapshotCreated !== true) return;
    const projection = pcLedger.getPublicProjection(sourceKey, sourceListingId);
    if (!projection) return;
    changedProjections.push(projection);
  };
  const due = pcLedger.dueRechecks({
    sourceId: sourceKey,
    checkedBefore: new Date(Date.parse(checkedAt) - 6 * 60 * 60 * 1000).toISOString(),
    limit: PC_RECHECK_LIMIT_PER_RUN
  });
  for (const listing of due) {
    throwIfAborted(parentSignal);
    let raw;
    try { raw = JSON.parse(listing.raw_json); } catch { raw = {}; }
    const url = String(raw.url || raw.item_url || "").trim();
    if (!/^https?:\/\//iu.test(url)) continue;
    let response;
    try {
      response = await fetch(url, {
        headers: { accept: "text/html,application/xhtml+xml,application/json" },
        signal: boundedFetchSignal(parentSignal)
      });
    } catch (error) {
      throwIfAborted(parentSignal);
      continue;
    }
    if (response.status === 404 || response.status === 410) {
      const result = pcLedger.recordMissingCheck({ sourceId: sourceKey, sourceListingId: listing.source_listing_id, checkedAt });
      captureProjection(listing.source_listing_id, result);
      continue;
    }
    if (response.status === 401 || response.status === 403) {
      const result = pcLedger.recordObservation({
        sourceId: sourceKey, sourceListingId: listing.source_listing_id, observedAt: checkedAt,
        title: listing.title, description: listing.description, rawPayload: raw,
        price: listing.price_value, currency: listing.currency, status: "BLOCKED_OR_PRIVATE",
        statusEvidence: { type: "HTTP_STATUS", value: String(response.status) }, availability: "BLOCKED_OR_PRIVATE"
      });
      captureProjection(listing.source_listing_id, result);
      continue;
    }
    if (!response.ok) continue;
    const body = (await response.text()).slice(0, 1_000_000);
    if (!listingIdentityIsPresent(body, listing)) {
      const result = pcLedger.recordMissingCheck({ sourceId: sourceKey, sourceListingId: listing.source_listing_id, checkedAt });
      captureProjection(listing.source_listing_id, result);
      continue;
    }
    const soldEvidence = structuredSoldEvidenceFromHtml(body, { ...listing, url });
    const result = pcLedger.recordObservation({
      sourceId: sourceKey, sourceListingId: listing.source_listing_id, observedAt: checkedAt,
      title: listing.title, description: listing.description, rawPayload: raw,
      price: listing.price_value, currency: listing.currency,
      status: soldEvidence ? "SOLD" : "ACTIVE",
      statusEvidence: soldEvidence
        ? soldEvidence
        : { type: "STRUCTURED_STATUS", value: listing.lifecycle_status },
      availability: "AVAILABLE"
    });
    captureProjection(listing.source_listing_id, result);
  }
  const publicProjections = stabilizeIncrementalPcProjections(changedProjections);
  for (const projection of publicProjections) searchIndex?.applyLifecycleProjection(projection);
  if (publicProjections.length > 0) await importToD1BestEffort(publicProjections, parentSignal);
  return publicProjections;
}

function pcSourceAdapter(sourceKey) {
  return createSourceAdapter({
    sourceKey,
    async collectIncremental(input) {
      const dueTargets = pcLedger.listDueCollectionTargets(
        sourceKey, input.now, undefined, PC_SOURCE_TARGETS_PER_RUN
      );
      if (dueTargets.length === 0) return {
        source_key: sourceKey,
        mode: "incremental",
        collected_at: input.now,
        items: [],
        next_cursor: input.cursor || null,
        exhausted: false,
        target_results: [],
        metrics: { request_count: 0, request_failure_count: 0, parsed_count: 0, parse_failure_count: 0,
          http_blocked_count: 0, captcha_count: 0, failure_messages: [] }
      };
      const collectTarget = async (target) => {
        throwIfAborted(input.signal);
        const items = SPECIALIST_FIXTURE_PARSERS[sourceKey]
          ? await collectSpecialistSource(sourceKey, target, input.signal)
          : await collectOne(sourceKey, target.query_text, sourceKey === "ebay" ? target.category_code : "pc",
            sourceKey === "ebay" ? 40 : 80,
            target.query_text, "recent", { min: null, max: null });
        return { target, items };
      };
      const settled = [];
      if (SPECIALIST_FIXTURE_PARSERS[sourceKey] || Object.hasOwn(PC_SOURCE_TARGET_PACING_MS, sourceKey)) {
        for (const target of dueTargets) {
          throwIfAborted(input.signal);
          try {
            settled.push({ status: "fulfilled", value: await collectTarget(target) });
          } catch (reason) {
            throwIfAborted(input.signal);
            settled.push({ status: "rejected", reason });
          }
          await new Promise((resolve) => setTimeout(resolve, PC_SOURCE_TARGET_PACING_MS[sourceKey] || 200));
        }
      } else {
        for (let offset = 0; offset < dueTargets.length; offset += PC_SOURCE_TARGET_CONCURRENCY) {
          throwIfAborted(input.signal);
          settled.push(...await Promise.allSettled(
            dueTargets.slice(offset, offset + PC_SOURCE_TARGET_CONCURRENCY).map(collectTarget)
          ));
          throwIfAborted(input.signal);
          if (offset + PC_SOURCE_TARGET_CONCURRENCY < dueTargets.length) {
            await new Promise((resolve) => setTimeout(resolve, 150));
          }
        }
      }
      const successful = settled.filter((result) => result.status === "fulfilled");
      const failed = settled.filter((result) => result.status === "rejected");
      const failureMessages = failed.map((result) => result.reason instanceof Error ? result.reason.message : String(result.reason));
      const collectionMetrics = {
        request_count: settled.length,
        request_failure_count: failed.length,
        parsed_count: 0,
        parse_failure_count: failureMessages.filter((message) => /(?:parse|parser|selector|invalid[_ ]listing|html)/iu.test(message)).length,
        http_blocked_count: failureMessages.filter((message) => /(?:HTTP[_ ]?(?:403|429)|\b403\b|\b429\b|blocked)/iu.test(message)).length,
        captcha_count: failureMessages.filter((message) => /captcha/iu.test(message)).length,
        failure_messages: failureMessages.slice(0, 12)
      };
      if (!successful.length) {
        const error = new Error(`ALL_PC_QUERIES_FAILED:${sourceKey}`);
        error.collection_metrics = {
          ...collectionMetrics,
          target_results: dueTargets.map((target, index) => ({
            target_id: target.target_id,
            status: "FAILED",
            cursor: target.incremental_cursor || null,
            error: settled[index].reason instanceof Error ? settled[index].reason.message : String(settled[index].reason)
          }))
        };
        throw error;
      }
      const items = dedupeCollectedItems(successful.flatMap((result) => result.value.items || []))
        .map((item) => {
          const sourceListingId = String(item.source_listing_id || item.item_id || item.id || item.url || "").trim();
          const publicItemId = String(item.item_id || item.id || "").startsWith(`${sourceKey}:`)
            ? String(item.item_id || item.id)
            : `${sourceKey}:${sourceListingId}`;
          const numericPrice = item.price === null || item.price === undefined ? null : Number(item.price);
          return {
            ...item,
            id: publicItemId,
            item_id: publicItemId,
            source_listing_id: sourceListingId,
            price: Number.isSafeInteger(numericPrice) && numericPrice >= 0 ? numericPrice : null,
            currency: String(item.currency || (sourceKey === "ebay" ? "USD" : "KRW")).toUpperCase(),
            status: String(item.status || item.lifecycle_status || "ACTIVE").toUpperCase(),
            raw_payload: item.raw_payload && typeof item.raw_payload === "object"
              ? item.raw_payload
              : { ...item, source_listing_id: sourceListingId }
          };
        });
      const incremental = filterIncrementalListings(items, input.cursor);
      collectionMetrics.parsed_count = items.length;
      return {
        source_key: sourceKey,
        mode: "incremental",
        collected_at: input.now,
        items: incremental.items,
        next_cursor: incremental.next_cursor,
        exhausted: false,
        target_results: settled.map((result, index) => ({
          target_id: dueTargets[index].target_id,
          status: result.status === "fulfilled" ? "SUCCEEDED" : "FAILED",
          cursor: result.status === "fulfilled" ? incremental.next_cursor : dueTargets[index].incremental_cursor || null,
          error: result.status === "rejected"
            ? (result.reason instanceof Error ? result.reason.message : String(result.reason))
            : null
        })),
        metrics: collectionMetrics
      };
    },
    async recheck(input) {
      const response = await fetch(input.url, {
        headers: { accept: "text/html,application/xhtml+xml,application/json" },
        signal: boundedFetchSignal(input.signal)
      });
      const checkedAt = input.now || new Date().toISOString();
      if (response.status === 404 || response.status === 410) return {
        source_key: sourceKey, mode: "recheck", checked_at: checkedAt,
        source_listing_id: input.source_listing_id, availability: "UNAVAILABLE_UNKNOWN",
        status: "UNAVAILABLE_UNKNOWN", evidence: [{ kind: "HTTP_STATUS", value: String(response.status) }]
      };
      if (response.status === 401 || response.status === 403) return {
        source_key: sourceKey, mode: "recheck", checked_at: checkedAt,
        source_listing_id: input.source_listing_id, availability: "BLOCKED_OR_PRIVATE",
        status: "BLOCKED_OR_PRIVATE", evidence: [{ kind: "HTTP_STATUS", value: String(response.status) }]
      };
      if (!response.ok) throw new Error(`RECHECK_HTTP_${response.status}`);
      const body = (await response.text()).slice(0, 1_000_000);
      if (!listingIdentityIsPresent(body, input)) return {
        source_key: sourceKey, mode: "recheck", checked_at: checkedAt,
        source_listing_id: input.source_listing_id, availability: "UNAVAILABLE_UNKNOWN",
        status: "UNAVAILABLE_UNKNOWN", evidence: [{ kind: "IDENTITY", value: "listing identity not present" }]
      };
      const soldEvidence = structuredSoldEvidenceFromHtml(body, input);
      return {
        source_key: sourceKey, mode: "recheck", checked_at: checkedAt,
        source_listing_id: input.source_listing_id, availability: "AVAILABLE",
        status: soldEvidence ? "SOLD" : "ACTIVE",
        evidence: [soldEvidence
          ? { kind: soldEvidence.type, value: soldEvidence.value }
          : { kind: "IDENTITY", value: "listing identity present" }]
      };
    }
  });
}

async function runPcSourceSchedulerTick() {
  if (!PC_PARTS_SCHEDULER_ENABLED || !pcPipeline || !pcLedger || pcSchedulerActive) return;
  pcSchedulerActive = true;
  const through = new Date().toISOString();
  const tickSignal = AbortSignal.timeout(PC_SCHEDULER_WATCHDOG_MS);
  pcSchedulerLastTickAt = through;
  try {
    const tickErrors = [];
    let committedRuns = 0;
    const adapters = Object.fromEntries(PC_SOURCE_REGISTRY.map((source) => [source.key, pcSourceAdapter(source.key)]));
    const results = await runDueSourceCollections({
      after: pcSchedulerAfter,
      through,
      adapters,
      runtimeBySource: pcSchedulerRuntime,
      inputsBySource: Object.fromEntries(PC_SOURCE_REGISTRY.map((source) => [source.key, { signal: tickSignal }])),
      governanceBySource: Object.fromEntries(PC_SOURCE_REGISTRY.map((source) => [
        source.key,
        source.policy_status === "APPROVED" ? EFFECTIVE_PC_SOURCE_GOVERNANCE[source.key] : undefined
      ]))
    });
    for (const result of results) {
      const runtimeBeforeRun = pcSchedulerRuntime[result.source_key] || getSourceRuntimeDefaults(result.source_key);
      if (result.status === "skipped") {
        pcSchedulerRuntime[result.source_key] = result.next_runtime;
        continue;
      }
      // The collection policy can recover an expired quarantine in memory.
      // Persist that recovery before either audit path asks the ledger to open
      // a crawl run, which requires the source to already be ENABLED.
      const recoveredFromQuarantine = result.next_runtime.runtime_status === "ENABLED"
        && runtimeBeforeRun.runtime_status === "QUARANTINED";
      const runtimeBeforeCrawlAudit = recoveredFromQuarantine
        ? {
            ...runtimeBeforeRun,
            runtime_status: "ENABLED",
            consecutive_failures: 0,
            quarantine_until: null
          }
        : runtimeBeforeRun;
      if (recoveredFromQuarantine) pcLedger.updateSourceRuntime(result.source_key, runtimeBeforeCrawlAudit);
      if (result.status === "failed") {
        tickErrors.push(`${result.source_key}:${result.error || "collection failed"}`);
        pcSchedulerRuntime[result.source_key] = result.next_runtime;
        const failureMetrics = result.metrics || {};
        for (const target of Array.isArray(failureMetrics.target_results) ? failureMetrics.target_results : []) {
          pcLedger.updateSourceTargetRuntime({
            sourceId: result.source_key,
            targetId: target.target_id,
            startedAt: result.run_at,
            cursor: target.cursor,
            error: target.error || result.error || "collection failed"
          });
        }
        try {
          const failedRunId = pcLedger.startCrawlRun({
            sourceId: result.source_key,
            startedAt: result.run_at,
            adapterVersion: "existing-site-wrapper-v1"
          });
          pcLedger.finishCrawlRun({
            crawlRunId: failedRunId,
            status: result.next_runtime.runtime_status === "QUARANTINED" ? "QUARANTINED" : "FAILED",
            finishedAt: new Date().toISOString(),
            collectedCount: 0,
            changedCount: 0,
            requestCount: Number(failureMetrics.request_count || 1),
            requestFailureCount: Number(failureMetrics.request_failure_count || 1),
            parsedCount: Number(failureMetrics.parsed_count || 0),
            parseFailureCount: Number(failureMetrics.parse_failure_count || 0),
            httpBlockedCount: Number(failureMetrics.http_blocked_count || 0),
            captchaCount: Number(failureMetrics.captcha_count || 0),
            error: result.error || "collection failed"
          });
        } catch (crawlError) {
          tickErrors.push(`${result.source_key}:crawl-audit:${crawlError instanceof Error ? crawlError.message : String(crawlError)}`);
        }
        pcLedger.updateSourceRuntime(result.source_key, result.next_runtime);
        continue;
      }
      let runId = null;
      try {
        runId = pcLedger.startCrawlRun({
          sourceId: result.source_key,
          startedAt: result.run_at,
          adapterVersion: "existing-site-wrapper-v1"
        });
        const recorded = await recordPcItemsIncrementally(result.result.items, result.run_at);
        const publicProjections = stabilizeIncrementalPcProjections(recorded);
        const changedCount = recorded.filter((item) => item._pc_snapshot_created === true).length;
        for (const target of Array.isArray(result.result.target_results) ? result.result.target_results : []) {
          pcLedger.updateSourceTargetRuntime({
            sourceId: result.source_key,
            targetId: target.target_id,
            startedAt: result.run_at,
            succeededAt: target.status === "SUCCEEDED" ? result.run_at : null,
            cursor: target.cursor,
            error: target.error
          });
        }
        await upsertPcProjectionsIncrementally(publicProjections, { observedAt: result.run_at });
        const d1ImportResult = publicProjections.length > 0
          ? await importToD1BestEffort(publicProjections, tickSignal)
          : null;
        if (d1ImportResult?.deferred) {
          tickErrors.push(`${result.source_key}:D1_DAILY_ROW_WRITE_LIMIT`);
        }
        await recheckKnownListings(result.source_key, result.run_at, tickSignal);
        const partialFailure = result.status === "partial_success";
        pcLedger.finishCrawlRun({
          crawlRunId: runId,
          status: partialFailure
            ? (result.next_runtime.runtime_status === "QUARANTINED" ? "QUARANTINED" : "FAILED")
            : "SUCCEEDED",
          finishedAt: new Date().toISOString(),
          collectedCount: recorded.length,
          changedCount,
          requestCount: Number(result.result.metrics?.request_count || 1),
          requestFailureCount: Number(result.result.metrics?.request_failure_count || 0),
          parsedCount: Number(result.result.metrics?.parsed_count ?? result.result.items.length),
          parseFailureCount: Number(result.result.metrics?.parse_failure_count || 0),
          httpBlockedCount: Number(result.result.metrics?.http_blocked_count || 0),
          captchaCount: Number(result.result.metrics?.captcha_count || 0),
          error: Array.isArray(result.result.metrics?.failure_messages)
            ? result.result.metrics.failure_messages.join("; ")
            : null
        });
        pcSchedulerRuntime[result.source_key] = result.next_runtime;
        pcLedger.updateSourceRuntime(result.source_key, result.next_runtime);
        if (!partialFailure) {
          committedRuns += 1;
          if (!d1ImportResult?.deferred) {
            try {
              await mirrorPcListingCollectionManifest({
                sourceId: result.source_key,
                asOf: result.run_at,
                successfulTargetIds: (Array.isArray(result.result.target_results) ? result.result.target_results : [])
                  .filter((target) => target.status === "SUCCEEDED"
                    && PC_HOURLY_COLLECTION_TARGET_IDS.has(target.target_id))
                  .map((target) => target.target_id)
              }, tickSignal);
            } catch (manifestError) {
              tickErrors.push(`${result.source_key}:collection-manifest:${manifestError instanceof Error ? manifestError.message : String(manifestError)}`);
            }
          }
        } else tickErrors.push(`${result.source_key}:${result.error}`);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (runId) {
          try {
            pcLedger.finishCrawlRun({
              crawlRunId: runId,
              status: "FAILED",
              finishedAt: new Date().toISOString(),
              requestCount: 1,
              requestFailureCount: 1,
              parseFailureCount: 1,
              error: message
            });
          } catch (auditError) {
            tickErrors.push(`${result.source_key}:crawl-audit:${auditError instanceof Error ? auditError.message : String(auditError)}`);
          }
        }
        tickErrors.push(`${result.source_key}:${message}`);
        const failedRuntime = sourceRuntimeAfterFailure(result.source_key, runtimeBeforeCrawlAudit, error, result.run_at);
        pcSchedulerRuntime[result.source_key] = failedRuntime;
        pcLedger.updateSourceRuntime(result.source_key, failedRuntime);
      }
    }
    if (committedRuns > 0) pcSchedulerLastSucceededAt = through;
    if (results.length > 0) pcSchedulerLastError = tickErrors.length > 0 ? tickErrors.join("; ") : null;
  } catch (error) {
    pcSchedulerLastError = error instanceof Error ? error.message : String(error);
    console.warn("[aws-runner] PC source scheduler tick failed", pcSchedulerLastError);
  } finally {
    pcSchedulerAfter = through;
    pcSchedulerActive = false;
  }
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
      search_index: indexRuntimeStatus(),
      pc_parts: {
        shadow_write_enabled: PC_PARTS_SHADOW_WRITE_ENABLED,
        ledger_ready: Boolean(pcLedger),
        scheduler_enabled: PC_PARTS_SCHEDULER_ENABLED,
        scheduler_active: pcSchedulerActive,
        publication_configured: Boolean(STATS_IMPORT_URL && IMPORT_TOKEN),
        publication_last_succeeded_at: pcPublicationLastSucceededAt,
        ...pcOperationalReadiness(),
        last_tick_at: pcSchedulerLastTickAt,
        last_succeeded_at: pcSchedulerLastSucceededAt,
        last_error: pcSchedulerLastError || pcPipelineError || null
      }
    });
  }
  if (req.method === "GET" && url.pathname === "/api/pc/catalog") {
    if (!tokenMatches((req.headers.authorization || "").replace(/^Bearer\s+/i, ""), RUNNER_TOKEN)) {
      return json(res, 401, { ok: false, error: "Unauthorized" });
    }
    return json(res, 200, { status: "success", data: pcCatalogResponse() });
  }
  if (req.method === "GET" && url.pathname === "/api/pc/products") {
    if (!tokenMatches((req.headers.authorization || "").replace(/^Bearer\s+/i, ""), RUNNER_TOKEN)) {
      return json(res, 401, { ok: false, error: "Unauthorized" });
    }
    try {
      return json(res, 200, { status: "success", data: pcProductsResponse(url) });
    } catch (error) {
      return json(res, 400, { status: "error", error: error instanceof Error ? error.message : String(error) });
    }
  }
  if (req.method === "GET" && url.pathname === "/api/pc/listings") {
    if (!tokenMatches((req.headers.authorization || "").replace(/^Bearer\s+/i, ""), RUNNER_TOKEN)) {
      return json(res, 401, { ok: false, error: "Unauthorized" });
    }
    if (!searchIndex) return json(res, 503, { status: "error", error: "PC listing projection is unavailable" });
    try {
      const query = parsePcListingsRequest(url, { allowedSites: PC_DIRECTORY_SITES });
      const catalogModels = query.catalogScope
        ? publicPcModelsForApi({
          category: query.catalogScope.categoryCode,
          q: query.catalogScope.query,
          ...query.catalogScope.facets
        }).models
        : null;
      const cursorState = decodePcListingsCursor(query, SEARCH_CURSOR_SECRET);
      const asOf = cursorState?.asOf || new Date().toISOString();
      const result = searchIndex.browsePcListings({
        ...query,
        canonicalProductIds: catalogModels?.map((model) => model.canonical_product_id) ?? null,
        asOf,
        after: cursorState?.after || null
      });
      if (!result.cursorFound) return json(res, 410, { status: "error", error: "CURSOR_EXPIRED: listing snapshot changed" });
      const nextCursor = result.nextAfter
        ? encodePcListingsCursor(query, { asOf, after: result.nextAfter }, SEARCH_CURSOR_SECRET)
        : null;
      return json(res, 200, {
        status: "success",
        data: {
          items: result.items,
          total: result.total,
          pagination: { has_more: Boolean(nextCursor), next_cursor: nextCursor },
          as_of: asOf,
          freshness: pcListingsFreshness(asOf, result.latestObservedAt),
          filters: {
            canonical_product_id: query.canonicalProductId || null,
            catalog_scope: query.catalogScope || null,
            matched_model_count: catalogModels?.length ?? null,
            manufacturer: query.manufacturer || null,
            board_manufacturer: query.boardManufacturer || null,
            sites: query.sites,
            sort: query.sort,
            price_min: query.minPrice,
            price_max: query.maxPrice,
            market_pool: query.marketPool || null,
            currency: query.currency || null
          }
        }
      });
    } catch (error) {
      return json(res, 400, { status: "error", error: error instanceof Error ? error.message : String(error) });
    }
  }
  if (req.method === "GET" && /^\/api\/products\/[^/]+\/price-stats$/u.test(url.pathname)) {
    if (!tokenMatches((req.headers.authorization || "").replace(/^Bearer\s+/i, ""), RUNNER_TOKEN)) {
      return json(res, 401, { ok: false, error: "Unauthorized" });
    }
    if (!pcLedger) return json(res, 503, { status: "error", error: "PC parts ledger is unavailable" });
    let query;
    try {
      query = parsePriceStatsRequest(url);
    } catch (error) {
      return json(res, 400, { status: "error", error: error instanceof Error ? error.message : String(error) });
    }
    if (!pcLedger.getCanonicalProduct(query.canonicalProductId)) {
      return json(res, 404, { status: "error", error: "Canonical product not found" });
    }
    try {
      const asOf = new Date().toISOString();
      const activePipelineVersion = pcLedger.getActivePipelineVersion();
      const priceVersionOptions = activePipelineVersion ? {
        normalizationVersion: activePipelineVersion.normalization_version,
        parserVersion: activePipelineVersion.parser_version,
        ruleVersion: activePipelineVersion.rule_version,
        filterVersion: activePipelineVersion.filter_version
      } : {};
      const stats = pcLedger.rebuildAndGetPriceStats({
        canonicalProductId: query.canonicalProductId,
        days: query.days,
        marketPool: query.marketPool,
        condition: query.condition,
        currency: query.currency,
        asOf,
        ...priceVersionOptions
      });
      const memberCount = pcLedger.traceStatMembers({
        canonicalProductId: query.canonicalProductId,
        marketPool: query.marketPool,
        condition: query.condition,
        currency: query.currency,
        days: query.days,
        asOf,
        ...priceVersionOptions
      }).length;
      return json(res, 200, {
        status: "success",
        data: priceStatsResponse(query, { ...stats, traceability: { member_count: memberCount } })
      });
    } catch (error) {
      return json(res, 503, { status: "error", error: error instanceof Error ? error.message : String(error) });
    }
  }
  if (req.method === "POST" && url.pathname === "/api/admin/pc-classification-feedback") {
    if (!tokenMatches((req.headers.authorization || "").replace(/^Bearer\s+/i, ""), RUNNER_TOKEN)) {
      return json(res, 401, { ok: false, error: "Unauthorized" });
    }
    if (!pcLedger) return json(res, 503, { ok: false, error: "PC parts ledger is unavailable" });
    try {
      const body = await readJson(req);
      const feedback = pcLedger.recordClassificationFeedback({
        snapshotId: body.snapshot_id,
        fieldName: body.field_name,
        previousValue: body.previous_value,
        correctedValue: body.corrected_value,
        reviewerRef: body.reviewer_ref,
        reason: body.reason,
        aliasCandidate: body.alias_candidate,
        canonicalProductId: body.canonical_product_id,
        approvedForShadow: body.approved_for_shadow === true
      });
      return json(res, 201, { ok: true, data: feedback });
    } catch (error) {
      return json(res, 400, { ok: false, error: error instanceof Error ? error.message : String(error) });
    }
  }
  if (req.method === "POST" && url.pathname === "/api/search") {
    if (!tokenMatches((req.headers.authorization || "").replace(/^Bearer\s+/i, ""), RUNNER_TOKEN)) {
      return json(res, 401, { ok: false, error: "Unauthorized" });
    }
    try {
      const body = await readJson(req);
      const requestedCategories = [body?.category_id, ...(Array.isArray(body?.category_ids) ? body.category_ids : [])]
        .filter(Boolean).map((value) => String(value).trim());
      if (requestedCategories.some((value) => value !== "pc")) {
        return json(res, 400, { status: "error", error: "Selected categories are unavailable; only pc is supported" });
      }
      body.category_id = "pc";
      delete body.category_ids;
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
        sources: OPERATIONAL_SEARCH_ONLY_SOURCES,
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
    return json(res, result.status === "failed" ? 502 : 200, { ok: result.status !== "failed", trigger: result });
  } catch (error) {
    return json(res, 400, { ok: false, error: error instanceof Error ? error.message : String(error) });
  }
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`[aws-runner] listening on ${PORT}; targets=${TARGET_SITES.join(",")}`);
});

const backgroundTimer = setInterval(() => { void runBackgroundRefreshTick(); }, BACKGROUND_TICK_MS);
backgroundTimer.unref();
const pcSchedulerTimer = setInterval(() => { void runPcSourceSchedulerTick(); }, PC_SCHEDULER_TICK_MS);
pcSchedulerTimer.unref();

for (const signal of ["SIGTERM", "SIGINT"]) {
  process.once(signal, () => {
    clearInterval(backgroundTimer);
    clearInterval(pcSchedulerTimer);
    try { searchIndex?.close(); } catch {}
    server.close(() => process.exit(0));
  });
}
