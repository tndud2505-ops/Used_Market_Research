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

const html = await readFile(new URL("../web-backend/public/index.html", import.meta.url), "utf8");
const app = await readFile(new URL("../web-backend/public/app.js", import.meta.url), "utf8");
const privacy = await readFile(new URL("../web-backend/public/privacy.html", import.meta.url), "utf8");
const terms = await readFile(new URL("../web-backend/public/terms.html", import.meta.url), "utf8");
const migration = await readFile(new URL("../cloudflare/migrations/0004_monetization_metrics.sql", import.meta.url), "utf8");

const publicSurface = `${html}\n${app}`;
assert.doesNotMatch(publicSurface, /link\.coupang\.com|COUPANG_|data-coupang|coupang-/u);
assert.doesNotMatch(publicSurface, /referrerpolicy=["']unsafe-url["']/u);
assert.doesNotMatch(publicSurface, /생활필수품|검색 결과 없음[\s\S]{0,500}제휴/u);
assert.match(privacy, /제3자 맞춤형 광고 쿠키를 사용하지 않습니다/u);
assert.match(privacy, /원문 검색어·상품명·전체 URL·영구 사용자 식별자는 광고 측정 정보로 저장하지 않습니다/u);
assert.doesNotMatch(privacy, /카카오 애드핏/u);
assert.match(terms, /제휴 여부는 검색 결과의 추천순이나 가격 통계에 영향을 주지 않습니다/u);

assert.equal((html.match(/id="contextual-offer"/gu) || []).length, 1);
assert.ok(html.indexOf('id="contextual-offer"') > html.indexOf('id="pagination-controls"'));
assert.match(html, /contextual-offer-label">광고</u);
assert.match(html, /수수료를 받을 수 있습니다/u);
assert.match(html, /시세와 추천순에는 영향을 주지 않습니다/u);
assert.match(html, /rel="sponsored noopener noreferrer"/u);
assert.match(app, /\/api\/monetization\/contextual-offer/u);
assert.match(app, /\/api\/monetization\/event/u);
assert.match(app, /event_token: offer\.event_token/u);
assert.match(app, /void refreshContextualOffer\(product\)/u);
assert.ok(app.indexOf("void refreshContextualOffer(product)") > app.indexOf("state.selectedProduct = product"));
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

console.log("monetization trust contract: ok");
