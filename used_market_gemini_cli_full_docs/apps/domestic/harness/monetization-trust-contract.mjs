import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";

import worker from "../cloudflare/worker.mjs";
import {
  issueMonetizationEventToken,
  purgeMonetizationMetrics,
  recordMonetizationEvent,
  selectContextualOffer
} from "../cloudflare/affiliate-registry.mjs";
import { COUPANG_COMMISSION_DISCLOSURE, createContextualAffiliate, validContextualOffer } from "../web-backend/public/affiliate.js";

const html = await readFile(new URL("../web-backend/public/index.html", import.meta.url), "utf8");
const app = await readFile(new URL("../web-backend/public/app.js", import.meta.url), "utf8");
const privacy = await readFile(new URL("../web-backend/public/privacy.html", import.meta.url), "utf8");
const terms = await readFile(new URL("../web-backend/public/terms.html", import.meta.url), "utf8");
const migration = await readFile(new URL("../cloudflare/migrations/0004_monetization_metrics.sql", import.meta.url), "utf8");
const affiliateUi = await readFile(new URL("../web-backend/public/affiliate.js", import.meta.url), "utf8");
const productionConfig = JSON.parse(await readFile(new URL("../cloudflare/wrangler.jsonc", import.meta.url), "utf8"));

const publicSurface = `${html}\n${app}\n${affiliateUi}`;
assert.doesNotMatch(publicSurface, /ads-partners\.coupang\.com|<iframe|<script[^>]+src=["']https:\/\/[^"']*coupang/u);
assert.doesNotMatch(publicSurface, /referrerpolicy=["']unsafe-url["']/u);
assert.doesNotMatch(publicSurface, /생활필수품|검색 결과 없음[\s\S]{0,500}제휴/u);
assert.match(privacy, /제3자 맞춤형 광고 쿠키를 사용하지 않습니다/u);
assert.match(privacy, /원문 검색어·상품명·전체 URL·영구 사용자 식별자는 광고 측정 정보로 저장하지 않습니다/u);
assert.doesNotMatch(privacy, /카카오 애드핏/u);
assert.match(terms, /제휴 여부는 검색 결과의 추천순이나 가격 통계에 영향을 주지 않습니다/u);

assert.equal([...html.matchAll(/id="contextual-offer"/gu)].length, 1);
assert.match(html, /id="contextual-offer"[^>]+hidden/u, "the shell must not publish an unverified ad");
assert.ok(html.indexOf('id="contextual-offer"') > html.indexOf('class="listing-heading"'));
assert.ok(html.indexOf('id="contextual-offer"') < html.indexOf('id="listing-message"'));
assert.match(affiliateUi, /sponsored noopener noreferrer/u);
assert.match(affiliateUi, /referrerPolicy: "no-referrer"/u);
assert.match(affiliateUi, /credentials: "omit"/u);
assert.match(affiliateUi, /affiliate-icon/u);
assert.match(affiliateUi, /offer\.cta_label\} →/u);
assert.doesNotMatch(migration, /query|title|url|ip|user|session/iu);

const now = new Date("2026-08-29T00:00:00.000Z");
const validOffer = {
  offer_id: "gpu-rtx3080-approved",
  provider: "PC Partner",
  title: "RTX 3080 호환 부품",
  cta_label: "상품 보기",
  destination_url: "https://parts.example/products/rtx-3080-accessory?aff=used-pick",
  canonical_product_id: "gpu:nvidia:rtx-3080",
  approved: true,
  reviewed_at: "2026-08-01T00:00:00.000Z",
  expires_at: "2026-12-31T00:00:00.000Z"
};
const validEnv = {
  MONETIZATION_ENABLED: "true",
  MONETIZATION_EVENT_SECRET: "test-only-secret-at-least-32-characters-long",
  AFFILIATE_ALLOWED_ORIGINS: "https://parts.example",
  AFFILIATE_OFFERS_JSON: JSON.stringify([validOffer])
};
const context = {
  canonical_product_id: "gpu:nvidia:rtx-3080",
  category_code: "GPU",
  slot: "after-organic-results"
};

assert.equal(selectContextualOffer({ ...validEnv, MONETIZATION_ENABLED: "false" }, context, { now }), null);
assert.equal(selectContextualOffer({ ...validEnv, MONETIZATION_EVENT_SECRET: "" }, context, { now }), null);
assert.equal(selectContextualOffer({ ...validEnv, MONETIZATION_EVENT_SECRET: "too-short" }, context, { now }), null);
assert.equal(selectContextualOffer(validEnv, { ...context, canonical_product_id: "gpu:nvidia:rtx-4090" }, { now }), null);
assert.equal(selectContextualOffer({ ...validEnv, AFFILIATE_ALLOWED_ORIGINS: "https://other.example" }, context, { now }), null);
assert.equal(selectContextualOffer({ ...validEnv, AFFILIATE_OFFERS_JSON: "{" }, context, { now }), null);
assert.equal(selectContextualOffer(validEnv, { ...context, raw_query: "RTX 3080" }, { now }), null);
assert.equal(selectContextualOffer({
  ...validEnv,
  AFFILIATE_OFFERS_JSON: JSON.stringify([validOffer, { ...validOffer, title: "중복 ID" }])
}, context, { now }), null);
assert.equal(selectContextualOffer({
  ...validEnv,
  AFFILIATE_OFFERS_JSON: JSON.stringify([{ ...validOffer, destination_url: "https://parts.example/?aff=used-pick" }])
}, context, { now }), null);
assert.equal(selectContextualOffer({
  ...validEnv,
  AFFILIATE_OFFERS_JSON: JSON.stringify([{ ...validOffer, expires_at: "2026-08-01T00:00:00.000Z" }])
}, context, { now }), null);
const selected = selectContextualOffer(validEnv, context, { now });
assert.equal(selected.offer_id, validOffer.offer_id);
assert.equal(selected.context_type, "canonical_product");
assert.equal(selected.disclosure.advertisement, "광고");
const categoryOffer = {
  ...validOffer,
  offer_id: "gpu-category-approved",
  destination_url: "https://parts.example/categories/gpu?aff=used-pick",
  canonical_product_id: undefined,
  category_code: "GPU"
};
const categorySelected = selectContextualOffer({
  ...validEnv,
  AFFILIATE_OFFERS_JSON: JSON.stringify([categoryOffer])
}, { category_code: "GPU", slot: "after-organic-results" }, { now });
assert.equal(categorySelected.offer_id, categoryOffer.offer_id);
assert.equal(categorySelected.context_type, "category");

const reviewedAt = new Date("2026-09-08T01:00:00.000Z");
const configuredEnv = { ...productionConfig.vars, MONETIZATION_EVENT_SECRET: validEnv.MONETIZATION_EVENT_SECRET };
const configuredCategories = productionConfig.vars.AFFILIATE_OFFERS_JSON.map((offer) => offer.category_code).sort();
assert.deepEqual(configuredCategories, ["CPU", "GPU", "HDD", "MOTHERBOARD", "PSU", "RAM", "SSD"]);
for (const category of configuredCategories) {
  const offerContext = { category_code: category, slot: "after-organic-results" };
  const offer = selectContextualOffer(configuredEnv, offerContext, { now: reviewedAt });
  assert.ok(offer);
  assert.equal(offer.context_key, category);
  assert.match(offer.destination_url, /^https:\/\/link\.coupang\.com\/a\/[A-Za-z0-9]+$/u);
  assert.equal(offer.disclosure.commission, COUPANG_COMMISSION_DISCLOSURE);
  assert.deepEqual(selectContextualOffer({ ...configuredEnv,
    AFFILIATE_OFFERS_JSON: JSON.stringify(productionConfig.vars.AFFILIATE_OFFERS_JSON),
  }, offerContext, { now: reviewedAt }), offer, "JSON bindings and env-file JSON must agree");
}
assert.equal(selectContextualOffer(configuredEnv, { category_code: "MOBILE", slot: "after-organic-results" }, { now: reviewedAt }), null);
assert.equal(selectContextualOffer(configuredEnv, { category_code: "CPU", slot: "after-organic-results" },
  { now: new Date("2027-03-09T00:00:00Z") }), null, "expired campaigns must fail closed");

const uiContext = { category_code: "CPU", slot: "after-organic-results" };
const uiOffer = {
  ...selectContextualOffer(configuredEnv, uiContext, { now: reviewedAt }),
  event_token: "fixture.signature", event_token_expires_at: "2026-09-08T01:05:00Z",
};
assert.equal(validContextualOffer(uiOffer, uiContext, reviewedAt.getTime()), true);
for (const change of [
  { destination_url: "https://evil.example/a/link" },
  { destination_url: "https://link.coupang.com/" },
  { context_key: "GPU" }, { context_type: "unknown" },
  { disclosure: { ...uiOffer.disclosure, commission: "" } },
  { expires_at: "2026-01-01" }, { event_token_expires_at: "2026-01-01" },
]) assert.equal(validContextualOffer({ ...uiOffer, ...change }, uiContext, reviewedAt.getTime()), false);

function d1Adapter(database, options = {}) {
  return {
    async batch(statements) {
      database.exec("BEGIN IMMEDIATE");
      try {
        const results = [];
        for (let index = 0; index < statements.length; index += 1) {
          if (options.failBatchAt === index) throw new Error("injected batch failure");
          results.push(await statements[index].run());
        }
        database.exec("COMMIT");
        return results;
      } catch (error) {
        database.exec("ROLLBACK");
        throw error;
      }
    },
    prepare(sql) {
      return {
        bind(...values) {
          const statement = database.prepare(sql);
          return {
            async all() { return { results: statement.all(...values) }; },
            async first() { return statement.get(...values) || null; },
            async run() { return statement.run(...values); }
          };
        },
        async all() { return { results: database.prepare(sql).all() }; },
        async first() { return database.prepare(sql).get() || null; },
        async run() { return database.prepare(sql).run(); }
      };
    }
  };
}

const database = new DatabaseSync(":memory:");
database.exec(migration);
const env = { ...validEnv, DB: d1Adapter(database) };
const offerResponse = await worker.fetch(new Request("https://used-pick.test/api/monetization/contextual-offer", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify(context)
}), env);
assert.equal(offerResponse.status, 200);
const responseOffer = (await offerResponse.json()).data.offer;
assert.equal(responseOffer.offer_id, validOffer.offer_id);
assert.match(responseOffer.event_token, /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/u);

const missingSecretResponse = await worker.fetch(new Request("https://used-pick.test/api/monetization/contextual-offer", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify(context)
}), { ...env, MONETIZATION_EVENT_SECRET: "" });
assert.equal(missingSecretResponse.status, 200);
assert.equal((await missingSecretResponse.json()).data.offer, null);

const eventBody = {
  event_type: "impression",
  offer_id: validOffer.offer_id,
  slot: "after-organic-results",
  context_type: "canonical_product",
  context_key: "gpu:nvidia:rtx-3080",
  event_token: responseOffer.event_token
};
const forgedResponse = await worker.fetch(new Request("https://used-pick.test/api/monetization/event", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({
    ...eventBody,
    event_token: `${responseOffer.event_token.slice(0, -1)}${responseOffer.event_token.endsWith("a") ? "b" : "a"}`
  })
}), env);
assert.equal(forgedResponse.status, 400);

