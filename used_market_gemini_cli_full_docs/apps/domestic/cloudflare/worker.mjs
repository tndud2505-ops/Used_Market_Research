import {
  fetchThroughFreeCache,
  fetchThroughD1ListingCache,
  freeTierConfig,
  browsePcListingsD1,
  hasD1,
  isFreeTierEnabled,
  readRecentCollectionRuns,
  readFreeTierUsage,
  searchD1
} from "./free-tier.mjs";
import { pcCatalogResponse, pcCollectionTargetSetV2, pcProductsResponse } from "./pc-directory-http.mjs";
import { publicPcCatalogForApi, publicPcFacetsForApi, publicPcModelsForApi } from "../market/logic/pc-public-catalog.mjs";
import {
  FREE_COLLECTION_EXCLUDED_SITES,
  FREE_COLLECTION_SITES,
  freeCollectionPlan,
  handleFreeCollectionQueue
} from "./free-collector.mjs";
import { fetchThroughLiveSearchCache } from "./live-search.mjs";
import {
  OPERATIONAL_PC_DIRECTORY_SITES,
  OPERATIONAL_TARGET_SITES,
  normalizeOperationalTargetSites
} from "./target-sites.mjs";
import { parsePriceStatsRequest, priceStatsResponse } from "../aws-runner/pc-price-stats-http.mjs";
import { publishProductStats, readPublishedProductStats } from "./public-product-stats.mjs";
import { getPcSource } from "../collector/logic/pc-source-registry.mjs";
import {
  issueMonetizationEventToken,
  purgeMonetizationMetrics,
  recordMonetizationEvent,
  selectContextualOffer
} from "./affiliate-registry.mjs";

const CRON_TO_JOBS = new Map([
  ["0 0 * * *", ["gpu-fast-scan"]],
  ["0 6 * * *", ["cpu-scan"]],
  ["0 12 * * *", ["ram-scan"]],
  ["0 18 * * *", ["ssd-scan"]],
  ["30 18 * * *", ["psu-scan", "full-pc-scan"]]
]);

const DAILY_PRICE_REFRESH_UTC_HOUR = 18;
const DEFAULT_RUNNER_TIMEOUT_MS = 15_000;
const DEFAULT_RUNNER_MAX_ATTEMPTS = 3;
const DEFAULT_RUNNER_RETRY_DELAY_MS = 250;
const MAX_RUNNER_REQUEST_BYTES = 1_048_576;
const MAX_STATS_PUBLICATION_BYTES = 16_777_216;
const MAX_RUNNER_RESPONSE_BYTES = 4_194_304;
const MAX_IMPORTED_LISTINGS = 500;
const PC_LISTING_COLLECTION_MANIFEST_VERSION = "pc-listing-collection-v1";
const PC_COLLECTION_TARGETS_BY_ID = new Map(pcCollectionTargetSetV2().targets
  .map((target) => [target.targetId, target]));
const PC_MAX_HOURLY_TARGETS_PER_SOURCE = Math.max(...OPERATIONAL_PC_DIRECTORY_SITES.map((sourceId) => (
  [...PC_COLLECTION_TARGETS_BY_ID.values()].filter((target) => target.enabled !== false
    && target.cadenceClass === "HOURLY_CATEGORY"
    && Array.isArray(target.sourceKeys) && target.sourceKeys.includes(sourceId)).length
)));
const IMPORT_ALLOWED_SITES = new Set([
  ...OPERATIONAL_TARGET_SITES,
  ...OPERATIONAL_PC_DIRECTORY_SITES
]);
const IMPORT_ALLOWED_HOSTS_BY_SITE = Object.freeze({
  joonggonara: Object.freeze(["web.joongna.com"]),
  bunjang: Object.freeze(["m.bunjang.co.kr", "bunjang.co.kr", "www.bunjang.co.kr"]),
  hellomarket: Object.freeze(["hellomarket.com", "www.hellomarket.com"]),
  rethinkmall: Object.freeze(["web.rethinkmall.com"]),
  danawa: Object.freeze(["dmall.danawa.com"]),
  ebay: Object.freeze(["ebay.com", "www.ebay.com"]),
  coolenjoy: Object.freeze(["coolenjoy.net", "www.coolenjoy.net"])
});
const SEARCH_ONLY_SOURCE_KEYS = Object.freeze(["hellomarket", "rethinkmall"]);

function operationalSearchOnlySource(sourceKey) {
  if (!SEARCH_ONLY_SOURCE_KEYS.includes(sourceKey)) return null;
  try {
    const source = getPcSource(sourceKey);
    return source.public_search === true
      && source.policy_status === "APPROVED"
      && source.runtime_status === "ENABLED"
      ? source
      : null;
  } catch {
    return null;
  }
}

function operationalSearchOnlyCatalog() {
  return SEARCH_ONLY_SOURCE_KEYS
    .map((sourceKey) => operationalSearchOnlySource(sourceKey))
    .filter(Boolean)
    .map((source) => ({
      key: source.key,
      name: source.name,
      market_kind: source.market_pool === "KR_REFURB_RETAIL" ? "refurb_retail" : "used_market",
      login_required: false,
      ui_registered: true,
      main_search_registered: true,
      category_mode: "keyword_inferred",
      classifiable_category_ids: []
    }));
}

class PayloadTooLargeError extends Error {}
class CollectionManifestConflictError extends Error {}

function readNonNegativeInteger(env, name, fallback, maximum) {
  const value = Number(env[name]);
  if (!Number.isFinite(value) || value < 1) return fallback;
  return Math.min(Math.floor(value), maximum);
}

function isRetryableStatus(status) {
  return status === 408 || status === 425 || status === 429 || status >= 500;
}

function wait(ms) {
  return ms <= 0 ? Promise.resolve() : new Promise((resolve) => setTimeout(resolve, ms));
}

function json(status, body) {
  return new Response(JSON.stringify(body, null, 2), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "content-security-policy": "default-src 'none'; frame-ancestors 'none'",
      "strict-transport-security": "max-age=31536000; includeSubDomains",
      "x-content-type-options": "nosniff",
      "referrer-policy": "strict-origin-when-cross-origin",
      "x-frame-options": "DENY"
    }
  });
}

function noStoreJson(status, body) {
  const response = json(status, body);
  response.headers.set("cache-control", "no-store");
  return response;
}

function percentile(sorted, ratio) {
  if (!sorted.length) return null;
  const position = (sorted.length - 1) * ratio;
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  if (lower === upper) return sorted[lower];
  return sorted[lower] + (sorted[upper] - sorted[lower]) * (position - lower);
}

function currentProjectionSummary(rows) {
  const samples = rows.map((row) => {
    const total = Number(row.price_value);
    const quantity = Number.isInteger(Number(row.quantity)) && Number(row.quantity) > 0 ? Number(row.quantity) : 1;
    const comparable = row.price_scope === "UNIT" || quantity === 1 ? total : total / quantity;
    return { price: comparable, quantity };
  }).filter((sample) => Number.isFinite(sample.price) && sample.price > 0).sort((left, right) => left.price - right.price);
  const prices = samples.map((sample) => sample.price);
  const count = prices.length;
  const mean = count >= 5 ? prices.reduce((sum, value) => sum + value, 0) / count : null;
  const median = count >= 3 ? percentile(prices, 0.5) : null;
  const p25 = count >= 10 ? percentile(prices, 0.25) : null;
  const p75 = count >= 10 ? percentile(prices, 0.75) : null;
  const lowerBound = p25 === null ? null : p25 - (p75 - p25) * 1.5;
  const upperBound = p75 === null ? null : p75 + (p75 - p25) * 1.5;
  const outliers = lowerBound === null ? [] : prices.filter((value) => value < lowerBound || value > upperBound);
  const trimmed = count >= 10 ? prices.slice(Math.floor(count * 0.1), Math.ceil(count * 0.9)) : [];
  return {
    sample_count: count,
    unit_count: samples.reduce((sum, sample) => sum + sample.quantity, 0),
    min: count ? prices[0] : null,
    max: count ? prices.at(-1) : null,
    mean: mean === null ? null : Number(mean.toFixed(2)),
    median: median === null ? null : Number(median.toFixed(2)),
    trimmed_mean: trimmed.length ? Number((trimmed.reduce((sum, value) => sum + value, 0) / trimmed.length).toFixed(2)) : null,
    p25: p25 === null ? null : Number(p25.toFixed(2)),
    p75: p75 === null ? null : Number(p75.toFixed(2)),
    outlier_count: outliers.length,
    outlier_lower_bound: lowerBound === null ? null : Number(lowerBound.toFixed(2)),
    outlier_upper_bound: upperBound === null ? null : Number(upperBound.toFixed(2)),
    confidence_level: count >= 10 ? "HIGH" : count >= 5 ? "MEDIUM" : count >= 3 ? "LOW" : "INSUFFICIENT"
  };
}

