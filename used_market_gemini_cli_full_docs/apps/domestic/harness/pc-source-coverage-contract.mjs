import assert from "node:assert/strict";

import {
  assessProbeRun,
  filterCollectionTargets,
  parseProbeConfig,
  pcProductQueryVariants,
  selectProbeRuns,
  strongProductTitleMatch,
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
  PC_PROBE_QUERY_VARIANTS: "1",
  PC_PROBE_MAX_QUERY_VARIANTS: "4",
}, ["bunjang", "joonggonara", "danawa", "ebay"]);
assert.deepEqual(config.sourceKeys, ["bunjang", "ebay"]);
assert.equal(config.offset, 1);
assert.equal(config.targetLimit, 1);
assert.equal(config.itemLimit, 30);
assert.equal(config.comparePublic, true);
assert.equal(config.queryVariants, true);
assert.equal(config.maxQueryVariants, 4);

const amdCpu = {
  id: "cpu:amd:ryzen-3-1200", name: "AMD Ryzen 3 1200", category: "CPU",
  manufacturer: "AMD", aliases: ["AMD Ryzen 3 1200", "Ryzen 3 1200", "1200"],
  spec: { cpu_model: "1200" },
};
assert.deepEqual(pcProductQueryVariants(amdCpu, { sourceKey: "bunjang", maximum: 4 }), [
  "라이젠 3 1200", "Ryzen 3 1200", "라이젠3 1200", "AMD Ryzen 3 1200",
]);
assert.equal(strongProductTitleMatch(amdCpu, "라이젠3 1200 CPU 단품 팝니다"), true);
assert.equal(strongProductTitleMatch(amdCpu, "LGA1200 메인보드 판매"), false);
const intelCpu = {
  id: "cpu:intel:i5-12400f", name: "Intel Core i5-12400F", category: "CPU",
  manufacturer: "Intel", aliases: ["Intel Core i5-12400F", "i5-12400F", "i5 12400F", "12400F"],
  spec: { cpu_model: "i5-12400F" },
};
assert.deepEqual(pcProductQueryVariants(intelCpu, { sourceKey: "bunjang", maximum: 4 }), [
  "i5-12400F", "i5 12400F", "인텔 i5 12400F", "Intel Core i5-12400F",
]);
assert.equal(strongProductTitleMatch(intelCpu, "인텔 i5 12400 F CPU 단품"), true);
assert.equal(strongProductTitleMatch(intelCpu, "인텔 i5~12400F CPU 단품"), true);
const nvidiaGpu = {
  id: "gpu:nvidia:rtx-3060-ti", name: "NVIDIA GeForce RTX 3060 Ti", category: "GPU",
  manufacturer: "NVIDIA", aliases: ["RTX 3060 Ti"], spec: { gpu_model: "RTX 3060 Ti" },
};
assert.deepEqual(pcProductQueryVariants(nvidiaGpu, { sourceKey: "bunjang", maximum: 4 }), [
  "RTX 3060 Ti", "RTX3060Ti", "지포스 RTX 3060 Ti", "NVIDIA GeForce RTX 3060 Ti",
]);
assert.equal(strongProductTitleMatch(nvidiaGpu, "이엠텍 RTX3060TI 그래픽카드"), true);
assert.equal(strongProductTitleMatch(
  { ...nvidiaGpu, id: "gpu:nvidia:rtx-4070-ti", name: "NVIDIA GeForce RTX 4070 Ti", aliases: ["RTX 4070 Ti"], spec: { gpu_model: "RTX 4070 Ti" } },
  "RTX 4070 Ti SUPER 16GB 그래픽카드"
), false, "Ti models must not claim Ti SUPER siblings");
assert.equal(strongProductTitleMatch(
  { ...nvidiaGpu, id: "gpu:nvidia:gtx-1050", name: "NVIDIA GeForce GTX 1050", aliases: ["GTX 1050"], spec: { gpu_model: "GTX 1050" } },
  "엔비디아 GTX 1050TI 4GB 그래픽카드"
), false, "base GPU models must not claim Ti siblings");
assert.equal(strongProductTitleMatch(
  { ...nvidiaGpu, id: "gpu:nvidia:gtx-1050", name: "NVIDIA GeForce GTX 1050", aliases: ["GTX 1050"], spec: { gpu_model: "GTX 1050" } },
  "엔비디아 GTX 1050 Ti 4GB 그래픽카드"
), false, "base GPU models must not claim space-separated Ti siblings");
assert.equal(strongProductTitleMatch(
  { id: "gpu:amd:rx-570", name: "AMD Radeon RX 570", category: "GPU", manufacturer: "AMD", aliases: ["RX 570"], spec: { gpu_model: "RX 570" } },
  "HIS RX5700 8GB 팝니다"
), false, "three-digit Radeon models must not claim four-digit siblings");
assert.equal(strongProductTitleMatch(
  { id: "gpu:amd:rx-550", name: "AMD Radeon RX 550", category: "GPU", manufacturer: "AMD", aliases: ["RX 550"], spec: { gpu_model: "RX 550" } },
  "로이체 rx-550 무선 옵티컬 마우스"
), false, "non-PC products sharing an RX model token must not enter the oracle denominator");
assert.equal(strongProductTitleMatch(
  { ...intelCpu, id: "cpu:intel:i5-12400", name: "Intel Core i5-12400", spec: { cpu_model: "i5-12400" } },
  "인텔 코어 i5-12400F CPU"
), false, "base CPUs must not claim suffixed siblings");
assert.equal(strongProductTitleMatch(
  { ...intelCpu, id: "cpu:intel:i5-12400", name: "Intel Core i5-12400", spec: { cpu_model: "i5-12400" } },
  "인텔 코어 i5-12400 F CPU"
), false, "base CPUs must not claim space-separated suffixed siblings");
assert.equal(strongProductTitleMatch(
  { id: "cpu:amd:ryzen-9-7950x", name: "AMD Ryzen 9 7950X", category: "CPU", manufacturer: "AMD", aliases: ["Ryzen 9 7950X"], spec: { cpu_model: "7950X" } },
  "AMD 라이젠 7950X3D 팝니다"
), false, "Ryzen X models must not claim X3D siblings");

