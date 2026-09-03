import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import { collectOne, resetEbayAccessTokenCacheForTests } from "../cloudflare/live-search.mjs";
import { OPERATIONAL_PC_DIRECTORY_SITES, OPERATIONAL_TARGET_SITES } from "../cloudflare/target-sites.mjs";
import {
  PC_SOURCE_REGISTRY,
  getPcSource,
  getSourceRuntimeDefaults,
  operatorAttestedSourceGovernance,
  runDueSourceCollections,
  runSourceCollection,
  sourceRuntimeForScheduler,
  validateSourceActivation,
  validateSourceGovernance
} from "../collector/logic/pc-source-registry.mjs";
import {
  collectDanawaCategoryListings,
  createSourceAdapter,
  parseBunjangPartnerCatalogCsv,
  parseCoolenjoyListingsHtml,
  parseDanawaListingsHtml,
} from "../collector/logic/pc-source-adapters.mjs";
import {
  PC_PART_CATEGORY_CODES,
  assertDanawaPcCategoryCoverage,
  assertEbayPcCategoryCoverage,
  danawaTargetsForCategory,
  ebayTargetForCategory,
  pcCategoryTitleMatches,
  trustedSpecialistCategory
} from "../collector/logic/pc-specialist-targets.mjs";
import { explicitSoldText } from "../market/logic/listing-lifecycle.mjs";
import { PC_PRODUCT_MASTER_V2 } from "../market/data/pc-product-master-v2.mjs";
import { pcCollectionTargetSetV2 } from "../cloudflare/pc-directory-http.mjs";

const liveCanary = Object.freeze({
  observed_at: "2026-08-29T00:01:00.000Z",
  request_succeeded: true,
  request_count: 1,
  parser_version: "fixture-parser-v1",
  http_status: 200,
  parsed_count: 1,
  parse_failure_count: 0,
  http_blocked_count: 0,
  captcha_count: 0
});
const activationClock = Object.freeze({ now: "2026-08-29T01:00:00.000Z" });

assert.equal(new Set(PC_SOURCE_REGISTRY.map((source) => source.key)).size, PC_SOURCE_REGISTRY.length);
assert.deepEqual(Object.fromEntries(PC_SOURCE_REGISTRY.map((source) => [source.key, source.cadence.kst_minutes])), {
  joonggonara: [4, 34], bunjang: [11], daangn: [15], danawa: [19, 49], hellomarket: [27],
  rethinkmall: [36], ebay: [44], coolenjoy: [52]
});
assert.ok(PC_SOURCE_REGISTRY.every((source) => source.cadence.jitter_max_seconds === 120));
for (const source of PC_SOURCE_REGISTRY) {
  const operational = OPERATIONAL_TARGET_SITES.includes(source.key);
  assert.equal(
    operational,
    source.public_search && source.policy_status === "APPROVED" && source.runtime_status === "ENABLED",
    `${source.key}: operational target must follow policy and runtime state`
  );
}
const deniedSource = getPcSource("daangn");
assert.equal(deniedSource.policy_status, "DENIED");
assert.equal(validateSourceActivation({ ...deniedSource, policy_status: "APPROVED", runtime_status: "ENABLED" }, {
  policy_reviewed_at: "2026-08-29T00:00:00.000Z",
  approved_access_mode: deniedSource.access.strategy,
  live_canary: liveCanary,
  operator_enabled: true
}, activationClock).reason, "POLICY_DENIED", "a cloned source object cannot override canonical policy");

const operatorAttestedDirectorySources = [
  "joonggonara", "bunjang", "danawa", "hellomarket", "coolenjoy"
];
for (const key of operatorAttestedDirectorySources) {
  const source = getPcSource(key);
  assert.equal(source.policy_status, "APPROVED", `${key}: operator-attested permission must enable policy`);
  assert.equal(source.runtime_status, "ENABLED", `${key}: approved PC directory source must be scheduler-ready`);
  assert.equal(source.approval_basis, "OPERATOR_ATTESTED_DIRECT_PERMISSION");
  assert.equal(source.approval_attested_at, "2026-08-31");
  assert.equal(source.approval_scope, "PC_PARTS_COLLECTION_AND_PUBLICATION");
  assert.equal(source.access_constraints, "PUBLIC_ROUTES_ONLY_NO_AUTH_OR_BLOCK_BYPASS");
  assert.equal(validateSourceActivation(key, {}).reason, "POLICY_REVIEW_MISSING",
    `${key}: registry approval must not bypass runtime governance and live-canary evidence`);
  const fallbackGovernance = operatorAttestedSourceGovernance(key, { now: "2026-08-31T12:00:00.000Z" });
  assert.ok(fallbackGovernance, `${key}: exact registry attestation must produce controlled fallback governance`);
  assert.equal(validateSourceGovernance(key, fallbackGovernance, { now: "2026-08-31T12:00:00.000Z" }).ok, true);
  assert.notEqual(validateSourceActivation(key, fallbackGovernance, { now: "2026-08-31T12:00:00.000Z" }).ok, true,
    `${key}: the strict canary validator remains unchanged`);
  assert.equal(validateSourceGovernance(key, {
    ...fallbackGovernance,
    access_constraints: "PUBLIC_ROUTES_WITH_BLOCK_BYPASS"
  }, { now: "2026-08-31T12:00:00.000Z" }).reason, "REGISTRY_OPERATOR_ATTESTATION_MISMATCH",
  `${key}: fallback governance cannot weaken the no-bypass constraint`);
}
assert.equal(operatorAttestedSourceGovernance("ebay", { now: "2026-08-31T12:00:00.000Z" }), null,
  "ordinary APPROVED sources without the exact operator attestation fields cannot use the fallback");

