import assert from "node:assert/strict";

import { pcCollectionCapacityPlan, pcCollectionTargetSetV2 } from "../cloudflare/pc-directory-http.mjs";
import { collectOne, pcSearchQueryVariants } from "../cloudflare/live-search.mjs";
import { OPERATIONAL_PC_DIRECTORY_SITES } from "../cloudflare/target-sites.mjs";
import { PC_PART_CATEGORY_CODES } from "../collector/logic/pc-specialist-targets.mjs";
import { PC_SOURCE_REGISTRY, listSourceCadenceEvents } from "../collector/logic/pc-source-registry.mjs";
import { SearchIndex } from "../aws-runner/search-index.mjs";
import { publicPcProducts } from "../market/logic/pc-public-catalog.mjs";

const targetSet = pcCollectionTargetSetV2();
const targets = targetSet.targets.filter((target) => target.enabled !== false);
const targetIds = targets.map((target) => target.targetId);
const categorySet = new Set(PC_PART_CATEGORY_CODES);
const operationalSites = new Set(OPERATIONAL_PC_DIRECTORY_SITES);
const publicProducts = publicPcProducts();

const defaultCapacity = pcCollectionCapacityPlan();
assert.equal(defaultCapacity.all_sources_sufficient, true,
  "the default per-run budget must cover hourly searches and the full daily model sweep");
assert.equal(defaultCapacity.configured_targets_per_run, 85);
assert.ok(defaultCapacity.sources.every((source) => source.minimum_targets_per_run <= defaultCapacity.configured_targets_per_run));
const legacyLowCapacity = pcCollectionCapacityPlan(12);
assert.equal(legacyLowCapacity.all_sources_sufficient, false,
  "an intentionally preserved low legacy limit must be visible as insufficient instead of silently starving daily targets");
assert.ok(legacyLowCapacity.sources.some((source) => source.daily_capacity_per_day < source.daily_target_count));

assert.equal(new Set(targetIds).size, targetIds.length, "collection target ids must be unique");
assert.ok(targets.length > PC_PART_CATEGORY_CODES.length, "the active target set must include category and model batches");
assert.equal(new Set(targets.map((target) => target.categoryCode)).size, categorySet.size,
  "every PC part category must have an active collection target");
assert.doesNotMatch(JSON.stringify(targetSet), /quasarzone/iu, "retired Quasarzone must not be an active collection target");
assert.equal(targetSet.targetSetVersion, "pc-targets:5:full-master-v13");
assert.ok(targetSet.targets.every((target) => /^pc-target:5:(?:category|market|master)-v13:/u.test(target.targetId)),
  "a new target set owns new IDs and cannot reuse an old set's immutable ownership");
const koreanGskill = targets.filter(target => target.targetId.endsWith(':domestic:ko'));
assert.equal(koreanGskill.length, 27);
assert.ok(koreanGskill.every(target => target.queryText.startsWith('지스킬 ') && !target.sourceKeys.includes('ebay')));
for (const product of publicProducts) {
  assert.ok(targets.some((target) => target.canonicalProductId === product.id),
    `${product.id} must have an exact collection target`);
}

const directorySources = PC_SOURCE_REGISTRY
  .filter((source) => source.directory_source === true && source.policy_status === "APPROVED" && source.runtime_status === "ENABLED")
  .map((source) => source.key);
assert.deepEqual([...operationalSites].sort(), [...new Set(directorySources)].sort(),
  "operational directory sites must come from the approved enabled registry");

for (const categoryCode of PC_PART_CATEGORY_CODES) {
  const categoryTargets = targets.filter((target) => target.categoryCode === categoryCode);
  assert.ok(categoryTargets.length > 0, `${categoryCode} must have at least one target`);
  assert.ok(categoryTargets.some((target) => target.cadenceClass === "HOURLY_CATEGORY"),
    `${categoryCode} must have a recurring category collection batch`);
  assert.ok(categoryTargets.some((target) => target.cadenceClass === "DAILY_MASTER" && target.canonicalProductId),
    `${categoryCode} must have a daily exact-model collection batch`);
  for (const sourceId of operationalSites) {
    assert.ok(categoryTargets.some((target) => target.sourceKeys.includes(sourceId)),
      `${sourceId} must be assigned to ${categoryCode}`);
  }
}

