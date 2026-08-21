import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const read = (name) => readFile(new URL(name, import.meta.url), "utf8");
const INTERNAL = ["mercari_jp", "yahoo_auction_jp", "rakuma", "ebay", "poshmark", "vinted", "unclaimed_baggage"];
const { default: worker, MARKETPLACES } = await import("./worker.mjs");

assert.deepEqual(Object.keys(MARKETPLACES), ["jp", "us"]);
assert.deepEqual(MARKETPLACES.jp.internal.map((site) => site.key), INTERNAL.slice(0, 3));
assert.deepEqual(MARKETPLACES.us.internal.map((site) => site.key), INTERNAL.slice(3));
assert.deepEqual(MARKETPLACES.us.external.map((site) => site.key), []);

const assetCalls = [];
const fakeAssets = {
  async fetch(request) {
    assetCalls.push(new URL(request.url));
    const path = new URL(request.url).pathname;
    if (path === "/index.html") return new Response('<!doctype html><html lang="en"><div class="market-app">Global existing UI</div></html>', { headers: { "content-type": "text/html" } });
    if (path === "/app.js") return new Response("export {};", { headers: { "content-type": "text/javascript" } });
    return new Response("asset", { headers: { "content-type": "text/plain" } });
  }
};

const runnerPayload = {
  status: "success",
  data: {
    query: { keyword: "camera" },
    items: [{ site: "mercari_jp", title: "中古 カメラ", price: 12000, currency: "JPY", url: "https://jp.mercari.com/item/m1" }],
    sources: [{ key: "mercari_jp", status: "ready", count: 1 }],
    summary: { item_count: 1, source_count: 1 },
    pagination: { has_more: false, next_cursor: null },
    session: { id: "fixture-session", generation: 1, page: 0, page_size: 30, window: 30, loaded_count: 1, available_count: 1, source_totals: { mercari_jp: 1 }, expires_at: "2099-01-01T00:00:00.000Z" }
  }
};
const ebayRunnerPayload = {
  status: "success",
  data: {
    query: { keyword: "camera" },
    items: [{ site: "ebay", title: "Used camera", price: 99.99, currency: "USD", url: "https://www.ebay.com/itm/fixture" }],
    sources: [{ key: "ebay", status: "ready", count: 1 }],
    summary: { item_count: 1, source_count: 1 },
    pagination: { has_more: false, next_cursor: null }
  }
};
let activeRunnerPayload = runnerPayload;
const runnerCategories = {
  status: "success",
  data: {
    categories: [{ id: "all", label: "All", parentId: null, description: "" }],
    site_plans: { mercari_jp: { selectable_category_ids: ["all"] } },
    source_bindings: { mercari_jp: { all: { mode: "keyword" } } }
  }
};
let cachedPayload = runnerPayload;
let cachedCategories = runnerCategories;
const dbCalls = [];
const fakeDb = {
  prepare(sql) {
    const call = { sql, values: [] };
    dbCalls.push(call);
    return {
      bind(...values) { call.values = values; return this; },
      async first() {
        if (/SELECT 1 AS ok/.test(sql)) return { ok: 1 };
        if (/search_response_cache/.test(sql) && cachedPayload) return { response_json: JSON.stringify(cachedPayload), expires_at: "2099-01-01T00:00:00.000Z" };
        if (/api_response_cache/.test(sql) && cachedCategories) return { response_json: JSON.stringify(cachedCategories), expires_at: "2099-01-01T00:00:00.000Z" };
        return null;
      },
      async run() { return { success: true }; }
    };
  }
};