assert.throws(() => getPcSource("quasarzone"), /UNKNOWN_PC_SOURCE:quasarzone/u,
  "removed sources must not be addressable by the operational registry");

assert.equal(getPcSource("bunjang").policy_status, "APPROVED");
assert.equal(getPcSource("bunjang").runtime_status, "ENABLED");
assert.equal(getPcSource("bunjang").policy_basis_url, "https://terms.bunjang.co.kr/terms/service.html");
assert.equal(getPcSource("bunjang").partner_application_url, "https://sell-global.bunjang.co.kr/");
assert.equal(getPcSource("bunjang").partner_api_docs_url, "https://api.bgzt.guide/");
assert.equal(getPcSource("bunjang").access.strategy, "public_site_json");
assert.equal(getPcSource("bunjang").access.api_only_required, false,
  "operator-attested permission keeps Bunjang on its existing public site script");
assert.equal(OPERATIONAL_TARGET_SITES.includes("bunjang"), true);
assert.equal(getPcSource("daangn").policy_status, "DENIED");
assert.equal(getPcSource("daangn").policy_basis_url, "https://www.daangn.com/robots.txt");
assert.equal(OPERATIONAL_TARGET_SITES.includes("daangn"), false);
assert.equal(getPcSource("danawa").policy_status, "APPROVED");
assert.equal(getPcSource("danawa").runtime_status, "ENABLED");
assert.equal(getPcSource("danawa").directory_source, true);
assert.equal(OPERATIONAL_TARGET_SITES.includes("danawa"), false, "specialist collection must not re-enable foreground live search");
assert.equal(OPERATIONAL_PC_DIRECTORY_SITES.includes("danawa"), true);
assert.equal(getPcSource("joonggonara").directory_source, true,
  "approved Joonggonara collection must feed the precollected PC directory");
assert.equal(getPcSource("hellomarket").directory_source, true,
  "approved Hellomarket collection must feed the precollected PC directory");
assert.equal(getPcSource("hellomarket").policy_status, "APPROVED");
assert.equal(getPcSource("hellomarket").policy_basis_url, "https://hellomarket.com/terms.hm");
assert.equal(OPERATIONAL_TARGET_SITES.includes("hellomarket"), false);
assert.equal(getPcSource("bunjang").directory_source, true,
  "approved Bunjang collection must feed the precollected PC directory");
assert.deepEqual(OPERATIONAL_PC_DIRECTORY_SITES,
  ["joonggonara", "bunjang", "danawa", "hellomarket", "rethinkmall", "ebay", "coolenjoy"]);
assert.equal(OPERATIONAL_PC_DIRECTORY_SITES.includes("bunjang"), true);
const collectionTargetSet = pcCollectionTargetSetV2();
const specialistTargets = collectionTargetSet.targets.filter((target) => target.sourceKeys.includes("danawa"));
const marketplaceTargets = collectionTargetSet.targets.filter((target) => target.sourceKeys.includes("joonggonara"));
const hellomarketTargets = collectionTargetSet.targets.filter((target) => target.sourceKeys.includes("hellomarket"));
const bunjangTargets = collectionTargetSet.targets.filter((target) => target.sourceKeys.includes("bunjang"));
const rethinkmallTargets = collectionTargetSet.targets.filter((target) => target.sourceKeys.includes("rethinkmall"));
const hourlyMarketplaceTargets = marketplaceTargets.filter((target) => target.cadenceClass === "HOURLY_CATEGORY");
const dailyMarketplaceTargets = marketplaceTargets.filter((target) => target.cadenceClass === "DAILY_MASTER");
assert.equal(specialistTargets.length, 11);
assert.equal(hourlyMarketplaceTargets.length, 19);
assert.equal(hellomarketTargets.length, marketplaceTargets.length,
  "approved Hellomarket receives the same full PC master sweep as other search marketplaces");
assert.equal(bunjangTargets.length, marketplaceTargets.length,
  "approved Bunjang receives the same full PC master sweep as other search marketplaces");
assert.equal(rethinkmallTargets.length, marketplaceTargets.length,
  "refurbished PC retail receives the same master sweep in its separate market pool");
assert.ok(dailyMarketplaceTargets.length >= PC_PRODUCT_MASTER_V2.length,
  "every master node must receive at least one daily marketplace query");
