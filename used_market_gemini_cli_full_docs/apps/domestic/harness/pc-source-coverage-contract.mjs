import assert from "node:assert/strict";

import {
  assessProbeRun,
  filterCollectionTargets,
  parseProbeConfig,
  selectProbeRuns,
  summarizeProbeRuns,
} from "../aws-runner/pc-source-coverage-core.mjs";

const targets = [
  {
    targetId: "category:CPU", canonicalProductId: null, categoryCode: "CPU", queryText: "CPU",
    sourceKeys: ["danawa"], targetOrder: 0, cadenceClass: "HOURLY_CATEGORY", enabled: true,
  },
  {
    targetId: "master:3100:kr", canonicalProductId: "cpu:amd:ryzen-3-3100", categoryCode: "CPU",
    queryText: "라이젠 3 3100", sourceKeys: ["bunjang", "joonggonara"], targetOrder: 1,
    cadenceClass: "DAILY_MASTER", enabled: true,
  },
  {
    targetId: "master:3100:ebay", canonicalProductId: "cpu:amd:ryzen-3-3100", categoryCode: "CPU",
    queryText: "AMD Ryzen 3 3100", sourceKeys: ["ebay"], targetOrder: 2,
    cadenceClass: "DAILY_MASTER", enabled: true,
  },
];

const config = parseProbeConfig({
  PC_PROBE_SOURCES: "bunjang,ebay",
  PC_PROBE_PRODUCT_IDS: "cpu:amd:ryzen-3-3100",
  PC_PROBE_OFFSET: "1",
  PC_PROBE_TARGET_LIMIT: "1",
  PC_PROBE_ITEM_LIMIT: "30",
  PC_PROBE_COMPARE_PUBLIC: "1",
}, ["bunjang", "joonggonara", "danawa", "ebay"]);
assert.deepEqual(config.sourceKeys, ["bunjang", "ebay"]);
assert.equal(config.offset, 1);
assert.equal(config.targetLimit, 1);
assert.equal(config.itemLimit, 30);
assert.equal(config.comparePublic, true);

const selected = selectProbeRuns(targets, config);
assert.equal(selected.totalRuns, 2);
assert.equal(selected.runs.length, 1);
assert.equal(selected.runs[0].sourceKey, "ebay");
assert.equal(selected.nextOffset, null);

const ledgerTargets = targets.map((target) => ({
  target_id: target.targetId,
  canonical_product_id: target.canonicalProductId,
  cadence_class: target.cadenceClass,
}));
assert.deepEqual(filterCollectionTargets(ledgerTargets, {
  cadenceClass: "DAILY_MASTER",
  productIds: ["cpu:amd:ryzen-3-3100"],
  targetIds: ["master:3100:ebay"],
  limit: 1,
}).map((target) => target.target_id), ["master:3100:ebay"]);

const exactProjection = {
  canonical_product_id: "cpu:amd:ryzen-3-3100",
  pc_category_code: "CPU",
  lifecycle_status: "ACTIVE",
  price_eligible: true,
  statistics_eligible: true,
  exclusion_reasons: [],
};
const missingPublic = assessProbeRun({
  sourceKey: "bunjang", target: targets[1], items: [{ title: "AMD 라이젠3 3100 CPU" }],
  projections: [exactProjection], publicListingCount: 0, publicFreshness: "EMPTY",
});
assert.equal(missingPublic.status, "PUBLIC_MISSING");
assert.equal(missingPublic.exact_product_match_count, 1);
assert.equal(missingPublic.eligible_exact_match_count, 1);

const matched = assessProbeRun({
  sourceKey: "bunjang", target: targets[1], items: [{ title: "AMD 라이젠3 3100 CPU" }],
  projections: [exactProjection], publicListingCount: 3, publicFreshness: "FRESH",
});
assert.equal(matched.status, "MATCHED");

const unresolved = assessProbeRun({
  sourceKey: "bunjang", target: targets[1], items: [{ title: "AMD 라이젠3 3100 CPU" }],
  projections: [{ canonical_product_id: null, pc_category_code: "CPU", exclusion_reasons: ["MODEL_NOT_IN_MASTER"] }],
  publicListingCount: 0, publicFreshness: "EMPTY",
});
assert.equal(unresolved.status, "CLASSIFIER_UNRESOLVED");

const empty = assessProbeRun({ sourceKey: "bunjang", target: targets[1], items: [], projections: [] });
assert.equal(empty.status, "SOURCE_EMPTY");
assert.equal(empty.public_listing_count, null);

const summary = summarizeProbeRuns([missingPublic, matched, unresolved, empty], { offset: 0, targetLimit: 4, totalRuns: 8 });
assert.deepEqual(summary.status_counts, {
  CLASSIFIER_UNRESOLVED: 1,
  MATCHED: 1,
  PUBLIC_MISSING: 1,
  SOURCE_EMPTY: 1,
});
assert.equal(summary.next_offset, 4);

console.log(JSON.stringify({ status: "passed", contract: "pc-source-coverage" }));