const deterministicToken = await issueMonetizationEventToken(validEnv, selected, { now });
assert.ok(deterministicToken?.token);
const expiredRecorded = await recordMonetizationEvent(env.DB, validEnv, {
  ...eventBody,
  event_token: deterministicToken.token
}, { now: new Date(now.getTime() + 301_000) });
assert.equal(expiredRecorded, false);

const impressionResponse = await worker.fetch(new Request("https://used-pick.test/api/monetization/event", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify(eventBody)
}), env);
assert.equal(impressionResponse.status, 204);
const replayedImpressionResponse = await worker.fetch(new Request("https://used-pick.test/api/monetization/event", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify(eventBody)
}), env);
assert.equal(replayedImpressionResponse.status, 400);
const clickResponse = await worker.fetch(new Request("https://used-pick.test/api/monetization/event", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ ...eventBody, event_type: "click" })
}), env);
assert.equal(clickResponse.status, 204);
const rejectedSensitiveEvent = await worker.fetch(new Request("https://used-pick.test/api/monetization/event", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ ...eventBody, raw_query: "RTX 3080" })
}), env);
assert.equal(rejectedSensitiveEvent.status, 400);
const rejectedMissingToken = await worker.fetch(new Request("https://used-pick.test/api/monetization/event", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ ...eventBody, event_token: undefined })
}), env);
assert.equal(rejectedMissingToken.status, 400);
const metric = database.prepare("SELECT * FROM monetization_daily_metrics").get();
assert.equal(metric.impressions, 1);
assert.equal(metric.clicks, 1);
assert.equal(metric.context_key, "gpu:nvidia:rtx-3080");
database.prepare(`INSERT INTO monetization_daily_metrics
  (date_key, offer_id, slot, context_type, context_key, impressions, clicks, updated_at)
  VALUES ('2025-01-01', 'old-offer', 'after-organic-results', 'category', 'GPU', 1, 0, '2025-01-01T00:00:00.000Z')`).run();
