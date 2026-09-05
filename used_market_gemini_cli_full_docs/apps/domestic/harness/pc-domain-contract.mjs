import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";

import { PcPartsLedger } from "../aws-runner/pc-parts-ledger.mjs";
import { evaluatePipelineQualityReports } from "../aws-runner/pc-pipeline-governance.mjs";
import { PcShadowPipeline } from "../aws-runner/pc-shadow-pipeline.mjs";
import { evaluatePcQualityDataset } from "../aws-runner/pc-quality-eval.mjs";
import { reclassifyPcSnapshots } from "../aws-runner/reclassify-pc-snapshots.mjs";
import {
  isPublicDeactivationCandidate,
  mergedPublicExclusionReasons,
  parseArguments as parsePublicReclassificationArguments
} from "../aws-runner/reclassify-public-pc-listings.mjs";
import { classifyPcPartListing } from "../market/logic/pc-parts-classifier.mjs";
import { explicitSoldText, isPartialSaleText, structuredSoldEvidenceFromHtml } from "../market/logic/listing-lifecycle.mjs";

for (const text of ["판매완료 아님", "아직 판매완료 아닙니다", "sold out 아님", "판매완료 표시 오류", "미판매완료"]) {
  assert.equal(explicitSoldText(text), null, `negative SOLD wording must not become terminal: ${text}`);
}
for (const text of ["2개 중 하나 판매완료", "2장 중 한 장 판매 완료", "4매 중 1매만 판매완료", "남은 두 장 판매"]) {
  assert.equal(isPartialSaleText(text), true, `partial sale wording must be recognized: ${text}`);
  assert.equal(explicitSoldText(text), null, `partial sale must not become whole-listing SOLD: ${text}`);
}
assert.equal(explicitSoldText("판매 완료 아님"), null, "spaced negative SOLD wording must not become terminal");
assert.equal(explicitSoldText("판매완료"), "판매완료");
assert.equal(structuredSoldEvidenceFromHtml(
  `<script type="application/ld+json">{"name":"다른 상품","offers":{"availability":"https://schema.org/SoldOut"}}</script>`,
  { source_listing_id: "target-3080", title: "RTX 3080 정상 작동", url: "https://example.test/item/target-3080" }
), null, "unrelated JSON-LD SoldOut is not listing evidence");
const qualityProbe = evaluatePcQualityDataset([{ id: "quality-probe", input: { title: "RTX 3080" }, truth: {
  category_code: "GPU", canonical_model: "RTX 3080", quantity: 1, price_scope: "TOTAL",
  listing_kind: "SINGLE_COMPONENT", lifecycle_status: "ACTIVE", market_pool: "KR_C2C_USED", duplicate: false
}, prediction: {
  category_code: "GPU", canonical_model: "RTX 3080", quantity: 1, price_scope: "TOTAL",
  listing_kind: "SINGLE_COMPONENT", lifecycle_status: "ACTIVE", market_pool: "KR_C2C_USED",
  duplicate_merged: false, price_eligible: true
} }]);
assert.equal(qualityProbe.metrics.category_precision, 1);
assert.deepEqual(qualityProbe.integrity_blockers, { false_sold_count: 0, market_pool_mismatch_count: 0, false_dedupe_count: 0 });
assert.equal(isPublicDeactivationCandidate({
  listing_kind: "ACCESSORY_ONLY", price_eligible: false, exclusion_reasons: ["ACCESSORY_ONLY"]
}), true, "an accessory projection must be deactivated without deleting its D1 row");
assert.equal(isPublicDeactivationCandidate({
  listing_kind: "SINGLE_COMPONENT", price_eligible: false, exclusion_reasons: ["QUANTITY_UNKNOWN"]
}), true, "an ambiguous-quantity projection must be deactivated without deleting its D1 row");
assert.equal(isPublicDeactivationCandidate({
  listing_kind: "SINGLE_COMPONENT", price_eligible: true, exclusion_reasons: []
}), false, "an eligible component projection must remain public");
assert.throws(() => parsePublicReclassificationArguments(["--apply"]),
  /requires reviewed --item-id values or --confirm-all-candidates/,
  "public deactivation requires an explicit reviewed scope");
assert.deepEqual(parsePublicReclassificationArguments(["--apply", "--confirm-all-candidates"]), {
  apply: true, confirmAllCandidates: true, itemIds: []
}, "all-candidate deactivation requires the explicit confirmation flag");
assert.deepEqual(mergedPublicExclusionReasons(
  { exclusion_reasons: ["LEGACY_REASON"] },
  { listing_kind: "SINGLE_COMPONENT", exclusion_reasons: ["QUANTITY_UNKNOWN", "MODEL_AMBIGUOUS"] }
), ["LEGACY_REASON", "QUANTITY_UNKNOWN", "MODEL_AMBIGUOUS"],
"public deactivation must preserve the classifier's exact exclusion reasons");

const cases = JSON.parse(await readFile(new URL("./fixtures/pc-parts-cases.json", import.meta.url), "utf8"));
const section21Cases = JSON.parse(await readFile(new URL("./fixtures/pc-parts-section21-cases.json", import.meta.url), "utf8"));
assert.equal(section21Cases.length, 30, "command document section 21 must remain an exact 30-case regression set");
assert.ok(cases.length > 0, "PC classifier fixtures are required");
assert.equal(new Set(cases.map((entry) => entry.id)).size, cases.length, "fixture ids must be unique");
for (const fixture of cases) {
  const actual = classifyPcPartListing(fixture.input);
  for (const [key, expected] of Object.entries(fixture.expected)) {
    assert.deepEqual(actual[key], expected, `${fixture.id}: ${key}`);
  }
  assert.ok(actual.evidence.length > 0, `${fixture.id}: classification evidence is required`);
}
for (const fixture of section21Cases.filter((entry) => entry.kind !== "missing_state")) {
  const actual = classifyPcPartListing(fixture.input);
  for (const [key, expected] of Object.entries(fixture.expected)) {
    assert.deepEqual(actual[key], expected, `${fixture.id}: ${key}`);
  }
}

const observedSystemAndBundleRegressions = [
  ["레노버 슬림 데스크탑 (i5 8500, ram 16gb, ssd512gb)", "FULL_SYSTEM"],
  ["중고컴퓨터~i5~6500~렘16 ssd250 gtx1060", "FULL_SYSTEM"],
  ["게임용본체 i3-9100f 램8 1050ti ssd250 hdd1테라", "FULL_SYSTEM"],
  ["i5 10400F CPU와 16GB RAM, GTX 980 240gb ssd 1tb hd 전주시", "FULL_SYSTEM"],
  ["AMD 라이젠5 5600 CPU GTX1650 16GB RAM 과 128m.2 ssd 240gb ssd 전주시", "FULL_SYSTEM"],
  ["HP Z2 SFF G8 Small Form Factor Z840 i7-11700 동급 CPU", "FULL_SYSTEM"],
  ["삼성 슬림 PC i5 6500 ssd 128GB +HDD 500GB GT730", "FULL_SYSTEM"],
  ["HP 노트북 i7 6700HQ 16GB RAM SSD 256GB 판매", "FULL_SYSTEM"],
  ["인텔 I7-6700 + H170 메인보드 DDR4", "COMPONENT_BUNDLE"],
  ["인텔cpu i7 8700k 델 z370 메인보드 850w모듈러파워 델케이스", "COMPONENT_BUNDLE"],
  ["i5-7500 , ASROCK Z170M Pro4S 인텔 CPU 메인보드셋 쿨러까지 일괄", "COMPONENT_BUNDLE"],
  ["Ryzen 5 5600 CPU(기본 쿨러 포함), B350M 메인보드", "COMPONENT_BUNDLE"],
  ["라이젠9 3900X RX9070XT 팝니다", "COMPONENT_BUNDLE"],
  ["14600K RX9070XT 고사양 컴퓨터 팝니다", "FULL_SYSTEM"],
  ["AMD 9800X3D/ RX9070XT / RAM 32GB 팝니다", "COMPONENT_BUNDLE"],
  ["라이젠9950X3D / RX9070XT / X870E / DDR5 48GB 고사양본체", "FULL_SYSTEM"],
  ["(개인) 9800X3D RX9070XT 컴퓨터", "FULL_SYSTEM"],
  ["K11 미니PC + 32G + 오큐링크 사파이어 RX 9070XT", "COMPONENT_BUNDLE"],
  ["9800X3D / RX 9070 XT / RAM 32G / 1TB 하이엔드 PC 판매", "FULL_SYSTEM"],
  ["9800X3D 하고 그래픽카드 RX 9070XT 16G", "COMPONENT_BUNDLE"],
  ["rx9070xt .gtx5070.gtx5080", "COMPONENT_BUNDLE"],
  ["5600/a520 / RX9070XT / 512GB", "FULL_SYSTEM"],
  ["7900/a620/RX9070XT/1TB", "FULL_SYSTEM"],
  ["14700/h810/RX9070XT/512GB", "FULL_SYSTEM"],
  ["9950X3D2/a620/RX9070XT/1TB", "FULL_SYSTEM"],
  ["34)울트라7 270K Plus /RX9070XT 화이트 컴퓨터", "FULL_SYSTEM"],
  ["285K/b760/RX9070XT/1TB", "FULL_SYSTEM"],
  ["(27일까지)7800x3D RX9070XT 32G CL28 하닉A다이 6000 2T", "FULL_SYSTEM"]
];
for (const [title, listingKind] of observedSystemAndBundleRegressions) {
  const actual = classifyPcPartListing({ title, price: 100_000, lifecycle_status: "ACTIVE" });
  assert.equal(actual.listing_kind, listingKind, `observed marketplace contamination must be excluded: ${title}`);
  assert.equal(actual.price_eligible, false, `system or cross-component bundle cannot enter price statistics: ${title}`);
  assert.ok(actual.exclusion_reasons.includes(listingKind), `exclusion reason must explain ${listingKind}: ${title}`);
}
for (const [title, listingKind] of [
  ["RX 9070 xt그래픽카드 구매합니다.", "WANTED"],
  ["기가바이트 RX 9070 XT 게이밍 OC 16GB 사기꾼", "REPORT"],
  ["사기) 사파이어 RX 9070 XT 니트로+ 판매합니다", "REPORT"],
  ["라데온 사파이어 RX9070XT 니트로+ 85만 사기 조심", "REPORT"]
]) {
  const actual = classifyPcPartListing({ title, price: 1_000_000, lifecycle_status: "ACTIVE" });
  assert.equal(actual.listing_kind, listingKind, `non-sale marketplace post must be excluded: ${title}`);
  assert.equal(actual.price_eligible, false, `non-sale marketplace post cannot enter price statistics: ${title}`);
  assert.ok(actual.exclusion_reasons.includes(listingKind), `exclusion reason must explain ${listingKind}: ${title}`);
}
for (const title of [
  "삼성 DDR4 2400 16GB 데스크탑 램 단품",
  "WD BLUE HDD 1TB WD10EZEX 데스크탑 SATA 하드디스크",
  "시소닉 프라임 gx-1000 파워 서플라이 본체만 판매합니다",
  "NZXT N7 Z790 인텔 메인보드 ATX LGA 1700 칩셋 14세대 CPU 지원",
  "삼성 노트북램 DDR4-3200 16G 팝니다",
  "노트북 하드 도시바 HDD 1TB 2.5인치 슬림 504시간",
  "노트북용 그래픽카드 GTX1060 6gb MXM Type B GPU 판매합니다",
  "LG BP60NB10 노트북 외장형 ODD 블루레이 플레이어 DVD",
  "RTX 3080 그래픽카드 7800X3D 시스템에서 테스트 완료",
  "ASRock RX 9070 XT / 16GB / 3팬 그래픽카드",
  "RX9070XT 16GB 그래픽카드 7800X3D 시스템에서 32G RAM 장착 테스트 완료"
]) {
  assert.equal(classifyPcPartListing({ title, price: 50_000 }).listing_kind, "SINGLE_COMPONENT",
    `component wording must not become a full system: ${title}`);
}

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
let now = Date.parse("2026-08-29T00:00:00.000Z");
const db = new DatabaseSync(":memory:");
const ledger = new PcPartsLedger({ db, now: () => now });
ledger.migrate();
ledger.migrate();
assert.equal(db.prepare("PRAGMA integrity_check").get().integrity_check, "ok");

