import { hasOfficialCategory } from "./category-source-map.mjs";
import { selectQualifiedItems } from "./live-search.mjs";
import { TARGET_SITES } from "./target-sites.mjs";

export const FREE_TIER_POLICY = Object.freeze({
  browserMinutesPerDay: 10,
  queueOperationsPerDay: 10_000,
  d1RowsWrittenPerDay: 100_000,
  searchCacheTtlSeconds: 21_600,
  staticCacheTtlSeconds: 86_400,
  maxSearchLimit: 60
});

const CACHEABLE_GET_PATHS = new Set([
  "/api/categories",
  "/api/search-only/sources",
  "/api/market/history",
  "/api/merged/latest",
  "/api/market/latest",
  "/api/market/by-gpu",
  "/api/opportunities/latest",
  "/api/collector/latest"
]);

const CACHEABLE_POST_PATHS = new Set([
  "/api/search",
  "/api/search-only"
]);

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
  const allowedSites = new Set(TARGET_SITES);
  const hasExplicitSites = Array.isArray(body?.sites);
  const sites = normalizeStringList(hasExplicitSites ? body.sites : TARGET_SITES, allowedSites);
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
           seller_name, posted_at, updated_at
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
    updated_at: row.updated_at
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