async function currentProjectionRows(db, query, productIds = null) {
  const ids = Array.isArray(productIds) ? productIds.filter(Boolean) : [query.canonicalProductId];
  if (!ids.length) return [];
  const placeholders = ids.map(() => "?").join(", ");
  const bound = db.prepare(`SELECT canonical_product_id, site, price_value, currency, quantity, price_scope,
      market_pool, condition_code, updated_at, listing_kind, price_eligible, exclusion_reasons_json
    FROM listings
    WHERE active = 1 AND lifecycle_status = 'ACTIVE'
      AND price_value > 0 AND canonical_product_id IN (${placeholders})
      AND currency = ? AND condition_code = ?
      AND market_pool IN (${productIds ? "'KR_C2C_USED', 'KR_DEALER_USED'" : "?"})`)
    .bind(...ids, query.currency || "KRW", query.condition || "USED_WORKING", ...(productIds ? [] : [query.marketPool]));
  if (typeof bound?.all !== "function") return [];
  const result = await bound.all();
  const rows = Array.isArray(result?.results) ? result.results : [];
  return rows.filter((row) => {
    return Number(row.price_eligible) === 1
      && Number.isInteger(Number(row.quantity))
      && Number(row.quantity) > 0
      && ["TOTAL", "UNIT"].includes(String(row.price_scope || ""))
      && ["SINGLE_COMPONENT", "SAME_PRODUCT_LOT"].includes(String(row.listing_kind || ""));
  });
}

function overlayCurrentProjection(stats, rows, days = 30) {
  if (!rows.length) {
    return {
      ...stats,
      daily: (Array.isArray(stats.daily) ? stats.daily : []).slice(-days),
      by_source: (Array.isArray(stats.by_source) ? stats.by_source : []).map((entry) => ({
        ...entry,
        daily: (Array.isArray(entry.daily) ? entry.daily : []).slice(-days)
      }))
    };
  }
  const hasPublishedAggregate = Number(stats?.active?.sample_count || 0) > 0;
  const active = hasPublishedAggregate ? stats.active : currentProjectionSummary(rows);
  const today = new Date(Date.now() + 9 * 60 * 60 * 1_000).toISOString().slice(0, 10);
  const daily = Array.isArray(stats.daily) ? stats.daily.map((row) => ({ ...row })) : [];
  if (!hasPublishedAggregate) {
    const todayRow = daily.find((row) => String(row.date || row.stat_date) === today);
    if (todayRow) todayRow.active = active;
    else daily.push({ date: today, active, reserved: currentProjectionSummary([]), sold: currentProjectionSummary([]), confirmed_transactions: currentProjectionSummary([]) });
  }
  const existingSources = new Map((Array.isArray(stats.by_source) ? stats.by_source : [])
    .filter((entry) => String(entry?.source_id || ""))
    .map((entry) => [String(entry.source_id), {
      ...entry,
      daily: (Array.isArray(entry.daily) ? entry.daily : []).slice(-days)
    }]));
  for (const sourceId of [...new Set(rows.map((row) => String(row.site || "")).filter(Boolean))].sort()) {
    if (hasPublishedAggregate && existingSources.has(sourceId)) continue;
    const sourceRows = rows.filter((row) => String(row.site || "") === sourceId);
    const sourceActive = currentProjectionSummary(sourceRows);
    const entry = existingSources.get(sourceId) || {
      source_id: sourceId,
      reserved: currentProjectionSummary([]),
      sold: currentProjectionSummary([]),
      confirmed_transactions: currentProjectionSummary([]),
      daily: []
    };
    entry.active = sourceActive;
    entry.data_origin = "CURRENT_D1_PROJECTION";
    const sourceDaily = Array.isArray(entry.daily) ? entry.daily.map((row) => ({ ...row })) : [];
    const sourceToday = sourceDaily.find((row) => String(row.date || row.stat_date) === today);
    if (sourceToday) sourceToday.active = sourceActive;
    else sourceDaily.push({ date: today, active: sourceActive, reserved: currentProjectionSummary([]), sold: currentProjectionSummary([]), confirmed_transactions: currentProjectionSummary([]) });
    entry.daily = sourceDaily.sort((left, right) => String(left.date || "").localeCompare(String(right.date || ""))).slice(-days);
    existingSources.set(sourceId, entry);
  }
  return {
    ...stats,
    active,
    daily: daily.sort((left, right) => String(left.date || "").localeCompare(String(right.date || ""))).slice(-days),
    by_source: [...existingSources.values()].sort((left, right) => String(left.source_id).localeCompare(String(right.source_id))),
    as_of: hasPublishedAggregate
      ? stats.as_of
      : rows.map((row) => String(row.updated_at || "")).sort().at(-1) || stats.as_of,
    methodology: {
      ...(stats.methodology || {}),
      active_projection: hasPublishedAggregate
        ? "통합 대표가격은 발행 원장 구성원을 유지하고, 신규 사이트별 현재가는 활성 D1 projection으로 보완합니다."
        : "현재 판매중 가격은 활성 공개 매물 원장으로 조회 시점에 재계산합니다."
    }
  };
}

async function publishedStatsAsOf(db, query) {
  const row = await db.prepare(`SELECT s.as_of
    FROM public_product_stats s
    JOIN public_stats_publications p ON p.publication_id = s.publication_id AND p.active = 1
    WHERE s.canonical_product_id = ? AND s.market_pool = ? AND s.condition_code = ?
      AND s.currency = ? AND s.days = ?
    LIMIT 1`).bind(
    query.canonicalProductId, query.marketPool, query.condition, query.currency, query.days
  ).first();
  return row?.as_of ? String(row.as_of) : null;
}

async function serveProductPriceStats(request, env) {
  let query;
  try {
    query = parsePriceStatsRequest(new URL(request.url));
  } catch (error) {
    return json(400, { status: "error", error: error instanceof Error ? error.message : String(error) });
  }
  if (!hasD1(env)) return json(503, { status: "error", error: "Public price statistics are unavailable" });
  try {
    const stats = await readPublishedProductStats(env.DB, query);
    const publicationAsOf = stats ? await publishedStatsAsOf(env.DB, query) : null;
    const projectionRows = await currentProjectionRows(env.DB, query);
    if (!stats && projectionRows.length === 0) return json(404, { status: "error", error: "Price statistics not found" });
    const baseStats = stats ? { ...stats, as_of: stats.as_of || publicationAsOf } : {
      active: currentProjectionSummary([]),
      reserved: currentProjectionSummary([]),
      sold: currentProjectionSummary([]),
      confirmed_transactions: currentProjectionSummary([]),
      by_source: [],
      by_manufacturer: [],
      daily: [],
      exclusions: { total: 0, reasons: {} },
      versions: { parser: null, rule: null, filter: null },
      traceability: { member_count: 0 },
      as_of: projectionRows.map((row) => String(row.updated_at || "")).sort().at(-1) || new Date().toISOString()
    };
    return json(200, { status: "success", data: priceStatsResponse(query, overlayCurrentProjection(baseStats, projectionRows, query.days)) });
  } catch (error) {
    console.error("Public price statistics failed", error);
    return json(503, { status: "error", error: "Public price statistics are unavailable" });
  }
}

async function servePcProducts(url, env) {
  const response = pcProductsResponse(url);
  const products = Array.isArray(response.products?.items) ? response.products.items : [];
  if (!hasD1(env) || products.length === 0) return json(200, { status: "success", data: response });
  const ids = products.map((product) => String(product.id || "")).filter(Boolean);
  if (ids.length === 0) return json(200, { status: "success", data: response });
  try {
    const placeholders = ids.map(() => "?").join(", ");
    const rows = await env.DB.prepare(`SELECT s.canonical_product_id, s.market_pool, s.currency, s.as_of,
        json_extract(s.stats_json, '$.active.sample_count') AS active_sample_count,
        json_extract(s.stats_json, '$.active.mean') AS active_mean,
        json_extract(s.stats_json, '$.active.median') AS active_median,
        json_extract(s.stats_json, '$.sold.sample_count') AS sold_sample_count,
        json_extract(s.stats_json, '$.sold.mean') AS sold_mean,
        json_extract(s.stats_json, '$.sold.median') AS sold_median
      FROM public_product_stats s
      JOIN public_stats_publications p ON p.publication_id = s.publication_id AND p.active = 1
      WHERE s.canonical_product_id IN (${placeholders})
        AND s.condition_code = 'USED_WORKING' AND s.currency = 'KRW'
        AND s.market_pool IN ('KR_C2C_USED', 'KR_DEALER_USED')`).bind(...ids).all();
    const preferred = new Map();
    for (const row of rows.results || []) {
      const previous = preferred.get(row.canonical_product_id);
      const rank = row.market_pool === "KR_C2C_USED" ? 2 : 1;
      const hasSamples = Number(row.active_sample_count || 0) + Number(row.sold_sample_count || 0) > 0;
      if (!hasSamples || (previous && previous.rank >= rank)) continue;
      preferred.set(row.canonical_product_id, { ...row, rank });
    }
    const currentRows = await currentProjectionRows(env.DB, { currency: "KRW", condition: "USED_WORKING" }, ids);
    for (const productId of ids) {
      for (const marketPool of ["KR_C2C_USED", "KR_DEALER_USED"]) {
        const scoped = currentRows.filter((row) => row.canonical_product_id === productId && row.market_pool === marketPool);
        if (!scoped.length) continue;
        const active = currentProjectionSummary(scoped);
        const rank = marketPool === "KR_C2C_USED" ? 2 : 1;
        const previous = preferred.get(productId);
        if (!previous || Number(previous.active_sample_count || 0) === 0) {
          preferred.set(productId, {
            canonical_product_id: productId,
            market_pool: marketPool,
            currency: "KRW",
            as_of: scoped.map((row) => String(row.updated_at || "")).sort().at(-1),
            active_sample_count: active.sample_count,
            active_mean: active.mean,
            active_median: active.median,
            sold_sample_count: previous?.sold_sample_count || 0,
            sold_mean: previous?.sold_mean || null,
            sold_median: previous?.sold_median || null,
            rank
          });
        }
      }
    }
    response.products.items = products.map((product) => {
      const stats = preferred.get(product.id);
      if (!stats) return product;
      return {
        ...product,
        price_stats_market_pool: stats.market_pool,
        price_stats_currency: stats.currency,
        price_stats_as_of: stats.as_of,
        price_stats: {
          active: { sample_count: Number(stats.active_sample_count || 0), mean: stats.active_mean, median: stats.active_median },
          sold: { sample_count: Number(stats.sold_sample_count || 0), mean: stats.sold_mean, median: stats.sold_median }
        }
      };
    });
  } catch (error) {
    console.error("PC product price summaries failed", error);
  }
  return json(200, { status: "success", data: response });
}

