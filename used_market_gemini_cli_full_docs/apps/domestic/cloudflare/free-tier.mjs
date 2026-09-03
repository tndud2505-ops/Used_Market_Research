import { hasOfficialCategory } from "./category-source-map.mjs";
import { selectQualifiedItems } from "./live-search.mjs";
import { pcCollectionTargetSetV2 } from "./pc-directory-http.mjs";
import { PC_SOURCE_REGISTRY } from "../collector/logic/pc-source-registry.mjs";
import { OPERATIONAL_PC_DIRECTORY_SITES, OPERATIONAL_TARGET_SITES } from "./target-sites.mjs";
import {
  decodePcListingsCursor,
  encodePcListingsCursor,
  parsePcListingsRequest,
  pcListingsFreshness
} from "./pc-listings-contract.mjs";

export const FREE_TIER_POLICY = Object.freeze({
  browserMinutesPerDay: 10,
  queueOperationsPerDay: 10_000,
  d1RowsWrittenPerDay: 100_000,
  searchCacheTtlSeconds: 21_600,
  staticCacheTtlSeconds: 86_400,
  maxSearchLimit: 60
});

const D1_LISTING_CACHE_TTL_SECONDS = 60;

const CACHEABLE_GET_PATHS = new Set([
  "/api/categories",
  "/api/pc/catalog",
  "/api/pc/products",
  "/api/search-only/sources",
  "/api/market/history",
  "/api/merged/latest",
  "/api/market/latest",
  "/api/market/by-gpu",
  "/api/opportunities/latest",
  "/api/collector/latest"
]);

const PC_COLLECTION_TARGETS = Object.freeze(pcCollectionTargetSetV2().targets);
const PC_HOURLY_COLLECTION_TARGETS = Object.freeze(PC_COLLECTION_TARGETS.filter((target) => (
  target.enabled !== false && target.cadenceClass === "HOURLY_CATEGORY"
)));
const PC_HOURLY_CATEGORY_CODES = Object.freeze([...new Set(
  PC_HOURLY_COLLECTION_TARGETS.map((target) => target.categoryCode).filter(Boolean)
)]);
const PC_CANONICAL_CATEGORY_BY_ID = new Map(PC_COLLECTION_TARGETS
  .filter((target) => target.canonicalProductId && target.categoryCode)
  .map((target) => [target.canonicalProductId, target.categoryCode]));
const PC_DIRECTORY_SOURCE_BY_ID = new Map(PC_SOURCE_REGISTRY
  .filter((source) => source.directory_source === true
    && source.policy_status === "APPROVED" && source.runtime_status === "ENABLED")
  .map((source) => [source.key, source]));
const PC_FRESHNESS_RUNTIME_BINDING_LIMIT = 40;

function requestedPcFreshnessScopes(query) {
  const sourceIds = (query.sites.length > 0 ? query.sites : OPERATIONAL_PC_DIRECTORY_SITES)
    .filter((sourceId) => {
      const source = PC_DIRECTORY_SOURCE_BY_ID.get(sourceId);
      if (!source) return false;
      const marketPools = Array.isArray(source.market_pools) ? source.market_pools : [source.market_pool];
      if (query.marketPool && !marketPools.includes(query.marketPool)) return false;
      if (query.currency === "USD" && !marketPools.includes("OVERSEAS_USED")) return false;
      if (query.currency === "KRW" && !marketPools.some((marketPool) => String(marketPool).startsWith("KR_"))) return false;
      return true;
    });
  const categoryCodes = query.canonicalProductId
    ? [PC_CANONICAL_CATEGORY_BY_ID.get(query.canonicalProductId) || ""]
    : query.boardManufacturer
      ? ["GPU"]
      : PC_HOURLY_CATEGORY_CODES;
  return sourceIds.flatMap((sourceId) => categoryCodes.map((categoryCode) => `${sourceId}:${categoryCode}`));
}

function requiredPcFreshnessTargets(cohortScopes) {
  const pairs = new Map();
  let unresolvedScopeCount = 0;
  for (const scope of cohortScopes) {
    const separator = scope.indexOf(":");
    const sourceId = separator >= 0 ? scope.slice(0, separator) : "";
    const categoryCode = separator >= 0 ? scope.slice(separator + 1) : "";
    const targets = PC_HOURLY_COLLECTION_TARGETS.filter((target) => (
      target.categoryCode === categoryCode
      && Array.isArray(target.sourceKeys)
      && target.sourceKeys.includes(sourceId)
    ));
    if (!sourceId || !categoryCode || targets.length === 0) {
      unresolvedScopeCount += 1;
      continue;
    }
    for (const target of targets) {
      pairs.set(`${sourceId}\u0000${target.targetId}`, { sourceId, targetId: target.targetId });
    }
  }
  return { pairs: [...pairs.values()], unresolvedScopeCount };
}

