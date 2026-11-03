import assert from "node:assert/strict";
import "./bunjang-lifecycle-contract.mjs";
import { readFile } from "node:fs/promises";
import { PcPartsLedger } from "../aws-runner/pc-parts-ledger.mjs";
import { PcShadowPipeline } from "../aws-runner/pc-shadow-pipeline.mjs";

import { buildLivePayload, collectOne, matchesRequestedKeyword, parseHelloMarketDetailHtml, pcSearchQueryVariants, resetEbayAccessTokenCacheForTests } from "../cloudflare/live-search.mjs";
import { filterCategoryItems } from "../cloudflare/category-filter.mjs";
import { OPERATIONAL_PC_DIRECTORY_SITES, OPERATIONAL_TARGET_SITES } from "../cloudflare/target-sites.mjs";
import {
  PC_SOURCE_REGISTRY,
  getPcSource,
  getSourceRuntimeDefaults,
  listSourceCadenceEvents,
  operatorAttestedSourceGovernance,
  runDueSourceCollections,
  runSourceCollection,
  sourceRuntimeAfterFailure,
  sourceRuntimeForScheduler,
  validateSourceActivation,
  validateSourceGovernance
} from "../collector/logic/pc-source-registry.mjs";
import {
  collectDanawaCategoryListings,
  createSourceAdapter,
  parseBunjangPartnerCatalogCsv,
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
import { publicPcProducts } from "../market/logic/pc-public-catalog.mjs";
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
const runtimeCanary = { ...liveCanary, observed_at: new Date().toISOString() };

assert.equal(new Set(PC_SOURCE_REGISTRY.map((source) => source.key)).size, PC_SOURCE_REGISTRY.length);
assert.deepEqual(Object.fromEntries(PC_SOURCE_REGISTRY.map((source) => [source.key, source.cadence.kst_minutes])), {
  joonggonara: [4], bunjang: [11], daangn: [15], danawa: [19], hellomarket: [27],
  rethinkmall: [36], ebay: [44]
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
  "joonggonara", "bunjang"
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
assert.equal(getPcSource("hellomarket").directory_source, false,
  "Hellomarket remains registered for historical evidence but is not collected");
assert.equal(getPcSource("hellomarket").policy_status, "APPROVED");
assert.equal(getPcSource("hellomarket").runtime_status, "DISABLED");
assert.equal(getPcSource("hellomarket").policy_basis_url, "https://hellomarket.com/terms.hm");
assert.equal(OPERATIONAL_TARGET_SITES.includes("hellomarket"), false);
assert.equal(getPcSource("rethinkmall").public_search, false);
assert.equal(getPcSource("rethinkmall").directory_source, false);
assert.equal(getPcSource("rethinkmall").runtime_status, "DISABLED");
assert.equal(OPERATIONAL_TARGET_SITES.includes("rethinkmall"), false,
  "complete-system retail must not appear in standalone PC-parts search");
assert.equal(OPERATIONAL_PC_DIRECTORY_SITES.includes("rethinkmall"), false);
assert.equal(getPcSource("bunjang").directory_source, true,
  "approved Bunjang collection must feed the precollected PC directory");
assert.deepEqual(OPERATIONAL_PC_DIRECTORY_SITES,
  ["joonggonara", "bunjang", "danawa", "ebay"]);
assert.equal(OPERATIONAL_PC_DIRECTORY_SITES.includes("bunjang"), true);
assert.equal(getPcSource("ebay").access.strategy, "official_browse_api");
assert.equal(getPcSource("ebay").access.api_only_required, true);
const collectionTargetSet = pcCollectionTargetSetV2();
const specialistTargets = collectionTargetSet.targets.filter((target) => target.sourceKeys.includes("danawa"));
const marketplaceTargets = collectionTargetSet.targets.filter((target) => target.sourceKeys.includes("joonggonara"));
const hellomarketTargets = collectionTargetSet.targets.filter((target) => target.sourceKeys.includes("hellomarket"));
const bunjangTargets = collectionTargetSet.targets.filter((target) => target.sourceKeys.includes("bunjang"));
const rethinkmallTargets = collectionTargetSet.targets.filter((target) => target.sourceKeys.includes("rethinkmall"));
const hourlyMarketplaceTargets = marketplaceTargets.filter((target) => target.cadenceClass === "HOURLY_CATEGORY");
const dailyMarketplaceTargets = marketplaceTargets.filter((target) => target.cadenceClass === "DAILY_MASTER");
assert.equal(specialistTargets.length, marketplaceTargets.length);
assert.equal(hourlyMarketplaceTargets.length, 19);
assert.equal(hellomarketTargets.length, 0,
  "disabled Hellomarket must not receive collection targets");
assert.equal(bunjangTargets.length, marketplaceTargets.length,
  "approved Bunjang receives the same full PC master sweep as other search marketplaces");
assert.equal(rethinkmallTargets.length, 0,
  "refurbished complete-system retail must not receive standalone PC-parts collection targets");
assert.ok(dailyMarketplaceTargets.length >= PC_PRODUCT_MASTER_V2.length,
  "every master node must receive at least one daily marketplace query");
assert.deepEqual(
  [...new Set(dailyMarketplaceTargets.map((target) => target.canonicalProductId))].sort(),
  [...new Set([...PC_PRODUCT_MASTER_V2, ...publicPcProducts()].map((product) => product.id))].sort(),
  "daily target generation must cover the complete master and every public PC product"
);
assert.ok(dailyMarketplaceTargets.every((target) => target.minimumIntervalMinutes === 24 * 60));
assert.deepEqual([...new Set(marketplaceTargets.map((target) => target.categoryCode))].sort(), [...PC_PART_CATEGORY_CODES].sort());
for (const sourceKey of OPERATIONAL_PC_DIRECTORY_SITES) {
  const sourceCategories = new Set(collectionTargetSet.targets
    .filter((target) => target.enabled !== false && target.sourceKeys.includes(sourceKey))
    .map((target) => target.categoryCode));
  assert.deepEqual([...sourceCategories].sort(), [...PC_PART_CATEGORY_CODES].sort(),
    `${sourceKey}: every operational PC source must have a target for every part category`);
}
for (const product of publicPcProducts().filter(({ category }) => ["SSD", "HDD", "PSU"].includes(category))) {
  for (const sourceKey of OPERATIONAL_PC_DIRECTORY_SITES) {
    assert.ok(collectionTargetSet.targets.some((target) => target.enabled !== false
      && target.canonicalProductId === product.id
      && target.sourceKeys.includes(sourceKey)),
    `${sourceKey}: missing public aggregate target ${product.id}`);
  }
}
const ebayExactQuery = (canonicalProductId) => collectionTargetSet.targets.find((target) => (
  target.canonicalProductId === canonicalProductId && target.sourceKeys.includes("ebay")
))?.queryText;
assert.equal(ebayExactQuery("ssd:samsung:capacity-bucket:gt-1-tb-le-2-tb"), "Samsung 2TB internal SSD");
assert.equal(ebayExactQuery("hdd:western-digital:capacity-bucket:gt-8-tb-le-12-tb"), "Western Digital 12TB internal HDD");
assert.equal(ebayExactQuery("psu:corsair:watts-bucket:751-850"), "Corsair 850W computer power supply");
assert.ok(collectionTargetSet.targets.filter((target) => target.sourceKeys.includes("ebay")
  && ["SSD", "HDD", "PSU"].includes(target.categoryCode)).every((target) => !/\b(?:over|up to)\b/iu.test(target.queryText)),
"eBay aggregate targets must use representative values instead of bucket-boundary prose");
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
  "1002,ASUS RTX 3070,removed,1,350000,0,USED,DELETED,RTX 3070,https://media.bunjang.co.kr/product/1002.jpg,600700001,111,,100,2026-08-31T00:10:00Z,2026-08-29T00:00:00Z",
  "1003,Intel i5-7400,sold,1,30000,0,USED,SOLD,i5-7400,https://media.bunjang.co.kr/product/1003.jpg,600700001,112,,101,2026-08-31T00:10:00Z,2026-08-28T00:00:00Z"
].join("\n");
const bunjangCatalogRows = parseBunjangPartnerCatalogCsv(bunjangCatalogFixture);
assert.equal(bunjangCatalogRows.length, 3);
assert.deepEqual(bunjangCatalogRows.map((item) => item.status), ["ACTIVE", "DELETED", "SOLD"],
  "the official segment feed must preserve SOLD while keeping DELETED distinct");
assert.equal(bunjangCatalogRows[0].source_listing_id, "1001");
assert.equal(bunjangCatalogRows[0].url, "https://m.bunjang.co.kr/products/1001");
assert.equal(bunjangCatalogRows[0].image_url, "https://media.bunjang.co.kr/product/1001.jpg");
assert.equal(bunjangCatalogRows[0].source_category_code, "600700001");
assert.equal(Object.hasOwn(bunjangCatalogRows[0].raw_payload, "uid"), false,
  "the public partner catalog parser must not retain the seller shop identifier");
assert.equal(sourceRuntimeForScheduler("hellomarket", {
  persisted: { runtime_status: "ENABLED", failure_count: 0 }
}).runtime_status, "DISABLED", "registry retirement must override stale persisted ENABLED state");
assert.equal(listSourceCadenceEvents({
  after: "2026-08-29T00:26:59.000Z",
  through: "2026-08-29T00:27:01.000Z",
  jitterBySource: { hellomarket: 0 }
}).some((event) => event.source_key === "hellomarket"), false,
"disabled sources must not keep generating scheduler no-op events");
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

const inferenceLedger = new PcPartsLedger({ filePath: ":memory:" });
inferenceLedger.migrate();
const inferencePipeline = new PcShadowPipeline({ ledger: inferenceLedger });
await inferencePipeline.initialize();
try {
  const observedAt = "2026-11-03T00:00:00.000Z";
  const normalizeInference = item => inferencePipeline.normalizeItem({
    site: "joonggonara", source_listing_id: "inference-fixture", price: 70_000,
    currency: "KRW", ...item
  }, observedAt, null, { reclassification: true });
  for (const [title, category, sourceCategory, kind, productId] of [
    ['USED BOX 4 Intel Core i7-14700K NO CPU INCLUDED REPEAT BOX ONLY "SOLO CAJA"', "CPU", "164", "BOX_ONLY", null],
    ["GeForce rtx 3090 호환 nvlink 4 slot 팝니다.", "GPU", "27386", "ACCESSORY_ONLY", null],
    ["Intel Core i7-14700K CPU with original box", "CPU", "164", "SINGLE_COMPONENT", "cpu:intel:i7-14700k"],
    ["RTX 3090 그래픽카드 NVLink 지원", "GPU", "27386", "SINGLE_COMPONENT", "gpu:nvidia:rtx-3090"]
  ]) {
    const item = { site: "ebay", title, requested_category_code: category, source_category_code: sourceCategory,
      status: "ACTIVE", price: 21, currency: "USD" };
    assert.equal(trustedSpecialistCategory(item), category, "fixture must exercise a trusted source-category override");
    const result = normalizeInference(item);
    assert.equal(result.classified.listing_kind, kind, title);
    assert.equal(result.normalized.categoryCode, productId ? category : "ACCESSORY", title);
    assert.equal(result.normalized.canonicalProductId, productId, title);
    assert.equal(result.normalized.statisticsEligible, Boolean(productId), title);
    if (!productId) {
      assert.equal(result.normalized.priceEligible, false);
      assert.equal(result.normalized.evidence.some(evidence => evidence.source === "STRUCTURED_SOURCE_CATEGORY"), false,
        "positive box/accessory evidence must outrank marketplace category hints");
    }
  }
  const soldItem = { site: "joonggonara", source_listing_id: "rx580-sold-title",
    title: "RX580 8GB 판매완료", status: "ACTIVE", price: 70_000, currency: "KRW" };
  const soldProjection = inferencePipeline.recordItem(soldItem, observedAt, { reclassification: true });
  assert.equal(soldProjection.lifecycle_status, "SOLD", "explicit sold title must reach the public badge before generic ACTIVE");
  assert.equal(soldProjection.canonical_product_id, "gpu:amd:rx-580");
  const soldSnapshot = inferenceLedger.latestSnapshot("joonggonara", "rx580-sold-title");
  assert.deepEqual(JSON.parse(soldSnapshot.status_evidence_json), { type: "EXPLICIT_TEXT", value: "판매완료" },
    "title inference must retain its text evidence rather than claiming a structured transaction signal");
  for (const title of ["RX580 판매완료 아님", "RX580 판매완료 표시 오류", "RX580 판매완료되면 삭제",
    "RX580 sold out 아님", "RX580 2개 중 1개 판매완료, 남은 1개 판매"]) {
    assert.equal(normalizeInference({ title, status: "ACTIVE" }).state.status, "ACTIVE", title);
  }
  for (const status of ["SOLD", "RESERVED", "DELETED", "EXPIRED", "UNAVAILABLE_UNKNOWN", "BLOCKED_OR_PRIVATE"]) {
    const state = normalizeInference({ title: "RX580 판매완료", lifecycle_status: status, status: "ACTIVE" }).state;
    assert.deepEqual(state, { status, evidence: { type: "STRUCTURED_STATUS", value: status } },
      `an explicit lifecycle status must be retained: ${status}`);
  }
  assert.equal(normalizeInference({ title: "RX580 판매완료 아님", status: "SOLD" }).state.status, "SOLD",
    "negative wording cannot erase an authoritative SOLD signal");
  assert.equal(normalizeInference({ title: "RX580 판매완료" }).state.status, "SOLD");
  assert.equal(normalizeInference({ title: "RX580 정상 작동" }).state.status, "UNAVAILABLE_UNKNOWN");
  for (const [title, kind] of [
    ["라이젠 3600 + RX580 (cpu판매완료)", "COMPONENT_BUNDLE"],
    ["RX580 / GTX1060 그래픽카드 일괄", "COMPONENT_BUNDLE"],
    ["RTX3060 그래픽카드 포함 데스크탑 본체", "FULL_SYSTEM"]
  ]) {
    const result = normalizeInference({ title, status: "ACTIVE" });
    assert.equal(result.classified.listing_kind, kind);
    assert.equal(result.classified.canonical_model, null, title);
    assert.equal(result.normalized.canonicalProductId, null, "a bundle/system must not gain an invented component identity");
    assert.equal(result.normalized.statisticsEligible, false);
    assert.equal(result.state.status, "ACTIVE", "one sold component does not sell the entire remaining bundle");
  }
  assert.equal(normalizeInference({ title: "라이젠 3600 + RX580 (cpu판매완료)" }).state.status, "UNAVAILABLE_UNKNOWN");
  for (const item of [
    { title: "라이젠 3600 + RX580 CPU 판매완료" },
    { title: "라이젠 3600 + RX580", description: "CPU 판매완료" }
  ]) assert.equal(normalizeInference({ ...item, status: "ACTIVE" }).state.status, "ACTIVE",
    "the pipeline must retain the classifier's component-scoped sold decision");

  const composedProjection = (sourceListingId, title, extras = {}) => inferencePipeline.recordItem({
    site: "joonggonara", source_listing_id: sourceListingId, title, status: "ACTIVE",
    price: 7_450_000, currency: "KRW", ...extras
  }, observedAt, { reclassification: true });
  const desktopTitle = "RTX3060 그래픽카드 포함 데스크탑 본체";
  const desktopNormalized = normalizeInference({ title: desktopTitle, status: "ACTIVE" }).normalized;
  assert.equal(desktopNormalized.searchComponents.length, 1, "one verified GPU association is sufficient for composition browsing");
  assert.equal(desktopNormalized.items, undefined, "a search association must not manufacture a component pricing row");
  const desktopProjection = composedProjection("one-gpu-desktop", desktopTitle);
  assert.deepEqual(desktopProjection.components, desktopNormalized.searchComponents);
  assert.equal(desktopProjection.components[0].canonical_product_id, "gpu:nvidia:rtx-3060");
  assert.equal(desktopProjection.canonical_product_id, null);
  assert.equal(desktopProjection.statistics_eligible, false);
  const legionTitle = "레노버 LEGION Pro 7 16IAX10 U9 5090 Edition W11 (SSD 1TB)";
  const legionProjection = composedProjection("legion-bare-5090", legionTitle);
  assert.equal(legionProjection.listing_type, "COMPLETE_PC");
  assert.equal(legionProjection.canonical_product_id, null, "a mobile GPU family must not become a desktop price identity");
  assert.equal(legionProjection.price_eligible, false);
  assert.equal(legionProjection.statistics_eligible, false);
  assert.deepEqual(legionProjection.components, [{
    canonical_product_id: "gpu:nvidia:rtx-5090", association_type: "TITLE_GPU_MODEL_FAMILY",
    search_only: true, matched_text: "5090"
  }]);
  assert.equal(Object.hasOwn(legionProjection.components[0], "unitPrice"), false);
  assert.equal(Object.hasOwn(legionProjection.components[0], "market_segment"), false,
    "a model-family association makes no claim about the desktop/mobile variant");
  const explicitLaptop = composedProjection("explicit-mobile-5090", "레노버 LEGION Pro 7 RTX5090 노트북");
  assert.equal(explicitLaptop.market_segment, "LAPTOP");
  assert.equal(explicitLaptop.canonical_product_id, null);
  assert.equal(explicitLaptop.statistics_eligible, false);
  assert.equal(explicitLaptop.components[0].canonical_product_id, "gpu:nvidia:rtx-5090");
  const acerTitle = "ACER (SF314-42) 4500U 16G/120GB 14인치 노트북 (윈도우11정품포함)";
  assert.ok(inferenceLedger.findApprovedProductsInText(acerTitle)
    .some(component => component.canonical_product_id === "cpu:amd:ryzen-5-4500"), "fixture reproduces the unsafe partial CPU alias");
  const acerProjection = composedProjection("acer-mobile-cpu", acerTitle, { components: ["cpu:amd:ryzen-5-4500"] });
  assert.deepEqual(acerProjection.components, [], "unverified or supplied aliases must not leak into search associations");
  assert.equal(acerProjection.canonical_product_id, null);
  assert.equal(acerProjection.statistics_eligible, false);
  const comparisonProjection = composedProjection("comparison-only-gpu", "레노버 LEGION Pro7 RTX5090급 게이밍 노트북");
  assert.deepEqual(comparisonProjection.components, [], "performance comparisons cannot create GPU associations");
  const bodyOnlyProjection = composedProjection("body-only-gpu", "레노버 LEGION Pro7 노트북", { description: "RTX5090급 성능" });
  assert.deepEqual(bodyOnlyProjection.components, [], "description-only models cannot establish the title association");
  const bundleProjection = composedProjection("bundle-one-gpu", "라이젠 3600 + RX580 CPU 판매완료");
  assert.equal(bundleProjection.components[0].canonical_product_id, "gpu:amd:rx-580");
  assert.equal(bundleProjection.lifecycle_status, "ACTIVE");
  assert.equal(bundleProjection.canonical_product_id, null);
  assert.equal(bundleProjection.statistics_eligible, false);
  for (const [title, productId] of [
    ["인텔 arc750 8GB 그래픽카드 RTX3060급", "gpu:intel:arc-a750"],
    ["ARC A770 16GB 정상 작동", "gpu:intel:arc-a770"],
    ["RX580 8GB 정상 작동", "gpu:amd:rx-580"],
    ["RX6600XT 8GB 정상 작동", "gpu:amd:rx-6600-xt"],
    ["RX7900 GRE 16GB 정상 작동", "gpu:amd:rx-7900-gre"],
    ["RTX3060 12GB 정상 작동", "gpu:nvidia:rtx-3060"],
    ["3060 12g", "gpu:nvidia:rtx-3060"],
    ["RTX3060 Ti 8GB 정상 작동", "gpu:nvidia:rtx-3060-ti"]
  ]) {
    const result = normalizeInference({ title, status: "ACTIVE" });
    assert.equal(result.normalized.canonicalProductId, productId, title);
    assert.equal(result.normalized.statisticsEligible, true, `valid alias must retain its sample: ${title}`);
  }
  // A stale alias set must not let incidental RTX3060 text replace classified ARC A750.
  inferenceLedger.db.prepare("DELETE FROM product_aliases WHERE canonical_product_id = ?").run("gpu:intel:arc-a750");
  const arcTitle = "인텔 arc750 8GB 그래픽카드 RTX3060급";
  assert.equal(inferenceLedger.matchAlias("GPU", "ARC A750"), null);
  assert.equal(inferenceLedger.matchAliasInText("GPU", arcTitle).canonical_product_id, "gpu:nvidia:rtx-3060");
  const arcWithoutAlias = normalizeInference({ title: arcTitle, status: "ACTIVE" });
  assert.equal(arcWithoutAlias.classified.canonical_model, "ARC A750");
  assert.equal(arcWithoutAlias.normalized.canonicalProductId, "gpu:intel:arc-a750");
  assert.equal(arcWithoutAlias.normalized.statisticsEligible, true);
  assert.equal(normalizeInference({ title: "RX6500 그래픽카드", status: "ACTIVE" }).normalized.canonicalProductId, null,
    "model refinement needs an approved text alias and cannot invent the only available suffix");
} finally {
  inferenceLedger.close();
}

const helloSsdDetail = parseHelloMarketDetailHtml(`<meta name="description" content="삼성 850 PRO 512GB SSD 여러 개 판매합니다."/><meta name="keywords" content="SSD,저장장치"/><meta property="og:image" content="https://ccimg.hellomarket.com/item.jpg"/>`, "https://www.hellomarket.com/item/183908019");
assert.equal(helloSsdDetail.description, "삼성 850 PRO 512GB SSD 여러 개 판매합니다.");
assert.equal(helloSsdDetail.keywords, "SSD,저장장치");
assert.equal(helloSsdDetail.image_url, "https://ccimg.hellomarket.com/item.jpg");
const helloPcDetail = parseHelloMarketDetailHtml(`<meta name="description" content="16GB 5TB 윈도우 10프로 모든게임 잘돌아갑니다"/><meta name="keywords" content="본체,컴퓨터"/>`, "https://www.hellomarket.com/item/182653333");
assert.match(`${helloPcDetail.description} ${helloPcDetail.keywords}`, /본체|컴퓨터/u);
assert.deepEqual(pcSearchQueryVariants("Intel i5-7400"), ["Intel i5-7400", "Intel i5 7400", "i5-7400"],
  "PC keyword collection must use bounded punctuation and manufacturer variants");

const recentLifecycleFixtureDate = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
const lifecycleSeparatedPayload = buildLivePayload({
  keyword: "i5 7400",
  category_id: "pc",
  sites: ["joonggonara"],
  limit: 10,
  sort: "recommended"
}, [{
  site: "joonggonara",
  items: [
    { id: "active", site: "joonggonara", title: "i5 7400 판매중", price: 10_000, currency: "KRW", status: "ACTIVE", posted_at: recentLifecycleFixtureDate, seller_name: "a", image_url: "https://img.example/a.jpg", url: "https://web.joongna.com/product/active" },
    { id: "sold", site: "joonggonara", title: "i5 7400 판매완료", price: 50_000, currency: "KRW", status: "SOLD", posted_at: recentLifecycleFixtureDate, seller_name: "b", image_url: "https://img.example/b.jpg", url: "https://web.joongna.com/product/sold" },
    { id: "unknown", site: "joonggonara", title: "i5 7400 판매완료 아님", price: 90_000, currency: "KRW", posted_at: recentLifecycleFixtureDate, seller_name: "c", image_url: "https://img.example/c.jpg", url: "https://web.joongna.com/product/unknown" },
    { id: "stale", site: "joonggonara", title: "i5 7400 오래된 판매글", price: 70_000, currency: "KRW", status: "ACTIVE", posted_at: "2020-01-01", seller_name: "d", image_url: "https://img.example/d.jpg", url: "https://web.joongna.com/product/stale" },
    { id: "system", site: "joonggonara", title: "i5 7400 램8GB SSD 사양 컴퓨터", price: 300_000, currency: "KRW", status: "ACTIVE", posted_at: recentLifecycleFixtureDate, seller_name: "e", image_url: "https://img.example/e.jpg", url: "https://web.joongna.com/product/system" }
  ]
}], { items: [] });
assert.equal(lifecycleSeparatedPayload.items.length, 5, "sold, unknown, stale, and price-scope-unclear listings remain visible");
assert.equal(lifecycleSeparatedPayload.sources[0].search_urls[0], "https://web.joongna.com/search/i5%207400",
  "an explicit Joonggonara keyword must keep the keyword URL even when a category is also selected");
assert.equal(lifecycleSeparatedPayload.summary.average_price, 10_000, "headline average must use active asking prices only");
assert.equal(lifecycleSeparatedPayload.summary.active_asking.average_price, 10_000);
assert.equal(lifecycleSeparatedPayload.summary.sold_last_ask.average_price, 50_000);
assert.deepEqual(lifecycleSeparatedPayload.summary.status_counts, { active: 3, reserved: 0, sold: 1, unknown: 1 });
assert.equal(lifecycleSeparatedPayload.summary.unknown_count, 1, "negated sold wording must stay unknown");

const specialistFixtures = await Promise.all([
  readFile(new URL("./fixtures/source-pages/danawa-market.html", import.meta.url), "utf8")
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
  sourceKey: "hellomarket",
  async collectIncremental() {
    disabledCalls += 1;
    throw new Error("disabled source was called");
  },
  async recheck() { throw new Error("not used"); }
});
const disabledResults = await runDueSourceCollections({
  after: "2026-08-29T18:26:59.000Z",
  through: "2026-08-29T18:27:01.000Z",
  adapters: { hellomarket: disabledAdapter },
  runtimeBySource: { hellomarket: getSourceRuntimeDefaults("hellomarket") },
  jitterBySource: { hellomarket: 0 }
});
assert.equal(disabledCalls, 0);
assert.deepEqual(disabledResults, [],
  "retired sources must not produce scheduler events or invoke adapters");

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
let pagedDanawaCalls = 0;
const pagedDanawa = await collectDanawaCategoryListings({
  categoryCode: "CPU",
  fetchImpl: async (_url, init) => {
    pagedDanawaCalls += 1;
    const requestedPage = Number(new URLSearchParams(String(init.body)).get("page"));
    const markup = requestedPage === 1
      ? currentDanawaMarkup
      : currentDanawaMarkup.replaceAll("52439768", "52439769").replace("i5-9600K", "i5-9700K");
    return new Response(JSON.stringify({ status: true, totalCount: "2", goodsList: markup }), { status: 200 });
  }
});
assert.equal(pagedDanawaCalls, 2, "Danawa collection must continue through reported result pages");
assert.deepEqual(pagedDanawa.items.map((item) => item.source_listing_id), ["52439768", "52439769"]);
const noopAdapter = createSourceAdapter({
  sourceKey: "ebay",
  async collectIncremental(input) {
    return {
      source_key: "ebay", mode: "incremental", collected_at: input.now,
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
  sourceKey: "ebay", adapter: noopAdapter, runtime: getSourceRuntimeDefaults("ebay"),
  governance: {
    policy_reviewed_at: "2026-08-29T00:00:00.000Z",
    activation_checked_at: "2026-08-29T01:00:00.000Z",
    approved_access_mode: getPcSource("ebay").access.strategy,
    live_canary: runtimeCanary,
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
for (const [category, title] of [["SSD", "Samsung 990 PRO 2TB"], ["HDD", "WD Red Plus 8TB"], ["PSU", "Corsair RM850x 850W"]]) {
  assert.equal(pcCategoryTitleMatches(category, title), true, `${category} exact family title must be accepted`);
}
for (const [category, title] of [["SSD", "990 PRO heatsink only"], ["HDD", "WD Red Plus external enclosure"], ["PSU", "RM850x cable only"], ["PSU", "Dell server power supply 1100W"]]) {
  assert.equal(pcCategoryTitleMatches(category, title), false, `${category} accessory/server false positive`);
}
for (const title of ["990 PRO 히트싱크만", "외장 SSD 케이스", "외장 HDD 케이스", "파워서플라이 케이블"]) {
  const category = title.includes("파워") ? "PSU" : title.includes("HDD") ? "HDD" : "SSD";
  assert.equal(pcCategoryTitleMatches(category, title), false, `${category} Korean accessory false positive`);
}
for (const title of ["600W 파워 케이블 포함", "600W 파워 케이블 없음"]) {
  assert.equal(pcCategoryTitleMatches("PSU", title), true, "a real PSU with cable-state text must reach classification");
}
for (const [category, title] of [
  ["SSD", "Samsung 970 EVO Plus 1TB"],
  ["SSD", "Samsung 980 500GB"],
  ["SSD", "WD Black SN850X 2TB"],
  ["HDD", "ST16000DM001 16TB"],
  ["HDD", "씨게이트 아이언울프 4TB"],
  ["PSU", "Corsair HX1200"],
  ["PSU", "Micronics Classic II 700W"]
]) {
  assert.equal(pcCategoryTitleMatches(category, title), true, `${category} model-only target title`);
}
assert.equal(matchesRequestedKeyword({ title: "CPU i5 7400 단품" }, "i5-7400"), true,
  "hyphen and spacing variants must match the same PC model");
assert.equal(matchesRequestedKeyword({ title: "RTX 3080 10GB 그래픽카드" }, "ASUS RTX 3080"), true,
  "a missing optional board manufacturer must not hide the requested GPU model");
const modelOnlyPcTitles = ["i5-7400", "Arc A770 16GB 그래픽카드", "DDR4 16GB", "980 PRO 1TB", "B650M 메인보드", "850W 파워서플라이"];
assert.deepEqual(
  filterCategoryItems(modelOnlyPcTitles.map((title) => ({ title })), { category_id: "pc" }).map((item) => item.title),
  modelOnlyPcTitles,
  "bounded PC model evidence must keep model-only component listings"
);
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
  live_canary: runtimeCanary,
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
assert.equal(abortedResult.status, "skipped");
assert.equal(abortedResult.reason, "TICK_DEADLINE");
assert.equal(abortedResult.next_runtime.consecutive_failures, 0,
  'an unattempted source must not enter failure backoff after another source exhausts the tick');

const previousFetch = globalThis.fetch;
const previousClientId = process.env.EBAY_CLIENT_ID;
const previousClientSecret = process.env.EBAY_CLIENT_SECRET;
const previousToken = process.env.EBAY_BROWSE_API_TOKEN;
try {
  globalThis.fetch = async (url) => {
    assert.equal(new URL(url).pathname, "/api/search/v8/web/search");
    assert.equal(new URL(url).searchParams.get("policyKey"), "pw.product.keyword");
    assert.equal(new URL(url).searchParams.get("sort"), "latest");
    return new Response(JSON.stringify({ data: { responses: { mainGrid: { searchResponse: {
    data: [{
      pid: "402071229",
      name: "AMD 라이젠3 3100 CPU 중고 판매",
      price: "50000",
      productImage: "https://media.example.test/402071229.jpg",
      shop: { uid: "fixture-user" },
      updatedAt: "2026-09-08T00:00:00.000Z",
      status: "SELLING",
    }],
  } } } } }), { status: 200 });
  };
  const bunjangItems = await collectOne("bunjang", "라이젠 3 3100", "pc", 20,
    "라이젠 3 3100", "recent", { min: null, max: null });
  assert.equal(bunjangItems.length, 1);
  assert.equal(bunjangItems[0].source_listing_id, "402071229",
    "Bunjang keyword rows must retain the stable source product id");
  assert.equal(bunjangItems[0].item_id, "bunjang:402071229",
    "Bunjang item identity must not depend on its full product URL");
  assert.equal(bunjangItems[0].posted_at, "2026-09-08T00:00:00.000Z");
  assert.equal(bunjangItems[0].lifecycle_status, "ACTIVE");

  const bunjangVariantRequests = [];
  globalThis.fetch = async (url) => {
    bunjangVariantRequests.push(String(url));
    return new Response(JSON.stringify({ data: { responses: { mainGrid: { searchResponse: { data: [] } } } } }), { status: 200 });
  };
  await collectOne("bunjang", "Intel i5-7400", "pc", 20,
    "Intel i5-7400", "recent", { min: null, max: null });
  assert.deepEqual(new Set(bunjangVariantRequests.map((url) => new URL(url).searchParams.get("q"))),
    new Set(["Intel i5-7400", "Intel i5 7400", "i5-7400"]),
    "Bunjang must send each generated query variant to the upstream request");

  const cursorRequests = [];
  globalThis.fetch = async (url) => {
    const parsed = new URL(url);
    cursorRequests.push(parsed.searchParams.get("cursor"));
    const offset = parsed.searchParams.has("cursor") ? 60 : 0;
    return new Response(JSON.stringify({ data: { responses: { mainGrid: { searchResponse: {
      data: Array.from({ length: 60 }, (_, i) => ({
        pid: 900000000 + offset + i, name: "RTX 3060 그래픽카드", price: 150000,
        status: "SELLING", updatedAt: "2026-10-09T00:00:00Z"
      })), cursor: offset ? null : "opaque-next-page", nextCursor: "not-the-web-page-cursor"
    } } } } }), { status: 200 });
  };
  const paged = await collectOne("bunjang", "RTX 3060", "pc", 80,
    "RTX 3060", "recent", { min: null, max: null });
  assert.equal(paged.length, 80);
  assert.equal(new Set(paged.map(item => item.source_listing_id)).size, 80);
  assert.equal(paged[0].source_listing_id, "900000000");
  assert.equal(paged[0].item_id, "bunjang:900000000");
  assert.deepEqual(cursorRequests, [null, "opaque-next-page"]);
  assert.equal(paged.status_observations.length, 120, 'retain already fetched page overflow without another request');
  assert.equal(paged.search_windows.length, 1);
  assert.equal(paged.search_windows[0].rows.length, 120, 'compare raw fetched scope, not keyword-filtered output');
  assert.equal(JSON.parse(paged.search_windows[0].scope).at(-1), 2);
  assert.equal(paged.status_observations.at(-1).item.source_listing_id, '900000119');
  assert.ok(paged.status_observations.every(row => Number.isFinite(Date.parse(row.observed_at))));
  const cachedPaged = await collectOne("bunjang", "RTX 3060", "pc", 80,
    "RTX 3060", "recent", { min: null, max: null });
  assert.equal(cachedPaged.source_cache_hit, true, 'cached pages cannot count as new lifecycle evidence');
  assert.equal(paged.source_cache_hit, undefined, 'cache reads must not mutate the fresh result');
  assert.equal(cursorRequests.length, 2, 'status capture and cached reads add no network calls');
  const joongRequests = [];
  globalThis.fetch = async url => {
    const parsed = new URL(url);
    joongRequests.push(parsed);
    const offset = parsed.searchParams.get('page') === '2' ? 50 : 0;
    const rows = Array.from({ length: 50 }, (_, i) => ({
      seq: 800000 + offset + i, title: 'GTX 980 그래픽카드', price: 50000,
      state: offset + i === 99 ? 2 : 0, articleUrl: `/product/${800000 + offset + i}`
    }));
    return new Response(`<script>{"items":${JSON.stringify(rows)},"changedProductFilterType":null}</script>`);
  };
  const joongPaged = await collectOne('joonggonara', 'GTX 980', 'pc', 80, 'GTX 980', 'recent', { min: null, max: null });
  assert.equal(joongPaged.length, 80);
  assert.equal(joongRequests.length, pcSearchQueryVariants('GTX 980').length * 2);
  assert.equal(joongPaged.status_observations.length, joongRequests.length * 50);
  assert.ok(joongPaged.status_observations.some(row => row.item.status === 'SOLD'
    && row.item.source_listing_id === 'joonggonara:https://web.joongna.com/product/800099'),
  'explicit sold state in fetched overflow remains available with exact identity');

  // The CLI/browser extractor must also retain the remainder of a 60-row
  // upstream page when the consumer displays only 20 listings at a time.
  const { tryExtractPublicSearchResult } = await import("../dist/collector/logic/publicSearchExtractors.js");
  const { bunjangAdapter } = await import("../dist/collector/logic/sites/bunjang.js");
  const extractorRequests = [];
  globalThis.fetch = async (url) => {
    const parsed = new URL(url);
    assert.equal(parsed.pathname, "/api/search/v8/web/search");
    assert.equal(parsed.searchParams.get("sort"), "latest");
    const cursor = parsed.searchParams.get("cursor");
    extractorRequests.push(cursor);
    const offset = cursor ? 60 : 0;
    return new Response(JSON.stringify({ data: { responses: { mainGrid: { searchResponse: {
      data: Array.from({ length: cursor ? 5 : 60 }, (_, i) => ({
        pid: 910000000 + offset + i, name: "RTX 4060 그래픽카드", price: 250000,
        status: i === 0 ? "SOLD_OUT" : "SELLING", updatedAt: "2026-10-09T00:00:00Z"
      })), cursor: cursor ? null : "extractor-next-page"
    } } } } }), { status: 200 });
  };
  let extractorCursor = null;
  const extractedUrls = [];
  for (let i = 0; i < 4; i += 1) {
    const page = await tryExtractPublicSearchResult(bunjangAdapter,
      { keyword: "RTX 4060", limit: 20, cursor: extractorCursor }, "");
    assert.equal(page.errors.length, 0);
    if (i === 0) {
      assert.equal(page.items[0].status, "sold");
      assert.equal(page.items[1].status, "active");
      assert.equal(page.items[0].url, "https://m.bunjang.co.kr/products/910000000");
    }
    extractedUrls.push(...page.items.map(item => item.url));
    extractorCursor = page.pagination.next_cursor;
  }
  assert.equal(extractedUrls.length, 65);
  assert.equal(new Set(extractedUrls).size, 65);
  assert.equal(extractorCursor, null);
  assert.deepEqual(extractorRequests, [null, null, null, "extractor-next-page"]);

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
  assert.equal(items[0].lifecycle_status, "ACTIVE",
    "eBay Browse search results are currently available listings");
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
  assert.equal(pcItems[0].lifecycle_status, "ACTIVE");
  assert.equal(pcItems[0].requested_category_code, "RAM");
  assert.equal(pcItems[0].source_category_code, "170083");
  assert.deepEqual(pcItems[0].source_leaf_category_ids, ["170084"]);
  const pcUrl = new URL(pcRequests[0].url);
  assert.equal(pcUrl.searchParams.get("q"), "RAM RAM",
    "eBay PC targets must preserve the exact target query instead of replacing it with a broad category query");
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

const [wrangler, deploySource, releaseSource, runnerSource, statsRunnerSource, directCollectorSource] = await Promise.all([
  readFile(new URL("../cloudflare/wrangler.jsonc", import.meta.url), "utf8"),
  readFile(new URL("../cloudflare/deploy.mjs", import.meta.url), "utf8"),
  readFile(new URL("../cloudflare/release.mjs", import.meta.url), "utf8"),
  readFile(new URL("../aws-runner/runner.mjs", import.meta.url), "utf8"),
  readFile(new URL("../aws-runner/publish-pc-stats-runner.mjs", import.meta.url), "utf8"),
  readFile(new URL("../aws-runner/collect-pc-source-now.mjs", import.meta.url), "utf8")
]);
assert.match(wrangler, /"AWS_PC_SCHEDULER_AUTHORITY"\s*:\s*"true"/u);
assert.match(wrangler, /"D1_LISTING_FALLBACK_ENABLED"\s*:\s*"false"/u,
  "the AWS-primary profile must not expose stale D1 listings by default");
assert.match(wrangler, /"PC_READ_CACHE_TTL_SECONDS"\s*:\s*"300"/u,
  "public AWS listing and price-stat reads must use the bounded Worker response cache");
assert.match(deploySource, /publication_configured !== true/u);
assert.match(deploySource, /PC_COLLECTION_TARGET_SET_MISMATCH/u);
assert.match(deploySource, /MONITOR_COLLECTION_TARGET_PRESENT/u);
assert.match(deploySource, /PC_COLLECTION_SOURCE_TARGETS_MISMATCH/u);
assert.equal(releaseSource.indexOf("--preflight-only") < releaseSource.indexOf("Apply D1 migrations"), true);
assert.match(releaseSource, /wrangler', 'rollback'/u);
assert.match(releaseSource, /'rollback', previousWorkerVersion, '--yes'/u);
assert.match(releaseSource, /verifyRollbackRestored\(previousWorkerVersion\)/u);
assert.match(runnerSource, /createSourceAdapter\(\{/u);
assert.match(statsRunnerSource, /D1_STATS_PUBLICATION_NOT_CONFIGURED/u);
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