async function serveAssets(request, env) {
  if (!env.ASSETS || typeof env.ASSETS.fetch !== "function") return null;
  const response = await env.ASSETS.fetch(request);
  return response.status === 404 ? null : response;
}

function augmentCategoryCatalog(catalog) {
  const sitePlans = Object.fromEntries(OPERATIONAL_TARGET_SITES.map((site) => [site, { ...(catalog?.site_plans?.[site] || {}) }]));
  const sourceBindings = Object.fromEntries(OPERATIONAL_TARGET_SITES.map((site) => [site, { ...(catalog?.source_bindings?.[site] || {}) }]));
  for (const site of ["hellomarket", "rethinkmall", "ebay"].filter((site) => OPERATIONAL_TARGET_SITES.includes(site))) {
    sitePlans[site] = Object.fromEntries((catalog?.categories || [])
      .filter((category) => category.id !== "all")
      .map((category) => [category.id, {
        requestedCategoryId: category.id,
        resolvedCategoryId: null,
        strategy: "keyword",
        binding: null,
        // Keyword search is integrated when the user supplies a query, but it
        // is not a verified category path. Keep category-only navigation
        // disabled for this source.
        availability: "unavailable",
        selectable: false
      }]));
    sourceBindings[site] = {};
  }
  for (const site of OPERATIONAL_TARGET_SITES) {
    sitePlans[site] ||= {};
    sourceBindings[site] ||= {};
  }
  return { ...catalog, site_plans: sitePlans, source_bindings: sourceBindings };
}

async function serveCategoryCatalog() {
  try {
    const { categoryCatalogForApi } = await import("../market/logic/category-catalog.ts");
    const { pcPartsCatalogForApi } = await import("../market/logic/pc-parts-catalog.mjs");
    return json(200, { status: "success", data: { ...augmentCategoryCatalog(categoryCatalogForApi()), pc_parts: pcPartsCatalogForApi() } });
  } catch (error) {
    console.error("Category catalog failed", error);
    return json(503, { status: "error", error: "Category catalog is unavailable" });
  }
}

async function manualTokenIsValid(request, env) {
  const expectedTokens = [env.MANUAL_RUN_TOKEN, env.MANUAL_RUN_TOKEN_NEXT]
    .filter((value) => typeof value === "string" && value.length > 0);
  const actual = request.headers.get("authorization") || "";
  if (expectedTokens.length === 0 || !actual.startsWith("Bearer ")) return false;
  const encoder = new TextEncoder();
  const actualDigest = new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(actual)));
  let matched = false;
  for (const expected of expectedTokens) {
    const expectedDigest = new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(`Bearer ${expected}`)));
    if (typeof crypto.subtle.timingSafeEqual === "function") {
      matched = crypto.subtle.timingSafeEqual(expectedDigest, actualDigest) || matched;
      continue;
    }
    let difference = expectedDigest.length ^ actualDigest.length;
    for (let index = 0; index < Math.max(expectedDigest.length, actualDigest.length); index += 1) {
      difference |= (expectedDigest[index] || 0) ^ (actualDigest[index] || 0);
    }
    matched = difference === 0 || matched;
  }
  return matched;
}

function nodeRunnerIsConfigured(env) {
  return Boolean(
    env.RUNNER_TOKEN
    && typeof env.RUNNER_URL === "string"
    && /^https:\/\//i.test(env.RUNNER_URL)
    && !env.RUNNER_URL.includes("replace-with")
  );
}

function searchRunnerIsConfigured(env) {
  return Boolean(
    env.RUNNER_TOKEN
    && typeof env.SEARCH_RUNNER_URL === "string"
    && /^https:\/\//i.test(env.SEARCH_RUNNER_URL)
    && !env.SEARCH_RUNNER_URL.includes("replace-with")
  );
}

async function directD1SearchFallback(request, env, runnerFallback = true) {
  const fallbackResponse = await searchD1(request, env);
  if (fallbackResponse.status >= 400 && fallbackResponse.status < 500) return fallbackResponse;
  if (!fallbackResponse.ok || fallbackResponse.headers.get("x-free-tier-data-source") !== "d1") {
    throw new Error(`D1_FALLBACK_HTTP_${fallbackResponse.status}`);
  }
  const fallbackHeaders = new Headers(fallbackResponse.headers);
  fallbackHeaders.set("x-search-data-source", "d1-fallback");
  if (runnerFallback) fallbackHeaders.set("x-search-runner-fallback", "true");
  fallbackHeaders.set("x-search-quality-layer", "d1-backup");
  return new Response(fallbackResponse.body, {
    status: fallbackResponse.status,
    headers: fallbackHeaders
  });
}

async function proxyToSearchRunner(request, env, runnerPath = "/api/search") {
  if (!searchRunnerIsConfigured(env)) {
    return json(503, { ok: false, error: "AWS search runner is not configured" });
  }
  const headers = new Headers(request.headers);
  headers.delete("host");
  headers.set("authorization", `Bearer ${env.RUNNER_TOKEN}`);
  const body = request.method === "GET" || request.method === "HEAD"
    ? undefined
    : await request.clone().arrayBuffer();
  const controller = new AbortController();
  const timeoutMs = readNonNegativeInteger(env, "SEARCH_RUNNER_TIMEOUT_MS", 15_000, 60_000);
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const runnerUrl = new URL(env.SEARCH_RUNNER_URL);
    runnerUrl.pathname = runnerPath;
    runnerUrl.search = new URL(request.url).search;
    const response = await fetch(runnerUrl, {
      method: request.method,
      headers,
      body,
      signal: controller.signal,
      redirect: "manual"
    });
    if (!response.ok && runnerPath === "/api/search" && hasD1(env) && response.status >= 500) {
      console.warn("AWS search runner returned an error; using D1 fallback", response.status);
      try {
        return await directD1SearchFallback(request, env);
      } catch (fallbackError) {
        console.error("D1 fallback after AWS search runner error failed", fallbackError);
        return json(502, { ok: false, error: "AWS search runner and D1 fallback are unavailable" });
      }
    }
    const responseBody = await readResponseText(response, MAX_RUNNER_RESPONSE_BYTES);
    const responseHeaders = new Headers(response.headers);
    responseHeaders.set("x-search-data-source", "aws-runner");
    responseHeaders.set("x-search-quality-layer", "aws-runner-index");
    return new Response(responseBody, {
      status: response.status,
      headers: responseHeaders
    });
  } catch (error) {
    console.error("AWS search runner proxy failed", error);
    if (runnerPath === "/api/search" && hasD1(env)) {
      try {
        return await directD1SearchFallback(request, env);
      } catch (fallbackError) {
        console.error("D1 fallback after AWS search runner failure also failed", fallbackError);
      }
    }
    return json(502, {
      ok: false,
      error: controller.signal.aborted ? "AWS search runner timed out" : "AWS search runner is unavailable"
    });
  } finally {
    clearTimeout(timer);
  }
}

async function proxyToRunnerStatus(request, env) {
  if (!nodeRunnerIsConfigured(env)) {
    return json(503, { ok: false, error: "AWS runner is not configured" });
  }
  const headers = new Headers(request.headers);
  headers.delete("host");
  headers.set("authorization", `Bearer ${env.RUNNER_TOKEN}`);
  const runnerUrl = new URL(env.RUNNER_URL);
  runnerUrl.pathname = "/api/runner/status";
  runnerUrl.search = new URL(request.url).search;
  try {
    const response = await fetch(runnerUrl, { method: "GET", headers, redirect: "manual" });
    const responseHeaders = new Headers(response.headers);
    responseHeaders.set("x-runner-data-source", "aws-runner");
    return new Response(response.body, { status: response.status, headers: responseHeaders });
  } catch (error) {
    console.error("AWS runner status proxy failed", error);
    return json(502, { ok: false, error: "AWS runner status is unavailable" });
  }
}

function resolveOriginUrl(env) {
  const value = typeof env.ORIGIN_URL === "string" ? env.ORIGIN_URL.trim() : "";
  if (!value) return null;
  try {
    const origin = new URL(value);
    if (origin.protocol !== "https:" && origin.protocol !== "http:") return null;
    return origin;
  } catch {
    return null;
  }
}

async function proxyToOrigin(request, env) {
  const origin = resolveOriginUrl(env);
  if (!origin) {
    return json(503, { ok: false, error: "Origin server is not configured" });
  }

  const incoming = new URL(request.url);
  origin.pathname = incoming.pathname;
  origin.search = incoming.search;
  const headers = new Headers(request.headers);
  headers.delete("host");
  const body = request.method === "GET" || request.method === "HEAD"
    ? undefined
    : await request.clone().arrayBuffer();
  return fetch(new Request(origin, {
    method: request.method,
    headers,
    body,
    redirect: "manual"
  }));
}