async function pcListingCollectionFreshness(db, cohortScopes, asOf) {
  const required = requiredPcFreshnessTargets(cohortScopes);
  const latestByTarget = new Map();
  try {
    for (let offset = 0; offset < required.pairs.length; offset += PC_FRESHNESS_RUNTIME_BINDING_LIMIT) {
      const chunk = required.pairs.slice(offset, offset + PC_FRESHNESS_RUNTIME_BINDING_LIMIT);
      const pairConditions = chunk.map(() => "(source_id = ? AND target_id = ?)").join(" OR ");
      const bindings = [asOf, asOf, ...chunk.flatMap((pair) => [pair.sourceId, pair.targetId])];
      const result = await db.prepare(`SELECT source_id, target_id, MAX(last_succeeded_at) AS last_succeeded_at
        FROM pc_listing_collection_target_runtime
        WHERE last_succeeded_at <= ? AND mirrored_at <= ? AND (${pairConditions})
        GROUP BY source_id, target_id`).bind(...bindings).all();
      for (const row of asArray(result.results)) {
        if (typeof row.last_succeeded_at === "string" && Number.isFinite(Date.parse(row.last_succeeded_at))) {
          latestByTarget.set(`${row.source_id}\u0000${row.target_id}`, row.last_succeeded_at);
        }
      }
    }
  } catch (error) {
    if (!/pc_listing_collection_target_runtime|no such table/iu.test(error instanceof Error ? error.message : String(error))) throw error;
  }
  const coveredTimes = required.pairs.map((pair) => latestByTarget.get(`${pair.sourceId}\u0000${pair.targetId}`))
    .filter((value) => typeof value === "string" && Number.isFinite(Date.parse(value)));
  const complete = required.unresolvedScopeCount === 0
    && required.pairs.length > 0
    && coveredTimes.length === required.pairs.length;
  const lastCollectedAt = complete
    ? coveredTimes.sort((left, right) => Date.parse(left) - Date.parse(right))[0]
    : null;
  return {
    lastCollectedAt,
    requiredTargetCount: required.pairs.length + required.unresolvedScopeCount,
    coveredTargetCount: coveredTimes.length,
    complete
  };
}

function pcListingItem(row) {
  const chipManufacturer = String(row.canonical_product_id || "").match(/^gpu:(nvidia|amd|intel):/u)?.[1];
  return {
    id: row.item_id,
    item_id: row.item_id,
    site: row.site,
    category_id: row.category_id,
    title: row.title,
    price: typeof row.price_value === "number" ? row.price_value : null,
    currency: row.currency || "KRW",
    url: row.url,
    image_url: row.image_url || null,
    posted_at: row.posted_at || null,
    updated_at: row.updated_at,
    canonical_product_id: row.canonical_product_id || null,
    canonical_display_name: row.canonical_display_name || null,
    canonical_manufacturer: row.canonical_manufacturer || null,
    chip_manufacturer: chipManufacturer ? ({ nvidia: "NVIDIA", amd: "AMD", intel: "Intel" })[chipManufacturer] : null,
    board_manufacturer: row.pc_category_code === "GPU" ? row.board_manufacturer || null : null,
    listing_kind: row.listing_kind || "UNKNOWN",
    category_code: row.pc_category_code || null,
    market_segment: row.market_segment || "UNKNOWN",
    listing_type: row.listing_type || "UNKNOWN",
    condition_group: row.condition_group || "UNKNOWN",
    spec_group_id: row.spec_group_id || null,
    classification_confidence: Number(row.classification_confidence || 0),
    model_confidence: Number(row.model_confidence || 0),
    quantity_confidence: Number(row.quantity_confidence || 0),
    price_scope_confidence: Number(row.price_scope_confidence || 0),
    statistics_eligible: row.statistics_eligible === 1,
    statistics_exclusion_reasons: parseJson(row.statistics_exclusion_reasons_json, []),
    quantity: Number.isInteger(row.quantity) ? row.quantity : null,
    price_scope: row.price_scope || "UNKNOWN",
    condition_code: row.condition_code || "UNKNOWN",
    lifecycle_status: row.lifecycle_status || "ACTIVE",
    market_pool: row.market_pool || null,
    confidence: parseJson(row.confidence_json, {}),
    evidence: parseJson(row.evidence_json, {}),
    price_eligible: row.price_eligible === 1,
    exclusion_reasons: parseJson(row.exclusion_reasons_json, []),
    good_listing_eligible: row.good_listing_eligible === 1,
    reference_price: typeof row.reference_price === "number" ? row.reference_price : null
  };
}