const runnerCalls = [];
let runnerMode = "success";
const originalFetch = globalThis.fetch;
globalThis.fetch = async (input, init = {}) => {
  const request = input instanceof Request ? input : new Request(input, init);
  runnerCalls.push(request);
  if (new URL(request.url).pathname === "/global/health") return Response.json({ ok: true, app: "global-runner" });
  if (runnerMode === "busy") return Response.json(
    { status: "error", code: "SEARCH_BUSY", error: "SEARCH_BUSY:5", retry_after_seconds: 5 },
    { status: 429, headers: { "retry-after": "5" } }
  );
  if (runnerMode === "session_error") return Response.json(
    { status: "error", error: "SESSION_EXPIRED: Search session expired. Start a new search." },
    { status: 400 }
  );
  if (runnerMode === "failure") return Response.json({ status: "error" }, { status: 502 });
  if (new URL(request.url).pathname.includes("/refresh/")) return Response.json({ status: "success", data: { changed: false } });
  if (new URL(request.url).pathname === "/global/api/categories") return Response.json(runnerCategories);
  return Response.json(activeRunnerPayload);
};

const waits = [];
function call(path, init = {}, overrides = {}) {
  return worker.fetch(new Request(`https://global.used-pick.com${path}`, init), {
    ASSETS: fakeAssets,
    DB: fakeDb,
    ENVIRONMENT: "test",
    ...overrides
  }, { waitUntil(promise) { waits.push(promise); } });
}
const runnerEnv = { RUNNER_URL: "https://global-runner.used-pick.com", RUNNER_TOKEN: "independent-global-token" };
const ebayNotificationEnv = {
  EBAY_DELETION_VERIFICATION_TOKEN: "fixture_ebay_deletion_token_1234567890"
};

const challengeCode = "fixture-challenge-code";
const challengeEndpoint = "https://global.used-pick.com/global/api/ebay/account-deletion";
const challengeBytes = new TextEncoder().encode(`${challengeCode}${ebayNotificationEnv.EBAY_DELETION_VERIFICATION_TOKEN}${challengeEndpoint}`);
const challengeDigest = await crypto.subtle.digest("SHA-256", challengeBytes);
const expectedChallenge = Array.from(new Uint8Array(challengeDigest), (byte) => byte.toString(16).padStart(2, "0")).join("");

const challengeResponse = await call(`/global/api/ebay/account-deletion?challenge_code=${encodeURIComponent(challengeCode)}`, {}, ebayNotificationEnv);
assert.equal(challengeResponse.status, 200);
assert.match(challengeResponse.headers.get("content-type") || "", /^application\/json/i);
assert.deepEqual(await challengeResponse.json(), { challengeResponse: expectedChallenge });

const deletionResponse = await call("/global/api/ebay/account-deletion", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({
    metadata: { topic: "MARKETPLACE_ACCOUNT_DELETION", schemaVersion: "1.0", deprecated: false },
    notification: {
      notificationId: "fixture-notification-id",
      data: { username: "fixture-seller", userId: "fixture-user-id", eiasToken: "fixture-eias" }
    }
  })
}, ebayNotificationEnv);
assert.equal(deletionResponse.status, 204);
assert.ok(dbCalls.some((call) => /DELETE FROM search_response_cache/.test(call.sql) && call.values.includes('%"ebay"%')));

assert.equal((await call("/global/api/ebay/account-deletion?challenge_code=fixture", {}, {})).status, 503);

const root = await call("/");
assert.equal(root.status, 308);
assert.equal(root.headers.get("location"), "/global/?country=jp");

assetCalls.length = 0;
const home = await call("/global/?country=us");
assert.equal(home.status, 200);
assert.equal(assetCalls[0].pathname, "/index.html");
assert.equal(assetCalls[0].search, "?country=us");
assert.match(await home.text(), /class="market-app"/);
assert.match(home.headers.get("content-security-policy"), /default-src 'self'/);

assetCalls.length = 0;
assert.equal((await call("/global/app.js?v=7")).status, 200);
assert.equal(assetCalls[0].pathname, "/app.js");
assert.equal(assetCalls[0].search, "?v=7");

const sources = await (await call("/global/api/sources?country=us")).json();
assert.deepEqual(sources.internal.map((site) => site.key), INTERNAL.slice(3));
assert.deepEqual(sources.external.map((site) => site.key), []);