const targetRolloverDb = new DatabaseSync(":memory:");
const targetRolloverLedger = new PcPartsLedger({ db: targetRolloverDb, now: () => now });
targetRolloverLedger.migrate();
targetRolloverLedger.activateCollectionTargets({
  targetSetVersion: "rollover-v1", directoryVersion: "directory-v1",
  targets: [{ targetId: "rollover-v1:gpu", categoryCode: "GPU", queryText: "GPU", sourceKeys: ["joonggonara"] }]
});
targetRolloverLedger.activateCollectionTargets({
  targetSetVersion: "rollover-v2", directoryVersion: "directory-v2",
  targets: [{ targetId: "rollover-v2:cpu", categoryCode: "CPU", queryText: "CPU", sourceKeys: ["joonggonara"] }]
});
assert.deepEqual(targetRolloverDb.prepare(
  "SELECT target_set_version, set_status FROM pc_collection_target_sets ORDER BY target_set_version"
).all().map((row) => ({ ...row })), [
  { target_set_version: "rollover-v1", set_status: "SUPERSEDED" },
  { target_set_version: "rollover-v2", set_status: "ACTIVE" }
], "a target-set rollover supersedes the previous ACTIVE row before inserting the next ACTIVE row");
assert.deepEqual(targetRolloverLedger.listActiveCollectionTargets().map((target) => target.target_id), ["rollover-v2:cpu"]);
targetRolloverDb.close();

const sourceActivationDb = new DatabaseSync(":memory:");
const sourceActivationLedger = new PcPartsLedger({ db: sourceActivationDb, now: () => now });
sourceActivationLedger.migrate();
for (const runtimeStatus of ["DISABLED", "ADAPTER_READY"]) {
  const sourceId = `activation-${runtimeStatus.toLowerCase()}`;
  sourceActivationLedger.upsertSource({
    sourceId, displayName: sourceId, marketPool: "KR_C2C_USED",
    policyStatus: "APPROVED", runtimeStatus
  });
  sourceActivationLedger.upsertSource({
    sourceId, displayName: sourceId, marketPool: "KR_C2C_USED",
    policyStatus: "APPROVED", runtimeStatus: "ENABLED"
  });
  assert.equal(sourceActivationLedger.getSource(sourceId).runtime_status, "ENABLED",
    `${runtimeStatus} registry runtime must become ENABLED after approved operator activation`);
}
sourceActivationLedger.upsertSource({
  sourceId: "activation-quarantined", displayName: "activation-quarantined", marketPool: "KR_C2C_USED",
  policyStatus: "APPROVED", runtimeStatus: "DISABLED"
});
sourceActivationLedger.updateSourceRuntime("activation-quarantined", {
  runtime_status: "QUARANTINED", consecutive_failures: 3,
  quarantine_until: "2026-08-29T06:00:00.000Z", last_error: "fixture blocked"
});
sourceActivationLedger.upsertSource({
  sourceId: "activation-quarantined", displayName: "activation-quarantined", marketPool: "KR_C2C_USED",
  policyStatus: "APPROVED", runtimeStatus: "ENABLED"
});
assert.equal(sourceActivationLedger.getSource("activation-quarantined").runtime_status, "QUARANTINED",
  "operator activation must preserve an existing quarantine");
assert.equal(sourceActivationLedger.getSource("activation-quarantined").failure_count, 3,
  "operator activation must not erase quarantine failure evidence");
sourceActivationDb.close();

assert.equal(ledger.getPublicationRuntime("PRODUCT_STATS"), null);
ledger.recordPublicationSuccess({
  publicationId: "fixture-publication-v1",
  checksum: "fixture-checksum",
  rowCount: 3,
  publishedAt: "2026-08-29T00:00:00.000Z"
});
assert.deepEqual({ ...ledger.getPublicationRuntime("PRODUCT_STATS") }, {
  publication_kind: "PRODUCT_STATS",
  publication_id: "fixture-publication-v1",
  checksum: "fixture-checksum",
  row_count: 3,
  published_at: "2026-08-29T00:00:00.000Z"
});
assert.throws(() => ledger.recordPublicationSuccess({
  publicationId: "invalid", checksum: "invalid", rowCount: 0
}), /positive integer/u);

ledger.upsertSource({
  sourceId: "joonggonara", displayName: "중고나라", marketPool: "KR_C2C_USED",
  policyStatus: "APPROVED", runtimeStatus: "ENABLED"
});
ledger.upsertSource({
  sourceId: "ebay", displayName: "eBay", marketPool: "OVERSEAS_USED",
  policyStatus: "APPROVED", runtimeStatus: "ENABLED"
});
ledger.activateCollectionTargets({
  targetSetVersion: "fixture-targets-v1",
  directoryVersion: "fixture-master-v1",
  targets: [
    { targetId: "fixture:gpu", categoryCode: "GPU", queryText: "GPU", sourceKeys: ["joonggonara"] },
    { targetId: "fixture:cpu", categoryCode: "CPU", queryText: "CPU", sourceKeys: ["joonggonara"],
      cadenceClass: "DAILY_MASTER", minimumIntervalMinutes: 24 * 60 },
    { targetId: "fixture:ebay-gpu", categoryCode: "GPU", queryText: "GPU", sourceKeys: ["ebay"] }
  ]
});
assert.equal(ledger.listActiveCollectionTargets().length, 3);
assert.deepEqual(ledger.listActiveCollectionTargets("joonggonara").map((target) => target.target_id),
  ["fixture:gpu", "fixture:cpu"], "source-aware collection targets must not leak across marketplaces");
assert.deepEqual(ledger.listActiveCollectionTargets("ebay").map((target) => target.target_id),
  ["fixture:ebay-gpu"], "specialist collection receives only its own targets");
assert.deepEqual(ledger.getActiveCollectionTargetSummary(), {
  target_set_version: "fixture-targets-v1",
  directory_version: "fixture-master-v1",
  declared_target_count: 3,
  enabled_target_count: 3,
  target_checksum: db.prepare("SELECT target_checksum FROM pc_collection_target_sets WHERE set_status = 'ACTIVE'").get().target_checksum,
  activated_at: "2026-08-29T00:00:00.000Z",
  source_target_counts: { ebay: 1, joonggonara: 2 },
  cadence_class_counts: { DAILY_MASTER: 1, HOURLY_CATEGORY: 2 },
  category_codes: ["CPU", "GPU"],
  monitor_target_count: 0
}, "active target summary must prove the deployed source/category scope without exposing query text");
const targetStartedAt = "2026-08-29T00:00:00.000Z";
ledger.updateSourceTargetRuntime({ sourceId: "joonggonara", targetId: "fixture:gpu", startedAt: targetStartedAt,
  succeededAt: targetStartedAt, cursor: "gpu-cursor-1" });
ledger.updateSourceTargetRuntime({ sourceId: "joonggonara", targetId: "fixture:cpu", startedAt: targetStartedAt,
  succeededAt: targetStartedAt, cursor: "cpu-cursor-1" });
