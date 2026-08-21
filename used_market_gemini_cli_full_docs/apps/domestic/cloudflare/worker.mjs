import {
  fetchThroughFreeCache,
  freeTierConfig,
  hasD1,
  isFreeTierEnabled,
  readRecentCollectionRuns,
  readFreeTierUsage,
  searchD1
} from "./free-tier.mjs";
import {
  FREE_COLLECTION_EXCLUDED_SITES,
  FREE_COLLECTION_SITES,
  freeCollectionPlan,
  handleFreeCollectionQueue
} from "./free-collector.mjs";
import { fetchThroughLiveSearchCache } from "./live-search.mjs";
import { TARGET_SITES } from "./target-sites.mjs";

const CRON_TO_JOBS = new Map([
  ["0 0 * * *", ["gpu-fast-scan", "iphone-scan"]],
  ["0 6 * * *", ["cpu-scan", "airpods-scan"]],
  ["0 12 * * *", ["ram-scan", "switch-scan"]],
  ["0 18 * * *", ["ssd-scan", "fashion-bottoms-scan"]],
  ["30 18 * * *", ["psu-scan", "full-pc-scan"]]
]);

const DAILY_PRICE_REFRESH_UTC_HOUR = 18;
const DEFAULT_RUNNER_TIMEOUT_MS = 15_000;
const DEFAULT_RUNNER_MAX_ATTEMPTS = 3;
const DEFAULT_RUNNER_RETRY_DELAY_MS = 250;
const MAX_RUNNER_REQUEST_BYTES = 1_048_576;
const MAX_RUNNER_RESPONSE_BYTES = 4_194_304;
const MAX_IMPORTED_LISTINGS = 500;
const D1_BACKUP_MAX_LISTINGS = 10_000;
const IMPORT_ALLOWED_SITES = new Set([
  "bunjang",
  "joonggonara",
  "hellomarket",
  "rethinkmall"
]);
const IMPORT_ALLOWED_HOSTS = new Set([
  "m.bunjang.co.kr",
  "bunjang.co.kr",
  "www.bunjang.co.kr",
  "web.joongna.com",
  "www.hellomarket.com",
  "web.rethinkmall.com"
]);

class PayloadTooLargeError extends Error {}

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
    headers: { "content-type": "application/json; charset=utf-8" }
  });
}

async function serveAssets(request, env) {
  if (!env.ASSETS || typeof env.ASSETS.fetch !== "function") return null;
  const response = await env.ASSETS.fetch(request);
  return response.status === 404 ? null : response;
}