function getIdempotencyKey(request, payload, trigger, jobNames, scheduledTime) {
  const headerKey = request.headers.get("idempotency-key")?.trim();
  if (headerKey) return headerKey;
  if (trigger === "cloudflare-cron" && scheduledTime) {
    return `cloudflare:${payload.cron}:${new Date(scheduledTime).toISOString()}`;
  }
  return `manual:${jobNames.join(",")}:${crypto.randomUUID()}`;
}

async function triggerNodeRunner(env, payload, idempotencyKey) {
  if (!nodeRunnerIsConfigured(env)) {
    throw new Error("RUNNER_URL is not configured");
  }
  if (!env.RUNNER_TOKEN) {
    throw new Error("RUNNER_TOKEN is not configured");
  }

  const headers = { "content-type": "application/json" };
  headers.authorization = `Bearer ${env.RUNNER_TOKEN}`;
  headers["idempotency-key"] = idempotencyKey;
  const timeoutMs = readNonNegativeInteger(env, "RUNNER_TIMEOUT_MS", DEFAULT_RUNNER_TIMEOUT_MS, 120_000);
  const maxAttempts = Math.max(1, readNonNegativeInteger(env, "RUNNER_MAX_ATTEMPTS", DEFAULT_RUNNER_MAX_ATTEMPTS, 5));
  const retryDelayMs = readNonNegativeInteger(env, "RUNNER_RETRY_DELAY_MS", DEFAULT_RUNNER_RETRY_DELAY_MS, 5_000);
  let lastError;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(env.RUNNER_URL, {
        method: "POST",
        headers,
        body: JSON.stringify(payload),
        signal: controller.signal
      });
      const responseText = await readResponseText(response, MAX_RUNNER_RESPONSE_BYTES);
      let responsePayload = null;
      try { responsePayload = JSON.parse(responseText); } catch { responsePayload = null; }
      const semanticOk = responsePayload && typeof responsePayload === "object" && "ok" in responsePayload
        ? responsePayload.ok === true
        : response.ok;
      const result = {
        ok: response.ok && semanticOk,
        status: response.status,
        body: responseText.slice(0, 4000),
        attempts: attempt
      };
      if (response.ok || !isRetryableStatus(response.status) || attempt === maxAttempts) {
        return result;
      }
      lastError = new Error(`Node runner returned HTTP ${response.status}`);
    } catch (error) {
      lastError = controller.signal.aborted
        ? new Error(`Node runner request timed out after ${timeoutMs} ms`)
        : error;
      if (attempt === maxAttempts) {
        throw lastError;
      }
    } finally {
      clearTimeout(timer);
    }

    await wait(retryDelayMs * (2 ** (attempt - 1)));
  }

  throw lastError ?? new Error("Node runner request failed");
}

async function readResponseText(response, maxBytes) {
  const declaredLength = Number(response.headers.get('content-length'));
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
    return `[response truncated at ${maxBytes} bytes]`;
  }
  if (!response.body) return '';
  const reader = response.body.getReader();
  const chunks = [];
  let totalBytes = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    const chunk = value instanceof Uint8Array ? value : new Uint8Array(value);
    const remaining = maxBytes - totalBytes;
    if (chunk.byteLength > remaining) {
      chunks.push(chunk.slice(0, Math.max(0, remaining)));
      return `${new TextDecoder().decode(concatBytes(chunks))}\n[response truncated at ${maxBytes} bytes]`;
    }
    chunks.push(chunk);
    totalBytes += chunk.byteLength;
  }
  return new TextDecoder().decode(concatBytes(chunks));
}

function concatBytes(chunks) {
  const total = chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0);
  const result = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return result;
}

async function readJsonPayload(request, maximumBytes = MAX_RUNNER_REQUEST_BYTES) {
  const declaredLength = Number(request.headers.get('content-length'));
  if (Number.isFinite(declaredLength) && declaredLength > maximumBytes) {
    throw new PayloadTooLargeError();
  }
  if (!request.body) return null;
  const reader = request.body.getReader();
  const chunks = [];
  let totalBytes = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    const chunk = value instanceof Uint8Array ? value : new Uint8Array(value);
    totalBytes += chunk.byteLength;
    if (totalBytes > maximumBytes) throw new PayloadTooLargeError();
    chunks.push(chunk);
  }
  return JSON.parse(new TextDecoder().decode(concatBytes(chunks)));
}

function importedUrl(value, site) {
  if (typeof value !== "string" || !value.trim()) return null;
  try {
    const parsed = new URL(value.trim());
    const hostname = parsed.hostname.toLowerCase();
    if (site === "danawa" && parsed.protocol === "http:" && hostname === "dmall.danawa.com") parsed.protocol = "https:";
    const allowedHosts = IMPORT_ALLOWED_HOSTS_BY_SITE[site] || [];
    if (parsed.protocol !== "https:" || !allowedHosts.includes(hostname)) return null;
    return parsed.toString();
  } catch {
    return null;
  }
}

function importedImageUrl(value) {
  if (typeof value !== "string" || !value.trim()) return null;
  try {
    const parsed = new URL(value.trim());
    return parsed.protocol === "https:" ? parsed.toString() : null;
  } catch {
    return null;
  }
}

function importedText(value, maximum = 1000) {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim().slice(0, maximum) : "";
}

function redactPublicText(value, maximum = 1000) {
  return importedText(value, maximum)
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/giu, "[EMAIL]")
    .replace(/(?<!\d)(?:\+?82[-.\s]?)?0?1[016789][-.\s]?\d{3,4}[-.\s]?\d{4}(?!\d)/gu, "[PHONE]");
}

function importedNumber(value) {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

function importedBoardManufacturer(value) {
  const direct = importedText(value?.board_manufacturer ?? value?.spec?.board_manufacturer, 120);
  if (direct) return direct;
  const evidence = value?.evidence;
  if (Array.isArray(evidence)) {
    const match = evidence.find((entry) => entry && typeof entry === "object"
      && ["board_manufacturer", "gpu_board_manufacturer"].includes(String(entry.field || "")));
    return importedText(match?.value, 120) || null;
  }
  if (evidence && typeof evidence === "object") {
    return importedText(evidence.board_manufacturer ?? evidence.gpu_board_manufacturer, 120) || null;
  }
  return null;
}

function normalizeImportedListing(value, index) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const site = importedText(value.site, 40);
  const title = redactPublicText(value.title, 500);
  if (!IMPORT_ALLOWED_SITES.has(site)) return null;
  const url = importedUrl(value.url, site);
  if (!title || !url) return null;
  const categoryId = importedText(value.category_id, 120) || "all";
  const itemId = importedText(value.item_id, 500) || `${site}:${url}`;
  if (site === "ebay" && /^ebay:https?:/iu.test(itemId)) return null;
  const updatedAt = importedText(value.updated_at, 80) || new Date().toISOString();
  const lifecycleStatus = importedText(value.lifecycle_status, 80).toUpperCase() || "ACTIVE";
  const priceValue = importedNumber(value.price_value ?? value.price);
  const source = getPcSource(site);
  const marketPool = importedText(value.market_pool, 80) || source?.market_pool || null;
  if (!source || !source.market_pools.includes(marketPool)) return null;
  const currency = importedText(value.currency, 12).toUpperCase() || (marketPool === "OVERSEAS_USED" ? "USD" : "KRW");
  const quantity = Number.isInteger(Number(value.quantity)) && Number(value.quantity) > 0 ? Number(value.quantity) : null;
  const priceScope = importedText(value.price_scope, 80).toUpperCase() || "UNKNOWN";
  const listingKind = importedText(value.listing_kind, 80).toUpperCase() || "UNKNOWN";
  const publicCategoryCode = importedText(value.category_code, 80).toUpperCase() || importedText(value.pc_category_code, 80).toUpperCase() || "UNSUPPORTED_CATEGORY";
  const marketSegment = importedText(value.market_segment, 80).toUpperCase() || "UNKNOWN";
  const listingType = importedText(value.listing_type, 80).toUpperCase() || ({ SINGLE_COMPONENT: "SINGLE", SAME_PRODUCT_LOT: "MULTI_SAME", COMPONENT_BUNDLE: "BUNDLE", FULL_SYSTEM: "COMPLETE_PC" }[listingKind] || "UNKNOWN");
  const conditionGroup = importedText(value.condition_group, 80).toUpperCase() || importedText(value.condition_code, 80).toUpperCase() || "UNKNOWN";
  const exclusionReasons = new Set(Array.isArray(value.exclusion_reasons)
    ? value.exclusion_reasons.map((reason) => importedText(reason, 80)).filter(Boolean)
    : []);
  if (quantity === null) exclusionReasons.add("QUANTITY_UNKNOWN");
  if (!["TOTAL", "UNIT"].includes(priceScope)) exclusionReasons.add("PRICE_SCOPE_AMBIGUOUS");
  const currencyMatchesPool = marketPool === "OVERSEAS_USED" ? currency === "USD" : currency === "KRW";
  if (!currencyMatchesPool) exclusionReasons.add("MARKET_CURRENCY_MISMATCH");
  const statisticsExclusionReasons = new Set(Array.isArray(value.statistics_exclusion_reasons)
    ? value.statistics_exclusion_reasons.map((reason) => importedText(reason, 80)).filter(Boolean)
    : exclusionReasons);
  const statisticsEligible = (value.statistics_eligible === true || value.statistics_eligible === 1)
    && ["CPU", "GPU", "RAM", "MOTHERBOARD", "SSD", "HDD", "PSU"].includes(publicCategoryCode)
    && marketSegment === "CONSUMER_DESKTOP"
    && ["SINGLE", "MULTI_SAME"].includes(listingType)
    && conditionGroup === "USED_WORKING"
    && statisticsExclusionReasons.size === 0;
  const priceEligible = value.price_eligible === true
    && quantity !== null
    && ["TOTAL", "UNIT"].includes(priceScope)
    && ["SINGLE_COMPONENT", "SAME_PRODUCT_LOT"].includes(listingKind)
    && currencyMatchesPool;
  return {
    item_id: itemId,
    site,
    category_id: categoryId,
    title,
    search_text: redactPublicText(value.search_text, 1000) || title,
    price_value: priceValue,
    currency,
    url,
    image_url: importedImageUrl(value.image_url) ?? null,
    seller_name: null,
    posted_at: importedText(value.posted_at, 80) || null,
    updated_at: updatedAt,
    active: lifecycleStatus === "ACTIVE" && Number.isFinite(priceValue) && priceValue > 0 ? 1 : 0,
    canonical_product_id: importedText(value.canonical_product_id, 200) || null,
    canonical_display_name: importedText(value.canonical_display_name, 300) || null,
    canonical_manufacturer: importedText(value.canonical_manufacturer, 120) || null,
    board_manufacturer: importedBoardManufacturer(value),
    listing_kind: listingKind,
    pc_category_code: publicCategoryCode,
    market_segment: marketSegment,
    listing_type: listingType,
    condition_group: conditionGroup,
    spec_group_id: importedText(value.spec_group_id, 200) || null,
    classification_confidence: importedNumber(value.classification_confidence) ?? 0,
    model_confidence: importedNumber(value.model_confidence) ?? 0,
    quantity_confidence: importedNumber(value.quantity_confidence) ?? 0,
    price_scope_confidence: importedNumber(value.price_scope_confidence) ?? 0,
    statistics_eligible: statisticsEligible ? 1 : 0,
    statistics_exclusion_reasons_json: JSON.stringify([...statisticsExclusionReasons].slice(0, 20)),
    quantity,
    price_scope: priceScope,
    condition_code: importedText(value.condition_code, 80) || "UNKNOWN",
    lifecycle_status: lifecycleStatus,
    market_pool: marketPool,
    confidence_json: JSON.stringify(value.confidence && typeof value.confidence === "object" ? value.confidence : {}),
    evidence_json: JSON.stringify(value.evidence && typeof value.evidence === "object" ? value.evidence : {}),
    price_eligible: priceEligible ? 1 : 0,
    exclusion_reasons_json: JSON.stringify([...exclusionReasons].slice(0, 20)),
    good_listing_eligible: value.good_listing_eligible === true ? 1 : 0,
    reference_price: importedNumber(value.reference_price),
    _index: index
  };
}