assert.deepEqual(
  ledger.listDueCollectionTargets("joonggonara", "2026-08-29T00:54:59.000Z").map((target) => target.target_id),
  [],
  "a collected source-target pair cannot run again inside the hourly window"
);
assert.deepEqual(
  ledger.listDueCollectionTargets("joonggonara", "2026-08-29T00:55:01.000Z").map((target) => target.target_id),
  ["fixture:gpu"],
  "only the hourly target becomes due inside the hourly jitter guard"
);
assert.deepEqual(
  ledger.listDueCollectionTargets("joonggonara", "2026-08-30T00:00:01.000Z").map((target) => target.target_id),
  ["fixture:gpu", "fixture:cpu"],
  "the daily master target becomes due only after its own 24-hour interval"
);
const coverageAsOf = new Date("2026-08-29T12:00:00.000Z");
for (let offset = 0; offset <= 30; offset += 1) {
  if ([5, 10, 20].includes(offset)) continue;
  const startedAt = new Date(coverageAsOf.getTime() - offset * DAY_MS).toISOString();
  const crawlRunId = ledger.startCrawlRun({ sourceId: "joonggonara", startedAt, adapterVersion: "fixture" });
  ledger.finishCrawlRun({
    crawlRunId, status: "SUCCEEDED", finishedAt: startedAt, collectedCount: 1,
    requestCount: 1, parsedCount: 1, parseFailureCount: 0, httpBlockedCount: 0, captchaCount: 0
  });
}
assert.equal(db.prepare(`SELECT COUNT(*) AS count FROM crawl_runs
  WHERE request_count = 1 AND parsed_count = 1 AND parse_failure_count = 0
    AND http_blocked_count = 0 AND captcha_count = 0`).get().count, 28,
"crawl audit rows retain parser and access outcome metrics");
assert.deepEqual(ledger.getSourceCollectionCoverage("joonggonara", coverageAsOf), {
  first_committed_crawl_at: "2026-07-30T12:00:00.000Z",
  last_committed_crawl_at: "2026-08-29T12:00:00.000Z",
  success_day_count_31d: 28,
  max_gap_days_31d: 2,
  continuous_30_day_coverage: true
});
const partialCommittedRunId = ledger.startCrawlRun({
  sourceId: "ebay", startedAt: "2026-08-29T11:00:00.000Z", adapterVersion: "fixture"
});
ledger.finishCrawlRun({
  crawlRunId: partialCommittedRunId, status: "FAILED", finishedAt: "2026-08-29T11:01:00.000Z",
  collectedCount: 10, changedCount: 10, requestCount: 11, requestFailureCount: 1,
  parsedCount: 10, parseFailureCount: 0, httpBlockedCount: 0, captchaCount: 0,
  error: "one category unavailable"
});
assert.deepEqual(ledger.getSourceCollectionCoverage("ebay", coverageAsOf), {
  first_committed_crawl_at: "2026-08-29T11:00:00.000Z",
  last_committed_crawl_at: "2026-08-29T11:01:00.000Z",
  success_day_count_31d: 1,
  max_gap_days_31d: 0,
  continuous_30_day_coverage: false
}, "a clean one-target failure remains committed without hiding its FAILED audit status");
ledger.registerProduct({
  canonicalProductId: "gpu:nvidia:rtx-3080", masterVersion: 1,
  canonicalDisplayName: "NVIDIA GeForce RTX 3080", manufacturer: "NVIDIA", brand: "GeForce",
  categoryCode: "GPU", productGroupKey: "nvidia-geforce-rtx-3080", spec: { chipset: "RTX 3080" }
});
ledger.addAlias({
  canonicalProductId: "gpu:nvidia:rtx-3080", masterVersion: 1,
  aliasText: "RTX 3080", validationStatus: "APPROVED"
});

const base = {
  sourceId: "joonggonara",
  sourceListingId: "gpu-1",
  observedAt: new Date(now).toISOString(),
  title: "RTX 3080 판매 010-1234-5678",
  description: "seller@example.com 연락",
  sellerRef: "판매자 010-1234-5678",
  rawPayload: { title: "RTX 3080 판매", phone: "010-1234-5678", email: "seller@example.com" },
  price: 500_000,
  currency: "KRW",
  status: "ACTIVE",
  availability: "AVAILABLE",
  normalized: {
    canonicalProductId: "gpu:nvidia:rtx-3080",
    canonicalDisplayName: "NVIDIA GeForce RTX 3080",
    categoryCode: "GPU",
    listingKind: "SINGLE_COMPONENT",
    quantity: 1,
    priceScope: "TOTAL",
    conditionCode: "USED_WORKING",
    marketPool: "KR_C2C_USED",
    exactProduct: true,
    priceEligible: true,
    spec: { chip_manufacturer: "NVIDIA", board_manufacturer: "ASUS" },
    statisticsEligible: true,
    confidence: { category: 0.99, model: 0.99, quantity: 1 }
  }
};

const first = ledger.recordObservation(base);
const storedRaw = db.prepare("SELECT raw_json, title, description, seller_ref_masked FROM raw_listings WHERE id = ?").get(first.rawListingId);
assert.doesNotMatch(JSON.stringify(storedRaw), /010-1234-5678|seller@example\.com|판매자/u);
assert.match(storedRaw.seller_ref_masked, /^\[SELLER:[A-Za-z0-9_-]{16}\]$/u);
assert.throws(() => db.prepare("UPDATE raw_listings SET title = 'tampered' WHERE id = ?").run(first.rawListingId), /immutable/u);

now += HOUR_MS;
const unchanged = ledger.recordObservation({ ...base, observedAt: new Date(now).toISOString() });
assert.equal(unchanged.snapshotCreated, false, "unchanged observations must not duplicate snapshots");

for (let attempt = 0; attempt < 3; attempt += 1) {
  now += 6 * HOUR_MS;
  ledger.recordMissingCheck({ sourceId: "joonggonara", sourceListingId: "gpu-1", checkedAt: new Date(now).toISOString() });
}
assert.equal(ledger.getListingState("joonggonara", "gpu-1").status, "UNAVAILABLE_UNKNOWN");

now += HOUR_MS;
const unprovedSold = ledger.recordObservation({
  ...base, observedAt: new Date(now).toISOString(), status: "SOLD",
  statusEvidence: { type: "SEARCH_DISAPPEARANCE" }
});
assert.equal(unprovedSold.status, "UNAVAILABLE_UNKNOWN", "search disappearance is not SOLD evidence");

now += HOUR_MS;
const sold = ledger.recordObservation({
  ...base, observedAt: new Date(now).toISOString(), status: "SOLD",
  statusEvidence: { type: "EXPLICIT_TEXT", value: "판매완료" }
});
assert.equal(sold.status, "SOLD");
assert.equal(sold.soldLastAskPrice, 500_000);
const rejectedTransaction = ledger.recordObservation({
  ...base, observedAt: new Date(now + 1_000).toISOString(), status: "SOLD", transactionPrice: 480_000,
  statusEvidence: { type: "STRUCTURED_STATUS", value: "SOLD" },
  transactionEvidence: { type: "OFFICIAL_API", source_field: "sold_listing_price", value: "480000" }
});
assert.equal(rejectedTransaction.snapshotCreated, false, "generic price fields are not transaction evidence");
const acceptedTransaction = ledger.recordObservation({
  ...base, observedAt: new Date(now + 2_000).toISOString(), status: "SOLD", transactionPrice: 480_000,
  statusEvidence: { type: "STRUCTURED_STATUS", value: "SOLD" },
  transactionEvidence: { type: "OFFICIAL_API", source_field: "transaction_price", meaning: "TRANSACTION_PRICE", value: "480000" }
});
assert.equal(acceptedTransaction.snapshotCreated, true, "explicit official transaction evidence is stored even after SOLD");
assert.equal(db.prepare("SELECT transaction_price FROM listing_snapshots WHERE id = ?").get(acceptedTransaction.snapshotId).transaction_price, 480_000);

function addSold({ sourceId, id, price, currency, marketPool }) {
  const activeAt = new Date(now + Number(id) * 1_000).toISOString();
  const soldAt = new Date(now + DAY_MS + Number(id) * 1_000).toISOString();
  const observation = {
    ...base,
    sourceId,
    sourceListingId: `${currency}-${id}`,
    observedAt: activeAt,
    title: `RTX 3080 ${id}`,
    rawPayload: { title: `RTX 3080 ${id}` },
    price,
    currency,
    normalized: { ...base.normalized, marketPool }
  };
  ledger.recordObservation(observation);
  ledger.recordObservation({
    ...observation, observedAt: soldAt, status: "SOLD",
    statusEvidence: { type: "STRUCTURED_STATUS", value: "SOLD" }
  });
}

for (let index = 1; index <= 5; index += 1) {
  addSold({ sourceId: "joonggonara", id: index, price: 400_000 + index * 10_000, currency: "KRW", marketPool: "KR_C2C_USED" });
}
for (let index = 1; index <= 3; index += 1) {
  addSold({ sourceId: "ebay", id: index, price: 300 + index * 10, currency: "USD", marketPool: "OVERSEAS_USED" });
}
now += 3 * DAY_MS;

const krStats = ledger.rebuildAndGetPriceStats({
  canonicalProductId: "gpu:nvidia:rtx-3080", days: 30, marketPool: "KR_C2C_USED",
  condition: "USED_WORKING", currency: "KRW", asOf: new Date(now).toISOString(),
  parserVersion: "pc-parser-v1", ruleVersion: "pc-rules-v1", filterVersion: "pc-filter-v1"
});
const krStatsEndDate = new Date(now).toISOString().slice(0, 10);
const krStatsStartDate = new Date(Date.parse(`${krStatsEndDate}T00:00:00.000Z`) - 29 * DAY_MS).toISOString().slice(0, 10);
assert.equal(krStats.daily.length, 30, "days=30 returns exactly 30 UTC calendar dates including asOf");
assert.equal(krStats.daily[0].date, krStatsStartDate, "the 30-day series starts at asOf-(days-1)");
assert.equal(krStats.daily.at(-1).date, krStatsEndDate, "the 30-day series includes the asOf date");
assert.equal(krStats.sold.sample_count, 6);
assert.equal(krStats.sold.unit_count, 6);
assert.equal(krStats.sold.min, 410_000);
assert.equal(krStats.sold.max, 500_000);
assert.equal(krStats.sold.median, 435_000);
assert.equal(krStats.by_manufacturer[0].manufacturer, "ASUS");
assert.equal(krStats.by_manufacturer[0].sold.sample_count, 6);
assert.ok(krStats.daily.some((row) => Number.isFinite(row.sold?.seven_day_sold_median)));
assert.ok(krStats.daily.every((row) => row.active && row.reserved && row.sold && row.confirmed_transactions),
  "the 30-day series keeps explicit zero-sample dates and all metric scopes");
assert.equal(krStats.methodology.market_pool, "KR_C2C_USED");
assert.equal(krStats.methodology.currency, "KRW");
assert.ok(ledger.traceStatMembers({
  canonicalProductId: "gpu:nvidia:rtx-3080", marketPool: "KR_C2C_USED",
  condition: "USED_WORKING", currency: "KRW"
}).every((row) => row.snapshot_id && row.raw_listing_id));

const reservedObservation = {
  ...base,
  sourceListingId: "reserved-only",
  observedAt: new Date(now + 10_000).toISOString(),
  title: "RTX 3080 예약중",
  rawPayload: { title: "RTX 3080 예약중" },
  price: 470_000
};
ledger.recordObservation(reservedObservation);
ledger.recordObservation({
  ...reservedObservation,
  observedAt: new Date(now + 20_000).toISOString(),
  status: "RESERVED",
  availability: "UNAVAILABLE"
});
const afterReservation = ledger.rebuildAndGetPriceStats({
  canonicalProductId: "gpu:nvidia:rtx-3080", days: 30, marketPool: "KR_C2C_USED",
  condition: "USED_WORKING", currency: "KRW", asOf: new Date(now + 30_000).toISOString(),
  parserVersion: "pc-parser-v1", ruleVersion: "pc-rules-v1", filterVersion: "pc-filter-v1"
});
assert.equal(afterReservation.active.sample_count, 0, "RESERVED listings are not ACTIVE price samples");
assert.equal(afterReservation.reserved.sample_count, 1, "RESERVED listings are a separate price scope");
assert.equal(afterReservation.reserved.min, 470_000, "RESERVED statistics use the displayed reservation price");
assert.ok(afterReservation.daily.some((row) => row.reserved?.sample_count === 1), "RESERVED daily statistics are published separately");

