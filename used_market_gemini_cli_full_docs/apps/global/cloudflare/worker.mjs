const SECURITY_HEADERS = Object.freeze({
  "content-security-policy": "default-src 'self'; base-uri 'none'; connect-src 'self'; font-src 'self'; form-action 'self'; frame-ancestors 'none'; img-src 'self' data: https:; object-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; upgrade-insecure-requests",
  "cross-origin-opener-policy": "same-origin",
  "permissions-policy": "camera=(), geolocation=(), microphone=()",
  "referrer-policy": "strict-origin-when-cross-origin",
  "x-content-type-options": "nosniff",
  "x-frame-options": "DENY"
});

export const MARKETPLACES = Object.freeze({
  jp: Object.freeze({
    label: "Japan",
    currency: "JPY",
    internal: Object.freeze([
      { key: "mercari_jp", label: "Mercari JP", searchBase: "https://jp.mercari.com/search?keyword=" },
      { key: "yahoo_auction_jp", label: "Yahoo! Auctions", searchBase: "https://auctions.yahoo.co.jp/search/search?p=" },
      { key: "rakuma", label: "Rakuma", searchBase: "https://fril.jp/s?query=" }
    ]),
    external: Object.freeze([])
  }),
  us: Object.freeze({
    label: "United States",
    currency: "USD",
    internal: Object.freeze([
      { key: "ebay", label: "eBay", searchBase: "https://www.ebay.com/sch/i.html?_nkw=" },
      { key: "poshmark", label: "Poshmark", searchBase: "https://poshmark.com/search?query=" },
      { key: "vinted", label: "Vinted US", searchBase: "https://www.vinted.com/catalog?search_text=" },
      { key: "unclaimed_baggage", label: "Unclaimed Baggage", searchBase: "https://www.unclaimedbaggage.com/search?q=" }
    ]),
    external: Object.freeze([])
  })
});

const CATEGORIES = Object.freeze([
  ["all", "All", null], ["fashion", "Fashion", null], ["fashion_women", "Women's Fashion", "fashion"],
  ["fashion_men", "Men's Fashion", "fashion"], ["fashion_goods", "Fashion Accessories", null],
  ["luxury", "Luxury", null], ["beauty", "Beauty", null], ["kids", "Kids and Baby", null],
  ["mobile", "Phones and Tablets", null], ["appliances", "Appliances", null], ["pc", "Computers", null],
  ["camera", "Cameras", null], ["furniture", "Furniture", null], ["living", "Home and Living", null],
  ["games", "Games", null], ["hobby", "Hobbies and Pets", null], ["books", "Books and Media", null],
  ["sports", "Sports", null], ["travel", "Travel and Outdoors", null], ["vehicles", "Vehicles", null],
  ["motorcycle", "Motorcycles", null], ["tools", "Tools", null]
].map(([id, label, parentId]) => ({ id, label, parentId, description: "" })));

const ALL_INTERNAL = Object.freeze(Object.values(MARKETPLACES).flatMap((market) => market.internal.map((site) => site.key)));
const INTERNAL_BY_COUNTRY = Object.freeze(Object.fromEntries(Object.entries(MARKETPLACES).map(([country, market]) => [country, market.internal.map((site) => site.key)])));
const EBAY_DELETION_ENDPOINT = "https://global.used-pick.com/global/api/ebay/account-deletion";