export async function browsePcListingsD1(request, env) {
  if (!hasD1(env)) return new Response(JSON.stringify({ status: "error", error: "D1 is unavailable" }), {
    status: 503,
    headers: { "content-type": "application/json; charset=utf-8" }
  });
  let query;
  let cursorState;
  try {
    query = parsePcListingsRequest(request, { allowedSites: OPERATIONAL_PC_DIRECTORY_SITES });
    cursorState = decodePcListingsCursor(query, env.SEARCH_CURSOR_SECRET || env.RUNNER_TOKEN || "used-market-local-cursor-v2");
  } catch (error) {
    return new Response(JSON.stringify({ status: "error", error: error instanceof Error ? error.message : String(error) }), {
      status: 400,
      headers: { "content-type": "application/json; charset=utf-8" }
    });
  }
  const asOf = cursorState?.asOf || new Date().toISOString();
  const conditions = [
    "active = 1",
    "lifecycle_status = 'ACTIVE'",
    "canonical_product_id IS NOT NULL",
    "pc_category_code IN ('CPU', 'GPU', 'RAM', 'MOTHERBOARD', 'SSD', 'HDD', 'PSU')",
    "price_value IS NOT NULL",
    "price_value > 0",
    "listing_kind IN ('SINGLE_COMPONENT', 'SAME_PRODUCT_LOT')",
    "price_eligible = 1",
    "condition_code = 'USED_WORKING'",
    "quantity IS NOT NULL",
    "quantity >= 1",
    "price_scope IN ('TOTAL', 'UNIT')",
    "((market_pool IN ('KR_C2C_USED', 'KR_DEALER_USED', 'KR_REFURB_RETAIL') AND currency = 'KRW') OR (market_pool = 'OVERSEAS_USED' AND currency = 'USD'))",
    "updated_at <= ?"
  ];
  const bindings = [asOf];
  if (query.canonicalProductId) {
    conditions.push("canonical_product_id = ?");
    bindings.push(query.canonicalProductId);
  }
  if (query.manufacturer) {
    conditions.push("(canonical_manufacturer = ? OR board_manufacturer = ?)");
    bindings.push(query.manufacturer, query.manufacturer);
  }
  if (query.boardManufacturer) {
    conditions.push("pc_category_code = 'GPU'");
    conditions.push("board_manufacturer = ?");
    bindings.push(query.boardManufacturer);
  }
  if (query.sites.length > 0) {
    conditions.push(`site IN (${query.sites.map(() => "?").join(", ")})`);
    bindings.push(...query.sites);
  }
  if (query.minPrice !== null) {
    conditions.push("price_value >= ?");
    bindings.push(query.minPrice);
  }
  if (query.maxPrice !== null) {
    conditions.push("price_value <= ?");
    bindings.push(query.maxPrice);
  }
  if (query.marketPool) {
    conditions.push("market_pool = ?");
    bindings.push(query.marketPool);
  }
  if (query.currency) {
    conditions.push("currency = ?");
    bindings.push(query.currency);
  }
  const whereClause = conditions.join(" AND ");
  const broadRecentBrowse = query.sort === "recent"
    && !query.canonicalProductId && !query.manufacturer && !query.boardManufacturer
    && query.minPrice === null && query.maxPrice === null && !query.marketPool && !query.currency;
  const publicIndexHint = broadRecentBrowse
    ? (query.sites.length > 0 ? " INDEXED BY idx_listings_pc_public_site_recent" : " INDEXED BY idx_listings_pc_public_recent")
    : "";
  const orderBy = query.sort === "price_asc"
    ? "price_value ASC, updated_at DESC, item_id ASC"
    : query.sort === "price_desc"
      ? "price_value DESC, updated_at DESC, item_id ASC"
      : "updated_at DESC, item_id ASC";
  const selectListings = (boardManufacturerColumn, selectedWhere, selectedBindings, suffix = "", indexHint = "") => env.DB.prepare(`SELECT item_id, site, category_id, title, price_value, currency, url,
      image_url, posted_at, updated_at, canonical_product_id, canonical_display_name, canonical_manufacturer,
      ${boardManufacturerColumn}, listing_kind, pc_category_code, quantity, price_scope, condition_code, lifecycle_status, market_pool,
      confidence_json, evidence_json, price_eligible, exclusion_reasons_json, good_listing_eligible, reference_price
    FROM listings${indexHint} WHERE ${selectedWhere} ${suffix}`).bind(...selectedBindings).all();
  const executeListingSelect = async (selectedWhere, selectedBindings, suffix = "", indexHint = "") => {
    try {
      return await selectListings("board_manufacturer", selectedWhere, selectedBindings, suffix, indexHint);
    } catch (error) {
      const missingBoardManufacturer = /board_manufacturer/iu.test(error instanceof Error ? error.message : String(error));
      if (!missingBoardManufacturer || query.manufacturer || query.boardManufacturer) throw error;
      return selectListings("NULL AS board_manufacturer", selectedWhere, selectedBindings, suffix, indexHint);
    }
  };
  const cursorExpired = () => new Response(JSON.stringify({ status: "error", error: "CURSOR_EXPIRED: listing snapshot changed" }), {
    status: 410,
    headers: { "content-type": "application/json; charset=utf-8" }
  });
  let page;
  let total;
  let latestObservedAt;
  let hasMoreCandidates;
  // Authoritative reconciliation and incremental imports publish one eligible row per stable item_id,
  // so normal and audit reads can share bounded raw keyset pagination without request-time deduplication.
  let anchor = null;
  if (cursorState?.after?.item_id) {
    anchor = await env.DB.prepare(`SELECT item_id, price_value, updated_at
      FROM listings WHERE item_id = ? AND ${whereClause} LIMIT 1`)
      .bind(cursorState.after.item_id, ...bindings).first();
    if (!anchor) return cursorExpired();
  }
  const pageConditions = [...conditions];
  const pageBindings = [...bindings];
  if (anchor && query.sort === "recent") {
    pageConditions.push("(updated_at < ? OR (updated_at = ? AND item_id > ?))");
    pageBindings.push(anchor.updated_at, anchor.updated_at, anchor.item_id);
  } else if (anchor) {
    const priceOperator = query.sort === "price_desc" ? "<" : ">";
    pageConditions.push(`(price_value ${priceOperator} ? OR (price_value = ?
      AND (updated_at < ? OR (updated_at = ? AND item_id > ?))))`);
    pageBindings.push(anchor.price_value, anchor.price_value, anchor.updated_at, anchor.updated_at, anchor.item_id);
  }
  const candidateLimit = query.limit + 1;
  const result = await executeListingSelect(pageConditions.join(" AND "), [...pageBindings, candidateLimit],
    `ORDER BY ${orderBy} LIMIT ?`, publicIndexHint);
  const rawRows = asArray(result.results);
  page = rawRows.slice(0, query.limit);
  let runtimeFreshness;
  if (cursorState?.summary) {
    total = cursorState.summary.total;
    latestObservedAt = cursorState.summary.latestObservedAt;
    runtimeFreshness = {
      lastCollectedAt: cursorState.summary.lastCollectedAt,
      requiredTargetCount: cursorState.summary.requiredTargetCount,
      coveredTargetCount: cursorState.summary.coveredTargetCount,
      complete: cursorState.summary.requiredTargetCount > 0
        && cursorState.summary.requiredTargetCount === cursorState.summary.coveredTargetCount
    };
  } else {
    const summary = await env.DB.prepare(`SELECT COUNT(*) AS total, MAX(updated_at) AS latest_observed_at
      FROM listings${publicIndexHint} WHERE ${whereClause}`).bind(...bindings).first();
    total = Number(summary?.total || 0);
    latestObservedAt = summary?.latest_observed_at || null;
    runtimeFreshness = await pcListingCollectionFreshness(env.DB, requestedPcFreshnessScopes(query), asOf);
  }
  const runtimeCollectedAt = runtimeFreshness.lastCollectedAt;
  const freshnessBasis = runtimeCollectedAt
    ? "SOURCE_TARGET_COLLECTION_MANIFEST"
    : runtimeFreshness.requiredTargetCount > 0
      ? "SOURCE_TARGET_COLLECTION_MANIFEST_INCOMPLETE"
      : "NO_MATCHING_LISTINGS";
  hasMoreCandidates = rawRows.length > query.limit;
  const nextAfter = hasMoreCandidates && page.length > 0 ? { item_id: page.at(-1).item_id } : null;
  const nextCursor = nextAfter ? encodePcListingsCursor(query, {
    asOf,
    after: nextAfter,
    summary: {
      total,
      latestObservedAt,
      lastCollectedAt: runtimeCollectedAt,
      requiredTargetCount: runtimeFreshness.requiredTargetCount,
      coveredTargetCount: runtimeFreshness.coveredTargetCount
    }
  },
    env.SEARCH_CURSOR_SECRET || env.RUNNER_TOKEN || "used-market-local-cursor-v2") : null;
  return new Response(JSON.stringify({
    status: "success",
    data: {
      items: page.map(pcListingItem),
      total,
      pagination: { has_more: Boolean(nextCursor), next_cursor: nextCursor },
      as_of: asOf,
      freshness: {
        ...pcListingsFreshness(asOf, runtimeCollectedAt),
        basis: freshnessBasis,
        last_listing_updated_at: latestObservedAt,
        coverage_state: runtimeFreshness.complete ? "COMPLETE" : "INCOMPLETE",
        required_target_count: runtimeFreshness.requiredTargetCount,
        covered_target_count: runtimeFreshness.coveredTargetCount
      },
      filters: {
        canonical_product_id: query.canonicalProductId || null,
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
  }), {
    status: 200,
    headers: {
      "content-type": "application/json; charset=utf-8",
        "cache-control": `public, max-age=${readPositiveInteger(
          env.D1_LISTING_CACHE_TTL_SECONDS,
          D1_LISTING_CACHE_TTL_SECONDS,
          300
        )}`,
        "x-free-tier-data-source": "d1"
    }
  });
}

const CACHEABLE_POST_PATHS = new Set([
  "/api/search",
  "/api/search-only"
]);

function parseJson(value, fallback) {
  try {
    const parsed = JSON.parse(String(value ?? ""));
    return parsed ?? fallback;
  } catch {
    return fallback;
  }
}

function readPositiveInteger(value, fallback, maximum) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 1) return fallback;
  return Math.min(Math.floor(parsed), maximum);
}