function normalizePcListingCollectionManifest(value) {
  if (value === null || value === undefined) return null;
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("collection_manifest must be an object");
  }
  const manifestVersion = importedText(value.manifest_version, 80);
  const sourceId = importedText(value.source_id, 80).toLowerCase();
  const status = importedText(value.status, 40).toUpperCase();
  const parsedAsOf = Date.parse(importedText(value.as_of, 80));
  if (manifestVersion !== PC_LISTING_COLLECTION_MANIFEST_VERSION) {
    throw new TypeError("collection_manifest manifest_version is invalid");
  }
  if (!OPERATIONAL_PC_DIRECTORY_SITES.includes(sourceId)) {
    throw new TypeError("collection_manifest source_id is not an approved PC directory source");
  }
  if (status !== "SUCCEEDED") throw new TypeError("collection_manifest status must be SUCCEEDED");
  if (!Number.isFinite(parsedAsOf) || parsedAsOf > Date.now() + 5 * 60 * 1_000) {
    throw new TypeError("collection_manifest as_of is invalid");
  }
  const successfulTargetIds = [...new Set((Array.isArray(value.successful_target_ids)
    ? value.successful_target_ids : []).map((targetId) => importedText(targetId, 200)).filter(Boolean))].sort();
  if (successfulTargetIds.length > PC_MAX_HOURLY_TARGETS_PER_SOURCE) {
    throw new TypeError(`collection_manifest successful_target_ids exceeds ${PC_MAX_HOURLY_TARGETS_PER_SOURCE}`);
  }
  if (successfulTargetIds.some((targetId) => {
    const target = PC_COLLECTION_TARGETS_BY_ID.get(targetId);
    return !target || target.enabled === false || target.cadenceClass !== "HOURLY_CATEGORY"
      || !Array.isArray(target.sourceKeys) || !target.sourceKeys.includes(sourceId);
  })) {
    throw new TypeError("collection_manifest contains a non-hourly target or one not assigned to source_id");
  }
  return {
    manifest_version: manifestVersion,
    source_id: sourceId,
    status,
    as_of: new Date(parsedAsOf).toISOString(),
    successful_target_ids: successfulTargetIds
  };
}