for (let index = 6; index <= 9; index += 1) {
  addSold({
    sourceId: "joonggonara",
    id: index,
    price: index === 9 ? 10_000_000 : 400_000 + index * 10_000,
    currency: "KRW",
    marketPool: "KR_C2C_USED"
  });
}
now += 2 * DAY_MS;
const outlierStats = ledger.rebuildAndGetPriceStats({
  canonicalProductId: "gpu:nvidia:rtx-3080", days: 30, marketPool: "KR_C2C_USED",
  condition: "USED_WORKING", currency: "KRW", asOf: new Date(now).toISOString(),
  parserVersion: "pc-parser-v1", ruleVersion: "pc-rules-v1", filterVersion: "pc-filter-v1"
});
assert.equal(outlierStats.sold.sample_count, 10);
assert.equal(outlierStats.sold.median, 455_000);
assert.equal(outlierStats.sold.trimmed_mean, 456_250);
assert.equal(outlierStats.sold.outlier_count, 1);
assert.ok(ledger.traceStatMembers({
  canonicalProductId: "gpu:nvidia:rtx-3080", marketPool: "KR_C2C_USED",
  condition: "USED_WORKING", currency: "KRW"
}).some((row) => row.outlier_flag === 1 && row.outlier_reason === "IQR_HIGH"));

const usdStats = ledger.rebuildAndGetPriceStats({
  canonicalProductId: "gpu:nvidia:rtx-3080", days: 30, marketPool: "OVERSEAS_USED",
  condition: "USED_WORKING", currency: "USD", asOf: new Date(now).toISOString(),
  parserVersion: "pc-parser-v1", ruleVersion: "pc-rules-v1", filterVersion: "pc-filter-v1"
});
assert.equal(usdStats.sold.sample_count, 3);
assert.equal(usdStats.sold.median, 320);
assert.equal(usdStats.sold.mean, null, "n=3~4 exposes median with a sample warning, not mean");
const emptyStats = ledger.rebuildAndGetPriceStats({
  canonicalProductId: "gpu:nvidia:rtx-3080", days: 30, marketPool: "KR_C2C_USED",
  condition: "NEW", currency: "KRW", asOf: new Date(now).toISOString()
});
assert.equal(emptyStats.sold.sample_count, 0);
assert.equal(emptyStats.sold.median, null, "n=0~2 has no representative price");

ledger.upsertSource({
  sourceId: "hellomarket", displayName: "헬로마켓", marketPool: "KR_C2C_USED",
  policyStatus: "APPROVED", runtimeStatus: "ENABLED"
});
ledger.registerProduct({
  canonicalProductId: "gpu:nvidia:rtx-4070", masterVersion: 1,
  canonicalDisplayName: "NVIDIA GeForce RTX 4070", manufacturer: "NVIDIA", brand: "GeForce",
  categoryCode: "GPU", productGroupKey: "nvidia-geforce-rtx-4070", spec: { chipset: "RTX 4070" }
});
for (const [sourceIndex, sourceId] of ["joonggonara", "hellomarket"].entries()) {
  for (let index = 1; index <= 3; index += 1) {
    const listing = {
      ...base,
      sourceId,
      sourceListingId: `rtx4070-${sourceId}-${index}`,
      observedAt: new Date(now + (sourceIndex * 10 + index) * 1_000).toISOString(),
      title: `RTX 4070 ${sourceId} ${index}`,
      rawPayload: { title: `RTX 4070 ${sourceId} ${index}` },
      price: 600_000 + sourceIndex * 20_000 + index * 5_000,
      normalized: {
        ...base.normalized,
        canonicalProductId: "gpu:nvidia:rtx-4070",
        canonicalDisplayName: "NVIDIA GeForce RTX 4070"
      }
    };
    ledger.recordObservation(listing);
    ledger.recordObservation({
      ...listing,
      observedAt: new Date(now + DAY_MS + (sourceIndex * 10 + index) * 1_000).toISOString(),
      status: "SOLD",
      statusEvidence: { type: "STRUCTURED_STATUS", value: "SOLD" },
      ...(index === 1 ? {
        transactionPrice: listing.price - 5_000,
        transactionEvidence: {
          type: "OFFICIAL_API", source_field: "transaction_price", meaning: "TRANSACTION_PRICE",
          value: String(listing.price - 5_000)
        }
      } : {})
    });
  }
}
now += 2 * DAY_MS;
const sourceStats = ledger.rebuildAndGetPriceStats({
  canonicalProductId: "gpu:nvidia:rtx-4070", days: 30, marketPool: "KR_C2C_USED",
  condition: "USED_WORKING", currency: "KRW", asOf: new Date(now).toISOString(),
  parserVersion: "pc-parser-v1", ruleVersion: "pc-rules-v1", filterVersion: "pc-filter-v1"
});
assert.deepEqual(sourceStats.by_source.map((entry) => entry.source_id), ["hellomarket", "joonggonara"]);
assert.ok(sourceStats.by_source.every((entry) => entry.sold.sample_count === 3));
assert.ok(sourceStats.by_source.every((entry) => entry.confirmed_transactions.sample_count === 1));
assert.ok(sourceStats.by_source.every((entry) => entry.daily.length === sourceStats.daily.length));
assert.ok(sourceStats.by_source.every((entry) => entry.traceability.member_count > 0));
assert.equal(db.prepare("SELECT COUNT(*) AS count FROM daily_source_price_stats").get().count > 0, true);
assert.equal(db.prepare("SELECT COUNT(*) AS count FROM daily_source_price_stat_members").get().count > 0, true);

ledger.registerProduct({
  canonicalProductId: "gpu:nvidia:rtx-4060", masterVersion: 1,
  canonicalDisplayName: "NVIDIA GeForce RTX 4060", manufacturer: "NVIDIA", brand: "GeForce",
  categoryCode: "GPU", productGroupKey: "nvidia-geforce-rtx-4060", spec: { chipset: "RTX 4060" }
});
const aliasedListingId = "91919191";
const aliasBase = {
  ...base,
  sourceListingId: aliasedListingId,
  observedAt: new Date(now + 10_000).toISOString(),
  title: "ASUS RTX 4060 active listing",
  rawPayload: { title: "ASUS RTX 4060 active listing", revision: 1 },
  price: 410_000,
  normalized: {
    ...base.normalized,
    canonicalProductId: "gpu:nvidia:rtx-4060",
    canonicalDisplayName: "NVIDIA GeForce RTX 4060"
  }
};
ledger.recordObservation(aliasBase);
ledger.recordObservation({
  ...aliasBase,
  sourceListingId: `https://web.joongna.com/product/${aliasedListingId}`,
  observedAt: new Date(now + 20_000).toISOString(),
  rawPayload: { title: "ASUS RTX 4060 active listing", revision: 2 },
  price: 390_000
});
const aliasedListingStats = ledger.rebuildAndGetPriceStats({
  canonicalProductId: "gpu:nvidia:rtx-4060", days: 30, marketPool: "KR_C2C_USED",
  condition: "USED_WORKING", currency: "KRW", asOf: new Date(now + 30_000).toISOString(),
  parserVersion: "pc-parser-v1", ruleVersion: "pc-rules-v1", filterVersion: "pc-filter-v1"
});
assert.equal(aliasedListingStats.active.sample_count, 1,
  "URL and numeric aliases for one source listing count once in aggregate statistics");
assert.equal(aliasedListingStats.active.median, null,
  "a one-listing cohort keeps its representative price hidden");
assert.equal(aliasedListingStats.active.min, 390_000,
  "the newest alias observation supplies the aggregate price");
assert.equal(aliasedListingStats.by_source[0].active.sample_count, 1,
  "URL and numeric aliases count once in source statistics");
assert.equal(aliasedListingStats.by_source[0].active.min, 390_000,
  "the newest alias observation supplies the source price");
assert.equal(aliasedListingStats.by_manufacturer[0].active.sample_count, 1,
  "URL and numeric aliases count once in manufacturer statistics");
assert.equal(aliasedListingStats.by_manufacturer[0].active.min, 390_000,
  "the newest alias observation supplies the manufacturer price");

const ineligibleAliasObservedAt = new Date(now + DAY_MS + 20_000).toISOString();
ledger.recordObservation({
  ...aliasBase,
  sourceListingId: `joonggonara:https://web.joongna.com/product/${aliasedListingId}`,
  observedAt: ineligibleAliasObservedAt,
  rawPayload: { title: "ASUS RTX 4060 anomalous listing", revision: 3 },
  price: 1_000,
  normalized: {
    ...aliasBase.normalized,
    priceEligible: true,
    statisticsEligible: false,
    exclusionReasons: ["ANOMALOUS_LOW_PRICE"]
  }
});
const ineligibleAliasStats = ledger.rebuildAndGetPriceStats({
  canonicalProductId: "gpu:nvidia:rtx-4060", days: 30, marketPool: "KR_C2C_USED",
  condition: "USED_WORKING", currency: "KRW", asOf: new Date(now + DAY_MS + 30_000).toISOString(),
  parserVersion: "pc-parser-v1", ruleVersion: "pc-rules-v1", filterVersion: "pc-filter-v1"
});
assert.equal(ineligibleAliasStats.active.sample_count, 0,
  "the newest ineligible alias removes an older eligible alias from the current aggregate cohort");
assert.equal(ineligibleAliasStats.by_source[0].active.sample_count, 0,
  "the newest ineligible alias removes an older eligible alias from the current source cohort");
assert.equal(ineligibleAliasStats.by_manufacturer[0].active.sample_count, 0,
  "the newest ineligible alias removes an older eligible alias from the current manufacturer cohort");
const eligibleAliasDate = aliasBase.observedAt.slice(0, 10);
const ineligibleAliasDate = ineligibleAliasObservedAt.slice(0, 10);
assert.equal(ineligibleAliasStats.daily.find((row) => row.date === eligibleAliasDate)?.active.sample_count, 1,
  "an eligible historical day remains after a later ineligible observation");