assert.deepEqual(
  [...new Set(dailyMarketplaceTargets.map((target) => target.canonicalProductId))].sort(),
  PC_PRODUCT_MASTER_V2.map((product) => product.id).sort(),
  "daily target generation must cover the complete versioned product master"
);
assert.ok(dailyMarketplaceTargets.every((target) => target.minimumIntervalMinutes === 24 * 60));
assert.deepEqual([...new Set(specialistTargets.map((target) => target.categoryCode))].sort(), [...PC_PART_CATEGORY_CODES].sort());
assert.deepEqual([...new Set(marketplaceTargets.map((target) => target.categoryCode))].sort(), [...PC_PART_CATEGORY_CODES].sort());
for (const sourceKey of OPERATIONAL_PC_DIRECTORY_SITES) {
  const sourceCategories = new Set(collectionTargetSet.targets
    .filter((target) => target.enabled !== false && target.sourceKeys.includes(sourceKey))
    .map((target) => target.categoryCode));
  assert.deepEqual([...sourceCategories].sort(), [...PC_PART_CATEGORY_CODES].sort(),
    `${sourceKey}: every operational PC source must have a target for every part category`);
}
assert.ok(marketplaceTargets.every((target) => !/MONITOR|모니터/iu.test(`${target.categoryCode} ${target.queryText}`)));
assert.ok(collectionTargetSet.targets.every((target) => !/MONITOR|모니터/iu.test(`${target.categoryCode} ${target.queryText}`)));
assert.ok(hourlyMarketplaceTargets.some((target) => target.categoryCode === "MOTHERBOARD" && target.queryText === "메인보드"));
assert.ok(hourlyMarketplaceTargets.some((target) => target.categoryCode === "CASE" && target.queryText === "컴퓨터 케이스"));
assert.equal(assertDanawaPcCategoryCoverage(), true);
assert.deepEqual(Object.keys(Object.fromEntries(PC_PART_CATEGORY_CODES.map((code) => [code, danawaTargetsForCategory(code).length]))).sort(),
  [...PC_PART_CATEGORY_CODES].sort());
const bunjangCatalogFixture = [
  "pid,name,description,quantity,price,shippingFee,condition,saleStatus,keywords,images,categoryId,brandId,options,uid,updatedAt,createdAt",
  "1001,MSI RTX 3060 12GB,working,1,300000,0,USED,SELLING,RTX 3060,https://media.bunjang.co.kr/product/1001.jpg,600700001,110,\"[{\"\"id\"\":\"\"memory\"\",\"\"value\"\":\"\"12GB\"\"}]\",99,2026-08-31T00:10:00Z,2026-08-30T00:00:00Z",
  "1002,ASUS RTX 3070,removed,1,350000,0,USED,DELETED,RTX 3070,https://media.bunjang.co.kr/product/1002.jpg,600700001,111,,100,2026-08-31T00:10:00Z,2026-08-29T00:00:00Z"
].join("\n");
const bunjangCatalogRows = parseBunjangPartnerCatalogCsv(bunjangCatalogFixture);
assert.equal(bunjangCatalogRows.length, 2);
assert.deepEqual(bunjangCatalogRows.map((item) => item.status), ["ACTIVE", "DELETED"],
  "the official segment feed's DELETED state must never be fabricated as SOLD");
assert.equal(bunjangCatalogRows[0].source_listing_id, "1001");
assert.equal(bunjangCatalogRows[0].url, "https://m.bunjang.co.kr/products/1001");
assert.equal(bunjangCatalogRows[0].image_url, "https://media.bunjang.co.kr/product/1001.jpg");
assert.equal(bunjangCatalogRows[0].source_category_code, "600700001");
assert.equal(Object.hasOwn(bunjangCatalogRows[0].raw_payload, "uid"), false,
  "the public partner catalog parser must not retain the seller shop identifier");