for (const sourceId of operationalSites) {
  const assigned = targets.filter((target) => target.sourceKeys.includes(sourceId));
  assert.ok(assigned.length > 0, `${sourceId} must have assigned collection targets`);
  assert.ok(assigned.every((target) => target.queryText.trim()), `${sourceId} targets must have queries`);
  assert.ok(assigned.every((target) => Number(target.minimumIntervalMinutes) >= 55),
    `${sourceId} targets must respect the minimum pacing guard`);
}

const events = listSourceCadenceEvents({
  after: "2026-08-31T14:00:00.000Z",
  through: "2026-08-31T16:00:00.000Z",
  jitterBySource: Object.fromEntries([...operationalSites].map((sourceId) => [sourceId, 0]))
});
const eventSources = new Set(events.map((event) => event.source_key));
for (const sourceId of operationalSites) {
  assert.ok(eventSources.has(sourceId), `${sourceId} must have a scheduler cadence event`);
}

const coverage = Object.fromEntries(PC_PART_CATEGORY_CODES.map((categoryCode) => [
  categoryCode,
  Object.fromEntries([...operationalSites].map((sourceId) => [
    sourceId,
    targets.filter((target) => target.categoryCode === categoryCode && target.sourceKeys.includes(sourceId)).length
  ]))
]));

const ryzen3100Targets = targets.filter((target) => target.canonicalProductId === "cpu:amd:ryzen-3-3100");
assert.ok(ryzen3100Targets.some((target) => target.queryText === "라이젠 3 3100"
  && target.sourceKeys.includes("bunjang") && !target.sourceKeys.includes("ebay")),
"domestic Ryzen collection must use a family-qualified Korean query instead of a bare model number");
assert.ok(ryzen3100Targets.some((target) => target.queryText === "Ryzen 3 3100"
  && target.sourceKeys.includes("bunjang") && !target.sourceKeys.includes("ebay")),
"domestic Ryzen collection must include a source spelling variant");
assert.ok(ryzen3100Targets.some((target) => target.queryText === "AMD Ryzen 3 3100"
  && target.sourceKeys.length === 1 && target.sourceKeys[0] === "ebay"),
"eBay collection must retain a source-appropriate English exact-model query");
assert.equal(ryzen3100Targets.some((target) => target.queryText === "3100"), false,
"ambiguous bare Ryzen model numbers must not be exact collection queries");
const intel12400Targets = targets.filter((target) => target.canonicalProductId === "cpu:intel:i5-12400f");
assert.ok(intel12400Targets.some((target) => target.queryText === "i5 12400F"
  && target.sourceKeys.includes("bunjang")), "Intel collection must include a space-separated variant");
const gtx1070TiTargets = targets.filter((target) => target.canonicalProductId === "gpu:nvidia:gtx-1070-ti");
assert.ok(gtx1070TiTargets.some((target) => target.queryText === "GTX1070Ti"
  && target.sourceKeys.includes("bunjang")), "GPU collection must include a compact model variant");
assert.ok(targets.some((target) => target.canonicalProductId === "ssd:samsung:capacity-bucket:513-gb-1-tb"
  && target.sourceKeys.includes("bunjang")), "supplemental public products must be collected");
assert.equal(targets.some((target) => /\b(?:257|513)GB\b/u.test(target.queryText)), false,
  "storage collection must not spend source quota on synthetic bucket-boundary capacities");
assert.ok(targets.some((target) => target.canonicalProductId === "ssd:samsung:capacity-bucket:257-512-gb"
  && target.sourceKeys.length === 1 && target.sourceKeys[0] === "ebay" && target.queryText === "Samsung 512GB internal SSD"),
"eBay storage collection must use a common capacity representative");
assert.ok(targets.some((target) => target.canonicalProductId === "psu:seasonic:watts-bucket:501-650"
  && target.sourceKeys.length === 1 && target.sourceKeys[0] === "ebay" && target.queryText === "Seasonic 650W computer power supply"),
"eBay PSU collection must use a common rated-wattage representative");