assert.equal(ineligibleAliasStats.daily.find((row) => row.date === ineligibleAliasDate)?.active.sample_count, 0,
  "the ineligible observation removes the listing from that day's active cohort");

const movedActiveId = "92929291";
const movedActiveObservedAt = new Date(now + 2 * DAY_MS + 10_000).toISOString();
const movedAt = new Date(now + 3 * DAY_MS + 10_000).toISOString();
const movedActiveBase = {
  ...aliasBase,
  sourceListingId: movedActiveId,
  observedAt: movedActiveObservedAt,
  rawPayload: { title: "ASUS RTX 4060 moved active listing", revision: 1 },
  price: 420_000
};
ledger.recordObservation(movedActiveBase);
ledger.recordObservation({
  ...movedActiveBase,
  sourceListingId: `https://web.joongna.com/product/${movedActiveId}`,
  observedAt: movedAt,
  rawPayload: { title: "ASUS RTX 4070 corrected active listing", revision: 2 },
  price: 620_000,
  normalized: {
    ...movedActiveBase.normalized,
    canonicalProductId: "gpu:nvidia:rtx-4070",
    canonicalDisplayName: "NVIDIA GeForce RTX 4070"
  }
});
const movedSoldId = "92929292";
const movedSoldBase = {
  ...movedActiveBase,
  sourceListingId: movedSoldId,
  observedAt: new Date(now + 2 * DAY_MS + 20_000).toISOString(),
  rawPayload: { title: "ASUS RTX 4060 moved sold listing", revision: 1 },
  price: 430_000
};
ledger.recordObservation(movedSoldBase);
ledger.recordObservation({
  ...movedSoldBase,
  observedAt: new Date(now + 2 * DAY_MS + 30_000).toISOString(),
  status: "SOLD",
  statusEvidence: { type: "STRUCTURED_STATUS", value: "SOLD" }
});
ledger.recordObservation({
  ...movedSoldBase,
  sourceListingId: `https://web.joongna.com/product/${movedSoldId}`,
  observedAt: new Date(now + 3 * DAY_MS + 20_000).toISOString(),
  rawPayload: { title: "ASUS RTX 4070 corrected sold listing", revision: 2 },
  price: 630_000,
  normalized: {
    ...movedSoldBase.normalized,
    canonicalProductId: "gpu:nvidia:rtx-4070",
    canonicalDisplayName: "NVIDIA GeForce RTX 4070"
  }
});
const movedOldBucketStats = ledger.rebuildAndGetPriceStats({
  canonicalProductId: "gpu:nvidia:rtx-4060", days: 30, marketPool: "KR_C2C_USED",
  condition: "USED_WORKING", currency: "KRW", asOf: new Date(now + 3 * DAY_MS + 30_000).toISOString(),
  parserVersion: "pc-parser-v1", ruleVersion: "pc-rules-v1", filterVersion: "pc-filter-v1"
});
assert.equal(movedOldBucketStats.active.sample_count, 0,
  "a stable identity moved to another canonical product must leave the old current ACTIVE cohort");
assert.equal(movedOldBucketStats.sold.sample_count, 0,
  "a stable identity moved to another canonical product must leave the old current SOLD cohort");
assert.equal(movedOldBucketStats.by_source[0].active.sample_count, 0);
assert.equal(movedOldBucketStats.by_source[0].sold.sample_count, 0);
assert.equal(movedOldBucketStats.by_manufacturer[0].active.sample_count, 0);
assert.equal(movedOldBucketStats.by_manufacturer[0].sold.sample_count, 0);
const movedOldDate = movedActiveObservedAt.slice(0, 10);
const movedDate = movedAt.slice(0, 10);
assert.equal(movedOldBucketStats.daily.find((row) => row.date === movedOldDate)?.active.sample_count, 1,
  "a canonical move preserves eligible historical ACTIVE evidence in the old bucket");
assert.equal(movedOldBucketStats.daily.find((row) => row.date === movedDate)?.active.sample_count, 0,
  "the old bucket remains empty from the canonical move date onward");
assert.equal(movedOldBucketStats.daily.find((row) => row.date === movedDate)?.sold.sample_count, 0,
  "the current cross-product move retracts stale SOLD evidence from the old bucket");

const pipeline = new PcShadowPipeline({ ledger });
await pipeline.initialize();
assert.equal(ledger.matchAlias("CPU", "1200")?.forbidden, true,
  "bare 1200 is a forbidden CPU alias because socket numbers are not Ryzen model evidence");
assert.equal(ledger.matchAliasInText("CPU", "LGA 1200 소켓 Z490")?.forbidden, true,
  "LGA1200 context must not resolve to AMD Ryzen 3 1200");
assert.equal(ledger.matchAliasInText("CPU", "AMD Ryzen 3 1200 CPU")?.canonical_product_id, "cpu:amd:ryzen-3-1200",
  "explicit Ryzen family and tier remain valid model evidence");
const intel1200SocketProjection = pipeline.recordItem({
  item_id: "joonggonara:intel-lga1200", site: "joonggonara",
  title: "[1200소켓] 인텔 코어i7-10세대 10700 (코멧레이크S)", price: 230_000,
  currency: "KRW", url: "https://web.joongna.com/product/intel-lga1200", status: "ACTIVE"
}, new Date(now).toISOString());
assert.equal(intel1200SocketProjection.canonical_product_id, "cpu:intel:i7-10700");
const z490SocketProjection = pipeline.recordItem({
  item_id: "joonggonara:z490-lga1200", site: "joonggonara",
  title: "컴퓨터 메인보드 ASUS TUF GAMING Z490-PLUS (인텔 10세대 1200소켓)", price: 87_000,
  currency: "KRW", url: "https://web.joongna.com/product/z490-lga1200", status: "ACTIVE"
}, new Date(now).toISOString());
assert.equal(z490SocketProjection.canonical_product_id, "motherboard:platform:intel:asus");
const celeron1200SocketProjection = pipeline.recordItem({
  item_id: "joonggonara:celeron-lga1200", site: "joonggonara",
  title: "인텔 셀러론 g5905 코멧레이크S CPU 소켓 1200", price: 30_000,
  currency: "KRW", url: "https://web.joongna.com/product/celeron-lga1200", status: "ACTIVE"
}, new Date(now).toISOString());
assert.equal(celeron1200SocketProjection.canonical_product_id, null);
assert.equal(celeron1200SocketProjection.price_eligible, false);
const ryzen1200Projection = pipeline.recordItem({
  item_id: "joonggonara:ryzen-1200", site: "joonggonara",
  title: "AMD Ryzen 3 1200 CPU 정품 쿨러 포함", price: 35_000,
  currency: "KRW", url: "https://web.joongna.com/product/ryzen-1200", status: "ACTIVE"
}, new Date(now).toISOString());
assert.equal(ryzen1200Projection.canonical_product_id, "cpu:amd:ryzen-3-1200");
const unknown7500x3dProjection = pipeline.recordItem({
  item_id: "hellomarket:unknown-7500x3d", site: "hellomarket",
  title: "7500x3d cpu 팝니다", price: 300_000,
  currency: "KRW", url: "https://www.hellomarket.com/item/unknown-7500x3d", status: "ACTIVE"
}, new Date(now).toISOString());
assert.equal(unknown7500x3dProjection.canonical_product_id, null,
  "an unknown CPU model must not partially match an Intel numeric alias");
assert.equal(unknown7500x3dProjection.price_eligible, false);
assert.equal(unknown7500x3dProjection.statistics_eligible, false);
assert.ok(unknown7500x3dProjection.exclusion_reasons.includes("MODEL_NOT_IN_MASTER"));
for (let index = 0; index < 5; index += 1) {
  pipeline.recordItem({
    item_id: `joonggonara:rtx5090-sold-${index}`, site: "joonggonara",
    title: "ASUS RTX 5090 그래픽카드 정상 작동", price: 5_500_000 + index * 100_000,
    currency: "KRW", url: `https://web.joongna.com/product/rtx5090-sold-${index}`, status: "SOLD"
  }, new Date(now + index + 1).toISOString());
}
const anomalousRtx5090Projection = pipeline.recordItem({
  item_id: "joonggonara:rtx5090-anomalous", site: "joonggonara",
  title: "ASUS RTX 5090 그래픽카드 정상 작동", price: 9_000,
  currency: "KRW", url: "https://web.joongna.com/product/rtx5090-anomalous", status: "ACTIVE"
}, new Date(now + 10).toISOString());
assert.equal(anomalousRtx5090Projection.price_eligible, false,
  "an anomalously low display price must not remain price eligible");
assert.ok(anomalousRtx5090Projection.exclusion_reasons.includes("ANOMALOUS_LOW_PRICE"));
assert.equal(ledger.matchAlias("RAM", "DDR3 4GB"), null,
  "an unqualified manufacturer-specific RAM alias must not pick an arbitrary product");
assert.equal(ledger.matchAlias("RAM", "Samsung DDR5 16GB").canonical_product_id, "ram:samsung:ddr5:16gb");
const ramProjected = pipeline.recordItem({
  item_id: "joonggonara:ram-manufacturer-1", site: "joonggonara", title: "Samsung DDR5 16GB 메모리 정상 작동",
  description: "개인 사용", price: 45_000, currency: "KRW",
  url: "https://web.joongna.com/product/ram-manufacturer-1", status: "ACTIVE"
}, new Date(now).toISOString());
assert.equal(ramProjected.canonical_product_id, "ram:samsung:ddr5:16gb");
assert.equal(ramProjected.canonical_manufacturer, "Samsung");
const ramTotalLot = pipeline.recordItem({
  item_id: "joonggonara:ram-total-lot", site: "joonggonara", title: "Samsung DDR5 16GB 2EA 일괄",
  description: "개인 사용", price: 90_000, currency: "KRW",
  url: "https://web.joongna.com/product/ram-total-lot", status: "ACTIVE"
}, new Date(now).toISOString());
const ramUnitLot = pipeline.recordItem({
  item_id: "joonggonara:ram-unit-lot", site: "joonggonara", title: "Samsung DDR5 16GB 2EA 개당",
  description: "개인 사용", price: 45_000, currency: "KRW",
  url: "https://web.joongna.com/product/ram-unit-lot", status: "ACTIVE"
}, new Date(now).toISOString());
assert.deepEqual(
  [ramTotalLot, ramUnitLot].map((entry) => [entry.quantity, entry.price_scope, entry.price_eligible]),
  [[2, "TOTAL", true], [2, "UNIT", true]],
  "RAM lot quantity and price scope must survive into the public projection"
);
const ramComparablePrices = db.prepare(`SELECT n.price_scope, n.quantity, li.unit_price, li.total_price
  FROM normalized_listings n
  JOIN listing_snapshots s ON s.id = n.snapshot_id
  JOIN listing_items li ON li.normalized_listing_id = n.id AND li.item_index = 0
  WHERE s.source_id = 'joonggonara' AND s.source_listing_id IN ('ram-total-lot', 'ram-unit-lot')
  ORDER BY n.price_scope`).all().map((row) => ({ ...row }));