assert.equal(getPcSource("coolenjoy").policy_status, "APPROVED");
assert.equal(getPcSource("coolenjoy").runtime_status, "ENABLED");
assert.equal(OPERATIONAL_TARGET_SITES.includes("coolenjoy"), false);
assert.equal(validateSourceActivation("joonggonara", {
  policy_reviewed_at: "2026-08-29T00:00:00.000Z",
  activation_checked_at: "2026-08-29T01:00:00.000Z",
  approved_access_mode: getPcSource("joonggonara").access.strategy,
  live_canary_passed: true,
  operator_enabled: true
}, activationClock).reason, "LIVE_CANARY_EVIDENCE_MISSING", "a boolean canary claim is not auditable activation evidence");
assert.equal(validateSourceActivation("joonggonara", {
  policy_reviewed_at: "2026-08-29T00:00:00.000Z",
  activation_checked_at: "2026-08-29T01:00:00.000Z",
  approved_access_mode: getPcSource("joonggonara").access.strategy,
  live_canary: { ...liveCanary, captcha_count: 1 },
  operator_enabled: true
}, activationClock).reason, "LIVE_CANARY_NOT_PASSED");
assert.equal(validateSourceActivation("joonggonara", {
  policy_reviewed_at: "2026-08-29T00:00:00.000Z",
  activation_checked_at: "2026-08-29T01:00:00.000Z",
  approved_access_mode: getPcSource("joonggonara").access.strategy,
  live_canary: liveCanary,
  operator_enabled: true
}, activationClock).ok, true);
assert.equal(validateSourceActivation("joonggonara", {
  policy_reviewed_at: "2026-07-28T00:00:00.000Z",
  activation_checked_at: "2026-08-29T01:00:00.000Z",
  approved_access_mode: getPcSource("joonggonara").access.strategy,
  live_canary: { ...liveCanary, observed_at: "2026-07-28T00:01:00.000Z" },
  operator_enabled: true
}, activationClock).reason, "LIVE_CANARY_STALE_OR_INVALID");
assert.equal(validateSourceActivation("joonggonara", {
  policy_reviewed_at: "2026-08-29T00:00:00.000Z",
  activation_checked_at: "2026-08-29T01:00:00.000Z",
  approved_access_mode: getPcSource("joonggonara").access.strategy,
  live_canary: { ...liveCanary, observed_at: "2026-08-30T00:01:00.000Z" },
  operator_enabled: true
}, activationClock).reason, "LIVE_CANARY_STALE_OR_INVALID");
assert.equal(validateSourceActivation("joonggonara", {
  policy_reviewed_at: "2026-08-29T00:00:00.000Z",
  activation_checked_at: "2026-08-29T01:00:00.000Z",
  approved_access_mode: getPcSource("joonggonara").access.strategy,
  live_canary: { ...liveCanary, parsed_count: 0 },
  operator_enabled: true
}, activationClock).reason, "LIVE_CANARY_NO_PARSE_OR_ASSERTION_EVIDENCE");
assert.equal(validateSourceActivation("joonggonara", {
  policy_reviewed_at: "2026-08-29T00:00:00.000Z",
  activation_checked_at: "2026-08-29T01:00:00.000Z",
  approved_access_mode: getPcSource("joonggonara").access.strategy,
  live_canary: { ...liveCanary, parsed_count: 0, assertions: [{ name: "api_contract", passed: true }] },
  operator_enabled: true
}, activationClock).ok, true, "zero-result canaries require explicit parser or API-contract assertions");
assert.equal(validateSourceActivation("joonggonara", {
  policy_reviewed_at: "2098-12-31T00:00:00.000Z",
  activation_checked_at: "2099-01-02T00:00:00.000Z",
  approved_access_mode: getPcSource("joonggonara").access.strategy,
  live_canary: { ...liveCanary, observed_at: "2099-01-01T00:00:00.000Z" },
  operator_enabled: true
}, activationClock).reason, "POLICY_REVIEW_IN_FUTURE",
"untrusted governance timestamps cannot move the validator clock into the future");

assert.equal(explicitSoldText("2개 중 1개 판매완료, 남은 1개 판매"), null);
assert.equal(explicitSoldText("판매완료"), "판매완료");

const specialistFixtures = await Promise.all([
  readFile(new URL("./fixtures/source-pages/danawa-market.html", import.meta.url), "utf8"),
  readFile(new URL("./fixtures/source-pages/coolenjoy-market.html", import.meta.url), "utf8")
]);
assert.deepEqual(parseDanawaListingsHtml(specialistFixtures[0]), [{
  source_listing_id: "31001", url: "https://dmall.danawa.com/bbs/?seq=31001",
  title: "RTX 3080 정상 작동", price: 450_000, currency: "KRW", status: "ACTIVE",
  image_url: "https://img.danawa.test/market/31001.jpg",
  raw_payload: {
    source_listing_id: "31001", href: "/bbs/?seq=31001", title_text: "RTX 3080 정상 작동",
    price_text: "450,000원", status_text: "판매 중"
  }
}]);
assert.equal(parseCoolenjoyListingsHtml(specialistFixtures[1])[0]?.status, "SOLD");
assert.equal(parseCoolenjoyListingsHtml(specialistFixtures[1])[0]?.price, 120_000);
const currentCoolenjoyMarkup = `<ul class="na-table">
  <li class="d-md-table-row border-bottom">
    <div><div id="abcd">판매완료</div></div>
    <div><a href="https://coolenjoy.net/bbs/mart2/1283457?sfl=wr_subject&amp;stx=RTX+3080" class="na-subject">MSI RTX 3080 Suprim X 판매합니다</a></div>
    <div class="nw-11"><span class="sr-only">판매가</span>420,000 원</div>
    <div class="nw-9"><img src="https://coolenjoy.net/img/level/n10.svg" alt="회원등급"></div>
    <div class="nw-6"><span class="sr-only">등록일</span>10:59</div>
  </li>
  <li class="d-md-table-row border-bottom">
    <div><div id="abcd">구매</div></div>
    <div><a href="/bbs/mart2/1281399" class="na-subject">DDR5 16GB 2개 삽니다</a></div>
    <div class="nw-11"><span class="sr-only">판매가</span>400,000 원</div>
    <div class="nw-6"><span class="sr-only">등록일</span>08.31</div>
  </li>
</ul>`;
const currentCoolenjoy = parseCoolenjoyListingsHtml(currentCoolenjoyMarkup);
assert.equal(currentCoolenjoy.length, 2);
assert.equal(currentCoolenjoy[0].source_listing_id, "1283457");
assert.equal(currentCoolenjoy[0].price, 420_000);
assert.equal(currentCoolenjoy[0].status, "SOLD");
assert.equal(currentCoolenjoy[0].image_url, "", "member level icons are not product images");
assert.equal(currentCoolenjoy[1].status, "UNKNOWN", "purchase requests are never treated as active sale offers");
const currentDanawaMarkup = `<tr class="list_item_first">
  <td class="thumb"><a href="http://dmall.danawa.com/v3/?controller=sale&methods=blog&seq=52439768&parentCategoryCode=1&childCategoryCode=1" class="link_txt"><img src="/images/loading.gif" data-src="//img.example.test/cpu.jpg" alt="CPU"></a></td>
  <td class="subject"><a href="http://dmall.danawa.com/v3/?controller=sale&methods=blog&seq=52439768&parentCategoryCode=1&childCategoryCode=1" class="link_txt">인텔 코어 i5-9600K 중고</a><ul class="detail"><li><span>사업자</span></li><li>중고상품</li></ul></td>
  <td class="price"><span class="price_num">90,000</span>원</td>
</tr>`;
const currentDanawa = parseDanawaListingsHtml(currentDanawaMarkup)[0];
assert.equal(currentDanawa.source_listing_id, "52439768");
assert.equal(currentDanawa.price, 90_000);
assert.equal(currentDanawa.seller_type, "DEALER");
assert.equal(currentDanawa.title, "인텔 코어 i5-9600K 중고");
assert.equal(currentDanawa.image_url, "https://img.example.test/cpu.jpg");
const unsafeDanawaImage = parseDanawaListingsHtml(currentDanawaMarkup.replace(
  'src="/images/loading.gif" data-src="//img.example.test/cpu.jpg"',
  'src="javascript:alert(1)"'
))[0];
assert.equal(unsafeDanawaImage.image_url, "", "non-HTTP image schemes must not reach public listing projections");