await purgeMonetizationMetrics(env.DB, now);
assert.equal(database.prepare("SELECT COUNT(*) AS count FROM monetization_daily_metrics WHERE offer_id = 'old-offer'").get().count, 0);

const atomicDatabase = new DatabaseSync(":memory:");
atomicDatabase.exec(migration);
await assert.rejects(() => recordMonetizationEvent(d1Adapter(atomicDatabase, { failBatchAt: 1 }), validEnv, {
  ...eventBody,
  event_token: deterministicToken.token
}, { now }), /injected batch failure/u);
assert.equal(atomicDatabase.prepare("SELECT COUNT(*) AS count FROM monetization_event_dedup").get().count, 0,
  "failed metric updates must roll back the dedup receipt");
assert.equal(await recordMonetizationEvent(d1Adapter(atomicDatabase), validEnv, {
  ...eventBody,
  event_token: deterministicToken.token
}, { now }), true, "the same event must remain retryable after an atomic rollback");
assert.equal(atomicDatabase.prepare("SELECT impressions FROM monetization_daily_metrics").get().impressions, 1);
atomicDatabase.close();
database.close();

const originalFetch = globalThis.fetch;
const originalDocument = globalThis.document;
const originalObserver = globalThis.IntersectionObserver;
const uiRequests = [];
const observations = [];
const pendingUi = [];
class UiNode {
  constructor(tag) { this.tag = tag; this.children = []; this.handlers = {}; this.attributes = {}; }
  append(...children) { this.children.push(...children); }
  replaceChildren(...children) { this.children = children; }
  setAttribute(key, value) { this.attributes[key] = value; }
  addEventListener(event, handler) { this.handlers[event] = handler; }
}
try {
  globalThis.document = {
    createElement: (tag) => new UiNode(tag),
    createElementNS: (_namespace, tag) => new UiNode(tag),
  };
  globalThis.IntersectionObserver = class {
    constructor(callback) { this.callback = callback; observations.push(this); }
    observe() {}
    disconnect() { this.disconnected = true; }
  };
  globalThis.fetch = (url, options) => {
    uiRequests.push({ url, options });
    if (url.endsWith("/contextual-offer")) return new Promise((resolve) => pendingUi.push(resolve));
    return Promise.resolve({ ok: true, status: 204 });
  };
  const root = new UiNode("section");
  const client = createContextualAffiliate(root, { now: () => reviewedAt.getTime() });
  await client.update({ hasResults: false, category_code: "CPU" });
  assert.equal(uiRequests.length, 0, "empty organic results must not even request advertising");
  const firstRender = client.update({ hasResults: true, category_code: "CPU", raw_query: "never-log-this" });
  pendingUi[0]({ ok: true, json: async () => ({ ok: true, data: { offer: uiOffer } }) });
  await firstRender;
  assert.equal(root.hidden, false);
  assert.match(root.children[1].textContent, new RegExp(`^${COUPANG_COMMISSION_DISCLOSURE}`), "disclosure must stay next to the ad link");
  const flatten = (node) => [node, ...node.children.flatMap(flatten)];
  const adLink = flatten(root).find((child) => child.tag === "a");
  assert.equal(adLink.rel, "sponsored noopener noreferrer");
  assert.equal(adLink.referrerPolicy, "no-referrer");
  assert.equal(adLink.href, uiOffer.destination_url);
  assert.equal(uiRequests.length, 1, "an off-screen offer must not count as an impression");
  observations[0].callback([{ isIntersecting: true, intersectionRatio: 0.3 }]);
  assert.equal(uiRequests.length, 1);
  observations[0].callback([{ isIntersecting: true, intersectionRatio: 0.6 }]);
  observations[0].callback([{ isIntersecting: true, intersectionRatio: 1 }]);
  adLink.handlers.click();
  adLink.handlers.click();
  assert.equal(uiRequests.length, 3, "one visible impression and one click must be sent per token");
  for (const request of uiRequests) {
    assert.doesNotMatch(request.options.body, /never-log-this|raw_query|destination_url|title|user_id/u);
    assert.equal(request.options.referrerPolicy, "no-referrer");
    assert.equal(request.options.credentials, "omit");
  }
  await client.update({ hasResults: true, category_code: "CPU" });
  assert.equal(uiRequests.length, 3, "the same rendered context should reuse its offer");
  client.clear();
  const stale = client.update({ hasResults: true, category_code: "CPU" });
  const current = client.update({ hasResults: true, category_code: "GPU" });
  const gpuOffer = { ...uiOffer, context_key: "GPU", title: "GPU", cta_label: "GPU 상품 보기" };
  pendingUi[2]({ ok: true, json: async () => ({ ok: true, data: { offer: gpuOffer } }) });
  await current;
  pendingUi[1]({ ok: true, json: async () => ({ ok: true, data: { offer: uiOffer } }) });
  await stale;
  assert.match(flatten(root).find((child) => child.tag === "a").textContent, /GPU/u,
    "a late response must never put a CPU ad on GPU results");
  observations[0].callback([{ isIntersecting: true, intersectionRatio: 1 }]);
  assert.notEqual(observations.at(-1).disconnected, true, "stale observers must not disconnect the current offer");
  const invalid = client.update({ hasResults: true, category_code: "RAM" });
  pendingUi[3]({ ok: true, json: async () => ({ ok: true, data: { offer: { ...uiOffer, context_key: "RAM", disclosure: {} } } }) });
  await invalid;
  assert.equal(root.hidden, true, "a response missing its mandatory disclosure must remain invisible");
  assert.equal(root.children.length, 0);
} finally {
  globalThis.fetch = originalFetch;
  if (originalDocument === undefined) delete globalThis.document;
  else globalThis.document = originalDocument;
  if (originalObserver === undefined) delete globalThis.IntersectionObserver;
  else globalThis.IntersectionObserver = originalObserver;
}

console.log("monetization trust contract: ok");