const categories = await (await call("/global/api/categories")).json();
assert.equal(categories.status, "success");
assert.ok(categories.data.categories.length >= 20);
assert.ok(categories.data.categories.every((category) => /^[\x20-\x7E]+$/.test(category.label)));

runnerCalls.length = 0;
waits.length = 0;
const runnerCategoryResponse = await call("/global/api/categories", {}, runnerEnv);
assert.equal(runnerCategoryResponse.status, 200);
assert.deepEqual(await runnerCategoryResponse.json(), runnerCategories);
assert.equal(runnerCategoryResponse.headers.get("x-global-catalog-source"), "runner");
assert.equal(runnerCalls[0].url, "https://global-runner.used-pick.com/global/api/categories");
assert.equal(runnerCalls[0].headers.get("authorization"), "Bearer independent-global-token");
assert.equal(waits.length, 1);
await Promise.all(waits);
assert.ok(dbCalls.some((call) => /INSERT INTO api_response_cache/.test(call.sql)));

runnerMode = "failure";
const cachedCategoryResponse = await call("/global/api/categories", {}, runnerEnv);
assert.equal(cachedCategoryResponse.status, 200);
assert.deepEqual(await cachedCategoryResponse.json(), runnerCategories);
assert.equal(cachedCategoryResponse.headers.get("x-global-catalog-source"), "d1-cache");
runnerMode = "success";

const searchBody = JSON.stringify({ keyword: "camera", sites: ["mercari_jp"], sort: "price_asc", min_price: 1000, max_price: 50000, limit: 20 });
runnerCalls.length = 0;
waits.length = 0;
const runnerSearch = await call("/global/api/search", { method: "POST", headers: { "content-type": "application/json" }, body: searchBody }, runnerEnv);
assert.equal(runnerSearch.status, 200);
assert.deepEqual(await runnerSearch.json(), runnerPayload);
assert.equal(runnerSearch.headers.get("x-global-search-source"), "runner");
assert.equal(runnerCalls[0].url, "https://global-runner.used-pick.com/global/api/search");
assert.equal(runnerCalls[0].method, "POST");
assert.equal(await runnerCalls[0].clone().text(), searchBody);
assert.equal(runnerCalls[0].headers.get("authorization"), "Bearer independent-global-token");
assert.equal(runnerCalls[0].headers.get("x-used-market-app"), "global");
assert.equal(waits.length, 0, "ephemeral search sessions must not be persisted to D1");

runnerMode = "failure";
runnerCalls.length = 0;
const cachedSearch = await call("/global/api/search", { method: "POST", headers: { "content-type": "application/json" }, body: searchBody }, runnerEnv);
assert.equal(cachedSearch.status, 503, "ephemeral searches must not replay a stale D1 session");
assert.equal(runnerCalls[0].headers.get("authorization"), "Bearer independent-global-token");
runnerMode = "success";

runnerMode = "session_error";
const sessionError = await call("/global/api/search", { method: "POST", headers: { "content-type": "application/json" }, body: searchBody }, runnerEnv);
assert.equal(sessionError.status, 400);
assert.match((await sessionError.json()).error, /^SESSION_EXPIRED:/);
runnerMode = "success";

runnerMode = "busy";
const busySearch = await call("/global/api/search", { method: "POST", headers: { "content-type": "application/json" }, body: searchBody }, runnerEnv);
assert.equal(busySearch.status, 429, "runner 429 must not be rewritten as SEARCH_UNAVAILABLE");
assert.equal(busySearch.headers.get("retry-after"), "5");
assert.equal((await busySearch.json()).code, "SEARCH_BUSY");
runnerMode = "success";

activeRunnerPayload = ebayRunnerPayload;
waits.length = 0;
const ebayRequest = await call("/global/api/search", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ keyword: "camera", sites: ["ebay"] }) }, runnerEnv);
assert.equal(ebayRequest.status, 200);
assert.equal((await ebayRequest.json()).data.items[0].site, "ebay");
assert.equal(waits.length, 0, "eBay responses must not be persisted in D1 cache");
activeRunnerPayload = runnerPayload;