let disabledCalls = 0;
const disabledAdapter = createSourceAdapter({
  sourceKey: "coolenjoy",
  async collectIncremental() {
    disabledCalls += 1;
    throw new Error("disabled source was called");
  },
  async recheck() { throw new Error("not used"); }
});
const disabledResults = await runDueSourceCollections({
  after: "2026-08-29T18:51:59.000Z",
  through: "2026-08-29T18:52:01.000Z",
  adapters: { coolenjoy: disabledAdapter },
  runtimeBySource: { coolenjoy: getSourceRuntimeDefaults("coolenjoy") },
  jitterBySource: { coolenjoy: 0 }
});
assert.equal(disabledCalls, 0);
assert.equal(disabledResults[0]?.reason, "POLICY_REVIEW_MISSING",
  "an approved source still must not run before runtime governance and live-canary evidence exist");

let catchupCalls = 0;
const catchupAdapter = createSourceAdapter({
  sourceKey: "joonggonara",
  async collectIncremental(input) {
    catchupCalls += 1;
    return {
      source_key: "joonggonara", mode: "incremental", collected_at: input.now,
      items: [], next_cursor: null, exhausted: false,
      metrics: {
        request_count: 1, request_failure_count: 0, parsed_count: 0,
        parse_failure_count: 0, http_blocked_count: 0, captcha_count: 0
      }
    };
  },
  async recheck() { throw new Error("not used"); }
});
const catchupResults = await runDueSourceCollections({
  after: "2026-08-31T16:00:00.000Z",
  through: "2026-08-31T18:00:00.000Z",
  adapters: { joonggonara: catchupAdapter },
  runtimeBySource: { joonggonara: getSourceRuntimeDefaults("joonggonara") },
  governanceBySource: {
    joonggonara: operatorAttestedSourceGovernance("joonggonara", { now: "2026-08-31T18:00:00.000Z" })
  },
  jitterBySource: { joonggonara: 0 }
});
assert.equal(catchupCalls, 1, "one scheduler tick must collapse repeated catch-up events for the same source");
assert.equal(catchupResults.filter((result) => result.source_key === "joonggonara").length, 1);

let danawaFetchCalls = 0;
const danawaCollected = await collectDanawaCategoryListings({
  categoryCode: "CPU",
  fetchImpl: async () => {
    danawaFetchCalls += 1;
    return new Response(JSON.stringify({ status: true, totalCount: "1", goodsList: currentDanawaMarkup }), { status: 200 });
  }
});
assert.equal(danawaFetchCalls, 1);
assert.equal(danawaCollected.items[0].requested_category_code, "CPU");
assert.equal(danawaCollected.items[0].image_url, "https://img.example.test/cpu.jpg");
assert.equal(danawaCollected.diagnostics[0].parsed_count, 1);
assert.equal(trustedSpecialistCategory(danawaCollected.items[0]), "CPU");
const noopAdapter = createSourceAdapter({
  sourceKey: "danawa",
  async collectIncremental(input) {
    return {
      source_key: "danawa", mode: "incremental", collected_at: input.now,
      items: [], next_cursor: null, exhausted: false,
      metrics: {
        request_count: 0, request_failure_count: 0, parsed_count: 0,
        parse_failure_count: 0, http_blocked_count: 0, captcha_count: 0, failure_messages: []
      }
    };
  },
  async recheck() { throw new Error("not used"); }
});
assert.equal((await noopAdapter.collectIncremental({ now: "2026-08-30T00:00:00.000Z" })).items.length, 0,
  "a scheduled source with no due targets is a valid no-op");