const selected = selectProbeRuns(targets, config);
assert.equal(selected.totalRuns, 2);
assert.equal(selected.runs.length, 1);
assert.equal(selected.runs[0].sourceKey, "ebay");
assert.equal(selected.nextOffset, null);
const collapsedVariants = selectProbeRuns([...targets, {
  ...targets[1], targetId: "master:3100:kr:variant", queryText: "Ryzen 3 3100", targetOrder: 3,
}], { ...config, offset: 0, targetLimit: 10 });
assert.equal(collapsedVariants.totalRuns, 2, "variant probes must run once per source/product");

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
  listing_kind: "SINGLE_COMPONENT",
  condition_code: "USED_WORKING",
  unit_price: 50000,
  exclusion_reasons: [],
};
const missingPublic = assessProbeRun({
  sourceKey: "bunjang", target: targets[1], items: [{ title: "AMD 라이젠3 3100 CPU" }],
  projections: [exactProjection], publicListingCount: 0, publicFreshness: "EMPTY",
  product: { ...amdCpu, id: "cpu:amd:ryzen-3-3100", name: "AMD Ryzen 3 3100", spec: { cpu_model: "3100" } },
  queryVariants: ["라이젠 3 3100", "Ryzen 3 3100"],
});
assert.equal(missingPublic.status, "PUBLIC_MISSING");
assert.equal(missingPublic.exact_product_match_count, 1);
assert.equal(missingPublic.eligible_exact_match_count, 1);
assert.equal(missingPublic.independent_candidate_count, 1);
assert.equal(missingPublic.independent_matched_count, 1);
assert.equal(missingPublic.independent_match_rate, 1);
assert.deepEqual(missingPublic.query_variants, ["라이젠 3 3100", "Ryzen 3 3100"]);

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