export function isFreeTierEnabled(env) {
  return String(env.FREE_TIER_MODE ?? "true").toLowerCase() !== "false";
}

export function freeTierConfig(env) {
  return {
    enabled: isFreeTierEnabled(env),
    search_cache_ttl_seconds: readPositiveInteger(
      env.FREE_TIER_SEARCH_CACHE_TTL_SECONDS,
      FREE_TIER_POLICY.searchCacheTtlSeconds,
      86_400
    ),
    static_cache_ttl_seconds: readPositiveInteger(
      env.FREE_TIER_STATIC_CACHE_TTL_SECONDS,
      FREE_TIER_POLICY.staticCacheTtlSeconds,
      604_800
    ),
    max_search_limit: readPositiveInteger(
      env.FREE_TIER_MAX_SEARCH_LIMIT,
      FREE_TIER_POLICY.maxSearchLimit,
      FREE_TIER_POLICY.maxSearchLimit
    )
  };
}

export function isCacheableRequest(request, url) {
  if (request.method === "GET" || request.method === "HEAD") {
    return url.pathname === "/" || !url.pathname.startsWith("/api/") || CACHEABLE_GET_PATHS.has(url.pathname);
  }
  return request.method === "POST" && CACHEABLE_POST_PATHS.has(url.pathname);
}