assert.deepEqual(ramComparablePrices, [
  { price_scope: "TOTAL", quantity: 2, unit_price: 45_000, total_price: 90_000 },
  { price_scope: "UNIT", quantity: 2, unit_price: 45_000, total_price: 90_000 }
], "RAM total-lot and per-module prices must normalize to the same comparable unit price");
const directoryFacetFixtures = [
  ["MOTHERBOARD", "MSI MAG B650M 박격포 WIFI 메인보드", "motherboard:platform:amd:msi", "MSI"],
  ["SSD", "삼성 980 PRO M.2 NVMe SSD 1TB", "ssd:samsung:capacity-bucket:960-gb-1-tb", "Samsung"],
  ["HDD", "WD Blue HDD 4TB 하드디스크", "hdd:western-digital:capacity-bucket:3-4-tb", "Western Digital"],
  ["PSU", "시소닉 VERTEX GX-850 ATX 3.0 파워", "psu:facet:atx:seasonic", "Seasonic"],
  ["COOLING", "녹투아 NH-D15 CPU 공랭 쿨러", "cooling:facet:air-cpu:noctua", "Noctua"],
  ["CASE", "Fractal Design North PC 케이스", "case:facet:mid-tower:fractal-design", "Fractal Design"],
  ["EXPANSION_CARD", "ASUS XG-C100C PCIe x16 랜카드 확장카드", "expansion:facet:network:asus", "ASUS"],
  ["ODD", "LG GP60NB50 외장 DVD ODD", "odd:facet:dvd-writer:lg", "LG"]
];
for (const [categoryCode, title, canonicalProductId, manufacturer] of directoryFacetFixtures) {
  const facetProjection = pipeline.recordItem({
    item_id: `joonggonara:facet-${categoryCode.toLowerCase()}`, site: "joonggonara", title,
    price: 100_000, currency: "KRW", url: `https://web.joongna.com/product/facet-${categoryCode.toLowerCase()}`,
    status: "ACTIVE"
  }, new Date(now).toISOString());
  assert.equal(facetProjection.canonical_product_id, canonicalProductId, `${categoryCode} manufacturer/facet directory match`);
  assert.equal(facetProjection.canonical_manufacturer, manufacturer, `${categoryCode} manufacturer directory match`);
  assert.equal(facetProjection.category_code, categoryCode);
  assert.equal(facetProjection.good_listing_eligible, false,
    `${categoryCode} directory groups must never be promoted as exact-SKU good listings`);
  const aggregationIdentity = db.prepare(`SELECT n.exact_product, json_extract(li.spec_json, '$.exact_sku') AS exact_sku
    FROM normalized_listings n
    JOIN listing_snapshots s ON s.id = n.snapshot_id
    JOIN listing_items li ON li.normalized_listing_id = n.id
    WHERE s.source_id = 'joonggonara' AND s.source_listing_id = ?
    ORDER BY n.id DESC LIMIT 1`).get(`facet-${categoryCode.toLowerCase()}`);
  assert.equal(aggregationIdentity.exact_product, 1,
    `${categoryCode} uniquely matched directory groups must enter their labelled group statistics`);
  assert.equal(aggregationIdentity.exact_sku, 0,
    `${categoryCode} directory groups remain distinct from exact SKUs`);
}
const structuredCaseProjection = pipeline.recordItem({
  item_id: "danawa:structured-case-1", source_listing_id: "structured-case-1", site: "danawa",
  requested_category_code: "CASE", source_category_code: "1:8",
  title: "[미들타워] Fractal Design Meshify C 강화유리", seller_type: "DEALER",
  price: 40_000, currency: "KRW", url: "https://dmall.danawa.com/v3/?controller=sale&methods=blog&seq=999991",
  status: "ACTIVE"
}, new Date(now).toISOString());
assert.equal(structuredCaseProjection.canonical_product_id, "case:facet:mid-tower:fractal-design",
  "a trusted source category must drive manufacturer matching when generic text detection is unknown");
assert.equal(structuredCaseProjection.canonical_manufacturer, "Fractal Design");
const structuredPsuProjection = pipeline.recordItem({
  item_id: "danawa:structured-psu-1", source_listing_id: "structured-psu-1", site: "danawa",
  requested_category_code: "PSU", source_category_code: "1:9",
  title: "[정격 650W] 마이크로닉스 Classic II 650W 80PLUS 골드", seller_type: "DEALER",
  price: 35_000, currency: "KRW", url: "https://dmall.danawa.com/v3/?controller=sale&methods=blog&seq=999993",
  status: "ACTIVE"
}, new Date(now).toISOString());
assert.equal(structuredPsuProjection.canonical_product_id, "psu:facet:atx:micronics");
assert.equal(structuredPsuProjection.canonical_manufacturer, "Micronics");
const boardProjected = pipeline.recordItem({
  item_id: "joonggonara:board-filter-1", site: "joonggonara", title: "ASUS RTX 3080 정상 작동",
  description: "개인 사용", price: 485_000, currency: "KRW",
  url: "https://web.joongna.com/product/board-filter-1", status: "ACTIVE"
}, new Date(now).toISOString());
assert.equal(boardProjected.canonical_manufacturer, "ASUS",
  "GPU listing manufacturer filters must use the board manufacturer");
assert.equal(boardProjected.chip_manufacturer, "NVIDIA");
assert.equal(boardProjected.board_manufacturer, "ASUS");
const projected = pipeline.recordItem({
  item_id: "joonggonara:shadow-1", site: "joonggonara", title: "RTX 3080 정상 작동",
  description: "개인 사용", price: 480_000, currency: "KRW",
  url: "https://web.joongna.com/product/shadow-1", status: "ACTIVE"
}, new Date(now).toISOString());
assert.equal(projected.canonical_product_id, "gpu:nvidia:rtx-3080");
assert.equal(projected.market_pool, "KR_C2C_USED");
assert.ok(["category", "model", "quantity", "price_scope", "condition", "status", "dedupe"]
  .every((field) => Number.isFinite(projected.confidence[field])));
const stableProjectionId = "joonggonara:https://web.joongna.com/product/stable-id";
pipeline.recordItem({
  item_id: stableProjectionId, source_listing_id: "stable-id", site: "joonggonara",
  title: "RTX 3080 정상 작동", description: "개인 사용", price: 480_000, currency: "KRW",
  url: "https://web.joongna.com/product/stable-id", image_url: "https://img.example.test/stable-id.jpg",
  posted_at: "2026-08-29T00:00:00.000Z", status: "ACTIVE",
  raw_payload: { title: "RTX 3080 정상 작동" }
}, new Date(now + 500).toISOString());
assert.equal(ledger.getPublicProjection("joonggonara", "stable-id").item_id, stableProjectionId,
  "lifecycle projections must preserve the SearchIndex item identity");
assert.equal(ledger.getPublicProjection("joonggonara", "stable-id").image_url, "https://img.example.test/stable-id.jpg",
  "lifecycle projections must preserve the public product image when source raw payload is nested");
assert.equal(ledger.getPublicProjection("joonggonara", "stable-id").posted_at, "2026-08-29T00:00:00.000Z");
const unchangedProjected = pipeline.recordItem({
  item_id: stableProjectionId, source_listing_id: "stable-id", site: "joonggonara",
  title: "RTX 3080 정상 작동", description: "개인 사용", price: 480_000, currency: "KRW",
  url: "https://web.joongna.com/product/stable-id", image_url: "https://img.example.test/stable-id.jpg",
  posted_at: "2026-08-29T00:00:00.000Z", status: "ACTIVE",
  raw_payload: { title: "RTX 3080 정상 작동" }
}, new Date(now + 600).toISOString());
assert.equal(unchangedProjected._pc_snapshot_created, false,
  "crawl changed_count must distinguish unchanged observations from new snapshots");
const dealerProjected = pipeline.recordItem({
  item_id: "joonggonara:dealer-1", site: "joonggonara", title: "업자 RTX 3080 정상 작동",
  description: "판매점 재고", price: 490_000, currency: "KRW",
  url: "https://web.joongna.com/product/dealer-1", status: "ACTIVE", seller_type: "DEALER"
}, new Date(now + 1_000).toISOString());
assert.equal(dealerProjected.market_pool, "KR_DEALER_USED");
assert.equal(dealerProjected.price_eligible, true, "dealer prices are isolated, not discarded");
assert.equal(dealerProjected.good_listing_eligible, false);
assert.ok(dealerProjected.exclusion_reasons.includes("DEALER_LISTING"));
const refurbProjected = pipeline.recordItem({
  item_id: "rethinkmall:refurb-1", site: "rethinkmall", title: "리퍼비시 RTX 3080 정상 작동",
  description: "검수 리퍼", price: 510_000, currency: "KRW",
  url: "https://web.rethinkmall.com/product/refurb-1", status: "ACTIVE"
}, new Date(now + 2_000).toISOString());
assert.equal(refurbProjected.market_pool, "KR_REFURB_RETAIL");
assert.equal(refurbProjected.condition_code, "REFURBISHED");
assert.equal(refurbProjected.price_eligible, true, "refurb prices are isolated, not discarded");
assert.equal(refurbProjected.good_listing_eligible, false);
pipeline.recordItem({
  item_id: "joonggonara:split-bundle", site: "joonggonara",
  title: "7800X3D + RTX 3080 반본체 세트", description: "CPU와 GPU 묶음",
  price: 900_000, currency: "KRW", url: "https://example.test/split-bundle", status: "ACTIVE"
}, new Date(now + 2_500).toISOString());
const splitBundleItems = db.prepare(`SELECT li.canonical_product_id, li.unit_price, li.total_price
  FROM listing_items li
  JOIN normalized_listings n ON n.id = li.normalized_listing_id
  JOIN listing_snapshots s ON s.id = n.snapshot_id
  WHERE s.source_id = 'joonggonara' AND s.source_listing_id = 'split-bundle'
  ORDER BY li.canonical_product_id`).all();