async function importListings(env, values, collectionManifestValue = null) {
  if (!hasD1(env)) return { inserted: 0, rejected: values.length, error: "D1 is unavailable" };
  const collectionManifest = normalizePcListingCollectionManifest(collectionManifestValue);
  const retiredPurged = await purgeRetiredD1Listings(env);
  const normalized = [];
  let rejected = 0;
  for (let index = 0; index < Math.min(values.length, MAX_IMPORTED_LISTINGS); index += 1) {
    const item = normalizeImportedListing(values[index], index);
    if (item) normalized.push(item);
    else rejected += 1;
  }
  rejected += Math.max(0, values.length - MAX_IMPORTED_LISTINGS);
  if (normalized.length === 0 && !collectionManifest) {
    return { inserted: 0, rejected, retired_purged: retiredPurged };
  }

  const manifestTargetIdsJson = collectionManifest
    ? JSON.stringify(collectionManifest.successful_target_ids)
    : null;
  const existingManifest = collectionManifest
    ? await env.DB.prepare(`SELECT source_id, as_of, manifest_version,
        successful_target_ids_json, successful_target_count
      FROM pc_listing_collection_manifests WHERE source_id = ? AND as_of = ?`)
      .bind(collectionManifest.source_id, collectionManifest.as_of).first()
    : null;
  const manifestMatches = (row) => Boolean(row
    && row.manifest_version === collectionManifest?.manifest_version
    && row.successful_target_ids_json === manifestTargetIdsJson
    && Number(row.successful_target_count) === collectionManifest?.successful_target_ids.length);
  if (existingManifest && !manifestMatches(existingManifest)) {
    throw new CollectionManifestConflictError("COLLECTION_MANIFEST_CONFLICT: source_id/as_of is immutable");
  }

  const statements = normalized.map((item) => env.DB.prepare(
    `INSERT INTO listings
      (item_id, site, category_id, title, search_text, price_value, currency, url, image_url, seller_name, posted_at, updated_at, active,
       canonical_product_id, canonical_display_name, canonical_manufacturer, board_manufacturer, listing_kind, pc_category_code,
       market_segment, listing_type, condition_group, spec_group_id, classification_confidence, model_confidence, quantity_confidence, price_scope_confidence,
       statistics_eligible, statistics_exclusion_reasons_json, quantity, price_scope, condition_code,
       lifecycle_status, market_pool, confidence_json, evidence_json, price_eligible, exclusion_reasons_json, good_listing_eligible, reference_price)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
              ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
              ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
              ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(item_id) DO UPDATE SET
        site = excluded.site,
        category_id = excluded.category_id,
        title = excluded.title,
        search_text = excluded.search_text,
        price_value = excluded.price_value,
        currency = excluded.currency,
        url = excluded.url,
        image_url = excluded.image_url,
        seller_name = excluded.seller_name,
        posted_at = excluded.posted_at,
        updated_at = excluded.updated_at,
        active = excluded.active,
        canonical_product_id = excluded.canonical_product_id,
        canonical_display_name = excluded.canonical_display_name,
        canonical_manufacturer = excluded.canonical_manufacturer,
        board_manufacturer = excluded.board_manufacturer,
        listing_kind = excluded.listing_kind,
        pc_category_code = excluded.pc_category_code,
        market_segment = excluded.market_segment,
        listing_type = excluded.listing_type,
        condition_group = excluded.condition_group,
        spec_group_id = excluded.spec_group_id,
        classification_confidence = excluded.classification_confidence,
        model_confidence = excluded.model_confidence,
        quantity_confidence = excluded.quantity_confidence,
        price_scope_confidence = excluded.price_scope_confidence,
        statistics_eligible = excluded.statistics_eligible,
        statistics_exclusion_reasons_json = excluded.statistics_exclusion_reasons_json,
        quantity = excluded.quantity,
        price_scope = excluded.price_scope,
        condition_code = excluded.condition_code,
        lifecycle_status = excluded.lifecycle_status,
        market_pool = excluded.market_pool,
        confidence_json = excluded.confidence_json,
        evidence_json = excluded.evidence_json,
        price_eligible = excluded.price_eligible,
        exclusion_reasons_json = excluded.exclusion_reasons_json,
        good_listing_eligible = excluded.good_listing_eligible,
        reference_price = excluded.reference_price
      WHERE listings.site IS NOT excluded.site
         OR listings.category_id IS NOT excluded.category_id
         OR listings.title IS NOT excluded.title
         OR listings.search_text IS NOT excluded.search_text
         OR listings.price_value IS NOT excluded.price_value
         OR listings.currency IS NOT excluded.currency
         OR listings.url IS NOT excluded.url
         OR listings.image_url IS NOT excluded.image_url
         OR listings.seller_name IS NOT excluded.seller_name
         OR listings.posted_at IS NOT excluded.posted_at
         OR listings.active IS NOT excluded.active
         OR listings.canonical_product_id IS NOT excluded.canonical_product_id
         OR listings.canonical_display_name IS NOT excluded.canonical_display_name
         OR listings.canonical_manufacturer IS NOT excluded.canonical_manufacturer
         OR listings.board_manufacturer IS NOT excluded.board_manufacturer
         OR listings.listing_kind IS NOT excluded.listing_kind
         OR listings.pc_category_code IS NOT excluded.pc_category_code
         OR listings.market_segment IS NOT excluded.market_segment
         OR listings.listing_type IS NOT excluded.listing_type
         OR listings.condition_group IS NOT excluded.condition_group
         OR listings.spec_group_id IS NOT excluded.spec_group_id
         OR listings.classification_confidence IS NOT excluded.classification_confidence
         OR listings.model_confidence IS NOT excluded.model_confidence
         OR listings.quantity_confidence IS NOT excluded.quantity_confidence
         OR listings.price_scope_confidence IS NOT excluded.price_scope_confidence
         OR listings.statistics_eligible IS NOT excluded.statistics_eligible
         OR listings.statistics_exclusion_reasons_json IS NOT excluded.statistics_exclusion_reasons_json
         OR listings.quantity IS NOT excluded.quantity
         OR listings.price_scope IS NOT excluded.price_scope
         OR listings.condition_code IS NOT excluded.condition_code
         OR listings.lifecycle_status IS NOT excluded.lifecycle_status
         OR listings.market_pool IS NOT excluded.market_pool
         OR listings.confidence_json IS NOT excluded.confidence_json
         OR listings.evidence_json IS NOT excluded.evidence_json
         OR listings.price_eligible IS NOT excluded.price_eligible
         OR listings.exclusion_reasons_json IS NOT excluded.exclusion_reasons_json
         OR listings.good_listing_eligible IS NOT excluded.good_listing_eligible
         OR listings.reference_price IS NOT excluded.reference_price`
  ).bind(
    item.item_id,
    item.site,
    item.category_id,
    item.title,
    item.search_text,
    item.price_value,
    item.currency,
    item.url,
    item.image_url,
    item.seller_name,
    item.posted_at,
    item.updated_at,
    item.active,
    item.canonical_product_id, item.canonical_display_name, item.canonical_manufacturer, item.board_manufacturer, item.listing_kind, item.pc_category_code,
    item.market_segment, item.listing_type, item.condition_group, item.spec_group_id, item.classification_confidence, item.model_confidence, item.quantity_confidence, item.price_scope_confidence,
    item.statistics_eligible, item.statistics_exclusion_reasons_json, item.quantity, item.price_scope, item.condition_code, item.lifecycle_status, item.market_pool,
    item.confidence_json, item.evidence_json, item.price_eligible, item.exclusion_reasons_json,
    item.good_listing_eligible, item.reference_price
  ));
  if (normalized.length > 0) {
    statements.push(env.DB.prepare(
      `INSERT INTO free_tier_usage (date_key, browser_seconds, queue_operations, d1_rows_written, collection_runs, updated_at)
       VALUES (?, 0, 0, ?, 0, ?)
       ON CONFLICT(date_key) DO UPDATE SET d1_rows_written = d1_rows_written + excluded.d1_rows_written, updated_at = excluded.updated_at`
    ).bind(new Date().toISOString().slice(0, 10), normalized.length, new Date().toISOString()));
  }
  const nonManifestStatements = [...statements];
  if (collectionManifest && !existingManifest) {
    const mirroredAt = new Date().toISOString();
    statements.push(env.DB.prepare(`INSERT INTO pc_listing_collection_manifests(
      source_id, as_of, manifest_version, successful_target_ids_json,
      successful_target_count, mirrored_at
    ) VALUES (?, ?, ?, ?, ?, ?)`).bind(
      collectionManifest.source_id,
      collectionManifest.as_of,
      collectionManifest.manifest_version,
      manifestTargetIdsJson,
      collectionManifest.successful_target_ids.length,
      mirroredAt
    ));
    for (const targetId of collectionManifest.successful_target_ids) {
      statements.push(env.DB.prepare(`INSERT INTO pc_listing_collection_target_runtime(
        source_id, target_id, last_succeeded_at, manifest_version, mirrored_at
      ) VALUES (?, ?, ?, ?, ?)`).bind(
        collectionManifest.source_id,
        targetId,
        collectionManifest.as_of,
        collectionManifest.manifest_version,
        mirroredAt
      ));
    }
  }
  if (statements.length > 0) {
    try {
      await env.DB.batch(statements);
    } catch (error) {
      if (!collectionManifest || existingManifest) throw error;
      const racedManifest = await env.DB.prepare(`SELECT source_id, as_of, manifest_version,
          successful_target_ids_json, successful_target_count
        FROM pc_listing_collection_manifests WHERE source_id = ? AND as_of = ?`)
        .bind(collectionManifest.source_id, collectionManifest.as_of).first();
      if (!manifestMatches(racedManifest)) {
        if (racedManifest) {
          throw new CollectionManifestConflictError("COLLECTION_MANIFEST_CONFLICT: source_id/as_of is immutable");
        }
        throw error;
      }
      // D1 batch is transactional. Retry only the unrelated listing writes after an
      // identical concurrent manifest won the immutable parent-row insert race.
      if (nonManifestStatements.length > 0) await env.DB.batch(nonManifestStatements);
    }
  }
  const mirroredManifest = collectionManifest
    ? await env.DB.prepare(`SELECT source_id, as_of, manifest_version,
        successful_target_ids_json, successful_target_count
      FROM pc_listing_collection_manifests WHERE source_id = ? AND as_of = ?`)
      .bind(collectionManifest.source_id, collectionManifest.as_of).first()
    : null;
  // Import owns only the supplied item identities. Older, inactive, or
  // over-cap rows remain recovery/audit data and must not be deleted here.
  return {
    inserted: normalized.length,
    rejected,
    retired_purged: retiredPurged,
    retention_policy: "NON_DESTRUCTIVE",
    collection_manifest: mirroredManifest ? {
      source_id: mirroredManifest.source_id,
      manifest_version: mirroredManifest.manifest_version,
      as_of: mirroredManifest.as_of,
      successful_target_ids: JSON.parse(mirroredManifest.successful_target_ids_json || "[]"),
      successful_target_count: Number(mirroredManifest.successful_target_count || 0)
    } : null
  };
}

async function purgeRetiredD1Listings(env) {
  // Rollback 동안 legacy_general projection은 복구 자산이다. PC import가
  // 승인되지 않은 기존 행을 소유하지 않으므로 여기서는 삭제하지 않는다.
  return hasD1(env) ? 0 : 0;
}