const sessionSearchBody = JSON.stringify({
  keyword: "camera",
  sites: ["mercari_jp"],
  session_id: "session-fixture-123456",
  session_page: 1,
  session_only: true
});
waits.length = 0;
const sessionSearch = await call("/global/api/search", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: sessionSearchBody
}, runnerEnv);
assert.equal(sessionSearch.status, 200);
assert.equal(waits.length, 0, "ephemeral session responses must not be persisted to D1");

runnerMode = "failure";
const failedSessionSearch = await call("/global/api/search", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: sessionSearchBody
}, runnerEnv);
assert.equal(failedSessionSearch.status, 503, "ephemeral session requests must not fall back to a stale D1 response");
runnerMode = "success";

runnerCalls.length = 0;
const refresh = await call("/global/api/search/refresh/token-1", {}, runnerEnv);
assert.equal(refresh.status, 200);
assert.equal(runnerCalls[0].url, "https://global-runner.used-pick.com/global/api/search/refresh/token-1");
assert.equal(runnerCalls[0].headers.get("authorization"), "Bearer independent-global-token");

runnerCalls.length = 0;
const health = await call("/global/api/health", {}, runnerEnv);
assert.equal(health.status, 200);
assert.deepEqual((await health.json()).origin, { configured: true, available: true });
assert.equal(runnerCalls[0].url, "https://global-runner.used-pick.com/global/health");
assert.equal(runnerCalls[0].headers.get("authorization"), null);

assert.equal((await call("/domestic/")).status, 404);

const config = await read("wrangler.jsonc");
for (const contract of [
  '"name": "used-market-global"',
  '"database_name": "used-market-global-free"',
  '"pattern": "global.used-pick.com"',
  '"RUNNER_URL": "https://global-runner.used-pick.com"',
  '"directory": "../web-backend/public"',
  '"binding": "ASSETS"',
  '"run_worker_first": true'
]) assert.ok(config.includes(contract), `config is missing ${contract}`);
assert.doesNotMatch(config, /"RUNNER_TOKEN"|(?<!global-)runner\.used-pick\.com|domestic/);

const migration = await read("migrations/0001_global.sql");
for (const contract of ["search_response_cache", "api_response_cache", "cache_key TEXT PRIMARY KEY", "country TEXT", "request_json TEXT", "response_json TEXT", "expires_at TEXT"]) {
  assert.ok(migration.includes(contract), `migration is missing ${contract}`);
}
assert.match(migration, /CHECK \(country IN \('jp', 'us'\)\)/);
assert.doesNotMatch(migration, /bunjang|joonggonara|hellomarket|rethinkmall/);

const deploy = await read("deploy.mjs");
assert.match(deploy, /global-runner\.used-pick\.com/);
assert.match(deploy, /RUNNER_TOKEN/);
assert.match(deploy, /RUNNER_TOKEN categories preflight/);
assert.match(deploy, /RUNNER_TOKEN search preflight/);
assert.match(deploy, /wrangler[\s\S]*deploy/);
assert.doesNotMatch(deploy, /(?<!global-)runner\.used-pick\.com|domestic/);

const release = await read("release.mjs");
for (const gate of ["harness.mjs", "--dry-run", "deploy.mjs", "/global/api/health", "/global/", "/global/api/categories", "/global/api/search"]) {
  assert.ok(release.includes(gate), `release gate is missing ${gate}`);
}
assert.doesNotMatch(release, /(?<!global-)runner\.used-pick\.com|domestic/);
assert.match(release, /wrangler@4\.124\.0/);
assert.match(release, /Capture current Worker version for rollback/);
assert.match(release, /Automatic rollback after global release smoke failure/);
assert.match(release, /"rollback", previousVersionId/);
assert.doesNotMatch(release, /\["wrangler",/);

globalThis.fetch = originalFetch;
console.log("global Cloudflare contract: existing Assets UI, 2 countries, 7 internal sources, runner-only ephemeral search sessions, D1 category cache, and release gates passed");