function withSecurity(response) {
  const headers = new Headers(response.headers);
  for (const [key, value] of Object.entries(SECURITY_HEADERS)) headers.set(key, value);
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

function json(value, status = 200, extraHeaders = {}) {
  return withSecurity(Response.json(value, {
    status,
    headers: { "cache-control": "no-store", ...extraHeaders }
  }));
}

function redirect(location) {
  return withSecurity(new Response(null, { status: 308, headers: { location } }));
}

function publicSource(site) {
  return { key: site.key, label: site.label, search_url: site.searchBase };
}

function sources(url) {
  const country = url.searchParams.get("country") === "us" ? "us" : "jp";
  const market = MARKETPLACES[country];
  return json({
    country,
    label: market.label,
    currency: market.currency,
    internal: market.internal.map(publicSource),
    external: market.external.map(publicSource)
  });
}

function staticCategories() {
  return { status: "success", data: { categories: CATEGORIES, site_plans: {}, source_bindings: {} } };
}

function validCategories(payload) {
  return Boolean(payload?.status === "success"
    && Array.isArray(payload?.data?.categories)
    && payload.data.categories.length
    && payload.data.site_plans && typeof payload.data.site_plans === "object"
    && payload.data.source_bindings && typeof payload.data.source_bindings === "object");
}

async function readApiCache(db, key) {
  try {
    const row = await db.prepare("SELECT response_json FROM api_response_cache WHERE cache_key = ? AND expires_at > ?")
      .bind(key, new Date().toISOString()).first();
    return row?.response_json ? JSON.parse(row.response_json) : null;
  } catch {
    return null;
  }
}

async function writeApiCache(db, key, payload, ttlMs) {
  const storedAt = new Date();
  const expiresAt = new Date(storedAt.getTime() + ttlMs);
  await db.prepare(`INSERT INTO api_response_cache (cache_key, response_json, stored_at, expires_at)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(cache_key) DO UPDATE SET
      response_json = excluded.response_json,
      stored_at = excluded.stored_at,
      expires_at = excluded.expires_at`).bind(
    key,
    JSON.stringify(payload),
    storedAt.toISOString(),
    expiresAt.toISOString()
  ).run();
}

async function categories(request, env, ctx) {
  if (request.method !== "GET" && request.method !== "HEAD") return json({ status: "error", error: "Method not allowed." }, 405, { allow: "GET, HEAD" });
  const config = runnerConfiguration(env);
  if (config) {
    try {
      const upstream = await fetch(new URL("/global/api/categories", config.origin), {
        headers: { accept: "application/json", authorization: `Bearer ${config.token}`, "x-used-market-app": "global" },
        signal: AbortSignal.timeout(10_000)
      });
      if (upstream.ok) {
        const payload = await upstream.json();
        if (validCategories(payload)) {
          ctx?.waitUntil(writeApiCache(env.DB, "categories", payload, 24 * 60 * 60_000));
          return json(payload, 200, { "x-global-catalog-source": "runner" });
        }
      }
      console.warn("global category runner unavailable; using D1 cache", { status: upstream.status });
    } catch (error) {
      console.warn("global category runner network failure; using D1 cache", { message: error instanceof Error ? error.message : String(error) });
    }
    const cached = await readApiCache(env.DB, "categories");
    if (validCategories(cached)) return json(cached, 200, { "x-global-catalog-source": "d1-cache" });
  }
  return json(staticCategories(), 200, { "x-global-catalog-source": "static-fallback" });
}

function runnerConfiguration(env) {
  try {
    const origin = new URL(String(env.RUNNER_URL || ""));
    const token = String(env.RUNNER_TOKEN || "").trim();
    if (origin.href !== "https://global-runner.used-pick.com/" || !token) return null;
    return { origin, token };
  } catch {
    return null;
  }
}

function normalizeSearchRequest(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Search body must be a JSON object.");
  const sites = Array.from(new Set((Array.isArray(value.sites) ? value.sites : [])
    .map((site) => String(site || "").trim().toLowerCase())
    .filter(Boolean)));
  if (!sites.length || sites.some((site) => !ALL_INTERNAL.includes(site))) throw new Error("Search sites must contain only global internal marketplaces.");
  const country = sites.every((site) => INTERNAL_BY_COUNTRY.jp.includes(site))
    ? "jp"
    : sites.every((site) => INTERNAL_BY_COUNTRY.us.includes(site)) ? "us" : null;
  if (!country) throw new Error("A search cannot mix Japan and United States marketplaces.");
  const keyword = String(value.keyword || "").trim().slice(0, 80);
  const categoryIds = Array.from(new Set([
    ...(Array.isArray(value.category_ids) ? value.category_ids : []),
    ...(value.category_id ? [value.category_id] : [])
  ].map((id) => String(id || "").trim()).filter(Boolean))).slice(0, 20);
  if (!keyword && !categoryIds.length) throw new Error("A keyword or category is required.");
  return { body: value, country, sites };
}

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(",")}}`;
  return JSON.stringify(value);
}

async function cacheKey(body) {
  const bytes = new TextEncoder().encode(stableJson(body));
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function validSearchResponse(payload, country, sites) {
  if (!payload || payload.status !== "success" || !payload.data || !Array.isArray(payload.data.items)) return false;
  const allowed = new Set(INTERNAL_BY_COUNTRY[country]);
  return payload.data.items.every((item) => item && allowed.has(item.site) && sites.includes(item.site));
}

async function readCache(db, key, country) {
  try {
    const row = await db.prepare("SELECT response_json, expires_at FROM search_response_cache WHERE cache_key = ? AND country = ? AND expires_at > ?")
      .bind(key, country, new Date().toISOString()).first();
    if (!row?.response_json) return null;
    const payload = JSON.parse(row.response_json);
    return payload && typeof payload === "object" ? payload : null;
  } catch {
    return null;
  }
}

async function writeCache(db, key, country, sites, requestBody, payload) {
  const storedAt = new Date();
  const expiresAt = new Date(storedAt.getTime() + 5 * 60_000);
  await db.prepare(`INSERT INTO search_response_cache (
    cache_key, country, sites_json, request_json, response_json, stored_at, expires_at
  ) VALUES (?, ?, ?, ?, ?, ?, ?)
  ON CONFLICT(cache_key) DO UPDATE SET
    country = excluded.country,
    sites_json = excluded.sites_json,
    request_json = excluded.request_json,
    response_json = excluded.response_json,
    stored_at = excluded.stored_at,
    expires_at = excluded.expires_at`).bind(
    key,
    country,
    JSON.stringify(sites),
    stableJson(requestBody),
    JSON.stringify(payload),
    storedAt.toISOString(),
    expiresAt.toISOString()
  ).run();
}

async function search(request, env, ctx) {
  if (request.method !== "POST") return json({ status: "error", error: "Method not allowed." }, 405, { allow: "POST" });
  let rawBody;
  let parsed;
  try {
    rawBody = await request.text();
    if (rawBody.length > 16_384) throw new Error("Search request is too large.");
    parsed = normalizeSearchRequest(JSON.parse(rawBody));
  } catch (error) {
    return json({ status: "error", error: error instanceof Error ? error.message : "Invalid search request." }, 400);
  }
  const config = runnerConfiguration(env);
  if (config) {
    const target = new URL("/global/api/search", config.origin);
    try {
      const upstream = await fetch(target, {
        method: "POST",
        headers: {
          accept: "application/json",
          authorization: `Bearer ${config.token}`,
          "content-type": "application/json",
          "x-used-market-app": "global"
        },
        body: rawBody,
        signal: AbortSignal.timeout(60_000)
      });
      if (upstream.status === 429) {
        return withSecurity(new Response(upstream.body, {
          status: 429,
          headers: {
            "content-type": upstream.headers.get("content-type") || "application/json; charset=utf-8",
            "cache-control": "no-store",
            "retry-after": upstream.headers.get("retry-after") || "5",
            "x-global-search-source": "runner"
          }
        }));
      }
      if ([400, 409, 410].includes(upstream.status)) {
        return withSecurity(new Response(upstream.body, {
          status: upstream.status,
          headers: {
            "content-type": upstream.headers.get("content-type") || "application/json; charset=utf-8",
            "cache-control": "no-store",
            "x-global-search-source": "runner"
          }
        }));
      }
      if (upstream.ok) {
        const payload = await upstream.json();
        if (validSearchResponse(payload, parsed.country, parsed.sites)) {
          return json(payload, 200, { "x-global-search-source": "runner" });
        }
      }
      console.warn("global runner response unavailable; using D1 cache", { status: upstream.status, country: parsed.country });
    } catch (error) {
      console.warn("global runner network failure; using D1 cache", { country: parsed.country, message: error instanceof Error ? error.message : String(error) });
    }
  }
  return json({ status: "error", code: "SEARCH_UNAVAILABLE", error: "Search is temporarily unavailable and no cached result exists." }, 503);
}

function ebayDeletionToken(env) {
  const token = String(env.EBAY_DELETION_VERIFICATION_TOKEN || "").trim();
  return /^[A-Za-z0-9_-]{32,80}$/.test(token) ? token : "";
}

async function ebayDeletionChallenge(url, env) {
  const token = ebayDeletionToken(env);
  if (!token) return json({ error: "eBay deletion endpoint is not configured." }, 503);
  const challengeCode = String(url.searchParams.get("challenge_code") || "").trim();
  if (!challengeCode || challengeCode.length > 256) return json({ error: "A valid challenge_code is required." }, 400);
  const bytes = new TextEncoder().encode(`${challengeCode}${token}${EBAY_DELETION_ENDPOINT}`);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  const challengeResponse = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
  return json({ challengeResponse });
}

async function ebayDeletionNotification(request, env) {
  if (!ebayDeletionToken(env)) return json({ error: "eBay deletion endpoint is not configured." }, 503);
  if (!String(request.headers.get("content-type") || "").toLowerCase().startsWith("application/json")) {
    return json({ error: "Content-Type must be application/json." }, 415);
  }
  let payload;
  try {
    const raw = await request.text();
    if (!raw || raw.length > 65_536) throw new Error("invalid payload");
    payload = JSON.parse(raw);
  } catch {
    return json({ error: "Invalid notification payload." }, 400);
  }
  if (payload?.metadata?.topic !== "MARKETPLACE_ACCOUNT_DELETION" || !payload?.notification?.notificationId) {
    return json({ error: "Unsupported notification payload." }, 400);
  }
  await env.DB.prepare("DELETE FROM search_response_cache WHERE sites_json LIKE ?")
    .bind('%"ebay"%')
    .run();
  return withSecurity(new Response(null, { status: 204, headers: { "cache-control": "no-store" } }));
}

async function ebayDeletion(request, env) {
  const url = new URL(request.url);
  if (request.method === "GET") return ebayDeletionChallenge(url, env);
  if (request.method === "POST") return ebayDeletionNotification(request, env);
  return json({ error: "Method not allowed." }, 405, { allow: "GET, POST" });
}

async function refresh(request, env) {
  if (request.method !== "GET") return json({ status: "error", error: "Method not allowed." }, 405, { allow: "GET" });
  const config = runnerConfiguration(env);
  if (!config) return json({ status: "error", error: "Refresh service is unavailable." }, 503);
  const incoming = new URL(request.url);
  const target = new URL(incoming.pathname + incoming.search, config.origin);
  try {
    const upstream = await fetch(target, {
      headers: { accept: "application/json", authorization: `Bearer ${config.token}`, "x-used-market-app": "global" },
      signal: AbortSignal.timeout(10_000)
    });
    return withSecurity(new Response(upstream.body, { status: upstream.status, headers: { "content-type": upstream.headers.get("content-type") || "application/json; charset=utf-8", "cache-control": "no-store" } }));
  } catch {
    return json({ status: "error", error: "Refresh service is unavailable." }, 503);
  }
}

async function health(env) {
  const config = runnerConfiguration(env);
  const d1Check = env.DB.prepare("SELECT 1 AS ok").first().then(() => true, () => false);
  const originCheck = !config ? Promise.resolve(false) : fetch(new URL("/global/health", config.origin), {
    headers: { accept: "application/json", "x-used-market-app": "global" },
    signal: AbortSignal.timeout(2500)
  }).then((response) => response.ok, () => false);
  const [d1Available, originAvailable] = await Promise.all([d1Check, originCheck]);
  return json({
    ok: d1Available,
    app: "global",
    runtime: "cloudflare-worker",
    storage: "d1",
    environment: env.ENVIRONMENT || "production",
    origin: { configured: Boolean(config), available: originAvailable }
  }, d1Available ? 200 : 503);
}

async function asset(request, env) {
  if (!env.ASSETS?.fetch) return json({ error: "Static assets are unavailable." }, 503);
  const incoming = new URL(request.url);
  const assetPath = incoming.pathname === "/global/" ? "/index.html" : incoming.pathname.slice("/global".length) || "/index.html";
  const target = new URL(assetPath + incoming.search, incoming.origin);
  const assetRequest = new Request(target, request);
  return withSecurity(await env.ASSETS.fetch(assetRequest));
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (url.pathname === "/") return redirect("/global/?country=jp");
    if (url.pathname === "/global") return redirect(`/global/${url.search}`);
    if (url.pathname === "/global/api/health") return health(env);
    if (url.pathname === "/global/api/sources") return sources(url);
    if (url.pathname === "/global/api/ebay/account-deletion") return ebayDeletion(request, env);
    if (url.pathname === "/global/api/categories") return categories(request, env, ctx);
    if (url.pathname === "/global/api/search") return search(request, env);
    if (url.pathname.startsWith("/global/api/search/refresh/")) return refresh(request, env);
    if (url.pathname === "/global/" || (url.pathname.startsWith("/global/") && !url.pathname.startsWith("/global/api/"))) return asset(request, env);
    return json({ error: "Not found." }, 404);
  }
};