const noopResult = await runSourceCollection({
  sourceKey: "danawa", adapter: noopAdapter, runtime: getSourceRuntimeDefaults("danawa"),
  governance: {
    policy_reviewed_at: "2026-08-29T00:00:00.000Z",
    activation_checked_at: "2026-08-29T01:00:00.000Z",
    approved_access_mode: getPcSource("danawa").access.strategy,
    live_canary: liveCanary,
    operator_enabled: true
  },
  input: { now: "2026-08-30T00:00:00.000Z" },
  now: "2026-08-30T00:00:00.000Z"
});
assert.equal(noopResult.status, "skipped");
assert.equal(noopResult.reason, "NO_DUE_TARGETS");
assert.equal(noopResult.next_runtime.last_succeeded_at, null,
  "a no-op must not create false successful collection evidence");
assert.equal(trustedSpecialistCategory({ ...danawaCollected.items[0], source_category_code: "1:4" }), null,
  "a mismatched source category cannot override text classification");
assert.equal(assertEbayPcCategoryCoverage(), true);
assert.equal(ebayTargetForCategory("RAM").category_ids[0], "170083");
assert.equal(pcCategoryTitleMatches("RAM", "Dodge Ram 2500 wheel hub bearing"), false);
assert.equal(pcCategoryTitleMatches("RAM", "Samsung DDR4 16GB desktop memory"), true);
assert.equal(pcCategoryTitleMatches("CASE", "iPhone leather case"), false);
assert.equal(pcCategoryTitleMatches("ODD", "odd vintage pin button"), false);
assert.equal(trustedSpecialistCategory({
  site: "ebay", requested_category_code: "RAM", source_category_code: "170083",
  title: "Samsung DDR4 16GB desktop memory"
}), "RAM");
assert.equal(trustedSpecialistCategory({
  site: "ebay", requested_category_code: "RAM", source_category_code: "170083",
  title: "Dodge Ram 2500 wheel hub bearing"
}), null);

let failures = 0;
const failingAdapter = createSourceAdapter({
  sourceKey: "joonggonara",
  async collectIncremental() {
    failures += 1;
    throw new Error("fixture timeout");
  },
  async recheck() { throw new Error("not used"); }
});
let runtime = getSourceRuntimeDefaults("joonggonara");
const joonggonaraGovernance = {
  policy_reviewed_at: "2026-08-29T00:00:00.000Z",
  activation_checked_at: "2026-08-29T01:00:00.000Z",
  approved_access_mode: getPcSource("joonggonara").access.strategy,
  live_canary: liveCanary,
  operator_enabled: true
};
const partialAdapter = createSourceAdapter({
  sourceKey: "joonggonara",
  async collectIncremental(input) {
    return {
      source_key: "joonggonara", mode: "incremental", collected_at: input.now,
      items: [], next_cursor: null, exhausted: false,
      metrics: {
        request_count: 12, request_failure_count: 11, parsed_count: 0,
        parse_failure_count: 0, http_blocked_count: 0, captcha_count: 0
      }
    };
  },
  async recheck() { throw new Error("not used"); }
});
const partialResult = await runSourceCollection({
  sourceKey: "joonggonara", adapter: partialAdapter, runtime: getSourceRuntimeDefaults("joonggonara"),
  governance: joonggonaraGovernance, input: { now: "2026-08-29T18:03:00.000Z" }, now: "2026-08-29T18:03:00.000Z"
});
assert.equal(partialResult.status, "partial_success");
assert.equal(partialResult.next_runtime.runtime_status, "ENABLED",
  "target-level partial failure must retain parsed items without quarantining the whole source");
assert.equal(partialResult.next_runtime.consecutive_failures, 0);
const singleTargetFailureAdapter = createSourceAdapter({
  sourceKey: "joonggonara",
  async collectIncremental(input) {
    return {
      source_key: "joonggonara", mode: "incremental", collected_at: input.now,
      items: [], next_cursor: null, exhausted: false,
      metrics: {
        request_count: 11, request_failure_count: 1, parsed_count: 1,
        parse_failure_count: 0, http_blocked_count: 0, captcha_count: 0
      }
    };
  },
  async recheck() { throw new Error("not used"); }
});
const singleTargetFailureResult = await runSourceCollection({
  sourceKey: "joonggonara", adapter: singleTargetFailureAdapter, runtime: getSourceRuntimeDefaults("joonggonara"),
  governance: joonggonaraGovernance, input: { now: "2026-08-29T18:03:00.000Z" }, now: "2026-08-29T18:03:00.000Z"
});
assert.equal(singleTargetFailureResult.status, "success",
  "one clean target failure among at least ten requests must not block the entire source run");