function scheduledJobNames(controller) {
  const mappedJobs = CRON_TO_JOBS.get(controller.cron);
  if (!mappedJobs) return null;

  const scheduledDate = new Date(controller.scheduledTime);
  if (
    controller.cron === "0 18 * * *"
    && scheduledDate.getUTCHours() === DAILY_PRICE_REFRESH_UTC_HOUR
  ) {
    return [...mappedJobs, "daily-price-refresh"];
  }

  return [...mappedJobs];
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.hostname.toLowerCase() === "www.used-pick.com") {
      const canonicalUrl = new URL(url);
      canonicalUrl.hostname = "used-pick.com";
      return new Response(null, {
        status: 301,
        headers: {
          location: canonicalUrl.toString(),
          "cache-control": "public, max-age=86400"
        }
      });
    }

    if (request.method === "GET" && url.pathname === "/health") {
      const freeTier = freeTierConfig(env);
      return json(200, {
        ok: true,
        service: "used-market-cloudflare-runner",
        configured: nodeRunnerIsConfigured(env),
        free_tier: {
          enabled: isFreeTierEnabled(env),
          cache: true,
          browser_minutes_per_day: 10,
          search_cache_ttl_seconds: freeTier.search_cache_ttl_seconds,
          static_cache_ttl_seconds: freeTier.static_cache_ttl_seconds,
          d1_bound: hasD1(env),
          browser_bound: Boolean(env.BROWSER),
          queue_bound: Boolean(env.COLLECTION_QUEUE),
          collection_sources: FREE_COLLECTION_SITES,
          excluded_sources: FREE_COLLECTION_EXCLUDED_SITES,
          usage: await readFreeTierUsage(env),
          recent_collection_runs: await readRecentCollectionRuns(env)
        }
      });
    }

    if (request.method === "POST" && url.pathname === "/api/monetization/contextual-offer") {
      let body;
      try {
        body = await readJsonPayload(request);
      } catch (error) {
        return noStoreJson(error instanceof PayloadTooLargeError ? 413 : 400, {
          ok: false,
          error: error instanceof PayloadTooLargeError ? "Payload too large" : "Invalid JSON body"
        });
      }
      const selectedOffer = selectContextualOffer(env, body || {});
      const token = selectedOffer ? await issueMonetizationEventToken(env, selectedOffer) : null;
      const offer = selectedOffer && token
        ? { ...selectedOffer, event_token: token.token, event_token_expires_at: token.expires_at }
        : null;
      return noStoreJson(200, { ok: true, data: { offer } });
    }

    if (request.method === "POST" && url.pathname === "/api/monetization/event") {
      if (!hasD1(env)) return noStoreJson(503, { ok: false, error: "Metrics storage is unavailable" });
      let body;
      try {
        body = await readJsonPayload(request);
      } catch (error) {
        return noStoreJson(error instanceof PayloadTooLargeError ? 413 : 400, {
          ok: false,
          error: error instanceof PayloadTooLargeError ? "Payload too large" : "Invalid JSON body"
        });
      }
      try {
        const recorded = await recordMonetizationEvent(env.DB, env, body || {});
        return recorded
          ? new Response(null, { status: 204, headers: { "cache-control": "no-store" } })
          : noStoreJson(400, { ok: false, error: "Invalid monetization event" });
      } catch (error) {
        console.error("Monetization event aggregation failed", error);
        return noStoreJson(503, { ok: false, error: "Metrics storage is unavailable" });
      }
    }

    if (request.method === "POST" && url.pathname === "/api/index/d1-fallback-check") {
      if (!await manualTokenIsValid(request, env)) {
        return json(401, { ok: false, error: "Unauthorized" });
      }
      if (!hasD1(env)) {
        return json(503, { ok: false, error: "D1 backup is not configured" });
      }
      try {
        const response = await directD1SearchFallback(request, env, false);
        const headers = new Headers(response.headers);
        headers.set("x-search-fallback-check", "true");
        return new Response(response.body, { status: response.status, headers });
      } catch (error) {
        console.error("D1 fallback diagnostic failed", error);
        return json(503, { ok: false, error: "D1 fallback diagnostic is unavailable" });
      }
    }

    if (request.method === "POST" && url.pathname === "/api/search") {
      let searchBody;
      try {
        searchBody = await readJsonPayload(request.clone());
      } catch (error) {
        return json(error instanceof PayloadTooLargeError ? 413 : 400, {
          ok: false,
          error: error instanceof PayloadTooLargeError ? "Payload too large" : "Invalid JSON body"
        });
      }
      const requestedCategories = [searchBody?.category_id, ...(Array.isArray(searchBody?.category_ids) ? searchBody.category_ids : [])]
        .filter(Boolean).map((value) => String(value).trim());
      if (requestedCategories.some((value) => value !== "pc")) {
        return json(400, { ok: false, error: "Selected categories are unavailable; only pc is supported" });
      }
      const normalizedBody = { ...(searchBody || {}), category_id: "pc" };
      delete normalizedBody.category_ids;
      const headers = new Headers(request.headers);
      headers.set("content-type", "application/json");
      request = new Request(request, { body: JSON.stringify(normalizedBody), headers });
    }

    const isPriceStatsPath = /^\/api\/products\/[^/]+\/price-stats$/u.test(url.pathname);
    if (request.method === "GET" && isPriceStatsPath && hasD1(env)) {
      return serveProductPriceStats(request, env);
    }
    if (isPriceStatsPath && searchRunnerIsConfigured(env)) {
      const runnerResponse = await proxyToSearchRunner(request, env, url.pathname);
      if (runnerResponse.status < 500 || !hasD1(env)) return runnerResponse;
      return serveProductPriceStats(request, env);
    }
    if (request.method === "GET" && isPriceStatsPath) {
      return serveProductPriceStats(request, env);
    }

    if (request.method === "GET" && url.pathname === "/api/pc/catalog") {
      return json(200, { status: "success", data: pcCatalogResponse() });
    }
    if (request.method === "GET" && url.pathname === "/api/catalog/categories") {
      const catalog = publicPcCatalogForApi();
      return json(200, { status: "success", categories: catalog.categories, data: { categories: catalog.categories } });
    }
    if (request.method === "GET" && url.pathname === "/api/catalog/facets") {
      try {
        const result = publicPcFacetsForApi(url.searchParams);
        return json(200, { status: "success", ...result, data: result });
      } catch (error) {
        return json(400, { status: "error", error: error instanceof Error ? error.message : String(error) });
      }
    }
    if (request.method === "GET" && url.pathname === "/api/catalog/models") {
      try {
        const result = publicPcModelsForApi(url.searchParams);
        const facets = publicPcFacetsForApi(url.searchParams);
        const payload = { ...result, available_facets: facets.available_facets };
        return json(200, { status: "success", ...payload, data: payload });
      } catch (error) {
        return json(400, { status: "error", error: error instanceof Error ? error.message : String(error) });
      }
    }
    if (request.method === "GET" && url.pathname === "/api/pc/products") {
      try {
        return await servePcProducts(url, env);
      } catch (error) {
        return json(400, { status: "error", error: error instanceof Error ? error.message : String(error) });
      }
    }
    if (request.method === "GET" && url.pathname === "/api/pc/listings") {
      try {
        if (hasD1(env)) return await fetchThroughD1ListingCache(request, env,
          (listingRequest) => browsePcListingsD1(listingRequest, env));
        if (searchRunnerIsConfigured(env)) return await proxyToSearchRunner(request, env, url.pathname);
        return json(503, { status: "error", error: "Stored PC listings are unavailable" });
      } catch (error) {
        console.error("D1 PC listing browse failed", error);
        if (searchRunnerIsConfigured(env)) return proxyToSearchRunner(request, env, url.pathname);
        return json(503, { status: "error", error: "Stored PC listings are temporarily unavailable" });
      }
    }

    if (request.method === "GET" && url.pathname === "/api/search-only/sources") {
      return json(200, {
        status: "success",
        data: {
          sources: operationalSearchOnlyCatalog(),
          mode: "search_only",
          note: "Only approved and enabled sources are callable."
        }
      });
    }

    if (searchRunnerIsConfigured(env) && request.method === "POST" && url.pathname === "/api/search") {
      try {
        const searchBody = await readJsonPayload(request.clone());
        const operationalSites = normalizeOperationalTargetSites(searchBody?.sites);
        if (operationalSites.length === 0) {
          return json(400, { ok: false, error: "No approved source was requested" });
        }
        const headers = new Headers(request.headers);
        headers.set("content-type", "application/json");
        const operationalRequest = new Request(request, {
          body: JSON.stringify({ ...(searchBody || {}), sites: operationalSites }),
          headers
        });
        return proxyToSearchRunner(operationalRequest, env, url.pathname);
      } catch (error) {
        return json(error instanceof PayloadTooLargeError ? 413 : 400, {
          ok: false,
          error: error instanceof PayloadTooLargeError ? "Request payload is too large" : "Invalid search request"
        });
      }
    }

    if (searchRunnerIsConfigured(env) && request.method === "POST" && url.pathname === "/api/search-only") {
      try {
        const searchBody = await readJsonPayload(request.clone());
        const sourceKey = typeof searchBody?.source === "string" ? searchBody.source.trim() : "";
        if (!operationalSearchOnlySource(sourceKey)) {
          return json(400, { status: "error", error: `source is not approved for live collection: ${sourceKey || "unknown"}` });
        }
        return proxyToSearchRunner(request, env, url.pathname);
      } catch (error) {
        return json(error instanceof PayloadTooLargeError ? 413 : 400, {
          status: "error",
          error: error instanceof PayloadTooLargeError ? "Request payload is too large" : "Invalid search-only request"
        });
      }
    }

    if (searchRunnerIsConfigured(env)
      && request.method === "GET"
      && url.pathname.startsWith("/api/search/refresh/")) {
      return proxyToSearchRunner(request, env, url.pathname);
    }

    if (request.method === "GET" && url.pathname === "/api/index/status" && searchRunnerIsConfigured(env)) {
      if (!await manualTokenIsValid(request, env)) {
        return json(401, { ok: false, error: "Unauthorized" });
      }
      return proxyToSearchRunner(request, env, url.pathname);
    }

    if (request.method === "GET" && url.pathname === "/api/runner/status" && nodeRunnerIsConfigured(env)) {
      if (!await manualTokenIsValid(request, env)) return json(401, { ok: false, error: "Unauthorized" });
      return proxyToRunnerStatus(request, env);
    }

    if (request.method === "POST" && url.pathname === "/api/search" && hasD1(env)) {
      try {
        const searchBody = await readJsonPayload(request.clone());
        const operationalSites = normalizeOperationalTargetSites(searchBody.sites);
        if (operationalSites.length === 0) return json(400, { ok: false, error: "No approved source was requested" });
        const operationalRequest = new Request(request, {
          body: JSON.stringify({ ...searchBody, sites: operationalSites }),
          headers: new Headers({ ...Object.fromEntries(request.headers), "content-type": "application/json" })
        });
        return await fetchThroughLiveSearchCache(operationalRequest, env, (fallbackRequest) => searchD1(fallbackRequest, env));
      } catch (error) {
        console.error("D1 search failed", error);
        return json(503, {
          ok: false,
          error: "Free-tier stored search is temporarily unavailable",
          detail: error instanceof Error ? error.message : String(error)
        });
      }
    }

    if (request.method === "GET" && url.pathname === "/api/categories") {
      return serveCategoryCatalog();
    }

    if (request.method === "GET" || request.method === "HEAD") {
      if (url.pathname === "/used-market-categories.html") {
        return new Response(null, { status: 301, headers: { location: "/categories" } });
      }
      if (url.pathname === "/iphone-used-items.html") {
        return json(410, { status: "error", error: "This legacy category is no longer provided", replacement: "/" });
      }
      const categoryRoute = url.pathname.match(/^\/categories\/([a-z-]+)$/u);
      if (categoryRoute) {
        if (!["cpu", "gpu", "ram", "motherboard", "ssd", "hdd", "psu"].includes(categoryRoute[1])) {
          return json(410, { status: "error", error: "Unsupported category route" });
        }
        const assetResponse = await serveAssets(new Request(new URL("/", request.url), request), env);
        if (assetResponse) return assetResponse;
      }
      if (url.pathname === "/categories") {
        const assetResponse = await serveAssets(new Request(new URL("/used-market-categories", request.url), request), env);
        if (assetResponse) return assetResponse;
      }
    }

    if (request.method === "POST" && url.pathname === "/admin/import-product-stats") {
      if (!await manualTokenIsValid(request, env)) {
        return json(401, { ok: false, error: "Unauthorized" });
      }
      if (!hasD1(env)) return json(503, { ok: false, error: "D1 is not configured" });
      let body;
      try {
        body = await readJsonPayload(request, MAX_STATS_PUBLICATION_BYTES);
      } catch (error) {
        return json(error instanceof PayloadTooLargeError ? 413 : 400, {
          ok: false,
          error: error instanceof PayloadTooLargeError ? "Payload too large" : "Invalid JSON body"
        });
      }
      try {
        const publication = await publishProductStats(env.DB, body || {});
        return json(200, { ok: true, publication });
      } catch (error) {
        return json(400, { ok: false, error: error instanceof Error ? error.message : String(error) });
      }
    }

    if (request.method === "POST" && url.pathname === "/admin/import-listings") {
      if (!await manualTokenIsValid(request, env)) {
        return json(401, { ok: false, error: "Unauthorized" });
      }
      let parsedBody;
      try {
        parsedBody = await readJsonPayload(request);
      } catch (error) {
        return json(error instanceof PayloadTooLargeError ? 413 : 400, {
          ok: false,
          error: error instanceof PayloadTooLargeError ? "Payload too large" : "Invalid JSON body"
        });
      }
      const values = Array.isArray(parsedBody)
        ? parsedBody
        : parsedBody && Array.isArray(parsedBody.items)
          ? parsedBody.items
          : null;
      if (!values) return json(400, { ok: false, error: "items array is required" });
      try {
        const result = await importListings(env, values,
          parsedBody && !Array.isArray(parsedBody) ? parsedBody.collection_manifest : null);
        return json(200, { ok: true, ...result });
      } catch (error) {
        if (!(error instanceof CollectionManifestConflictError) && !(error instanceof TypeError)) {
          console.error("Listing import failed", error);
        }
        return json(error instanceof CollectionManifestConflictError ? 409 : error instanceof TypeError ? 400 : 500, {
          ok: false,
          error: error instanceof Error ? error.message : String(error)
        });
      }
    }

    if ((request.method === "GET" || request.method === "HEAD") && !url.pathname.startsWith("/api/") && url.pathname !== "/run") {
      const assetResponse = await serveAssets(request, env);
      if (assetResponse) return assetResponse;
    }

    if (request.method === "POST" && url.pathname === "/run") {
      if (!await manualTokenIsValid(request, env)) {
        return json(401, { ok: false, error: "Unauthorized" });
      }

      let parsedBody;
      try {
        parsedBody = await readJsonPayload(request);
      } catch (error) {
        return json(error instanceof PayloadTooLargeError ? 413 : 400, {
          ok: false,
          error: error instanceof PayloadTooLargeError ? 'Payload too large' : 'Invalid JSON body'
        });
      }
      const body = parsedBody && typeof parsedBody === "object" && !Array.isArray(parsedBody)
        ? parsedBody
        : {};
      const jobNames = Array.isArray(body.job_names)
        ? body.job_names.filter((value) => typeof value === "string").map((value) => value.trim()).filter(Boolean)
        : typeof body.job_name === "string" && body.job_name.trim()
          ? [body.job_name.trim()]
          : [];
      if (jobNames.length === 0) {
        return json(400, { ok: false, error: "job_name or job_names is required" });
      }

      if (isFreeTierEnabled(env) && hasD1(env) && env.BROWSER && env.COLLECTION_QUEUE?.sendBatch) {
        const freeTierJobNames = jobNames.filter((jobName) => Boolean(freeCollectionPlan(jobName)));
        if (freeTierJobNames.length === 0) {
          return json(400, { ok: false, error: "No supported free-tier collection job was requested" });
        }
        await env.COLLECTION_QUEUE.sendBatch(freeTierJobNames.map((jobName) => ({
          body: {
            job_name: jobName,
            trigger: "manual-free-tier-queue",
            requested_at: new Date().toISOString()
          }
        })));
        return json(202, {
          ok: true,
          mode: "free-tier-queue",
          queued_job_names: freeTierJobNames
        });
      }

      const idempotencyKey = getIdempotencyKey(request, body, "manual", jobNames);
      try {
        const result = await triggerNodeRunner(env, {
          job_names: jobNames,
          trigger: "manual",
          requested_at: new Date().toISOString(),
          idempotency_key: idempotencyKey
        }, idempotencyKey);
        return json(result.ok ? 200 : 502, { ok: result.ok, trigger: result });
      } catch (error) {
        return json(502, { ok: false, error: error instanceof Error ? error.message : String(error) });
      }
    }

    try {
      return await fetchThroughFreeCache(request, env, (cachedRequest) => proxyToOrigin(cachedRequest, env));
    } catch (error) {
      console.error("Origin proxy failed", error);
      return json(502, { ok: false, error: "Origin server is unavailable" });
    }
  },

  async scheduled(controller, env, ctx) {
    await purgeRetiredD1Listings(env);
    if (hasD1(env)) await purgeMonetizationMetrics(env.DB);
    const jobNames = scheduledJobNames(controller);
    if (!jobNames) {
      console.error(`No job mapping for Cloudflare cron: ${controller.cron}`);
      throw new Error(`No job mapping for Cloudflare cron: ${controller.cron}`);
    }
    if (String(env.AWS_PC_SCHEDULER_AUTHORITY || "false").toLowerCase() === "true") {
      const publicationJobs = jobNames.filter((jobName) => jobName === "daily-price-refresh");
      if (publicationJobs.length > 0) {
        const idempotencyKey = getIdempotencyKey(new Request("https://worker.example.test"), {
          cron: controller.cron
        }, "cloudflare-publication-cron", publicationJobs, controller.scheduledTime);
        ctx.waitUntil(triggerNodeRunner(env, {
          job_names: publicationJobs,
          trigger: "cloudflare-publication-cron",
          cron: controller.cron,
          scheduled_time: new Date(controller.scheduledTime).toISOString(),
          idempotency_key: idempotencyKey
        }, idempotencyKey).then((result) => {
          if (!result.ok) throw new Error(`Node runner returned HTTP ${result.status}: ${result.body}`);
          return result;
        }));
        return;
      }
      const watchdog = await proxyToRunnerStatus(new Request("https://worker.internal/api/runner/status"), env);
      if (!watchdog.ok) throw new Error(`AWS PC scheduler watchdog failed with HTTP ${watchdog.status}`);
      const watchdogPayload = await watchdog.clone().json().catch(() => null);
      if (watchdogPayload?.data?.pc_parts?.ledger_ready !== true
        || watchdogPayload?.data?.pc_parts?.scheduler_enabled !== true
        || watchdogPayload?.data?.pc_parts?.publication_configured !== true
        || !watchdogPayload?.data?.pc_parts?.last_succeeded_at
        || Date.now() - Date.parse(watchdogPayload.data.pc_parts.last_succeeded_at) > 2 * 60 * 60 * 1000
        || watchdogPayload?.data?.pc_parts?.last_error) {
        throw new Error("AWS PC scheduler watchdog reported not ready");
      }
      return;
    }

    if (isFreeTierEnabled(env) && hasD1(env) && env.BROWSER && env.COLLECTION_QUEUE?.sendBatch) {
      const messages = jobNames
        .filter((jobName) => Boolean(freeCollectionPlan(jobName)))
        .map((jobName) => ({
          body: {
            job_name: jobName,
            trigger: "cloudflare-free-tier-cron",
            scheduled_time: new Date(controller.scheduledTime).toISOString()
          }
        }));
      if (messages.length > 0) {
        await env.COLLECTION_QUEUE.sendBatch(messages);
      }
      return;
    }

    const idempotencyKey = getIdempotencyKey(new Request("https://worker.example.test"), {
      cron: controller.cron
    }, "cloudflare-cron", jobNames, controller.scheduledTime);
    ctx.waitUntil(triggerNodeRunner(env, {
      job_names: jobNames,
      trigger: "cloudflare-cron",
      cron: controller.cron,
      scheduled_time: new Date(controller.scheduledTime).toISOString(),
      idempotency_key: idempotencyKey
    }, idempotencyKey).then((result) => {
      if (!result.ok) {
        throw new Error(`Node runner returned HTTP ${result.status}: ${result.body}`);
      }
      return result;
    }));
  },

  async queue(batch, env) {
    if (!isFreeTierEnabled(env) || !hasD1(env) || !env.BROWSER) {
      throw new Error("Free-tier queue requires FREE_TIER_MODE, DB, and BROWSER bindings");
    }
    await handleFreeCollectionQueue(batch, env);
  }
};