function augmentCategoryCatalog(catalog) {
  const sitePlans = Object.fromEntries(TARGET_SITES.map((site) => [site, { ...(catalog?.site_plans?.[site] || {}) }]));
  const sourceBindings = Object.fromEntries(TARGET_SITES.map((site) => [site, { ...(catalog?.source_bindings?.[site] || {}) }]));
  for (const site of ["hellomarket", "rethinkmall"]) {
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
  for (const site of TARGET_SITES) {
    sitePlans[site] ||= {};
    sourceBindings[site] ||= {};
  }
  return { ...catalog, site_plans: sitePlans, source_bindings: sourceBindings };
}

async function serveCategoryCatalog() {
  try {
    const { categoryCatalogForApi } = await import("../market/logic/category-catalog.ts");
    return json(200, { status: "success", data: augmentCategoryCatalog(categoryCatalogForApi()) });
  } catch (error) {
    console.error("Category catalog failed", error);
    return json(503, { status: "error", error: "Category catalog is unavailable" });
  }
}

function manualTokenIsValid(request, env) {
  const expected = env.MANUAL_RUN_TOKEN;
  return Boolean(expected && request.headers.get("authorization") === `Bearer ${expected}`);
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
      const result = {
        ok: response.ok,
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

async function readJsonPayload(request) {
  const declaredLength = Number(request.headers.get('content-length'));
  if (Number.isFinite(declaredLength) && declaredLength > MAX_RUNNER_REQUEST_BYTES) {
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
    if (totalBytes > MAX_RUNNER_REQUEST_BYTES) throw new PayloadTooLargeError();
    chunks.push(chunk);
  }
  return JSON.parse(new TextDecoder().decode(concatBytes(chunks)));
}

function importedUrl(value) {
  if (typeof value !== "string" || !value.trim()) return null;
  try {
    const parsed = new URL(value.trim());
    if (parsed.protocol !== "https:" || !IMPORT_ALLOWED_HOSTS.has(parsed.hostname)) return null;
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

function importedNumber(value) {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

function normalizeImportedListing(value, index) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const site = importedText(value.site, 40);
  const title = importedText(value.title, 500);
  const url = importedUrl(value.url);
  if (!IMPORT_ALLOWED_SITES.has(site) || !title || !url) return null;
  const categoryId = importedText(value.category_id, 120) || "all";
  const itemId = importedText(value.item_id, 500) || `${site}:${url}`;
  const updatedAt = importedText(value.updated_at, 80) || new Date().toISOString();
  return {
    item_id: itemId,
    site,
    category_id: categoryId,
    title,
    search_text: importedText(value.search_text, 1000) || title,
    price_value: importedNumber(value.price_value ?? value.price),
    currency: importedText(value.currency, 12) || "KRW",
    url,
    image_url: importedImageUrl(value.image_url) ?? null,
    seller_name: importedText(value.seller_name, 200) || null,
    posted_at: importedText(value.posted_at, 80) || null,
    updated_at: updatedAt,
    active: 1,
    _index: index
  };
}

async function importListings(env, values) {
  if (!hasD1(env)) return { inserted: 0, rejected: values.length, error: "D1 is unavailable" };
  const retiredPurged = await purgeRetiredD1Listings(env);
  const normalized = [];
  let rejected = 0;
  for (let index = 0; index < Math.min(values.length, MAX_IMPORTED_LISTINGS); index += 1) {
    const item = normalizeImportedListing(values[index], index);
    if (item) normalized.push(item);
    else rejected += 1;
  }
  rejected += Math.max(0, values.length - MAX_IMPORTED_LISTINGS);
  if (normalized.length === 0) return { inserted: 0, rejected, retired_purged: retiredPurged };

  const statements = normalized.map((item) => env.DB.prepare(
    `INSERT OR REPLACE INTO listings
      (item_id, site, category_id, title, search_text, price_value, currency, url, image_url, seller_name, posted_at, updated_at, active)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
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
    item.active
  ));
  statements.push(env.DB.prepare(
    `INSERT INTO free_tier_usage (date_key, browser_seconds, queue_operations, d1_rows_written, collection_runs, updated_at)
     VALUES (?, 0, 0, ?, 0, ?)
     ON CONFLICT(date_key) DO UPDATE SET d1_rows_written = d1_rows_written + excluded.d1_rows_written, updated_at = excluded.updated_at`
  ).bind(new Date().toISOString().slice(0, 10), normalized.length, new Date().toISOString()));
  await env.DB.batch(statements);
  const perSiteLimit = Math.floor(D1_BACKUP_MAX_LISTINGS / IMPORT_ALLOWED_SITES.size);
  const pruneStatements = [...IMPORT_ALLOWED_SITES].map((site) => env.DB.prepare(`
    DELETE FROM listings
     WHERE site = ?
       AND item_id NOT IN (
         SELECT item_id FROM listings
          WHERE site = ? AND active = 1
          ORDER BY COALESCE(posted_at, updated_at) DESC, updated_at DESC
          LIMIT ?
       )
  `).bind(site, site, perSiteLimit));
  await env.DB.batch(pruneStatements);
  return { inserted: normalized.length, rejected, retired_purged: retiredPurged, backup_limit: D1_BACKUP_MAX_LISTINGS, per_site_limit: perSiteLimit };
}

async function purgeRetiredD1Listings(env) {
  if (!hasD1(env)) return 0;
  const sites = [...IMPORT_ALLOWED_SITES];
  const placeholders = sites.map(() => "?").join(", ");
  const result = await env.DB.prepare(
    `DELETE FROM listings WHERE site NOT IN (${placeholders})`
  ).bind(...sites).run();
  return Number(result?.meta?.changes || 0);
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

    if (request.method === "POST" && url.pathname === "/api/index/d1-fallback-check") {
      if (!manualTokenIsValid(request, env)) {
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

    if (
      searchRunnerIsConfigured(env)
      && ((request.method === "POST" && (url.pathname === "/api/search" || url.pathname === "/api/search-only"))
        || (request.method === "GET" && url.pathname === "/api/search-only/sources")
        || (request.method === "GET" && url.pathname.startsWith("/api/search/refresh/")))
    ) {
      return proxyToSearchRunner(request, env, url.pathname);
    }

    if (request.method === "GET" && url.pathname === "/api/index/status" && searchRunnerIsConfigured(env)) {
      if (!manualTokenIsValid(request, env)) {
        return json(401, { ok: false, error: "Unauthorized" });
      }
      return proxyToSearchRunner(request, env, url.pathname);
    }

    if (request.method === "GET" && url.pathname === "/api/runner/status" && nodeRunnerIsConfigured(env)) {
      return proxyToRunnerStatus(request, env);
    }

    if (request.method === "POST" && url.pathname === "/api/search" && hasD1(env)) {
      try {
        return await fetchThroughLiveSearchCache(request, env, (fallbackRequest) => searchD1(fallbackRequest, env));
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

    if (request.method === "POST" && url.pathname === "/admin/import-listings") {
      if (!manualTokenIsValid(request, env)) {
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
        const result = await importListings(env, values);
        return json(200, { ok: true, ...result });
      } catch (error) {
        console.error("Listing import failed", error);
        return json(500, { ok: false, error: error instanceof Error ? error.message : String(error) });
      }
    }

    if ((request.method === "GET" || request.method === "HEAD") && !url.pathname.startsWith("/api/") && url.pathname !== "/run") {
      const assetResponse = await serveAssets(request, env);
      if (assetResponse) return assetResponse;
    }

    if (request.method === "POST" && url.pathname === "/run") {
      if (!manualTokenIsValid(request, env)) {
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
    const jobNames = scheduledJobNames(controller);
    if (!jobNames) {
      console.error(`No job mapping for Cloudflare cron: ${controller.cron}`);
      throw new Error(`No job mapping for Cloudflare cron: ${controller.cron}`);
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

export { CRON_TO_JOBS, DAILY_PRICE_REFRESH_UTC_HOUR, scheduledJobNames };