async function sha256Hex(value) {
  const digest = await crypto.subtle.digest("SHA-256", value);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function buildCacheKey(request, url) {
  let suffix = "";
  if (request.method === "POST") {
    const body = await request.clone().arrayBuffer();
    if (body.byteLength > 262_144) return null;
    suffix = `:body=${await sha256Hex(body)}`;
  }
  return new Request(`https://used-market-free-cache-v4.invalid${url.pathname}${url.search}${suffix}`, {
    method: "GET"
  });
}

function responseWithHeader(response, name, value) {
  const headers = new Headers(response.headers);
  headers.set(name, value);
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers
  });
}

function responseForCache(response, ttlSeconds) {
  const headers = new Headers(response.headers);
  headers.set("cache-control", `public, max-age=${ttlSeconds}`);
  headers.delete("set-cookie");
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers
  });
}

export async function fetchThroughFreeCache(request, env, originFetch) {
  const url = new URL(request.url);
  const config = freeTierConfig(env);
  if (!config.enabled || !isCacheableRequest(request, url) || !globalThis.caches?.default) {
    return originFetch(request);
  }

  const cacheKey = await buildCacheKey(request, url);
  if (!cacheKey) return originFetch(request);

  const cached = await globalThis.caches.default.match(cacheKey);
  if (cached) return responseWithHeader(cached, "x-free-tier-cache", "HIT");

  const response = await originFetch(request);
  if (response.status < 200 || response.status >= 300) return response;
  if (!(await shouldCacheResponse(response))) return response;

  const ttlSeconds = request.method === "POST"
    ? config.search_cache_ttl_seconds
    : config.static_cache_ttl_seconds;
  await globalThis.caches.default.put(cacheKey, responseForCache(response.clone(), ttlSeconds));
  return responseWithHeader(response, "x-free-tier-cache", "MISS");
}

export async function fetchThroughD1ListingCache(request, env, originFetch) {
  const url = new URL(request.url);
  if (request.method !== "GET" || url.pathname !== "/api/pc/listings"
    || url.searchParams.has("reconciliation_audit") || !globalThis.caches?.default) {
    return originFetch(request);
  }
  const cacheKey = await buildCacheKey(request, url);
  if (!cacheKey) return originFetch(request);
  const cached = await globalThis.caches.default.match(cacheKey);
  if (cached) return responseWithHeader(cached, "x-d1-listing-cache", "HIT");

  const response = await originFetch(request);
  if (response.status < 200 || response.status >= 300
    || response.headers.get("x-free-tier-data-source") !== "d1") {
    return response;
  }
  await globalThis.caches.default.put(cacheKey, response.clone());
  return responseWithHeader(response, "x-d1-listing-cache", "MISS");
}