assert.deepEqual(splitBundleItems.map((row) => row.canonical_product_id), ["cpu:amd:ryzen-7-7800x3d", "gpu:nvidia:rtx-3080"],
  "component bundles retain separate child items without entering single-product prices");
assert.ok(splitBundleItems.every((row) => row.unit_price === null && row.total_price === null),
  "a bundle total must never be assigned to children without explicit per-item prices");
pipeline.recordItem({
  item_id: "joonggonara:priced-bundle", site: "joonggonara",
  title: "7800X3D 35만원 + RTX 3080 45만원 반본체 세트", description: "CPU와 GPU 묶음",
  price: 800_000, currency: "KRW", url: "https://example.test/priced-bundle", status: "ACTIVE"
}, new Date(now + 2_600).toISOString());
const pricedBundleItems = db.prepare(`SELECT li.canonical_product_id, li.unit_price, li.total_price
  FROM listing_items li
  JOIN normalized_listings n ON n.id = li.normalized_listing_id
  JOIN listing_snapshots s ON s.id = n.snapshot_id
  WHERE s.source_id = 'joonggonara' AND s.source_listing_id = 'priced-bundle'
  ORDER BY li.canonical_product_id`).all();
assert.deepEqual(pricedBundleItems.map((row) => [row.canonical_product_id, row.unit_price, row.total_price]), [
  ["cpu:amd:ryzen-7-7800x3d", 350_000, 350_000],
  ["gpu:nvidia:rtx-3080", 450_000, 450_000]
], "explicit child prices are retained independently from the bundle total");
pipeline.recordItem({
  item_id: "joonggonara:bundle-total-after-child", site: "joonggonara",
  title: "7800X3D + RTX 3080 세트 90만원", description: "CPU와 GPU 묶음 총액",
  price: 900_000, currency: "KRW", url: "https://example.test/bundle-total-after-child", status: "ACTIVE"
}, new Date(now + 2_700).toISOString());
assert.equal(db.prepare(`SELECT COUNT(*) AS count FROM listing_items li
  JOIN normalized_listings n ON n.id = li.normalized_listing_id
  JOIN listing_snapshots s ON s.id = n.snapshot_id
  WHERE s.source_listing_id = 'bundle-total-after-child'
    AND (li.unit_price IS NOT NULL OR li.total_price IS NOT NULL)`).get().count, 0,
  "a trailing bundle total must not become the last child price");

const duplicateActiveA = ledger.recordObservation({
  ...base, sourceListingId: "duplicate-reactivation-a", observedAt: new Date(now + 3_000).toISOString(),
  title: "RTX 3080 duplicate A", rawPayload: { title: "RTX 3080 duplicate A" }
});
const duplicateActiveB = ledger.recordObservation({
  ...base, sourceId: "ebay", sourceListingId: "duplicate-reactivation-b",
  observedAt: new Date(now + 4_000).toISOString(), title: "RTX 3080 duplicate B",
  rawPayload: { title: "RTX 3080 duplicate B" }, price: 400, currency: "USD",
  normalized: { ...base.normalized, marketPool: "OVERSEAS_USED" }
});
const duplicateEvidence = { identity_keys: ["seller_fingerprint", "image_hash"] };
ledger.assignDuplicateCluster({
  snapshotId: duplicateActiveA.snapshotId, clusterKey: "fixture-cross-source", confidence: 0.99,
  evidence: duplicateEvidence
});
assert.equal(ledger.assignDuplicateCluster({
  snapshotId: duplicateActiveB.snapshotId, clusterKey: "fixture-cross-source", confidence: 0.99,
  evidence: duplicateEvidence
}).cluster_status, "CONFIRMED");
const duplicateSoldA = ledger.recordObservation({
  ...base, sourceListingId: "duplicate-reactivation-a", observedAt: new Date(now + 5_000).toISOString(),
  title: "RTX 3080 duplicate A", rawPayload: { title: "RTX 3080 duplicate A" }, status: "SOLD",
  statusEvidence: { type: "STRUCTURED_STATUS", value: "SOLD" }
});
const duplicateReactivatedA = ledger.recordObservation({
  ...base, sourceListingId: "duplicate-reactivation-a", observedAt: new Date(now + 6_000).toISOString(),
  title: "RTX 3080 duplicate A", rawPayload: { title: "RTX 3080 duplicate A" }, status: "ACTIVE",
  statusEvidence: { type: "STRUCTURED_STATUS", value: "ACTIVE" }
});
for (const snapshotId of [duplicateSoldA.snapshotId, duplicateReactivatedA.snapshotId]) {
  assert.equal(db.prepare("SELECT COUNT(*) AS count FROM duplicate_cluster_members WHERE snapshot_id = ?").get(snapshotId).count, 1,
    "duplicate identity must follow lifecycle snapshots");
}
pipeline.recordItem({
  item_id: "danawa:legacy-structured-case", source_listing_id: "legacy-structured-case", site: "danawa",
  title: "[미들타워] Fractal Design Meshify C 강화유리", price: 40_000, currency: "KRW",
  url: "https://dmall.danawa.com/v3/?controller=sale&methods=blog&seq=999992&parentCategoryCode=1&childCategoryCode=8",
  status: "ACTIVE",
  raw_payload: {
    href: "/v3/?controller=sale&methods=blog&seq=999992&parentCategoryCode=1&childCategoryCode=8"
  }
}, new Date(now + 6_500).toISOString());
const reclassificationVersions = {
  normalizationVersion: 2,
  parserVersion: "pc-parser-v2",
  ruleVersion: "pc-rules-v1",
  filterVersion: "pc-filter-v1"
};
const reclassificationDryRun = reclassifyPcSnapshots({
  ledger, pipeline, versions: reclassificationVersions, limit: 3
});
assert.equal(reclassificationDryRun.mode, "dry-run");
assert.equal(reclassificationDryRun.eligible, 3);
assert.equal(db.prepare("SELECT COUNT(*) AS count FROM normalized_listings WHERE normalization_version = 2").get().count, 0);
const reclassificationApply = reclassifyPcSnapshots({
  ledger, pipeline, versions: reclassificationVersions, apply: true, limit: 3
});
assert.equal(reclassificationApply.inserted, 3);
assert.equal(reclassifyPcSnapshots({
  ledger, pipeline, versions: reclassificationVersions, apply: true, limit: 3
}).skipped, 3, "reclassification reruns must be idempotent");
const fullReclassification = reclassifyPcSnapshots({
  ledger, pipeline, versions: reclassificationVersions, apply: true
});
assert.equal(fullReclassification.inserted + fullReclassification.skipped,
  db.prepare("SELECT COUNT(*) AS count FROM listing_snapshots").get().count,
  "candidate activation requires complete snapshot coverage");
assert.equal(db.prepare(`SELECT n.canonical_product_id FROM normalized_listings n
  JOIN listing_snapshots s ON s.id = n.snapshot_id
  WHERE s.source_id = 'danawa' AND s.source_listing_id = 'legacy-structured-case'
    AND n.normalization_version = 2`).get()?.canonical_product_id, "case:facet:mid-tower:fractal-design",
"reclassification must recover a trusted Danawa category from the immutable listing URL");
const reclassifiedSnapshot = db.prepare("SELECT snapshot_id FROM normalized_listings WHERE normalization_version = 2 ORDER BY snapshot_id LIMIT 1").get();
assert.equal(db.prepare(`SELECT normalization_version FROM normalized_listings
  WHERE snapshot_id = ? ORDER BY normalization_version DESC LIMIT 1`).get(reclassifiedSnapshot.snapshot_id).normalization_version, 2);
const passingQualityReport = {
  metrics: {
    reviewed_records: 100, category_precision: 0.99, exact_model_accuracy: 0.98,
    ram_quantity_price_scope_accuracy: 0.995, bundle_contamination_rate: 0,
    false_dedupe_rate: 0, unknown_rate: 0.1
  },
  targets: Object.fromEntries(["category", "model", "ram", "bundle", "dedupe", "unknown"]
    .map((key) => [key, { met: true }])),
  integrity_blockers: { false_sold_count: 0, market_pool_mismatch_count: 0, false_dedupe_count: 0 }
};
assert.deepEqual(evaluatePipelineQualityReports({
  ledger, reports: { "pc-normalization-v2": passingQualityReport }, evaluatedAt: new Date(now)
}), [], "daily automation must not auto-activate staged parser/rule/filter changes");
assert.equal(ledger.getActivePipelineVersion().version_key, "pc-v1");
assert.equal(ledger.evaluatePipelineVersion({
  versionKey: "pc-normalization-v2", qualityReport: passingQualityReport
}).status, "ACTIVE", "staged pipeline activation is an explicit operator action");
assert.equal(ledger.getActivePipelineVersion().version_key, "pc-normalization-v2");
pipeline.recordItem({
  item_id: "joonggonara:v2-active-item", site: "joonggonara", title: "RTX 3080 v2 활성 매물",
  description: "정상 작동", price: 470_000, currency: "KRW",
  url: "https://example.test/v2-active-item", status: "ACTIVE"
}, new Date(now + 7_000).toISOString());
const v2ActiveSnapshot = db.prepare(`SELECT id FROM listing_snapshots
  WHERE source_id = 'joonggonara' AND source_listing_id = 'v2-active-item' ORDER BY id DESC LIMIT 1`).get();
assert.deepEqual(db.prepare(`SELECT normalization_version FROM normalized_listings
  WHERE snapshot_id = ? ORDER BY normalization_version`).all(v2ActiveSnapshot.id).map((row) => row.normalization_version), [1, 2],
"active candidate observations must dual-write the exact rollback normalization");
assert.equal(ledger.getPublicProjection("joonggonara", "v2-active-item").parser_version, "pc-parser-v2");
ledger.insertNormalization(v2ActiveSnapshot.id, {
  normalizationVersion: 3, canonicalProductId: "gpu:rolled-back-probe", canonicalDisplayName: "bad v3",
  categoryCode: "GPU", listingKind: "SINGLE_COMPONENT", quantity: 1, priceScope: "TOTAL",
  conditionCode: "USED_WORKING", marketPool: "KR_C2C_USED", exactProduct: true,
  priceEligible: true, exclusionReasons: [], unitPrice: 1, totalPrice: 1
}, 1, "KRW", { parserVersion: "pc-parser-v2", ruleVersion: "pc-rules-v1", filterVersion: "pc-filter-v1" });
assert.equal(ledger.getPublicProjection("joonggonara", "v2-active-item").canonical_product_id, "gpu:nvidia:rtx-3080",
  "public projection must pin normalization_version as well as parser/rule/filter labels");