const allFailedAdapter = createSourceAdapter({
  sourceKey: "joonggonara",
  async collectIncremental() {
    const error = new Error("ALL_PC_QUERIES_FAILED:joonggonara");
    error.collection_metrics = {
      request_count: 12, request_failure_count: 12, parsed_count: 0,
      parse_failure_count: 2, http_blocked_count: 1, captcha_count: 1
    };
    throw error;
  },
  async recheck() { throw new Error("not used"); }
});
const allFailedResult = await runSourceCollection({
  sourceKey: "joonggonara", adapter: allFailedAdapter, runtime: getSourceRuntimeDefaults("joonggonara"),
  governance: joonggonaraGovernance, input: { now: "2026-08-29T18:03:00.000Z" }, now: "2026-08-29T18:03:00.000Z"
});
assert.equal(allFailedResult.status, "failed");
assert.deepEqual(allFailedResult.metrics, {
  request_count: 12, request_failure_count: 12, parsed_count: 0,
  parse_failure_count: 2, http_blocked_count: 1, captcha_count: 1
}, "all-failed query batches must preserve exact audit metrics through the scheduler boundary");
const missingGovernance = await runSourceCollection({
  sourceKey: "joonggonara", adapter: failingAdapter, runtime,
  input: { now: "2026-08-29T18:03:00.000Z", cursor: null }, now: "2026-08-29T18:03:00.000Z"
});
assert.equal(missingGovernance.reason, "POLICY_REVIEW_MISSING");
assert.equal(failures, 0, "approved sources must not run before governance evidence is present");
for (const timestamp of [
  "2026-08-29T18:04:00.000Z",
  "2026-08-29T18:09:00.000Z",
  "2026-08-29T18:24:00.000Z"
]) {
  const result = await runSourceCollection({
    sourceKey: "joonggonara", adapter: failingAdapter, runtime,
    governance: joonggonaraGovernance,
    input: { now: timestamp, cursor: null }, now: timestamp
  });
  runtime = result.next_runtime;
}
assert.equal(runtime.runtime_status, "QUARANTINED");
const quarantined = await runSourceCollection({
  sourceKey: "joonggonara", adapter: failingAdapter, runtime,
  governance: joonggonaraGovernance,
  input: { now: "2026-08-29T18:25:00.000Z", cursor: null }, now: "2026-08-29T18:25:00.000Z"
});
assert.equal(quarantined.reason, "SOURCE_QUARANTINED");
assert.equal(failures, 3, "quarantined sources must not be called again");

let legacyRecoveryCalls = 0;
const legacyRecoveryAdapter = createSourceAdapter({
  sourceKey: "joonggonara",
  async collectIncremental(input) {
    legacyRecoveryCalls += 1;
    return {
      source_key: "joonggonara", mode: "incremental", collected_at: input.now,
      items: [], next_cursor: null, exhausted: false,
      metrics: {
        request_count: 1, request_failure_count: 0, parsed_count: 0,
        parse_failure_count: 0, http_blocked_count: 0, captcha_count: 0
      }
    };
  },
  async recheck() { throw new Error("not used"); }
});
const legacyQuarantine = {
  ...getSourceRuntimeDefaults("joonggonara"),
  runtime_status: "QUARANTINED",
  consecutive_failures: 3,
  last_started_at: "2026-08-29T18:24:00.000Z",
  quarantine_until: null
};
const legacyBeforeExpiry = await runSourceCollection({
  sourceKey: "joonggonara", adapter: legacyRecoveryAdapter, runtime: legacyQuarantine,
  governance: joonggonaraGovernance,
  input: { now: "2026-08-29T19:24:00.000Z" }, now: "2026-08-29T19:24:00.000Z"
});
assert.equal(legacyBeforeExpiry.reason, "SOURCE_QUARANTINED");
const legacyAfterExpiry = await runSourceCollection({
  sourceKey: "joonggonara", adapter: legacyRecoveryAdapter, runtime: legacyQuarantine,
  governance: joonggonaraGovernance,
  input: { now: "2026-08-30T00:24:01.000Z" }, now: "2026-08-30T00:24:01.000Z"
});
assert.equal(legacyAfterExpiry.status, "success");
assert.equal(legacyRecoveryCalls, 1, "a missing legacy quarantine expiry must recover exactly once after six hours");

const abortedController = new AbortController();
abortedController.abort(new Error("fixture scheduler watchdog"));
const abortedResult = await runSourceCollection({
  sourceKey: "joonggonara", adapter: legacyRecoveryAdapter, runtime: getSourceRuntimeDefaults("joonggonara"),
  governance: joonggonaraGovernance,
  input: { now: "2026-08-30T00:25:00.000Z", signal: abortedController.signal },
  now: "2026-08-30T00:25:00.000Z"
});
assert.equal(abortedResult.status, "failed");
assert.equal(abortedResult.error, "fixture scheduler watchdog");