async function shouldCacheResponse(response) {
  if (response.headers.get("x-free-tier-data-source") !== "d1") return true;
  try {
    const payload = await response.clone().json();
    return Array.isArray(payload?.data?.items) && payload.data.items.length > 0;
  } catch {
    return true;
  }
}

export function hasD1(env) {
  return Boolean(env.DB && typeof env.DB.prepare === "function");
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function normalizeString(value) {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeStringList(value, allowed) {
  return [...new Set(asArray(value).map(normalizeString).filter((item) => allowed.has(item)))];
}

function median(values) {
  const sorted = values.filter((value) => Number.isFinite(value)).sort((a, b) => a - b);
  if (sorted.length === 0) return null;
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? Math.round((sorted[middle - 1] + sorted[middle]) / 2) : sorted[middle];
}

function sourceName(site) {
  return {
    joonggonara: "중고나라",
    bunjang: "번개장터",
    ebay: "eBay",
    hellomarket: "Hello Market",
    rethinkmall: "RethinkMall"
  }[site] ?? site;
}

export async function searchD1(request, env) {
  let body;
  try {
    body = await request.clone().json();
  } catch {
    return new Response(JSON.stringify({ status: "error", error: "Request body must be valid JSON" }), {
      status: 400,
      headers: { "content-type": "application/json; charset=utf-8" }
    });
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return new Response(JSON.stringify({ status: "error", error: "Request body must be a JSON object" }), {
      status: 400,
      headers: { "content-type": "application/json; charset=utf-8" }
    });
  }
  const config = freeTierConfig(env);
  const keyword = normalizeString(body?.keyword);
  const categoryIds = [...new Set([
    ...asArray(body?.category_ids).map(normalizeString),
    normalizeString(body?.category_id)
  ].filter((value) => value && value !== "all"))];
  const allowedSites = new Set(OPERATIONAL_TARGET_SITES);
  const hasExplicitSites = Array.isArray(body?.sites);
  const sites = normalizeStringList(hasExplicitSites ? body.sites : OPERATIONAL_TARGET_SITES, allowedSites);
  if (hasExplicitSites && sites.length === 0) {
    return new Response(JSON.stringify({ status: "error", error: "at least one target site is required" }), {
      status: 400,
      headers: { "content-type": "application/json; charset=utf-8" }
    });
  }
  const categorySites = categoryIds.length && !keyword
    ? sites.filter((site) => categoryIds.every((categoryId) => hasOfficialCategory(site, categoryId)))
    : sites;
  if (categoryIds.length && !keyword && Array.isArray(body?.sites) && categorySites.length !== sites.length) {
    const unavailableSites = sites.filter((site) => !categorySites.includes(site));
    return new Response(JSON.stringify({
      status: "error",
      error: `Selected categories are unavailable for site(s): ${unavailableSites.join(", ")}`
    }), {
      status: 400,
      headers: { "content-type": "application/json; charset=utf-8" }
    });
  }
  const collectionSites = categoryIds.length ? categorySites : sites;
  const requestedViewSites = Array.isArray(body?.view_sites)
    ? normalizeStringList(body.view_sites, new Set(collectionSites))
    : [];
  if (Array.isArray(body?.view_sites) && requestedViewSites.length === 0) {
    return new Response(JSON.stringify({ status: "error", error: "view_sites must include at least one selected site" }), {
      status: 400,
      headers: { "content-type": "application/json; charset=utf-8" }
    });
  }
  const effectiveSites = requestedViewSites.length ? requestedViewSites : collectionSites;
  if (effectiveSites.length === 0) {
    return new Response(JSON.stringify({ status: "error", error: "at least one target site is required" }), {
      status: 400,
      headers: { "content-type": "application/json; charset=utf-8" }
    });
  }
  const parsePriceBound = (key) => {
    const raw = body?.[key];
    if (raw === undefined || raw === null || raw === "") return null;
    const value = Number(raw);
    if (!Number.isSafeInteger(value) || value < 0 || value > 100_000_000_000) {
      throw new Error(`${key} must be an integer between 0 and 100000000000`);
    }
    return value;
  };
  let minPrice;
  let maxPrice;
  try {
    minPrice = parsePriceBound("min_price");
    maxPrice = parsePriceBound("max_price");
    if (minPrice !== null && maxPrice !== null && minPrice > maxPrice) {
      throw new Error("min_price must be less than or equal to max_price");
    }
  } catch (error) {
    return new Response(JSON.stringify({ status: "error", error: error instanceof Error ? error.message : String(error) }), {
      status: 400,
      headers: { "content-type": "application/json; charset=utf-8" }
    });
  }
  const requestedLimit = Number(body?.limit);
  const limit = Math.min(
    Number.isInteger(requestedLimit) && requestedLimit > 0 ? requestedLimit : 24,
    config.max_search_limit
  );
  const sort = normalizeString(body?.sort) || "recommended";
  if (sort !== "recommended" && sort !== "price_asc" && sort !== "price_desc" && sort !== "recent") {
    return new Response(JSON.stringify({ status: "error", error: "sort must be recommended, price_asc, price_desc or recent" }), {
      status: 400,
      headers: { "content-type": "application/json; charset=utf-8" }
    });
  }

  if (!keyword && categoryIds.length === 0) {
    return new Response(JSON.stringify({ status: "error", error: "keyword or category_id is required" }), {
      status: 400,
      headers: { "content-type": "application/json; charset=utf-8" }
    });
  }

  const conditions = ["active = 1"];
  const bindings = [];
  const pcCategoryCode = normalizeString(body?.pc_category_code).toUpperCase();
  const manufacturer = normalizeString(body?.manufacturer);
  if (keyword) {
    const compactKeyword = keyword.toLowerCase().replace(/[\s._\-/]+/g, "");
    const compactTitle = "REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(LOWER(title), ' ', ''), '-', ''), '_', ''), '.', ''), '/', '')";
    const compactSearchText = "REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(LOWER(search_text), ' ', ''), '-', ''), '_', ''), '.', ''), '/', '')";
    conditions.push(`(title LIKE ? OR search_text LIKE ? OR ${compactTitle} LIKE ? OR ${compactSearchText} LIKE ?)`);
    bindings.push(`%${keyword}%`, `%${keyword}%`, `%${compactKeyword}%`, `%${compactKeyword}%`);
  }
  if (categoryIds.length > 0) {
    conditions.push(`category_id IN (${categoryIds.map(() => "?").join(", ")})`);
    bindings.push(...categoryIds);
  }
  if (pcCategoryCode) {
    conditions.push("pc_category_code = ?");
    bindings.push(pcCategoryCode);
  }
  if (manufacturer) {
    conditions.push("canonical_manufacturer = ?");
    bindings.push(manufacturer);
  }
  conditions.push(`site IN (${effectiveSites.map(() => "?").join(", ")})`);
  bindings.push(...effectiveSites);
  if (minPrice !== null) {
    conditions.push("price_value >= ?");
    bindings.push(minPrice);
  }
  if (maxPrice !== null) {
    conditions.push("price_value <= ?");
    bindings.push(maxPrice);
  }

  const orderBy = sort === "price_asc"
    ? "CASE WHEN price_value IS NULL OR price_value <= 100 THEN 1 ELSE 0 END, price_value ASC, COALESCE(posted_at, updated_at) DESC"
    : sort === "price_desc"
      ? "CASE WHEN price_value IS NULL OR price_value <= 100 THEN 1 ELSE 0 END, price_value DESC, COALESCE(posted_at, updated_at) DESC"
    : sort === "recent"
      ? "COALESCE(posted_at, updated_at) DESC, updated_at DESC"
      : "CASE WHEN image_url IS NULL OR image_url = '' THEN 1 ELSE 0 END, COALESCE(posted_at, updated_at) DESC, CASE WHEN price_value IS NULL OR price_value <= 100 THEN 1 ELSE 0 END, price_value ASC";
  const candidateLimit = Math.min(Math.max(limit * 4, limit), 240);
  const result = await env.DB.prepare(`
    SELECT item_id, site, category_id, title, price_value, currency, url, image_url,
           seller_name, posted_at, updated_at, canonical_product_id, canonical_display_name, canonical_manufacturer,
           listing_kind, pc_category_code, quantity, price_scope, condition_code, lifecycle_status,
           market_pool, confidence_json, evidence_json, price_eligible, exclusion_reasons_json,
           good_listing_eligible, reference_price
      FROM listings
     WHERE ${conditions.join(" AND ")}
     ORDER BY ${orderBy}
     LIMIT ?
  `).bind(...bindings, candidateLimit).all();
  const rows = asArray(result.results);
  const candidateItems = rows.map((row) => ({
    id: row.item_id,
    item_id: row.item_id,
    site: row.site,
    category_id: row.category_id,
    title: row.title,
    price: typeof row.price_value === "number" ? row.price_value : null,
    currency: row.currency ?? "KRW",
    url: row.url,
    image_url: row.image_url ?? null,
    seller_name: row.seller_name ?? null,
    posted_at: row.posted_at ?? null,
    updated_at: row.updated_at,
    canonical_product_id: row.canonical_product_id ?? null,
    canonical_display_name: row.canonical_display_name ?? null,
    canonical_manufacturer: row.canonical_manufacturer ?? null,
    listing_kind: row.listing_kind || "UNKNOWN",
    category_code: row.pc_category_code ?? null,
    quantity: Number.isInteger(row.quantity) ? row.quantity : null,
    price_scope: row.price_scope || "UNKNOWN",
    condition_code: row.condition_code || "UNKNOWN",
    lifecycle_status: row.lifecycle_status || "ACTIVE",
    market_pool: row.market_pool ?? null,
    confidence: parseJson(row.confidence_json, {}),
    evidence: parseJson(row.evidence_json, {}),
    price_eligible: row.price_eligible === 1,
    exclusion_reasons: parseJson(row.exclusion_reasons_json, []),
    good_listing_eligible: row.good_listing_eligible === 1,
    reference_price: typeof row.reference_price === "number" ? row.reference_price : null
  }));
  const selection = selectQualifiedItems(candidateItems, limit, body);
  const items = selection.items;
  const prices = items.map((item) => item.price).filter((value) => typeof value === "number" && value > 0);
  const sourceKeys = effectiveSites;
  const sources = sourceKeys.map((site) => {
    const visibleCount = items.filter((item) => item.site === site).length;
    return {
      key: site,
      name: sourceName(site),
      count: visibleCount,
      normalized_count: visibleCount,
      extracted_count: visibleCount,
      filtered_count: 0,
      visible_count: visibleCount,
      collection_state: visibleCount > 0 ? "ready" : "empty",
      status: "ready",
      warnings: [],
      errors: []
    };
  });
  const searchedAt = rows
    .map((row) => normalizeString(row?.updated_at))
    .filter(Boolean)
    .sort()
    .at(-1) ?? null;
  const payload = {
    query: keyword || categoryIds.join(" / "),
    category: categoryIds.length === 1 ? { id: categoryIds[0] } : null,
    categories: categoryIds.map((id) => ({ id })),
    pagination: { has_more: false, next_cursor: null },
    run_id: searchedAt ? `d1:${searchedAt}` : "d1:empty",
    searched_at: searchedAt,
    sources,
    items,
    summary: {
      item_count: items.length,
      source_count: sources.filter((source) => source.visible_count > 0).length,
      currency: new Set(items.map((item) => item.currency)).size === 1 ? (items[0]?.currency ?? "KRW") : "MIXED",
      median_price: median(prices),
      average_price: prices.length > 0 ? Math.round(prices.reduce((sum, value) => sum + value, 0) / prices.length) : null,
      lowest_price: prices.length > 0 ? Math.min(...prices) : null,
      highest_price: prices.length > 0 ? Math.max(...prices) : null,
      suspect_count: 0
    },
    market_snapshot: null,
    price_history: null,
    quality: {
      raw_count: candidateItems.length,
      normalized_count: candidateItems.length,
      merged_count: items.length,
      selection: selection.audit,
      price_range: { min: minPrice, max: maxPrice },
      sort,
      warnings: rows.length === 0 ? ["FREE_TIER_D1_EMPTY: no pre-collected listings matched this request"] : []
    }
  };
  return new Response(JSON.stringify({ status: "success", data: payload }, null, 2), {
    status: 200,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": `public, max-age=${config.search_cache_ttl_seconds}`,
      "x-free-tier-data-source": "d1"
    }
  });
}

export async function readFreeTierUsage(env) {
  if (!hasD1(env)) return null;
  const dateKey = new Date().toISOString().slice(0, 10);
  try {
    const row = await env.DB.prepare(
      "SELECT date_key, browser_seconds, queue_operations, d1_rows_written, collection_runs, updated_at FROM free_tier_usage WHERE date_key = ?"
    ).bind(dateKey).first();
    return row ?? {
      date_key: dateKey,
      browser_seconds: 0,
      queue_operations: 0,
      d1_rows_written: 0,
      collection_runs: 0,
      updated_at: null
    };
  } catch {
    return null;
  }
}

export async function readRecentCollectionRuns(env, limit = 12) {
  if (!hasD1(env)) return [];
  try {
    const result = await env.DB.prepare(
      "SELECT run_id, site, category_id, status, items_count, error_message, started_at, finished_at FROM collection_runs ORDER BY started_at DESC LIMIT ?"
    ).bind(Math.min(Math.max(Number(limit) || 1, 1), 20)).all();
    return asArray(result.results);
  } catch {
    return [];
  }
}