const kingstonTarget = targets.find((target) => target.canonicalProductId === "ram:kingston:ddr3:4gb"
  && target.sourceKeys.includes("bunjang"));
assert.equal(kingstonTarget?.queryText, "Kingston DDR3 4GB 램");
assert.deepEqual(pcSearchQueryVariants(kingstonTarget.queryText), [
  "Kingston DDR3 4GB 램", "Kingston DDR3 4GB RAM"
]);
const originalFetch = globalThis.fetch;
const kingstonQueries = [];
try {
  globalThis.fetch = async (url) => {
    const query = new URL(url).searchParams.get("q");
    kingstonQueries.push(query);
    return new Response(JSON.stringify({ list: query === "Kingston DDR3 4GB RAM" ? [{
      pid: "422738661", name: "Kingston DDR3 PC3-10600U 4GB RAM 6개 개당 판매",
      price: "10000", status: "0", update_time: "2026-09-29T00:00:00.000Z"
    }] : [] }), { status: 200 });
  };
  const items = await collectOne("bunjang", kingstonTarget.queryText, "pc", 20,
    kingstonTarget.queryText, "recent", { min: null, max: null });
  assert.deepEqual(kingstonQueries, ["Kingston DDR3 4GB 램", "Kingston DDR3 4GB RAM"]);
  assert.equal(items.length, 1, "the RAM spelling variant must recover the matching listing");
  assert.equal(items[0].source_listing_id, "422738661");
} finally {
  globalThis.fetch = originalFetch;
}

try {
  globalThis.fetch = async () => new Response('"items":[{"seq":229402788,"title":"인텔 i5-6600K CPU 판매","price":30000,"articleUrl":"https://web.joongna.com/product/229402788","sortDate":"2026-09-29T00:00:00Z","state":"0"}],"changedProductFilterType"', { status: 200 });
  const items = await collectOne("joonggonara", "i5 6600K", "pc", 20,
    "i5 6600K", "recent", { min: null, max: null });
  assert.equal(items.length, 1);
  assert.equal(items[0].source_listing_id, "joonggonara:https://web.joongna.com/product/229402788",
    "existing ledger identity must survive the public numeric-ID repair");
  assert.equal(items[0].item_id, "joonggonara:229402788");
} finally {
  globalThis.fetch = originalFetch;
}

const index = new SearchIndex({ filePath: ":memory:", now: () => Date.parse("2026-09-29T12:00:00Z") });
const joongnaUrl = "https://web.joongna.com/product/229402788";
const projection = {
  site: "joonggonara", category_id: "pc", title: "인텔 i5-6600K CPU 판매",
  price: 30_000, currency: "KRW", url: joongnaUrl,
  canonical_product_id: "cpu:intel:i5-6600k", category_code: "CPU",
  listing_kind: "SINGLE_COMPONENT", quantity: 1, price_scope: "TOTAL",
  condition_code: "USED_WORKING", lifecycle_status: "ACTIVE",
  market_pool: "KR_C2C_USED", price_eligible: true
};
index.upsertPublicProjections([
  { ...projection, item_id: "joonggonara:229402788" },
  { ...projection, item_id: `joonggonara:${joongnaUrl}` }
], { observedAt: "2026-09-29T00:00:00Z" });
assert.equal(index.browsePcListings({ canonicalProductId: projection.canonical_product_id,
  asOf: "2026-09-29T12:00:00Z" }).total, 1);
index.applyLifecycleProjection({ ...projection, item_id: `joonggonara:${joongnaUrl}`,
  lifecycle_status: "UNAVAILABLE_UNKNOWN", updated_at: "2026-09-29T06:00:00Z" });
assert.equal(index.browsePcListings({ canonicalProductId: projection.canonical_product_id,
  asOf: "2026-09-29T12:00:00Z" }).total, 0,
"a lifecycle recheck must also retire the old numeric-ID projection of the same Joongna URL");
index.close();

console.log(JSON.stringify({
  status: "passed",
  contract: "pc-collection-matrix",
  target_set_version: targetSet.targetSetVersion,
  enabled_target_count: targets.length,
  operational_sites: [...operationalSites].sort(),
  category_count: PC_PART_CATEGORY_CODES.length,
  coverage
}, null, 2));