const previousFetch = globalThis.fetch;
const previousClientId = process.env.EBAY_CLIENT_ID;
const previousClientSecret = process.env.EBAY_CLIENT_SECRET;
const previousToken = process.env.EBAY_BROWSE_API_TOKEN;
try {
  process.env.EBAY_CLIENT_ID = "fixture-client-id";
  process.env.EBAY_CLIENT_SECRET = "fixture-client-secret";
  delete process.env.EBAY_BROWSE_API_TOKEN;
  resetEbayAccessTokenCacheForTests();
  const requests = [];
  globalThis.fetch = async (url, init = {}) => {
    requests.push({ url: String(url), init });
    if (String(url).includes("/identity/v1/oauth2/token")) {
      return new Response(JSON.stringify({ access_token: "fixture-oauth-token", expires_in: 7200 }), { status: 200 });
    }
    return new Response(JSON.stringify({
      total: 1,
      itemSummaries: [{
        itemId: "v1|fixture|0", title: "RTX 3080 Used GPU",
        price: { value: "399.99", currency: "USD" },
        itemWebUrl: "https://www.ebay.com/itm/fixture"
      }]
    }), { status: 200 });
  };
  const items = await collectOne("ebay", "RTX 3080", "all", 10);
  assert.equal(items.length, 1);
  assert.equal(items[0].site, "ebay");
  assert.equal(items[0].currency, "USD");
  assert.match(requests[0].url, /\/identity\/v1\/oauth2\/token/u);
  assert.match(String(requests[0].init.headers.authorization), /^Basic /u);
  assert.equal(requests[1].init.headers.authorization, "Bearer fixture-oauth-token");

  const pcRequests = [];
  globalThis.fetch = async (url, init = {}) => {
    pcRequests.push({ url: String(url), init });
    return new Response(JSON.stringify({
      total: 2,
      itemSummaries: [
        {
          itemId: "v1|ram-valid|0", leafCategoryIds: ["170084"], title: "Samsung DDR4 16GB desktop memory",
          condition: "Used", price: { value: "29.99", currency: "USD" }, itemWebUrl: "https://www.ebay.com/itm/ram-valid"
        },
        {
          itemId: "v1|ram-noise|0", leafCategoryIds: ["170084"], title: "Dodge Ram 2500 wheel hub bearing",
          condition: "Used", price: { value: "49.99", currency: "USD" }, itemWebUrl: "https://www.ebay.com/itm/ram-noise"
        }
      ]
    }), { status: 200 });
  };
  const pcItems = await collectOne("ebay", "RAM RAM", "RAM", 10);
  assert.equal(pcItems.length, 1);
  assert.equal(pcItems[0].source_listing_id, "v1|ram-valid|0");
  assert.equal(pcItems[0].item_id, "ebay:v1|ram-valid|0");
  assert.equal(pcItems[0].requested_category_code, "RAM");
  assert.equal(pcItems[0].source_category_code, "170083");
  assert.deepEqual(pcItems[0].source_leaf_category_ids, ["170084"]);
  const pcUrl = new URL(pcRequests[0].url);
  assert.equal(pcUrl.searchParams.get("category_ids"), "170083");
  assert.equal(pcUrl.searchParams.get("filter"), "conditions:{USED}");
} finally {
  globalThis.fetch = previousFetch;
  resetEbayAccessTokenCacheForTests();
  if (previousClientId === undefined) delete process.env.EBAY_CLIENT_ID;
  else process.env.EBAY_CLIENT_ID = previousClientId;
  if (previousClientSecret === undefined) delete process.env.EBAY_CLIENT_SECRET;
  else process.env.EBAY_CLIENT_SECRET = previousClientSecret;
  if (previousToken === undefined) delete process.env.EBAY_BROWSE_API_TOKEN;
  else process.env.EBAY_BROWSE_API_TOKEN = previousToken;
}

const [wrangler, deploySource, releaseSource, runnerSource, directCollectorSource] = await Promise.all([
  readFile(new URL("../cloudflare/wrangler.jsonc", import.meta.url), "utf8"),
  readFile(new URL("../cloudflare/deploy.mjs", import.meta.url), "utf8"),
  readFile(new URL("../cloudflare/release.mjs", import.meta.url), "utf8"),
  readFile(new URL("../aws-runner/runner.mjs", import.meta.url), "utf8"),
  readFile(new URL("../aws-runner/collect-pc-source-now.mjs", import.meta.url), "utf8")
]);
assert.match(wrangler, /"AWS_PC_SCHEDULER_AUTHORITY"\s*:\s*"true"/u);
assert.match(deploySource, /publication_configured !== true/u);
assert.match(deploySource, /PC_COLLECTION_TARGET_SET_MISMATCH/u);
assert.match(deploySource, /MONITOR_COLLECTION_TARGET_PRESENT/u);
assert.match(deploySource, /PC_COLLECTION_SOURCE_TARGETS_MISMATCH/u);
assert.equal(releaseSource.indexOf("--preflight-only") < releaseSource.indexOf("Apply D1 migrations"), true);
assert.match(releaseSource, /wrangler', 'rollback'/u);
assert.match(releaseSource, /'rollback', previousWorkerVersion, '--yes'/u);
assert.match(releaseSource, /verifyRollbackRestored\(previousWorkerVersion\)/u);
assert.match(runnerSource, /createSourceAdapter\(\{/u);
assert.match(runnerSource, /D1_STATS_PUBLICATION_NOT_CONFIGURED/u);
assert.match(runnerSource, /PC_SCHEDULER_WATCHDOG_MS/u);
assert.match(runnerSource, /RUNNER_INDEX_SOFT_LIMIT_BYTES/u);
assert.match(runnerSource, /RUNNER_INDEX_HARD_LIMIT_BYTES/u);
assert.match(runnerSource, /signal: boundedFetchSignal/u);
assert.match(runnerSource, /rethinkmall:\s*1_500/u,
  "RethinkMall collection must use bounded target pacing");
assert.match(runnerSource, /SPECIALIST_FIXTURE_PARSERS\[sourceKey\]\s*\|\|\s*Object\.hasOwn\(PC_SOURCE_TARGET_PACING_MS, sourceKey\)/u,
  "every source with an explicit pacing policy must use the sequential target path");
assert.match(directCollectorSource, /if \(failed\.length > 0\) process\.exitCode = 1/u);
assert.doesNotMatch(runnerSource, /iphone-scan|airpods-scan|switch-scan|fashion-bottoms-scan/u);

console.log(JSON.stringify({ status: "passed", contract: "pc-source-policy" }, null, 2));