for (let attempt = 1; attempt <= 3; attempt += 1) {
  ledger.recordMissingCheck({
    sourceId: "joonggonara", sourceListingId: "v2-active-item",
    checkedAt: new Date(now + 7_000 + attempt * 6 * HOUR_MS).toISOString()
  });
}
const v2MissingSnapshot = db.prepare(`SELECT id FROM listing_snapshots
  WHERE source_id = 'joonggonara' AND source_listing_id = 'v2-active-item' ORDER BY observed_at DESC, id DESC LIMIT 1`).get();
assert.deepEqual(db.prepare(`SELECT normalization_version FROM normalized_listings
  WHERE snapshot_id = ? ORDER BY normalization_version`).all(v2MissingSnapshot.id).map((row) => row.normalization_version), [1, 2, 3],
  "lifecycle-only snapshots must preserve active and rollback normalizations");
const smallSingleMissQualityReport = {
  ...passingQualityReport,
  targets: { ...passingQualityReport.targets, model: { met: false } },
  metrics: { ...passingQualityReport.metrics, exact_model_accuracy: 0.979 }
};
assert.equal(ledger.evaluatePipelineVersion({
  versionKey: "pc-normalization-v2", qualityReport: smallSingleMissQualityReport
}).status, "ACTIVE", "one small non-integrity quality miss must not roll back the whole pipeline");
assert.equal(ledger.getActivePipelineVersion().version_key, "pc-normalization-v2");
const degradedQualityReport = {
  ...passingQualityReport,
  targets: { ...passingQualityReport.targets, model: { met: false } },
  metrics: { ...passingQualityReport.metrics, exact_model_accuracy: 0.9 }
};
assert.equal(evaluatePipelineQualityReports({
  ledger, reports: { "pc-normalization-v2": degradedQualityReport }, evaluatedAt: new Date(now)
})[0].status, "ROLLED_BACK");
assert.equal(ledger.getActivePipelineVersion().version_key, "pc-v1", "quality degradation restores the exact previous pipeline version");
assert.equal(ledger.getPublicProjection("joonggonara", "v2-active-item").parser_version, "pc-parser-v1",
  "rolled-back normalizations must never drive the public projection");
const shadowStartedAt = new Date(now - 73 * HOUR_MS).toISOString();
const distinctAliasSnapshots = [];
for (let index = 0; index < 20; index += 1) {
  const sourceListingId = `alias-review-${index}`;
  const site = index % 2 === 0 ? "joonggonara" : "ebay";
  pipeline.recordItem({
    item_id: `${site}:${sourceListingId}`, site,
    title: `RTX 3080 정상 매물 ${index}`, description: "개인 사용 정상 작동",
    price: site === "ebay" ? 400 + index : 480_000 + index, currency: site === "ebay" ? "USD" : "KRW",
    url: `https://example.test/${site}/${sourceListingId}`,
    status: "ACTIVE"
  }, new Date(now + index * 1_000).toISOString());
  const snapshotId = db.prepare(`SELECT id FROM listing_snapshots
    WHERE source_id = ? AND source_listing_id = ? ORDER BY id DESC LIMIT 1`).get(site, sourceListingId).id;
  distinctAliasSnapshots.push(snapshotId);
  ledger.recordClassificationFeedback({
    snapshotId,
    fieldName: "canonical_product_id",
    previousValue: null,
    correctedValue: "gpu:nvidia:rtx-3080",
    reviewerRef: `fixture-reviewer-${index}`,
    reason: "human reviewed alias sample",
    ...(index === 0 ? {
      aliasCandidate: "3080 정상",
      canonicalProductId: "gpu:nvidia:rtx-3080",
      approvedForShadow: true,
      createdAt: shadowStartedAt
    } : {})
  });
}
const insufficientAliasEvaluation = ledger.evaluateDueAliasShadows(new Date(now), {
  "3080정상": { fixedValidationPrecision: 99.5, regressionPassed: true }
});
assert.ok(insufficientAliasEvaluation.some((result) => result.status === "SHADOW" && result.reason === "FIXED_VALIDATION_REQUIRED"),
  "fixed validation precision must be a [0,1] ratio");
const aliasEvaluation = ledger.evaluateDueAliasShadows(new Date(now), {
  "3080정상": { fixedValidationPrecision: 1, regressionPassed: true }
});
assert.ok(aliasEvaluation.some((result) => result.status === "APPROVED" && result.promoted === true));
for (let index = 0; index < 20; index += 1) {
  ledger.recordClassificationFeedback({
    snapshotId: distinctAliasSnapshots[index], fieldName: "canonical_product_id", previousValue: null,
    correctedValue: "gpu:nvidia:rtx-3070", reviewerRef: `fixture-reject-reviewer-${index}`,
    reason: "human rejected alias sample",
    ...(index === 0 ? {
      aliasCandidate: "정상 작동", canonicalProductId: "gpu:nvidia:rtx-3080",
      approvedForShadow: true, createdAt: shadowStartedAt
    } : {})
  });
}
const rejectedAliasEvaluation = ledger.evaluateDueAliasShadows(new Date(now));
assert.ok(rejectedAliasEvaluation.some((result) => result.status === "REJECTED" && result.rolledBack === true));
for (let index = 0; index < 5; index += 1) {
  const site = index % 2 === 0 ? "joonggonara" : "ebay";
  pipeline.recordItem({
    item_id: `${site}:model-candidate-${index}`, site,
    title: index === 0 ? "RTX 6090 정상 작동 연락 010-1234-5678" : "RTX 6090 정상 작동",
    description: "개인 사용", price: site === "ebay" ? 1_200 : 1_500_000,
    currency: site === "ebay" ? "USD" : "KRW",
    url: `https://example.test/model-candidate-${index}`, status: "ACTIVE"
  }, new Date(now + 20_000 + index * 1_000).toISOString());
}
const modelCandidate = db.prepare(`SELECT * FROM model_candidates
  WHERE category_code = 'GPU' AND candidate_text = 'rtx6090'`).get();
assert.equal(modelCandidate.candidate_status, "REVIEW_REQUIRED");
assert.equal(modelCandidate.distinct_listing_count, 5);
assert.equal(modelCandidate.distinct_source_count, 2);
assert.doesNotMatch(modelCandidate.evidence_json, /010-1234-5678/u,
  "automatic candidate evidence must pass through the same PII redaction boundary as raw listings");
for (let index = 0; index < 5; index += 1) {
  const site = index % 2 === 0 ? "joonggonara" : "ebay";
  pipeline.recordItem({
    item_id: `${site}:unknown-alias-${index}`, site, title: "칠팔삼디 정상 작동",
    description: "PC 부품 개인 사용", price: site === "ebay" ? 300 : 400_000,
    currency: site === "ebay" ? "USD" : "KRW",
    url: `https://example.test/unknown-alias-${index}`, status: "ACTIVE"
  }, new Date(now + 30_000 + index * 1_000).toISOString());
}
const unknownAliasCandidate = db.prepare(`SELECT * FROM model_candidates
  WHERE category_code = 'UNKNOWN' AND candidate_text = '칠팔삼디'`).get();
assert.equal(unknownAliasCandidate.candidate_status, "REVIEW_REQUIRED",
  "repeated unparsed model-like aliases must become review candidates without auto-promotion");
assert.equal(ledger.runIntegrityAudit(new Date(now)).ok, true);
const auditFixtureStat = db.prepare("SELECT id, sample_count FROM daily_price_stats ORDER BY id LIMIT 1").get();
db.prepare("UPDATE daily_price_stats SET sample_count = sample_count + 1 WHERE id = ?").run(auditFixtureStat.id);
assert.throws(() => ledger.runIntegrityAudit(new Date(now)), /STAT_MEMBER_COUNT_MISMATCH/u);
db.prepare("UPDATE daily_price_stats SET sample_count = ? WHERE id = ?").run(auditFixtureStat.sample_count, auditFixtureStat.id);
assert.equal(ledger.runIntegrityAudit(new Date(now)).ok, true);

const reactivationBase = {
  ...base, sourceListingId: "reactivated", title: "RTX 3080 재등록", rawPayload: { title: "RTX 3080 재등록" },
  observedAt: new Date(now + HOUR_MS).toISOString()
};
ledger.recordObservation(reactivationBase);
ledger.recordObservation({
  ...reactivationBase, observedAt: new Date(now + 2 * HOUR_MS).toISOString(), status: "SOLD",
  statusEvidence: { type: "STRUCTURED_STATUS", value: "SOLD" }
});
ledger.recordObservation({
  ...reactivationBase, observedAt: new Date(now + 3 * HOUR_MS).toISOString(), status: "ACTIVE",
  statusEvidence: { type: "STRUCTURED_STATUS", value: "판매 중" }
});
const correctedStats = ledger.rebuildAndGetPriceStats({
  canonicalProductId: "gpu:nvidia:rtx-3080", days: 30, marketPool: "KR_C2C_USED",
  condition: "USED_WORKING", currency: "KRW", asOf: new Date(now + 4 * HOUR_MS).toISOString()
});
assert.equal(correctedStats.sold.sample_count, 10, "explicit reactivation retracts a false SOLD sample");
assert.throws(() => ledger.recordObservation({
  ...base, sourceListingId: "wrong-pool", observedAt: new Date(now + 5 * HOUR_MS).toISOString(),
  normalized: { ...base.normalized, marketPool: "OVERSEAS_USED" }
}), /MARKET_POOL_(?:NOT_ALLOWED|MISMATCH)/u);
const firstObservedSold = ledger.recordObservation({
  ...base,
  sourceListingId: "first-observed-sold",
  observedAt: new Date(now + 6 * HOUR_MS).toISOString(),
  price: 430_000,
  status: "SOLD",
  statusEvidence: { type: "STRUCTURED_STATUS", value: "SOLD" }
});
assert.equal(firstObservedSold.soldLastAskPrice, 430_000,
  "a structured SOLD row may use its still-visible asking price without claiming a transaction price");

ledger.close();
db.close();
console.log(JSON.stringify({ status: "passed", contract: "pc-domain" }, null, 2));
