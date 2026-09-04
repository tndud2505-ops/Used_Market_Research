import assert from "node:assert/strict";
import { once } from "node:events";
import { access, mkdtemp, readFile, rm } from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { spawn } from "node:child_process";

import worker from "../cloudflare/worker.mjs";
import { buildCacheKey, fetchThroughD1ListingCache, isCacheableRequest } from "../cloudflare/free-tier.mjs";
import { statsChecksum, statsPublicationKey } from "../cloudflare/public-product-stats.mjs";
import {
  comparePcListingRows,
  dedupePcListingRows,
  parsePcListingsRequest,
  pcListingsIdentity
} from "../cloudflare/pc-listings-contract.mjs";
import { OPERATIONAL_PC_DIRECTORY_SITES, OPERATIONAL_TARGET_SITES } from "../cloudflare/target-sites.mjs";
import { decodeSearchCursor, encodeSearchCursor } from "../aws-runner/search-cursor.mjs";
import { SearchIndex, collectionIdentity } from "../aws-runner/search-index.mjs";
import {
  assertPcProjectionApplyConfirmation,
  buildPcProjectionReconciliation,
  collectAuthoritativePcProjections,
  DEFAULT_PC_REPUBLISH_SOURCES,
  parsePcProjectionRepublishArguments,
  pcProjectionTombstone,
  repairAuthoritativePcProjection,
  stabilizeIncrementalPcProjections
} from "../aws-runner/pc-projection-republish-policy.mjs";
import {
  createWebSearchRunner,
  enrichPcWebItem,
  toSearchOnlyWebItem,
  validateWebSearchRequest,
  WebSearchValidationError
} from "../dist/web-backend/logic/search-service.js";
import {
  listSearchOnlySourceCatalog,
  SearchOnlyValidationError,
  validateSearchOnlyRequest
} from "../dist/web-backend/logic/search-only-service.js";

assert.throws(
  () => parsePcListingsRequest("https://used-pick.test/api/pc/listings?sort=price_asc", { allowedSites: [] }),
  /currency is required/u
);
assert.throws(
  () => parsePcListingsRequest("https://used-pick.test/api/pc/listings?market_pool=KR_C2C_USED&currency=USD", { allowedSites: [] }),
  /domestic market_pool requires KRW/u
);
const scopedPcListingsRequest = parsePcListingsRequest(
  "https://used-pick.test/api/pc/listings?market_pool=KR_C2C_USED&currency=KRW&board_manufacturer=ASUS",
  { allowedSites: [] }
);
assert.equal(scopedPcListingsRequest.marketPool, "KR_C2C_USED");
assert.equal(scopedPcListingsRequest.currency, "KRW");
assert.equal(scopedPcListingsRequest.boardManufacturer, "ASUS");
const catalogScopedPcListingsRequest = parsePcListingsRequest(
  "https://used-pick.test/api/pc/listings?category_code=RAM&module_capacity_gb=16&manufacturer=Samsung&manufacturer=SK%20hynix",
  { allowedSites: [] }
);
assert.equal(catalogScopedPcListingsRequest.catalogScope.categoryCode, "RAM");
assert.deepEqual(catalogScopedPcListingsRequest.catalogScope.facets.module_capacity_gb, ["16"]);
assert.deepEqual(catalogScopedPcListingsRequest.catalogScope.facets.manufacturer, ["SK hynix", "Samsung"]);
assert.equal(catalogScopedPcListingsRequest.manufacturer, "",
  "manufacturer is a catalog facet whenever category_code defines a multi-model scope");
const reversedCatalogScopedRequest = parsePcListingsRequest(
  "https://used-pick.test/api/pc/listings?manufacturer=SK%20hynix&manufacturer=Samsung&module_capacity_gb=16&category_code=RAM",
  { allowedSites: [] }
);
assert.equal(pcListingsIdentity(catalogScopedPcListingsRequest), pcListingsIdentity(reversedCatalogScopedRequest),
  "equivalent catalog scopes retain one signed cursor identity regardless of parameter order");
assert.throws(
  () => parsePcListingsRequest("https://used-pick.test/api/pc/listings?canonical_product_id=ram%3Asamsung%3Addr5%3A16gb&category_code=RAM", { allowedSites: [] }),
  /cannot be combined with catalog scope/u
);
assert.equal(Object.hasOwn(JSON.parse(pcListingsIdentity(scopedPcListingsRequest)), "reconciliation_audit"), false,
  "ordinary signed cursors retain their pre-audit query identity");
const auditPcListingsRequest = parsePcListingsRequest(
  "https://used-pick.test/api/pc/listings?reconciliation_audit=audit-one",
  { allowedSites: [] }
);
const otherAuditPcListingsRequest = parsePcListingsRequest(
  "https://used-pick.test/api/pc/listings?reconciliation_audit=audit-two",
  { allowedSites: [] }
);
assert.equal(auditPcListingsRequest.reconciliationAudit, "audit-one");
assert.notEqual(pcListingsIdentity(auditPcListingsRequest), pcListingsIdentity(otherAuditPcListingsRequest),
  "the reconciliation audit key must be part of the signed cursor identity");
const comparatorFixture = [
  { item_id: "fixture:a", price_value: 100, updated_at: "2026-08-31T02:00:00.000Z" },
  { item_id: "fixture:b", price_value: 200, updated_at: "2026-08-31T01:00:00.000Z" },
  { item_id: "fixture:c", price_value: 200, updated_at: "2026-08-31T03:00:00.000Z" }
];
assert.deepEqual([...comparatorFixture].sort((left, right) => comparePcListingRows(left, right, "recent"))
  .map((row) => row.item_id), ["fixture:c", "fixture:a", "fixture:b"]);
assert.deepEqual([...comparatorFixture].sort((left, right) => comparePcListingRows(left, right, "price_asc"))
  .map((row) => row.item_id), ["fixture:a", "fixture:c", "fixture:b"]);
assert.deepEqual([...comparatorFixture].sort((left, right) => comparePcListingRows(left, right, "price_desc"))
  .map((row) => row.item_id), ["fixture:c", "fixture:b", "fixture:a"]);
const duplicateIdentityFixture = dedupePcListingRows([{
  item_id: "danawa:https://dmall.danawa.com/v3/?controller=sale&methods=blog&seq=998877",
  site: "danawa", url: "https://dmall.danawa.com/v3/?controller=sale&methods=blog&seq=998877",
  updated_at: "2026-08-29T00:00:00.000Z"
}, {
  item_id: "danawa:998877", site: "danawa",
  url: "https://dmall.danawa.com/v3/?controller=sale&methods=blog&seq=998877",
  updated_at: "2026-08-28T00:00:00.000Z"
}]);
assert.equal(duplicateIdentityFixture.length, 1);
assert.equal(duplicateIdentityFixture[0].item_id, "danawa:998877",
  "the stable same-site identity wins over its legacy URL identity without deleting either source row");
assert.deepEqual(DEFAULT_PC_REPUBLISH_SOURCES, [...OPERATIONAL_PC_DIRECTORY_SITES],
  "projection republication must cover every approved public directory source by default");
const eligibleRepublishProjection = {
  item_id: "bunjang:1001", source_listing_id: "1001", site: "bunjang", title: "RTX 3080 단품", price: 480_000, currency: "KRW",
  url: "https://m.bunjang.co.kr/products/1001", canonical_product_id: "gpu:nvidia:rtx-3080",
  lifecycle_status: "ACTIVE", listing_kind: "SINGLE_COMPONENT", condition_code: "USED_WORKING",
  quantity: 1, price_scope: "TOTAL", market_pool: "KR_C2C_USED", price_eligible: true, exclusion_reasons: []
};
const eligibleLotRepublishProjection = {
  ...eligibleRepublishProjection,
  item_id: "danawa:1002", source_listing_id: "1002", site: "danawa", title: "DDR4 8GB 동일 제품 2개",
  url: "https://dmall.danawa.com/v3/?controller=sale&methods=blog&seq=1002",
  canonical_product_id: "ram:ddr4:8gb", listing_kind: "SAME_PRODUCT_LOT", quantity: 2
};
const republishProjectionFixtures = new Map([
  ["eligible", eligibleRepublishProjection],
  ["lot", eligibleLotRepublishProjection],
  ["system", { ...eligibleRepublishProjection, item_id: "bunjang:1003", source_listing_id: "1003", listing_kind: "FULL_SYSTEM", price_eligible: false }],
  ["accessory", { ...eligibleRepublishProjection, item_id: "joonggonara:1004", source_listing_id: "1004", site: "joonggonara", listing_kind: "ACCESSORY_ONLY", price_eligible: false }],
  ["quantity-unknown", { ...eligibleRepublishProjection, item_id: "danawa:1005", source_listing_id: "1005", site: "danawa", quantity: null, price_eligible: false }],
  ["sold", { ...eligibleRepublishProjection, item_id: "coolenjoy:1006", source_listing_id: "1006", site: "coolenjoy", lifecycle_status: "SOLD", price_eligible: false }],
  ["zero", { ...eligibleRepublishProjection, item_id: "rethinkmall:1007", source_listing_id: "1007", site: "rethinkmall", price: 0, price_eligible: false }]
]);
const republishProjectionBySourcePair = new Map([...republishProjectionFixtures.values()]
  .map((item) => [`${item.site}\u0000${item.source_listing_id}`, item]));
const authoritativeProjectionSet = collectAuthoritativePcProjections(
  [...republishProjectionFixtures.values()].map((item) => ({ source_id: item.site, source_listing_id: item.source_listing_id })),
  (sourceId, sourceListingId) => republishProjectionBySourcePair.get(`${sourceId}\u0000${sourceListingId}`)
);
assert.deepEqual(authoritativeProjectionSet.items.map((item) => item.item_id).sort(), [
  "bunjang:1001", "danawa:1002"
], "only the active pipeline's authoritative eligible identities may drive republication");
assert.equal(authoritativeProjectionSet.ineligible_count, 5);
const activeV9Fixture = {
  normalization_version: 9, parser_version: "pc-parser-v5", rule_version: "pc-rules-v9", filter_version: "pc-filter-v5"
};
const maskedOlderProjection = {
  ...eligibleRepublishProjection,
  item_id: "joonggonara:https://web.joongna.com/product/[PHONE]",
  site: "joonggonara", url: "https://web.joongna.com/product/[PHONE]", price: 90_000,
  updated_at: "2026-08-31T10:00:00.000Z", ...activeV9Fixture
};
const latestPriceProjection = {
  ...maskedOlderProjection,
  item_id: "joonggonara:231952321", url: "https://web.joongna.com/product/231952321",
  price: 75_000, updated_at: "2026-08-31T11:00:00.000Z"
};
const maskedIdentityAuthority = collectAuthoritativePcProjections([
  { source_id: "joonggonara", source_listing_id: "https://web.joongna.com/product/231952321" },
  { source_id: "joonggonara", source_listing_id: "231952321" },
  { source_id: "joonggonara", source_listing_id: "231952321" }
], (_sourceId, sourceListingId) => sourceListingId.startsWith("http") ? maskedOlderProjection : latestPriceProjection,
{ pipelineVersion: activeV9Fixture });
assert.equal(maskedIdentityAuthority.input_row_count, 3);
assert.equal(maskedIdentityAuthority.source_pair_count, 2, "source pairs are deduplicated before projection reads");
assert.equal(maskedIdentityAuthority.projection_count, 2);
assert.equal(maskedIdentityAuthority.version_covered_count, 2);
assert.equal(maskedIdentityAuthority.stable_identity_collision_group_count, 1);
assert.equal(maskedIdentityAuthority.stable_identity_collision_extra_count, 1);
assert.equal(maskedIdentityAuthority.items.length, 1);
assert.equal(maskedIdentityAuthority.items[0].item_id, "joonggonara:231952321");
assert.equal(maskedIdentityAuthority.items[0].url, "https://web.joongna.com/product/231952321");
assert.equal(maskedIdentityAuthority.items[0].price, 75_000,
  "the newest observation wins when URL and numeric source pairs collapse to one stable identity");
const maskedIdentityAuthorityReordered = collectAuthoritativePcProjections([
  { source_id: "joonggonara", source_listing_id: "231952321" },
  { source_id: "joonggonara", source_listing_id: "https://web.joongna.com/product/231952321" }
], (_sourceId, sourceListingId) => sourceListingId.startsWith("http") ? maskedOlderProjection : latestPriceProjection,
{ pipelineVersion: activeV9Fixture });
assert.equal(maskedIdentityAuthorityReordered.source_pair_checksum, maskedIdentityAuthority.source_pair_checksum,
  "source-pair coverage checksum is independent of database row order");
assert.equal(maskedIdentityAuthorityReordered.items[0].price, 75_000);
assert.deepEqual(
  [
    repairAuthoritativePcProjection("bunjang", "bunjang:https://m.bunjang.co.kr/products/163934091", maskedOlderProjection),
    repairAuthoritativePcProjection("hellomarket", "https://www.hellomarket.com/item/163962035", maskedOlderProjection),
    repairAuthoritativePcProjection("ebay", "v1|116454586914|0", maskedOlderProjection)
  ].map((item) => [item.item_id, item.url]),
  [
    ["bunjang:163934091", "https://m.bunjang.co.kr/products/163934091"],
    ["hellomarket:163962035", "https://www.hellomarket.com/item/163962035"],
    ["ebay:116454586914", "https://www.ebay.com/itm/116454586914"]
  ], "unmasked source_listing_id repairs masked projection identities and canonical URLs"
);
const incrementalLegacyProjection = {
  ...eligibleRepublishProjection,
  id: "bunjang:https://m.bunjang.co.kr/products/163934091",
  item_id: "bunjang:https://m.bunjang.co.kr/products/163934091",
  source_listing_id: "https://m.bunjang.co.kr/products/163934091",
  url: "https://m.bunjang.co.kr/products/163934091?from=search",
  updated_at: "2026-09-01T00:00:00.000Z"
};
const incrementalUnavailableProjection = {
  ...incrementalLegacyProjection,
  id: "bunjang:163934091",
  item_id: "bunjang:163934091",
  source_listing_id: "163934091",
  lifecycle_status: "UNAVAILABLE_UNKNOWN",
  price_eligible: false,
  good_listing_eligible: false,
  exclusion_reasons: ["MISSING_RECHECK_THRESHOLD"],
  updated_at: "2026-09-01T06:00:00.000Z"
};
const stabilizedIncrementalProjections = stabilizeIncrementalPcProjections([
  incrementalLegacyProjection,
  incrementalUnavailableProjection
]);
assert.equal(stabilizedIncrementalProjections.length, 1,
  "scheduler batches must collapse URL and numeric variants before local/D1 publication");
assert.deepEqual({
  id: stabilizedIncrementalProjections[0].id,
  item_id: stabilizedIncrementalProjections[0].item_id,
  url: stabilizedIncrementalProjections[0].url,
  lifecycle_status: stabilizedIncrementalProjections[0].lifecycle_status,
  price_eligible: stabilizedIncrementalProjections[0].price_eligible,
  good_listing_eligible: stabilizedIncrementalProjections[0].good_listing_eligible,
  exclusion_reasons: stabilizedIncrementalProjections[0].exclusion_reasons
}, {
  id: "bunjang:163934091",
  item_id: "bunjang:163934091",
  url: "https://m.bunjang.co.kr/products/163934091",
  lifecycle_status: "UNAVAILABLE_UNKNOWN",
  price_eligible: false,
  good_listing_eligible: false,
  exclusion_reasons: ["MISSING_RECHECK_THRESHOLD"]
}, "stable identity repair must preserve an ineligible lifecycle projection instead of dropping it");
assert.deepEqual(
  stabilizeIncrementalPcProjections([
    incrementalUnavailableProjection,
    incrementalLegacyProjection
  ]),
  stabilizedIncrementalProjections,
  "incremental stable-identity selection must not depend on collector target order"
);
const staleD1Fixture = {
  ...eligibleRepublishProjection,
  item_id: "bunjang:stale-v8-system", id: "bunjang:stale-v8-system",
  title: "RTX 5090 본체", url: "https://m.bunjang.co.kr/products/1999"
};
const staleLocalFixture = {
  ...eligibleRepublishProjection,
  item_id: "danawa:stale-v8-quantity", id: "danawa:stale-v8-quantity", site: "danawa",
  title: "FSP 파워 수량 미확인", url: "https://dmall.danawa.com/v3/?controller=sale&methods=blog&seq=1998"
};
const legacyLotIdentity = {
  ...eligibleLotRepublishProjection,
  item_id: `danawa:${eligibleLotRepublishProjection.url}`,
  id: `danawa:${eligibleLotRepublishProjection.url}`
};
const reconciliationFixture = buildPcProjectionReconciliation({
  authoritative: authoritativeProjectionSet.items,
  d1Public: [{ ...eligibleRepublishProjection, canonical_product_id: "gpu:nvidia:stale-v8-target" }, legacyLotIdentity, staleD1Fixture],
  localPublic: [eligibleRepublishProjection, eligibleLotRepublishProjection, staleLocalFixture],
  pipelineVersion: activeV9Fixture,
  authorityCoverage: authoritativeProjectionSet
});
assert.equal(reconciliationFixture.authoritative_count, 2);
assert.deepEqual(reconciliationFixture.d1_stale.map((item) => item.item_id), [
  "bunjang:stale-v8-system", legacyLotIdentity.item_id
]);
assert.deepEqual(reconciliationFixture.local_stale.map((item) => item.item_id), ["danawa:stale-v8-quantity"]);
assert.equal(reconciliationFixture.d1_upserts.find((item) => item.item_id === "bunjang:1001").canonical_product_id,
  "gpu:nvidia:rtx-3080", "the authoritative canonical target replaces the stale public target in place");
assert.equal(reconciliationFixture.d1_missing_count, 1,
  "a legacy-only identity is missing until the canonical item ID is upserted");
assert.equal(reconciliationFixture.d1_upserts.find((item) => item.listing_kind === "SAME_PRODUCT_LOT").item_id,
  eligibleLotRepublishProjection.item_id, "reconciliation always upserts the authoritative canonical item ID");
const canonicalIdMigrationFixture = buildPcProjectionReconciliation({
  authoritative: [eligibleLotRepublishProjection],
  d1Public: [legacyLotIdentity],
  localPublic: [eligibleLotRepublishProjection],
  pipelineVersion: activeV9Fixture,
  sources: ["danawa"]
});
assert.equal(canonicalIdMigrationFixture.d1_stale_count, 1);
assert.equal(canonicalIdMigrationFixture.d1_missing_count, 1);
assert.equal(canonicalIdMigrationFixture.d1_stale[0].item_id, legacyLotIdentity.item_id);
assert.equal(canonicalIdMigrationFixture.d1_upserts[0].item_id, eligibleLotRepublishProjection.item_id,
  "a legacy-only representative is tombstoned while its canonical ID is inserted non-destructively");
assert.equal(canonicalIdMigrationFixture.local_stale_count, 0);
assert.equal(canonicalIdMigrationFixture.local_missing_count, 0,
  "an exact canonical representative remains present and is not tombstoned");
const canonicalWithAliasFixture = buildPcProjectionReconciliation({
  authoritative: [eligibleLotRepublishProjection],
  d1Public: [eligibleLotRepublishProjection, legacyLotIdentity],
  localPublic: [eligibleLotRepublishProjection],
  pipelineVersion: activeV9Fixture,
  sources: ["danawa"]
});
assert.equal(canonicalWithAliasFixture.d1_missing_count, 0);
assert.deepEqual(canonicalWithAliasFixture.d1_stale.map((item) => item.item_id), [legacyLotIdentity.item_id]);
assert.deepEqual(canonicalWithAliasFixture.d1_upserts.map((item) => item.item_id), [eligibleLotRepublishProjection.item_id],
  "an exact canonical row survives while only its legacy alias is tombstoned");
const ebayCanonicalProjection = repairAuthoritativePcProjection("ebay", "v1|116454586914|0", {
  ...eligibleRepublishProjection,
  id: "ebay:legacy-input",
  item_id: "ebay:legacy-input",
  site: "ebay",
  source_listing_id: "v1|116454586914|0",
  currency: "USD",
  market_pool: "OVERSEAS_USED"
});
const ebayLegacyProjection = {
  ...ebayCanonicalProjection,
  id: `ebay:${ebayCanonicalProjection.url}`,
  item_id: `ebay:${ebayCanonicalProjection.url}`
};
const ebayCanonicalMigrationFixture = buildPcProjectionReconciliation({
  authoritative: [ebayCanonicalProjection],
  d1Public: [ebayLegacyProjection],
  localPublic: [ebayCanonicalProjection],
  pipelineVersion: activeV9Fixture,
  sources: ["ebay"]
});
assert.equal(ebayCanonicalMigrationFixture.d1_missing_count, 1);
assert.deepEqual(ebayCanonicalMigrationFixture.d1_stale.map((item) => item.item_id), [ebayLegacyProjection.item_id]);
assert.deepEqual(ebayCanonicalMigrationFixture.d1_upserts.map((item) => item.item_id), [ebayCanonicalProjection.item_id],
  "eBay URL identities retain their canonical numeric-ID migration behavior");
const ebayLegacyTombstone = pcProjectionTombstone(ebayCanonicalMigrationFixture.d1_stale[0], {
  updatedAt: "2026-09-01T00:00:00.000Z"
});
assert.equal(ebayLegacyTombstone.item_id, ebayLegacyProjection.item_id);
assert.equal(ebayLegacyTombstone.price_eligible, false,
  "legacy aliases are retained as non-destructive tombstones");
assert.throws(() => buildPcProjectionReconciliation({
  authoritative: [eligibleLotRepublishProjection],
  d1Public: [{
    ...eligibleLotRepublishProjection,
    url: "https://dmall.danawa.com/v3/?controller=sale&methods=blog&seq=wrong-identity"
  }],
  localPublic: [eligibleLotRepublishProjection],
  pipelineVersion: activeV9Fixture,
  sources: ["danawa"]
}), /D1_PUBLIC_STALE_UPSERT_ITEM_ID_COLLISION:danawa:1002/u,
"the plan fails closed if one item ID would otherwise be both upserted and tombstoned");
const reorderedReconciliationFixture = buildPcProjectionReconciliation({
  authoritative: [...authoritativeProjectionSet.items].reverse(),
  d1Public: [staleD1Fixture, legacyLotIdentity, { ...eligibleRepublishProjection, canonical_product_id: "gpu:nvidia:stale-v8-target" }],
  localPublic: [staleLocalFixture, eligibleLotRepublishProjection, eligibleRepublishProjection],
  pipelineVersion: reconciliationFixture.pipeline_version,
  authorityCoverage: authoritativeProjectionSet
});
assert.equal(reorderedReconciliationFixture.checksum, reconciliationFixture.checksum,
  "reconciliation checksum must be deterministic regardless of input row order");
const staleTombstone = pcProjectionTombstone(staleD1Fixture, { updatedAt: "2026-09-01T00:00:00.000Z" });
assert.equal(staleTombstone.price_eligible, false);
assert.ok(staleTombstone.exclusion_reasons.includes("NOT_IN_ACTIVE_PIPELINE_ELIGIBLE_SET"));
assert.throws(() => parsePcProjectionRepublishArguments(["--apply"]), /requires checksum and all exact expected counts/u);
const confirmedReconciliation = parsePcProjectionRepublishArguments([
  "--apply", `--confirm-checksum=${reconciliationFixture.checksum}`,
  "--expect-authoritative-count=2", "--expect-d1-stale-count=2", "--expect-d1-missing-count=1",
  "--expect-local-stale-count=1", "--expect-local-missing-count=0",
  "--expect-source-pair-count=7", "--expect-projection-count=7", "--expect-version-covered-count=7"
]);
assert.equal(assertPcProjectionApplyConfirmation(confirmedReconciliation, reconciliationFixture), true);
assert.throws(() => assertPcProjectionApplyConfirmation(
  { ...confirmedReconciliation, expectedD1StaleCount: 796 }, reconciliationFixture
), /RECONCILIATION_CONFIRMATION_MISMATCH/u,
"a bulk classifier candidate count cannot bypass the reviewed stale-set count");

const approvedWebRequest = validateWebSearchRequest({
  keyword: "RTX 3080",
  category_id: "pc",
  sites: ["joonggonara", "rethinkmall", "ebay"]
});
assert.deepEqual(approvedWebRequest.sites, ["joonggonara", "rethinkmall", "ebay"]);
const facetRequest = validateWebSearchRequest({
  keyword: "RTX", category_id: "pc", sites: ["joonggonara"], pc_category_code: "gpu", manufacturer: "NVIDIA"
});
assert.equal(facetRequest.pcCategoryCode, "GPU");
assert.equal(facetRequest.manufacturer, "NVIDIA");
assert.notEqual(
  collectionIdentity({ keyword: "RTX", category_id: "pc", sites: ["joonggonara"], pc_category_code: "GPU", manufacturer: "NVIDIA" }).key,
  collectionIdentity({ keyword: "RTX", category_id: "pc", sites: ["joonggonara"], pc_category_code: "GPU", manufacturer: "AMD" }).key,
  "PC facet changes must produce a distinct cache and cursor identity"
);
assert.deepEqual(
  validateWebSearchRequest({ keyword: "RTX 3080", category_id: "pc" }).sites,
  [...OPERATIONAL_TARGET_SITES],
  "local web defaults must stay aligned with the canonical operational registry"
);
const localPcProjection = enrichPcWebItem(toSearchOnlyWebItem("hellomarket", {
  id: "hello-pc-1", title: "RTX 3080 단품 정상 작동", price: 420_000,
  status: "active", url: "https://www.hellomarket.com/item/hello-pc-1"
}));
assert.equal(localPcProjection.canonical_product_id, "gpu:nvidia:rtx-3080");
assert.equal(localPcProjection.listing_kind, "SINGLE_COMPONENT");
assert.equal(localPcProjection.category_code, "GPU");
assert.equal(localPcProjection.canonical_manufacturer, "NVIDIA");
assert.equal(localPcProjection.market_pool, "KR_C2C_USED");
assert.equal(localPcProjection.price_eligible, true);
assert.deepEqual(localPcProjection.exclusion_reasons, []);
assert.deepEqual(
  validateWebSearchRequest({ keyword: "RTX 3080", category_id: "pc", sites: ["bunjang"] }).sites,
  ["bunjang"],
  "Bunjang must remain selectable after operator-approved activation"
);
let bunjangCollectOneCalls = 0;
const bunjangLegacyRunner = createWebSearchRunner({
  collectOne: async (site, keyword, categoryId) => {
    bunjangCollectOneCalls += 1;
    assert.equal(site, "bunjang");
    assert.equal(keyword, "RTX 3080");
    assert.equal(categoryId, "pc");
    return [{
      id: "bunjang:legacy-live-1",
      title: "ZOTAC RTX 3080 단품 정상 작동",
      price: 430_000,
      currency: "KRW",
      status: "active",
      url: "https://m.bunjang.co.kr/products/910010",
      image_url: "https://media.example.test/bunjang-910010.jpg"
    }];
  }
});
const bunjangLegacyPayload = await bunjangLegacyRunner({
  keyword: "RTX 3080",
  category_id: "pc",
  sites: ["bunjang"]
});
assert.equal(bunjangCollectOneCalls, 1,
  "the legacy Bunjang search must execute its existing collectOne adapter");
assert.equal(bunjangLegacyPayload.data.items.length, 1,
  "the legacy Bunjang route must not return an empty success when collectOne found a listing");
assert.equal(bunjangLegacyPayload.data.items[0].site, "bunjang");
assert.equal(bunjangLegacyPayload.data.items[0].price, 430_000);
assert.throws(
  () => validateWebSearchRequest({ keyword: "RTX 3080", category_id: "pc", sites: ["daangn"] }),
  (error) => error instanceof WebSearchValidationError && /Unsupported site: daangn/u.test(error.message)
);
assert.throws(
  () => validateSearchOnlyRequest({ source: "hellomarket", keyword: "RTX 3080" }),
  (error) => error instanceof SearchOnlyValidationError && /not approved/u.test(error.message),
  "a denied source must not remain callable through the legacy search-only endpoint"
);
assert.deepEqual(
  listSearchOnlySourceCatalog().sources.map((source) => source.key),
  ["rethinkmall"],
  "search-only source discovery must expose approved and enabled sources only"
);
assert.deepEqual(
  toSearchOnlyWebItem("hellomarket", {
    id: "hello-1",
    title: "RTX 3080 단품",
    price: 420_000,
    status: "active",
    url: "https://www.hellomarket.com/item/hello-1",
    canonical_category_id: "pc",
    canonical_category_path: ["디지털/가전", "PC"]
  }),
  {
    id: "hello-1",
    title: "RTX 3080 단품",
    price: 420_000,
    site: "hellomarket",
    price_label: "420,000원",
    seller: "",
    condition: "",
    location: "",
    posted_at: "",
    image_url: "",
    shipping: "",
    currency: "KRW",
    status: "active",
    listing_type: "used_market",
    score: null,
    baseline_price: null,
    deviation_rate: null,
    fraud_risk: null,
    net_profit: null,
    demand: "",
    noise_filtered: false,
    noise_reason: "",
    components: [],
    price_suspect: false,
    url: "https://www.hellomarket.com/item/hello-1",
    category_id: "pc",
    category_path: ["디지털/가전", "PC"],
    source_category_id: "",
    source_category_ids: [],
    source_category_path: [],
    category_mapping_mode: "keyword_inferred",
    category_mapping_confidence: "unknown"
  }
);

const pcRequest = {
  keyword: "RTX 3080", category_id: "pc", sites: ["joonggonara"],
  sort: "price_asc", limit: 1, refresh_index: false
};
assert.equal(collectionIdentity(pcRequest).namespace, "pc_parts_v1");
assert.equal(collectionIdentity({ keyword: "아이폰 15", category_id: "mobile", sites: ["joonggonara"] }).namespace, "legacy_general");

const directory = await mkdtemp(path.join(os.tmpdir(), "used-pick-service-"));
const indexPath = path.join(directory, "search-index.sqlite");
const backupDir = path.join(directory, "backups");
const now = Date.parse("2026-08-29T00:00:00.000Z");
const items = [
  ["pc-1", 480_000],
  ["pc-2", 520_000],
  ["pc-3", 560_000]
].map(([id, price]) => ({
  id: `joonggonara:${id}`, site: "joonggonara", category_id: "pc",
  title: `RTX 3080 ${id}`, price, currency: "KRW",
  url: `https://web.joongna.com/product/${id}`,
  image_url: `https://images.example.test/${id}.jpg`,
  canonical_product_id: "gpu:nvidia:rtx-3080",
  canonical_display_name: "NVIDIA GeForce RTX 3080",
  canonical_manufacturer: "ASUS",
  chip_manufacturer: "NVIDIA",
  board_manufacturer: "ASUS",
  listing_kind: "SINGLE_COMPONENT", category_code: "GPU", quantity: 1,
  price_scope: "TOTAL", condition_code: "USED_WORKING", lifecycle_status: "ACTIVE",
  market_pool: "KR_C2C_USED", price_eligible: true, exclusion_reasons: []
}));

let index = new SearchIndex({ filePath: indexPath, backupDir, now: () => now });
index.registerQuery(pcRequest);
index.ingest(pcRequest, items, { deep: true, complete: true, successfulSites: ["joonggonara"] });
const publicProjection = index.upsertPublicProjections([{
  ...items[0], id: "danawa:scheduled-pc", item_id: "danawa:scheduled-pc", site: "danawa",
  title: "RTX 3080 scheduled projection", price: 470_000
}, {
  ...items[0], id: "danawa:zero-price", item_id: "danawa:zero-price", site: "danawa",
  title: "RTX 3080 zero price", price: 0
}, {
  ...items[0], id: "danawa:option-ad", item_id: "danawa:option-ad", site: "danawa",
  title: "RTX 3080 option advertisement", price: 1, listing_kind: "OPTION_AD"
}, {
  ...items[0], id: "danawa:new-condition", item_id: "danawa:new-condition", site: "danawa",
  title: "RTX 3080 unopened", price: 490_000, condition_code: "NEW"
}], { observedAt: "2026-08-29T00:00:00.000Z" });
assert.equal(publicProjection.inserted, 4);
const browsedProjection = index.browsePcListings({
  canonicalProductId: "gpu:nvidia:rtx-3080", sites: ["danawa"], sort: "price_asc", limit: 2,
  asOf: "2026-08-29T00:00:01.000Z"
});
assert.equal(browsedProjection.items[0].id, "danawa:scheduled-pc");
assert.equal(browsedProjection.items[0].image_url, "https://images.example.test/pc-1.jpg",
  "precollected source images must survive the SearchIndex public listing projection");
assert.equal(browsedProjection.items.length, 1,
  "zero-price, option advertisements, and non-USED_WORKING rows stay out of the public PC directory");
assert.equal(browsedProjection.items.every((item) => item.canonical_product_id === "gpu:nvidia:rtx-3080"), true);
index.upsertPublicProjections([{
  ...items[0], id: "danawa:https://dmall.danawa.com/v3/?controller=sale&methods=blog&seq=998877",
  item_id: "danawa:https://dmall.danawa.com/v3/?controller=sale&methods=blog&seq=998877", site: "danawa",
  url: "https://dmall.danawa.com/v3/?controller=sale&methods=blog&seq=998877",
  canonical_manufacturer: null, board_manufacturer: "GIGABYTE", title: "RTX 3080 legacy URL identity"
}, {
  ...items[0], id: "danawa:998877", item_id: "danawa:998877", site: "danawa",
  url: "https://dmall.danawa.com/v3/?controller=sale&methods=blog&seq=998877",
  canonical_manufacturer: null, board_manufacturer: "GIGABYTE", title: "RTX 3080 stable identity"
}, {
  ...items[0], id: "danawa:invalid-pc", item_id: "danawa:invalid-pc", site: "danawa",
  board_manufacturer: "MSI", quantity: null, price_eligible: false, exclusion_reasons: ["QUANTITY_UNKNOWN"]
}], { observedAt: "2026-08-29T00:00:00.000Z" });
const dedupedProjection = index.browsePcListings({
  canonicalProductId: "gpu:nvidia:rtx-3080", boardManufacturer: "GIGABYTE", sites: ["danawa"], limit: 10,
  asOf: "2026-08-29T00:00:01.000Z", currency: "KRW"
});
assert.equal(dedupedProjection.items.length, 1);
assert.equal(dedupedProjection.items[0].item_id, "danawa:998877");
assert.equal(dedupedProjection.items[0].canonical_manufacturer, null);
assert.equal(dedupedProjection.items[0].board_manufacturer, "GIGABYTE");
assert.equal(index.db.prepare("SELECT COUNT(*) AS count FROM listings WHERE url = ?")
  .get("https://dmall.danawa.com/v3/?controller=sale&methods=blog&seq=998877").count, 2,
  "public deduplication must retain both source rows for audit and recovery");
const excludedProjection = index.browsePcListings({
  canonicalProductId: "gpu:nvidia:rtx-3080", boardManufacturer: "MSI", sites: ["danawa"], limit: 10,
  asOf: "2026-08-29T00:00:01.000Z", currency: "KRW"
});
assert.equal(excludedProjection.items.length, 0, "price-ineligible or quantity-ambiguous listings stay private");
index.upsertPublicProjections([staleLocalFixture, eligibleLotRepublishProjection], {
  observedAt: "2026-09-01T00:00:00.000Z"
});
index.upsertPublicProjections([
  pcProjectionTombstone(staleLocalFixture, { updatedAt: "2026-09-01T00:01:00.000Z" })
], { observedAt: "2026-09-01T00:01:00.000Z" });
const retainedLocalTombstone = index.db.prepare(`SELECT active,
  json_extract(pc_metadata_json, '$.price_eligible') AS price_eligible,
  json_extract(pc_metadata_json, '$.exclusion_reasons') AS exclusion_reasons
  FROM listings WHERE item_id = ?`).get(staleLocalFixture.item_id);
assert.equal(retainedLocalTombstone.active, 1,
  "local reconciliation keeps the source row as non-destructive recovery data");
assert.equal(retainedLocalTombstone.price_eligible, 0);
assert.ok(JSON.parse(retainedLocalTombstone.exclusion_reasons).includes("NOT_IN_ACTIVE_PIPELINE_ELIGIBLE_SET"));
assert.equal(index.browsePcListings({
  canonicalProductId: staleLocalFixture.canonical_product_id, sites: ["danawa"], limit: 100,
  asOf: "2026-09-01T00:02:00.000Z", currency: "KRW"
}).items.some((item) => item.item_id === staleLocalFixture.item_id), false,
"a reconciled stale local projection remains stored but is no longer public");
assert.equal(index.browsePcListings({
  canonicalProductId: eligibleLotRepublishProjection.canonical_product_id, sites: ["danawa"], limit: 100,
  asOf: "2026-09-01T00:02:00.000Z", currency: "KRW"
}).items.some((item) => item.item_id === eligibleLotRepublishProjection.item_id), true,
"an authoritative SAME_PRODUCT_LOT remains publicly eligible");
const firstPage = index.searchPage(pcRequest, { limit: 1 });
assert.equal(firstPage.items[0].canonical_product_id, "gpu:nvidia:rtx-3080");
const secret = "fixture-cursor-secret-that-is-long-enough";
const cursor = encodeSearchCursor({
  cacheKey: collectionIdentity(pcRequest).key,
  sort: pcRequest.sort,
  snapshotVersion: firstPage.snapshotVersion,
  after: firstPage.nextKey
}, secret);
const decoded = decodeSearchCursor(cursor, {
  cacheKey: collectionIdentity(pcRequest).key, sort: pcRequest.sort, secret
});
assert.throws(
  () => decodeSearchCursor(cursor, { cacheKey: "different-query", sort: pcRequest.sort, secret }),
  /does not match the current search/u
);
assert.throws(
  () => decodeSearchCursor(`${cursor.slice(0, -1)}x`, { cacheKey: collectionIdentity(pcRequest).key, sort: pcRequest.sort, secret }),
  /signature is invalid/u
);

index.ingest(pcRequest, [{ ...items[0], id: "joonggonara:new", price: 100_000 }, ...items], {
  deep: true, complete: true, successfulSites: ["joonggonara"]
});
const oldSecondPage = index.searchPage(pcRequest, {
  limit: 1, snapshotVersion: decoded.snapshotVersion, after: decoded.after
});
assert.equal(oldSecondPage.items[0].id, "joonggonara:pc-2", "continuations must stay on the frozen snapshot");
const countBeforeAllSourceFailure = index.db.prepare("SELECT COUNT(*) AS count FROM listings").get().count;
const allSourceFailure = index.ingest(pcRequest, [], { deep: true, complete: true, successfulSites: [] });
assert.equal(allSourceFailure.reason, "all_sources_failed");
assert.equal(index.db.prepare("SELECT COUNT(*) AS count FROM listings").get().count, countBeforeAllSourceFailure,
  "all-source failure preserves the stale projection");
index.ingest(pcRequest, [
  { ...items[0], id: "joonggonara:sold-projection", lifecycle_status: "SOLD" },
  {
    ...items[0], id: "joonggonara:pii-projection", title: "RTX 3080 010-1234-5678",
    description: "seller@example.com 연락", search_text: "RTX 3080 seller@example.com"
  }
], { deep: false, complete: false, successfulSites: ["joonggonara"] });
const currentProjection = index.searchPage(pcRequest, { limit: 40 });
assert.ok(!currentProjection.items.some((item) => item.id === "joonggonara:sold-projection"), "SOLD is not an active projection");
const storedProjection = index.db.prepare("SELECT title, search_text, description FROM listings WHERE item_id = ?")
  .get("joonggonara:pii-projection");
assert.doesNotMatch(JSON.stringify(storedProjection), /010-1234-5678|seller@example\.com/u);
const legacyRequest = { keyword: "아이폰 15", category_id: "mobile", sites: ["joonggonara"] };
index.registerQuery(legacyRequest);
index.ingest(legacyRequest, [{
  id: "joonggonara:legacy-phone", site: "joonggonara", category_id: "mobile",
  title: "아이폰 15", price: 700_000, currency: "KRW",
  url: "https://example.test/legacy-phone"
}], { deep: true, complete: true, successfulSites: ["joonggonara"] });
const legacyKey = collectionIdentity(legacyRequest).key;
index.db.prepare("UPDATE query_index SET last_requested_at = '2025-01-01T00:00:00.000Z' WHERE query_key = ?").run(legacyKey);
index.maintenance();
assert.equal(index.getQuery(legacyKey).collection_namespace, "legacy_general",
  "legacy rollback projections survive normal cache retention until explicit retirement");
const capIndex = new SearchIndex({ filePath: ":memory:", now: () => now, limits: { maxActiveListings: 1 } });
capIndex.registerQuery(legacyRequest);
capIndex.ingest(legacyRequest, [{
  id: "joonggonara:cap-legacy", site: "joonggonara", category_id: "mobile",
  title: "아이폰 15 롤백 표본", price: 710_000, currency: "KRW",
  url: "https://example.test/cap-legacy"
}], { deep: true, complete: true, successfulSites: ["joonggonara"] });
capIndex.registerQuery(pcRequest);
capIndex.ingest(pcRequest, [{ ...items[0], id: "joonggonara:cap-pc" }], {
  deep: true, complete: true, successfulSites: ["joonggonara"]
});
assert.equal(capIndex.searchPage(legacyRequest, { limit: 10 }).items[0].id, "joonggonara:cap-legacy",
  "active-listing capacity eviction must preserve a usable legacy rollback projection");
capIndex.close();
const backup = index.createBackup();
assert.ok(backup);
await access(backup);
index.upsertPublicProjections([{
  ...items[0], id: "ebay:https://www.ebay.com/itm/legacy-url-id", item_id: "ebay:https://www.ebay.com/itm/legacy-url-id",
  site: "ebay", url: "https://www.ebay.com/itm/legacy-url-id", market_pool: "OVERSEAS_USED"
}], { observedAt: "2026-08-29T00:00:00.000Z" });
index.db.exec("PRAGMA user_version = 7");
index.close();

index = new SearchIndex({ filePath: indexPath, backupDir, now: () => now });
const resumedPage = index.searchPage(pcRequest, {
  limit: 1, snapshotVersion: decoded.snapshotVersion, after: decoded.after
});
assert.equal(resumedPage.items[0].id, "joonggonara:pc-2", "snapshot must survive restart");
assert.equal(index.db.prepare("SELECT active FROM listings WHERE item_id = ?")
  .get("ebay:https://www.ebay.com/itm/legacy-url-id").active, 0,
"legacy eBay URL identities are retained for recovery but retired from public listings");
assert.equal(index.db.prepare("PRAGMA integrity_check").get().integrity_check, "ok");
index.close();

async function freePort() {
  return await new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      server.close((error) => error ? reject(error) : resolve(address.port));
    });
  });
}

async function waitForHealth(baseUrl, child) {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    if (child.exitCode !== null) throw new Error(`runner exited early with ${child.exitCode}`);
    try {
      const response = await fetch(`${baseUrl}/health`);
      if (response.ok) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error("runner did not become healthy");
}

const port = await freePort();
const token = "pc-service-runner-token";
const child = spawn(process.execPath, ["aws-runner/runner.mjs"], {
  cwd: new URL("..", import.meta.url),
  env: {
    ...process.env,
    RUNNER_PORT: String(port),
    CLOUDFLARE_RUNNER_TOKEN: token,
    RUNNER_INDEX_PATH: indexPath,
    RUNNER_INDEX_DIR: directory,
    RUNNER_INDEX_MODE: "cache_first",
    RUNNER_SEARCH_CURSOR_SECRET: secret,
    PC_PARTS_SHADOW_WRITE_ENABLED: "true",
    PC_PARTS_SCHEDULER_ENABLED: "false"
  },
  stdio: ["ignore", "pipe", "pipe"]
});
let stderr = "";
child.stderr.on("data", (chunk) => { stderr += chunk; });
try {
  const baseUrl = `http://127.0.0.1:${port}`;
  await waitForHealth(baseUrl, child);
  const unauthorized = await fetch(`${baseUrl}/api/search`, {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(pcRequest)
  });
  assert.equal(unauthorized.status, 401);
  const feedbackUnauthorized = await fetch(`${baseUrl}/api/admin/pc-classification-feedback`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ snapshot_id: 1 })
  });
  assert.equal(feedbackUnauthorized.status, 401);
  const headers = { authorization: `Bearer ${token}`, "content-type": "application/json" };
  const catalogResponse = await fetch(`${baseUrl}/api/pc/catalog`, { headers });
  assert.equal(catalogResponse.status, 200, stderr);
  const catalogPayload = await catalogResponse.json();
  assert.equal(catalogPayload.data.categories.some((category) => category.code === "GPU"), true);
  assert.equal(catalogPayload.data.sources.some((source) => source.source_id === "bunjang"
    && source.public_enabled === true), true);
  const productsResponse = await fetch(`${baseUrl}/api/pc/products?category_code=GPU&query=RTX%203080&limit=10`, { headers });
  assert.equal(productsResponse.status, 200, stderr);
  assert.equal((await productsResponse.json()).data.products.items[0].id, "gpu:nvidia:rtx-3080");
  const listingsResponse = await fetch(`${baseUrl}/api/pc/listings?canonical_product_id=gpu%3Anvidia%3Artx-3080&board_manufacturer=ASUS&sites=danawa&sort=price_asc&price_min=400000&price_max=600000&currency=KRW&limit=2`, { headers });
  assert.equal(listingsResponse.status, 200, stderr);
  const listingsPayload = await listingsResponse.json();
  assert.equal(listingsPayload.data.items[0].canonical_product_id, "gpu:nvidia:rtx-3080");
  assert.equal(listingsPayload.data.items[0].image_url, "https://images.example.test/pc-1.jpg",
    "the local public listing API must preserve a collected source image URL");
  assert.equal(typeof listingsPayload.data.as_of, "string");
  assert.equal(typeof listingsPayload.data.freshness.state, "string");
  assert.equal(Object.hasOwn(listingsPayload.data.pagination, "next_cursor"), true);
  const authorized = await fetch(`${baseUrl}/api/search`, {
    method: "POST", headers, body: JSON.stringify(pcRequest)
  });
  assert.equal(authorized.status, 200, stderr);
  const feedbackBadSnapshot = await fetch(`${baseUrl}/api/admin/pc-classification-feedback`, {
    method: "POST", headers,
    body: JSON.stringify({ snapshot_id: 999999, field_name: "canonical_product_id", corrected_value: "gpu:nvidia:rtx-3080" })
  });
  assert.equal(feedbackBadSnapshot.status, 400);
  const payload = await authorized.json();
  assert.equal(payload.data.items[0].canonical_product_id, "gpu:nvidia:rtx-3080");
  assert.match(payload.data.pagination.next_cursor, /^index:v2:/u);
  const tampered = await fetch(`${baseUrl}/api/search`, {
    method: "POST", headers,
    body: JSON.stringify({ ...pcRequest, cursor: `${payload.data.pagination.next_cursor}x` })
  });
  assert.equal(tampered.status, 400);
} finally {
  child.kill("SIGTERM");
  await Promise.race([
    new Promise((resolve) => child.once("exit", resolve)),
    new Promise((resolve) => setTimeout(resolve, 2_000))
  ]);
  if (child.exitCode === null) child.kill("SIGKILL");
}

function d1Adapter(database, { maxBindings = Number.POSITIVE_INFINITY, bindingObservations = null } = {}) {
  let batchTail = Promise.resolve();
  return {
    async batch(statements) {
      const previousBatch = batchTail;
      let releaseBatch;
      batchTail = new Promise((resolve) => { releaseBatch = resolve; });
      await previousBatch;
      database.exec("BEGIN IMMEDIATE");
      try {
        const results = [];
        for (const statement of statements) results.push(await statement.run());
        database.exec("COMMIT");
        return results;
      } catch (error) {
        database.exec("ROLLBACK");
        throw error;
      } finally {
        releaseBatch();
      }
    },
    prepare(sql) {
      const statement = database.prepare(sql);
      const observeBindings = (values) => {
        bindingObservations?.push({ sql, count: values.length });
        if (values.length > maxBindings) throw new Error(`D1_ERROR: too many SQL variables (${values.length})`);
      };
      const bound = (values) => ({
        async all() {
          observeBindings(values);
          const results = statement.all(...values);
          return { results };
        },
        async first() { observeBindings(values); return statement.get(...values) || null; },
        async run() { observeBindings(values); return statement.run(...values); }
      });
      return {
        ...bound([]),
        bind(...values) { return bound(values); }
      };
    }
  };
}

const d1 = new DatabaseSync(":memory:");
d1.exec(await readFile(new URL("../cloudflare/migrations/0001_free_tier.sql", import.meta.url), "utf8"));
d1.exec(await readFile(new URL("../cloudflare/migrations/0002_pc_public_stats.sql", import.meta.url), "utf8"));
d1.exec(await readFile(new URL("../cloudflare/migrations/0003_pc_listing_projection.sql", import.meta.url), "utf8"));
d1.exec(await readFile(new URL("../cloudflare/migrations/0006_pc_listing_manufacturer.sql", import.meta.url), "utf8"));
d1.exec(await readFile(new URL("../cloudflare/migrations/0009_pc_listing_board_manufacturer.sql", import.meta.url), "utf8"));
d1.exec(await readFile(new URL("../cloudflare/migrations/0010_pc_listing_public_pagination.sql", import.meta.url), "utf8"));
d1.exec(await readFile(new URL("../cloudflare/migrations/0011_pc_listing_collection_runtime.sql", import.meta.url), "utf8"));
d1.exec(await readFile(new URL("../cloudflare/migrations/0012_pc_public_classification.sql", import.meta.url), "utf8"));
d1.prepare(`INSERT INTO listings(item_id, site, category_id, title, search_text, price_value, currency, url, updated_at, active)
  VALUES (?, 'ebay', 'pc', 'legacy eBay row', 'legacy eBay row', 100, 'USD', ?, ?, 1)`).run(
  "ebay:https://www.ebay.com/itm/legacy-d1-id", "https://www.ebay.com/itm/legacy-d1-id", "2026-08-29T00:00:00.000Z"
);
d1.exec(await readFile(new URL("../cloudflare/migrations/0008_retire_legacy_ebay_url_ids.sql", import.meta.url), "utf8"));
assert.equal(d1.prepare("SELECT active FROM listings WHERE item_id = ?")
  .get("ebay:https://www.ebay.com/itm/legacy-d1-id").active, 0);
d1.prepare(`INSERT INTO listings(item_id, site, category_id, title, search_text, price_value, currency, url, image_url, updated_at, active,
  canonical_product_id, canonical_display_name, canonical_manufacturer, board_manufacturer, listing_kind, pc_category_code, quantity, price_scope, condition_code,
  lifecycle_status, market_pool, price_eligible, exclusion_reasons_json)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, '[]')`).run(
  "danawa:d1-pc", "danawa", "pc", "RTX 3080 D1 백업", "RTX 3080 D1 백업", 490_000, "KRW",
  "https://dmall.danawa.com/v3/?controller=sale&methods=blog&seq=d1-pc", "https://images.example.test/d1-pc.jpg", "2026-08-29T00:00:00.000Z",
  "gpu:nvidia:rtx-3080", "NVIDIA GeForce RTX 3080", null, "ASUS", "SINGLE_COMPONENT", "GPU", 1, "TOTAL",
  "USED_WORKING", "ACTIVE", "KR_C2C_USED"
);
const importEnv = { DB: d1Adapter(d1), MANUAL_RUN_TOKEN: "import-fixture-token" };
const nextTokenImportResponse = await worker.fetch(new Request("https://used-pick.test/admin/import-listings", {
  method: "POST",
  headers: { authorization: "Bearer next-import-fixture-token", "content-type": "application/json" },
  body: JSON.stringify({ items: [] })
}), { ...importEnv, MANUAL_RUN_TOKEN: "", MANUAL_RUN_TOKEN_NEXT: "next-import-fixture-token" });
assert.equal(nextTokenImportResponse.status, 200, "a secondary operator token supports non-disruptive secret rotation");

const publicationRouteD1 = new DatabaseSync(":memory:");
publicationRouteD1.exec(await readFile(new URL("../cloudflare/migrations/0002_pc_public_stats.sql", import.meta.url), "utf8"));
const publicationRouteEnv = {
  DB: d1Adapter(publicationRouteD1),
  MANUAL_RUN_TOKEN: "publication-route-token"
};
const publicationRouteStats = (sampleCount) => ({
  active: { sample_count: sampleCount },
  sold: { sample_count: 0 },
  confirmed_transactions: { sample_count: 0 },
  by_source: [{
    source_id: "joonggonara",
    active: { sample_count: sampleCount }, sold: { sample_count: 0 },
    confirmed_transactions: { sample_count: 0 }, daily: []
  }],
  versions: { parser: "pc-parser-v5", rule: "pc-rules-v5", filter: "pc-filter-v5" }
});
const publicationRouteRow = (canonicalProductId, sampleCount, asOf) => ({
  canonical_product_id: canonicalProductId,
  market_pool: "KR_C2C_USED",
  condition_code: "USED_WORKING",
  currency: "KRW",
  days: 30,
  stats_json: publicationRouteStats(sampleCount),
  as_of: asOf
});
const publicationRouteManifest = async (publicationId, rows, mergeWithActive = false) => ({
  publication_id: publicationId,
  rows,
  expected_row_count: rows.length,
  expected_non_empty_scope_count: rows.length,
  checksum: await statsChecksum(rows),
  expected_keys: rows.map(statsPublicationKey),
  parser_version: "pc-parser-v5",
  rule_version: "pc-rules-v5",
  filter_version: "pc-filter-v5",
  merge_with_active: mergeWithActive,
  created_at: "2026-08-31T00:00:00.000Z"
});
const publicationRouteFetch = (manifest) => worker.fetch(new Request("https://used-pick.test/admin/import-product-stats", {
  method: "POST",
  headers: { authorization: "Bearer publication-route-token", "content-type": "application/json" },
  body: JSON.stringify(manifest)
}), publicationRouteEnv);
const publicationBaseRows = [
  publicationRouteRow("gpu:route:preserved", 1, "2026-08-30T00:00:00.000Z"),
  publicationRouteRow("gpu:route:overlap", 1, "2026-08-30T00:00:00.000Z")
];
const publicationBaseResponse = await publicationRouteFetch(
  await publicationRouteManifest("route-base", publicationBaseRows)
);
assert.equal(publicationBaseResponse.status, 200, JSON.stringify(await publicationBaseResponse.clone().json()));
const publicationInputRows = [
  publicationRouteRow("gpu:route:overlap", 3, "2026-08-31T00:00:00.000Z"),
  publicationRouteRow("gpu:route:added", 1, "2026-08-31T00:00:00.000Z")
];
const publicationMergeResponse = await publicationRouteFetch(
  await publicationRouteManifest("route-merged", publicationInputRows, true)
);
assert.equal(publicationMergeResponse.status, 200, JSON.stringify(await publicationMergeResponse.clone().json()));
const publicationMergePayload = (await publicationMergeResponse.json()).publication;
assert.equal(publicationMergePayload.merged_with_active, true);
assert.equal(publicationMergePayload.input_row_count, 2);
assert.equal(publicationMergePayload.preserved_row_count, 1);
assert.equal(publicationMergePayload.row_count, 3,
  "the authenticated import route must activate the server-computed union publication");
assert.equal(publicationRouteD1.prepare("SELECT expected_row_count FROM public_stats_publications WHERE active = 1")
  .get().expected_row_count, 3);
const publicationOverlapStats = JSON.parse(publicationRouteD1.prepare(`SELECT stats_json FROM public_product_stats
  WHERE publication_id = 'route-merged' AND canonical_product_id = 'gpu:route:overlap'`).get().stats_json);
assert.equal(publicationOverlapStats.active.sample_count, 3,
  "the authenticated merge route must prefer the new row for an overlapping scope key");

const runnerProxyPolicyEnv = {
  ...importEnv,
  SEARCH_RUNNER_URL: "https://runner.invalid/api/search",
  RUNNER_TOKEN: "fixture-runner-token"
};
const deniedSearchOnlyResponse = await worker.fetch(new Request("https://used-pick.test/api/search-only", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ source: "hellomarket", keyword: "RTX 3080" })
}), runnerProxyPolicyEnv);
assert.equal(deniedSearchOnlyResponse.status, 400,
  "the edge must reject a denied search-only source before contacting the runner");
const deniedLegacySearchResponse = await worker.fetch(new Request("https://used-pick.test/api/search", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ keyword: "RTX 3080", sites: ["daangn"] })
}), runnerProxyPolicyEnv);
assert.equal(deniedLegacySearchResponse.status, 400,
  "the edge must reject a denied legacy search source before contacting the runner");
const searchOnlyCatalogResponse = await worker.fetch(
  new Request("https://used-pick.test/api/search-only/sources"),
  runnerProxyPolicyEnv
);
assert.equal(searchOnlyCatalogResponse.status, 200);
assert.deepEqual(
  (await searchOnlyCatalogResponse.json()).data.sources.map((source) => source.key),
  ["rethinkmall"],
  "the edge search-only catalog must not advertise denied sources"
);
d1.prepare(`INSERT INTO public_stats_publications(publication_id, checksum, expected_row_count,
  expected_non_empty_scope_count, parser_version, rule_version, filter_version, created_at, activated_at, active)
  VALUES ('fixture-products', 'fixture-checksum', 1, 1, 'pc-parser-v5', 'pc-rules-v5', 'pc-filter-v5', ?, ?, 1)`)
  .run("2026-08-29T00:00:00.000Z", "2026-08-29T00:00:00.000Z");
const publishedRtx3080Stats = {
  active: { sample_count: 5, mean: 500000, median: 490000 },
  sold: { sample_count: 3, mean: null, median: 470000 },
  confirmed_transactions: { sample_count: 0, mean: null, median: null },
  daily: [{ date: "2026-08-29", active: { sample_count: 5, mean: 500000, median: 490000 }, sold: { sample_count: 3, mean: null, median: 470000 } }],
  by_source: [{
    source_id: "bunjang",
    active: { sample_count: 2, mean: null, median: null },
    sold: { sample_count: 1, mean: null, median: null },
    confirmed_transactions: { sample_count: 0, mean: null, median: null },
    daily: [{ date: "2026-08-29", active: { sample_count: 2, mean: null, median: null }, sold: { sample_count: 1, mean: null, median: null } }]
  }, {
    source_id: "joonggonara",
    active: { sample_count: 3, mean: null, median: 490000 },
    sold: { sample_count: 2, mean: null, median: null },
    confirmed_transactions: { sample_count: 0, mean: null, median: null },
    daily: [{ date: "2026-08-29", active: { sample_count: 3, mean: null, median: 490000 }, sold: { sample_count: 2, mean: null, median: null } }]
  }]
};
d1.prepare(`INSERT INTO public_product_stats(publication_id, canonical_product_id, market_pool,
  condition_code, currency, days, stats_json, as_of) VALUES ('fixture-products', 'gpu:nvidia:rtx-3080',
  'KR_C2C_USED', 'USED_WORKING', 'KRW', 30, ?, ?)`)
  .run(JSON.stringify(publishedRtx3080Stats), "2026-08-29T00:00:00.000Z");
const ssdBucketId = "ssd:samsung:capacity-bucket:960-gb-1-tb";
d1.prepare(`INSERT INTO public_product_stats(publication_id, canonical_product_id, market_pool,
  condition_code, currency, days, stats_json, as_of) VALUES ('fixture-products', ?,
  'KR_DEALER_USED', 'USED_WORKING', 'KRW', 30, ?, ?)`)
  .run(ssdBucketId, JSON.stringify({ active: { sample_count: 0 }, sold: { sample_count: 0 }, daily: [], by_source: [] }),
    "2026-08-29T00:00:00.000Z");
for (const [index, price] of [90_000, 100_000, 110_000].entries()) {
  d1.prepare(`INSERT INTO listings(item_id, site, category_id, title, search_text, price_value, currency, url, updated_at, active,
    canonical_product_id, canonical_display_name, canonical_manufacturer, listing_kind, pc_category_code, quantity, price_scope,
    condition_code, lifecycle_status, market_pool, price_eligible, exclusion_reasons_json)
    VALUES (?, 'danawa', 'pc', ?, ?, ?, 'KRW', ?, ?, 1, ?, 'Samsung SSD 960GB-1TB', 'Samsung',
      'SINGLE_COMPONENT', 'SSD', 1, 'TOTAL', 'USED_WORKING', 'ACTIVE', 'KR_DEALER_USED', 1, '[]')`).run(
    `danawa:ssd-bucket-${index}`, `Samsung SSD 1TB ${index}`, `Samsung SSD 1TB ${index}`, price,
    `https://dmall.danawa.com/v3/?controller=sale&methods=blog&seq=80000${index}`,
    "2026-08-31T00:00:00.000Z", ssdBucketId
  );
}
for (const [index, price] of [280_000, 300_000, 320_000].entries()) {
  d1.prepare(`INSERT INTO listings(item_id, site, category_id, title, search_text, price_value, currency, url, updated_at, active,
    canonical_product_id, canonical_display_name, canonical_manufacturer, listing_kind, pc_category_code, quantity, price_scope,
    condition_code, lifecycle_status, market_pool, price_eligible, exclusion_reasons_json)
    VALUES (?, 'joonggonara', 'pc', ?, ?, ?, 'KRW', ?, ?, 1, 'gpu:nvidia:rtx-3060', 'NVIDIA GeForce RTX 3060', 'MSI',
      'SINGLE_COMPONENT', 'GPU', 1, 'TOTAL', 'USED_WORKING', 'ACTIVE', 'KR_C2C_USED', 1, '[]')`).run(
    `joonggonara:rtx-3060-${index}`, `MSI RTX 3060 ${index}`, `MSI RTX 3060 ${index}`, price,
    `https://web.joongna.com/product/3060${index}`,
    "2026-08-31T00:00:00.000Z"
  );
}
for (const [index, price] of [290_000, 310_000, 330_000].entries()) {
  d1.prepare(`INSERT INTO listings(item_id, site, category_id, title, search_text, price_value, currency, url, updated_at, active,
    canonical_product_id, canonical_display_name, canonical_manufacturer, listing_kind, pc_category_code, quantity, price_scope,
    condition_code, lifecycle_status, market_pool, price_eligible, exclusion_reasons_json)
    VALUES (?, 'bunjang', 'pc', ?, ?, ?, 'KRW', ?, ?, 1, 'gpu:nvidia:rtx-3060', 'NVIDIA GeForce RTX 3060', 'ZOTAC',
      'SINGLE_COMPONENT', 'GPU', 1, 'TOTAL', 'USED_WORKING', 'ACTIVE', 'KR_C2C_USED', 1, '[]')`).run(
    `bunjang:rtx-3060-${index}`, `ZOTAC RTX 3060 ${index}`, `ZOTAC RTX 3060 ${index}`, price,
    `https://m.bunjang.co.kr/products/3061${index}`,
    "2026-08-31T00:00:00.000Z"
  );
}
const workerCatalog = await worker.fetch(new Request("https://used-pick.test/api/pc/catalog"), importEnv);
assert.equal(workerCatalog.status, 200);
const workerCatalogPayload = await workerCatalog.json();
assert.equal(workerCatalogPayload.data.categories.some((category) => category.code === "GPU"), true);
assert.deepEqual(
  workerCatalogPayload.data.sources.map((source) => source.source_id).sort(),
  [...OPERATIONAL_PC_DIRECTORY_SITES].sort(),
  "the catalog must expose every operational PC directory source"
);
assert.equal(workerCatalogPayload.data.source_candidates.some((source) => ["bunjang", "hellomarket", "coolenjoy"]
  .includes(source.source_id)), false,
"operational directory sources must not remain in the inactive candidate list");
const workerProducts = await worker.fetch(new Request("https://used-pick.test/api/pc/products?category_code=GPU&query=RTX%203080"), importEnv);
assert.equal(workerProducts.status, 200);
const workerProductsPayload = await workerProducts.json();
assert.equal(workerProductsPayload.data.products.items[0].id, "gpu:nvidia:rtx-3080");
assert.equal(workerProductsPayload.data.products.items[0].price_stats.active.median, 490000);
assert.equal(workerProductsPayload.data.products.items[0].price_stats_market_pool, "KR_C2C_USED");
const publishedStatsResponse = await worker.fetch(new Request(
  "https://used-pick.test/api/products/gpu%3Anvidia%3Artx-3080/price-stats?days=30&market_pool=KR_C2C_USED&condition=USED_WORKING&currency=KRW"
), importEnv);
assert.equal(publishedStatsResponse.status, 200);
const publishedStatsPayload = (await publishedStatsResponse.json()).data;
assert.deepEqual(publishedStatsPayload.by_source.map((source) => source.source_id), ["bunjang", "danawa", "joonggonara"]);
assert.equal(publishedStatsPayload.active.sample_count, 5,
  "the published aggregate must remain ledger-member based instead of summing per-source projections");
assert.equal(publishedStatsPayload.as_of, "2026-08-29T00:00:00.000Z",
  "adding a current source projection must not relabel the published aggregate with a newer timestamp");
assert.equal(publishedStatsPayload.by_source.find((source) => source.source_id === "danawa").active.sample_count, 1,
  "a newly collected D1 source must be visible even before the next aggregate publication");
assert.equal(publishedStatsPayload.by_source.find((source) => source.source_id === "joonggonara").active.median, 490_000,
  "stored per-source statistics must remain independently selectable by the UI site filter");
const ssdStatsResponse = await worker.fetch(new Request(
  `https://used-pick.test/api/products/${encodeURIComponent(ssdBucketId)}/price-stats?days=30&market_pool=KR_DEALER_USED&condition=USED_WORKING&currency=KRW`
), importEnv);
assert.equal(ssdStatsResponse.status, 200);
const ssdStatsPayload = await ssdStatsResponse.json();
assert.equal(ssdStatsPayload.data.active.sample_count, 3);
assert.equal(ssdStatsPayload.data.active.median, 100_000,
  "uniquely matched capacity/manufacturer buckets receive current projection statistics");
assert.equal(ssdStatsPayload.data.sold.sample_count, 0,
  "current projection overlays must never fabricate sold samples");
const currentOnlyStatsResponse = await worker.fetch(new Request(
  "https://used-pick.test/api/products/gpu%3Anvidia%3Artx-3060/price-stats?days=30&market_pool=KR_C2C_USED&condition=USED_WORKING&currency=KRW"
), importEnv);
assert.equal(currentOnlyStatsResponse.status, 200,
  "an active precollected listing cohort must not be hidden only because sold publication history is not ready");
const currentOnlyStats = (await currentOnlyStatsResponse.json()).data;
assert.equal(currentOnlyStats.active.sample_count, 6);
assert.equal(currentOnlyStats.active.mean, 305_000);
assert.equal(currentOnlyStats.active.median, 305_000);
assert.equal(currentOnlyStats.sold.sample_count, 0);
assert.equal(currentOnlyStats.confidence.level, "자료 부족");
assert.equal(currentOnlyStats.daily.at(-1).active.sample_count, 6);
assert.deepEqual(currentOnlyStats.by_source.map((source) => source.source_id), ["bunjang", "joonggonara"]);
assert.equal(currentOnlyStats.by_source.find((source) => source.source_id === "bunjang").active.median, 310_000);
assert.equal(currentOnlyStats.by_source.find((source) => source.source_id === "joonggonara").active.median, 300_000);
const joongOnlyListings = await worker.fetch(new Request(
  "https://used-pick.test/api/pc/listings?canonical_product_id=gpu%3Anvidia%3Artx-3060&sites=joonggonara&currency=KRW"
), { ...importEnv, SEARCH_CURSOR_SECRET: "fixture-cursor-secret-that-is-long-enough" });
const joongOnlyItems = (await joongOnlyListings.json()).data.items;
assert.equal(joongOnlyItems.length, 3);
assert.equal(joongOnlyItems.every((item) => item.site === "joonggonara"), true);
const bunjangOnlyListings = await worker.fetch(new Request(
  "https://used-pick.test/api/pc/listings?canonical_product_id=gpu%3Anvidia%3Artx-3060&sites=bunjang&currency=KRW"
), { ...importEnv, SEARCH_CURSOR_SECRET: "fixture-cursor-secret-that-is-long-enough" });
const bunjangOnlyItems = (await bunjangOnlyListings.json()).data.items;
assert.equal(bunjangOnlyItems.length, 3);
assert.equal(bunjangOnlyItems.every((item) => item.site === "bunjang"), true);
const combinedSourceListings = await worker.fetch(new Request(
  "https://used-pick.test/api/pc/listings?canonical_product_id=gpu%3Anvidia%3Artx-3060&sites=joonggonara,bunjang&currency=KRW"
), { ...importEnv, SEARCH_CURSOR_SECRET: "fixture-cursor-secret-that-is-long-enough" });
assert.equal((await combinedSourceListings.json()).data.items.length, 6,
  "one or multiple source filters must read only the selected stored listing projections");
const unfilteredListings = await worker.fetch(new Request(
  "https://used-pick.test/api/pc/listings?limit=2"
), { ...importEnv, SEARCH_CURSOR_SECRET: "fixture-cursor-secret-that-is-long-enough" });
assert.equal(unfilteredListings.status, 200, "unfiltered directory pagination must remain D1-backed");
const unfilteredPayload = await unfilteredListings.json();
assert.equal(unfilteredPayload.data.items.length, 2);
assert.equal(unfilteredPayload.data.pagination.has_more, true);
const unfilteredContinuation = await worker.fetch(new Request(
  `https://used-pick.test/api/pc/listings?limit=2&cursor=${encodeURIComponent(unfilteredPayload.data.pagination.next_cursor)}`
), { ...importEnv, SEARCH_CURSOR_SECRET: "fixture-cursor-secret-that-is-long-enough" });
assert.equal(unfilteredContinuation.status, 200);
assert.equal((await unfilteredContinuation.json()).data.items.some((item) => (
  unfilteredPayload.data.items.some((previous) => previous.item_id === item.item_id)
)), false, "SQL keyset pagination must not repeat the previous page anchor");

const paginationD1 = new DatabaseSync(":memory:");
for (const migration of [
  "0001_free_tier.sql",
  "0003_pc_listing_projection.sql",
  "0006_pc_listing_manufacturer.sql",
  "0009_pc_listing_board_manufacturer.sql",
  "0010_pc_listing_public_pagination.sql",
  "0011_pc_listing_collection_runtime.sql",
  "0012_pc_public_classification.sql"
]) {
  paginationD1.exec(await readFile(new URL(`../cloudflare/migrations/${migration}`, import.meta.url), "utf8"));
}
const insertPaginationFixture = paginationD1.prepare(`INSERT INTO listings(
  item_id, site, category_id, title, search_text, price_value, currency, url, updated_at, active,
  canonical_product_id, canonical_display_name, canonical_manufacturer, listing_kind, pc_category_code,
  quantity, price_scope, condition_code, lifecycle_status, market_pool, price_eligible, exclusion_reasons_json
) VALUES (?, 'danawa', 'pc', ?, ?, ?, 'KRW', ?, ?, 1,
  'gpu:nvidia:rtx-3080', 'NVIDIA GeForce RTX 3080', 'NVIDIA', 'SINGLE_COMPONENT', 'GPU',
  1, 'TOTAL', 'USED_WORKING', 'ACTIVE', 'KR_C2C_USED', 1, '[]')`);
const stableUrl = "https://dmall.danawa.com/v3/?controller=sale&methods=blog&seq=998877";
for (const fixture of [
  ["danawa:boundary-200", "boundary 200", 200_000,
    "https://dmall.danawa.com/v3/?controller=sale&methods=blog&seq=200", "2026-08-31T08:00:00.000Z"],
  ["danawa:boundary-300", "boundary 300", 300_000,
    "https://dmall.danawa.com/v3/?controller=sale&methods=blog&seq=300", "2026-08-31T07:00:00.000Z"],
  ["danawa:boundary-400", "boundary 400", 400_000,
    "https://dmall.danawa.com/v3/?controller=sale&methods=blog&seq=400", "2026-08-31T06:00:00.000Z"],
  ["danawa:boundary-500", "boundary 500", 500_000,
    "https://dmall.danawa.com/v3/?controller=sale&methods=blog&seq=500", "2026-08-31T05:00:00.000Z"],
  ["danawa:boundary-600", "boundary 600", 600_000,
    "https://dmall.danawa.com/v3/?controller=sale&methods=blog&seq=600", "2026-08-31T04:00:00.000Z"],
  ["danawa:boundary-700", "boundary 700", 700_000,
    "https://dmall.danawa.com/v3/?controller=sale&methods=blog&seq=700", "2026-08-31T03:00:00.000Z"],
  ["danawa:998877", "stable identity", 800_000, stableUrl, "2026-08-31T02:00:00.000Z"],
  ["danawa:boundary-900", "boundary 900", 900_000,
    "https://dmall.danawa.com/v3/?controller=sale&methods=blog&seq=900", "2026-08-31T01:00:00.000Z"]
]) {
  insertPaginationFixture.run(fixture[0], fixture[1], fixture[1], fixture[2], fixture[3], fixture[4]);
}
const paginationEnv = {
  DB: d1Adapter(paginationD1),
  SEARCH_CURSOR_SECRET: "fixture-pagination-secret-that-is-long-enough"
};
async function readPaginationFixture(url) {
  const response = await worker.fetch(new Request(url), paginationEnv);
  return { response, payload: await response.json() };
}
async function readAllPaginationFixtures(baseUrl) {
  const pages = [];
  const seenCursors = new Set();
  let cursor = "";
  do {
    const url = new URL(baseUrl);
    if (cursor) url.searchParams.set("cursor", cursor);
    const page = await readPaginationFixture(url);
    assert.equal(page.response.status, 200);
    pages.push(page);
    cursor = page.payload.data.pagination.has_more ? page.payload.data.pagination.next_cursor : "";
    assert.equal(Boolean(cursor) || !page.payload.data.pagination.has_more, true);
    assert.equal(seenCursors.has(cursor) && Boolean(cursor), false, "pagination cursors must not loop");
    if (cursor) seenCursors.add(cursor);
    assert.ok(pages.length <= 10, "pagination fixture must terminate");
  } while (cursor);
  return { pages, items: pages.flatMap((page) => page.payload.data.items) };
}
const publicBase = "https://used-pick.test/api/pc/listings?canonical_product_id=gpu%3Anvidia%3Artx-3080&market_pool=KR_C2C_USED&currency=KRW&sort=price_asc&limit=2";
const publicPagination = await readAllPaginationFixtures(publicBase);
assert.equal(publicPagination.pages.length, 4);
assert.equal(publicPagination.pages.every((page) => page.payload.data.total === 8), true,
  "ordinary browse total is the reconciled stable-row count");
const publicItems = publicPagination.items;
assert.equal(new Set(publicItems.map((item) => item.item_id)).size, publicItems.length,
  "authoritatively reconciled stable item IDs must not repeat across page boundaries");
assert.deepEqual(publicItems.map((item) => item.item_id), [
  "danawa:boundary-200", "danawa:boundary-300", "danawa:boundary-400", "danawa:boundary-500",
  "danawa:boundary-600", "danawa:boundary-700", "danawa:998877", "danawa:boundary-900"
], "stable-only rows follow the requested keyset sort across every page boundary");

const auditBase = "https://used-pick.test/api/pc/listings?canonical_product_id=gpu%3Anvidia%3Artx-3080&market_pool=KR_C2C_USED&currency=KRW&sort=price_asc&limit=2&reconciliation_audit=audit-one";
const auditPagination = await readAllPaginationFixtures(auditBase);
assert.equal(auditPagination.pages.length, 4);
assert.equal(auditPagination.pages.every((page) => page.payload.data.total === 8), true,
  "reconciliation audit total is the raw eligible row count");
const auditItems = auditPagination.items;
assert.equal(auditItems.length, 8);
assert.equal(new Set(auditItems.map((item) => item.item_id)).size, 8,
  "reconciliation audit pagination preserves every raw unique item_id exactly once");
assert.equal(auditItems.some((item) => item.item_id === "danawa:998877"), true);
const mismatchedAuditCursor = await readPaginationFixture(
  `https://used-pick.test/api/pc/listings?canonical_product_id=gpu%3Anvidia%3Artx-3080&market_pool=KR_C2C_USED&currency=KRW&sort=price_asc&limit=2&reconciliation_audit=audit-two&cursor=${encodeURIComponent(auditPagination.pages[0].payload.data.pagination.next_cursor)}`
);
assert.equal(mismatchedAuditCursor.response.status, 400,
  "an audit cursor is signed to its reconciliation cache-busting key");
const auditCacheKeyOne = await buildCacheKey(new Request(auditBase), new URL(auditBase));
const auditCacheKeyTwo = await buildCacheKey(new Request(auditBase.replace("audit-one", "audit-two")),
  new URL(auditBase.replace("audit-one", "audit-two")));
assert.notEqual(auditCacheKeyOne.url, auditCacheKeyTwo.url,
  "each reconciliation audit key isolates its free-tier cache namespace");
const originalCaches = globalThis.caches;
const listingCacheEntries = new Map();
try {
  globalThis.caches = {
    default: {
      async match(request) { return listingCacheEntries.get(request.url)?.clone() || undefined; },
      async put(request, response) { listingCacheEntries.set(request.url, response.clone()); }
    }
  };
  const cachedListingRequest = new Request("https://used-pick.test/api/pc/listings?sites=danawa");
  let listingReads = 0;
  const originRead = async () => {
    listingReads += 1;
    return new Response(JSON.stringify({ status: "success" }), {
      headers: { "cache-control": "public, max-age=60", "x-free-tier-data-source": "d1" }
    });
  };
  const firstCachedListing = await fetchThroughD1ListingCache(cachedListingRequest, {}, originRead);
  const secondCachedListing = await fetchThroughD1ListingCache(cachedListingRequest, {}, originRead);
  assert.equal(firstCachedListing.headers.get("x-d1-listing-cache"), "MISS");
  assert.equal(secondCachedListing.headers.get("x-d1-listing-cache"), "HIT");
  assert.equal(listingReads, 1, "identical public listing reads must share a D1 cache entry");
  await fetchThroughD1ListingCache(new Request(`${cachedListingRequest.url}&reconciliation_audit=fixture`), {}, originRead);
  assert.equal(listingReads, 2, "reconciliation audit reads must remain uncached");
} finally {
  if (originalCaches === undefined) delete globalThis.caches;
  else globalThis.caches = originalCaches;
}

const insertBindingFixture = paginationD1.prepare(`INSERT INTO listings(
  item_id, site, category_id, title, search_text, price_value, currency, url, updated_at, active,
  canonical_product_id, canonical_display_name, canonical_manufacturer, listing_kind, pc_category_code,
  quantity, price_scope, condition_code, lifecycle_status, market_pool, price_eligible, exclusion_reasons_json
) VALUES (?, 'danawa', 'pc', ?, ?, ?, 'KRW', ?, '2026-08-31T01:00:00.000Z', 1,
  'gpu:nvidia:rtx-5090', 'NVIDIA GeForce RTX 5090', 'NVIDIA', 'SINGLE_COMPONENT', 'GPU',
  1, 'TOTAL', 'USED_WORKING', 'ACTIVE', 'KR_C2C_USED', 1, '[]')`);
const bindingItemIds = [];
for (let index = 0; index < 105; index += 1) {
  const token = `binding-${String(index).padStart(3, "0")}`;
  const itemId = `danawa:${token}`;
  bindingItemIds.push(itemId);
  insertBindingFixture.run(itemId, token, token, 1_000_000 + index,
    `https://dmall.danawa.com/v3/?controller=sale&methods=blog&seq=${token}`);
}
const bindingObservations = [];
const bindingBudgetEnv = {
  DB: d1Adapter(paginationD1, { maxBindings: 90, bindingObservations }),
  SEARCH_CURSOR_SECRET: "fixture-pagination-secret-that-is-long-enough"
};
const bindingBudgetResponse = await worker.fetch(new Request(
  "https://used-pick.test/api/pc/listings?canonical_product_id=gpu%3Anvidia%3Artx-5090&market_pool=KR_C2C_USED&currency=KRW&sort=price_asc&limit=100"
), bindingBudgetEnv);
assert.equal(bindingBudgetResponse.status, 200);
const bindingBudgetPayload = await bindingBudgetResponse.json();
assert.equal(bindingBudgetPayload.data.total, 105);
assert.deepEqual(bindingBudgetPayload.data.items.map((item) => item.item_id), bindingItemIds.slice(0, 100),
  "the bounded first keyset page preserves requested order");
assert.equal(bindingBudgetPayload.data.pagination.has_more, true);
const bindingContinuationResponse = await worker.fetch(new Request(
  `https://used-pick.test/api/pc/listings?canonical_product_id=gpu%3Anvidia%3Artx-5090&market_pool=KR_C2C_USED&currency=KRW&sort=price_asc&limit=100&cursor=${encodeURIComponent(bindingBudgetPayload.data.pagination.next_cursor)}`
), bindingBudgetEnv);
assert.equal(bindingContinuationResponse.status, 200);
const bindingContinuationPayload = await bindingContinuationResponse.json();
assert.equal(bindingContinuationPayload.data.total, 105);
assert.equal(bindingContinuationPayload.data.pagination.has_more, false);
const allBindingItems = [...bindingBudgetPayload.data.items, ...bindingContinuationPayload.data.items];
assert.deepEqual(allBindingItems.map((item) => item.item_id), bindingItemIds,
  "stable-only rows paginate in exact requested order");
assert.equal(new Set(allBindingItems.map((item) => item.item_id)).size, 105,
  "stable-only normal pagination returns no duplicate item IDs");
const normalPageSelects = bindingObservations.filter((observation) => (
  /\bSELECT item_id, site, category_id, title,/iu.test(observation.sql)
));
assert.equal(normalPageSelects.length, 2);
assert.equal(normalPageSelects.every((observation) => /\bORDER BY\b[\s\S]*\bLIMIT \?/iu.test(observation.sql)), true,
  "normal D1 listing reads must be bounded limit+1 keyset statements");

const insertCatalogScopeFixture = paginationD1.prepare(`INSERT INTO listings(
  item_id, site, category_id, title, search_text, price_value, currency, url, updated_at, active,
  canonical_product_id, canonical_display_name, canonical_manufacturer, listing_kind, pc_category_code,
  quantity, price_scope, condition_code, lifecycle_status, market_pool, price_eligible, exclusion_reasons_json
) VALUES (?, 'danawa', 'pc', ?, ?, ?, 'KRW', ?, '2026-08-31T02:00:00.000Z', 1,
  ?, ?, ?, 'SINGLE_COMPONENT', 'RAM', 1, 'TOTAL', 'USED_WORKING', 'ACTIVE', 'KR_C2C_USED', 1, '[]')`);
insertCatalogScopeFixture.run("danawa:ram-samsung-16", "Samsung DDR5 16GB", "Samsung DDR5 16GB", 42_000,
  "https://dmall.danawa.com/v3/?controller=sale&methods=blog&seq=ram-samsung-16",
  "ram:samsung:ddr5:16gb", "Samsung DDR5 16GB", "Samsung");
insertCatalogScopeFixture.run("danawa:ram-hynix-16", "SK hynix DDR5 16GB", "SK hynix DDR5 16GB", 39_000,
  "https://dmall.danawa.com/v3/?controller=sale&methods=blog&seq=ram-hynix-16",
  "ram:sk-hynix:ddr5:16gb", "SK hynix DDR5 16GB", "SK hynix");
insertCatalogScopeFixture.run("danawa:ram-samsung-8", "Samsung DDR5 8GB", "Samsung DDR5 8GB", 22_000,
  "https://dmall.danawa.com/v3/?controller=sale&methods=blog&seq=ram-samsung-8",
  "ram:samsung:ddr5:8gb", "Samsung DDR5 8GB", "Samsung");
const catalogScopeObservationStart = bindingObservations.length;
const catalogScopeBase = "https://used-pick.test/api/pc/listings?category_code=RAM&generation=DDR5&module_capacity_gb=16&sites=danawa&currency=KRW&limit=1";
const catalogScopeResponse = await worker.fetch(new Request(
  catalogScopeBase
), bindingBudgetEnv);
assert.equal(catalogScopeResponse.status, 200);
const catalogScopePayload = await catalogScopeResponse.json();
assert.equal(catalogScopePayload.data.pagination.has_more, true);
const catalogScopeContinuation = await worker.fetch(new Request(
  `${catalogScopeBase}&cursor=${encodeURIComponent(catalogScopePayload.data.pagination.next_cursor)}`
), bindingBudgetEnv);
assert.equal(catalogScopeContinuation.status, 200);
const catalogScopeContinuationPayload = await catalogScopeContinuation.json();
assert.deepEqual(new Set([
  ...catalogScopePayload.data.items,
  ...catalogScopeContinuationPayload.data.items
].map((item) => item.canonical_product_id)), new Set([
  "ram:samsung:ddr5:16gb", "ram:sk-hynix:ddr5:16gb"
]));
assert.equal(catalogScopePayload.data.total, null,
  "multi-model listing browse avoids a separate exact COUNT query");
assert.equal(catalogScopeContinuationPayload.data.total, null,
  "multi-model continuation reuses the nullable first-page summary");
assert.equal(catalogScopePayload.data.filters.matched_model_count, 8);
const catalogScopeObservations = bindingObservations.slice(catalogScopeObservationStart);
assert.equal(catalogScopeObservations.some((observation) => /SELECT COUNT\(\*\) AS total/iu.test(observation.sql)), false,
  "multi-model listing browse must not spend D1 reads on an exact total");
assert.equal(catalogScopeObservations.some((observation) => /json_each\(\?\)/iu.test(observation.sql)), true,
  "multi-model listing browse uses one JSON-bound catalog ID set");
assert.equal(catalogScopeObservations.every((observation) => observation.count <= 90), true,
  "catalog listing scopes stay within the D1 binding budget");

let emptyCatalogScopeDbCalls = 0;
const emptyCatalogScopeResponse = await worker.fetch(new Request(
  "https://used-pick.test/api/pc/listings?category_code=RAM&q=no-such-public-model"
), {
  DB: { prepare() { emptyCatalogScopeDbCalls += 1; throw new Error("D1 must not be queried for an empty catalog scope"); } },
  SEARCH_CURSOR_SECRET: "fixture-pagination-secret-that-is-long-enough"
});
assert.equal(emptyCatalogScopeResponse.status, 200);
assert.equal((await emptyCatalogScopeResponse.json()).data.items.length, 0);
assert.equal(emptyCatalogScopeDbCalls, 0, "an empty catalog model scope returns without a D1 read");
const bindingBudgetObservations = bindingObservations.slice(0, catalogScopeObservationStart);
assert.equal(bindingBudgetObservations.filter((observation) => /SELECT COUNT\(\*\) AS total, MAX\(updated_at\)/iu.test(observation.sql)).length, 1,
  "a signed continuation cursor must reuse the first-page summary instead of rescanning D1");
assert.equal(bindingBudgetObservations.filter((observation) => /FROM pc_listing_collection_target_runtime/iu.test(observation.sql)).length, 1,
  "a signed continuation cursor must reuse the first-page collection freshness");
assert.equal(bindingBudgetObservations.some((observation) => (
  /\bSELECT item_id, site, url, price_value, updated_at\b/iu.test(observation.sql)
  && !/\bLIMIT\b/iu.test(observation.sql)
)), false, "normal pagination must not scan the complete identity projection in Worker memory");
assert.ok(Math.max(...bindingObservations.map((observation) => observation.count)) <= 90);
paginationD1.close();
for (const site of ["joonggonara", "bunjang", "ebay"]) {
  const siteOnlyResponse = await worker.fetch(new Request(
    `https://used-pick.test/api/pc/listings?sites=${site}&limit=1`
  ), { ...importEnv, SEARCH_CURSOR_SECRET: "fixture-cursor-secret-that-is-long-enough" });
  assert.equal(siteOnlyResponse.status, 200, `${site} site-only directory browse must stay available`);
  assert.equal((await siteOnlyResponse.json()).data.items.every((item) => item.site === site), true);
}
const publicRecentPlan = d1.prepare(`EXPLAIN QUERY PLAN SELECT item_id FROM listings INDEXED BY idx_listings_pc_public_recent
  WHERE active = 1 AND lifecycle_status = 'ACTIVE' AND canonical_product_id IS NOT NULL
    AND price_value IS NOT NULL AND price_value > 0
    AND listing_kind IN ('SINGLE_COMPONENT', 'SAME_PRODUCT_LOT') AND price_eligible = 1
    AND condition_code = 'USED_WORKING' AND quantity IS NOT NULL AND quantity >= 1
    AND price_scope IN ('TOTAL', 'UNIT') AND updated_at <= ?
  ORDER BY updated_at DESC, item_id ASC LIMIT 31`).all("2026-08-31T23:59:59.999Z")
  .map((row) => row.detail).join(" ");
assert.match(publicRecentPlan, /idx_listings_pc_public_recent/u,
  "unfiltered recent browse must use the bounded public-listing index");
const siteRecentPlan = d1.prepare(`EXPLAIN QUERY PLAN SELECT item_id FROM listings INDEXED BY idx_listings_pc_public_site_recent
  WHERE active = 1 AND lifecycle_status = 'ACTIVE' AND canonical_product_id IS NOT NULL
    AND price_value IS NOT NULL AND price_value > 0
    AND listing_kind IN ('SINGLE_COMPONENT', 'SAME_PRODUCT_LOT') AND price_eligible = 1
    AND condition_code = 'USED_WORKING' AND quantity IS NOT NULL AND quantity >= 1
    AND price_scope IN ('TOTAL', 'UNIT') AND updated_at <= ? AND site = ?
  ORDER BY updated_at DESC, item_id ASC LIMIT 31`).all("2026-08-31T23:59:59.999Z", "joonggonara")
  .map((row) => row.detail).join(" ");
assert.match(siteRecentPlan, /idx_listings_pc_public_site_recent/u,
  "site-only recent browse must use the site-prefixed public-listing index");
const workerListings = await worker.fetch(new Request(
  "https://used-pick.test/api/pc/listings?canonical_product_id=gpu%3Anvidia%3Artx-3080&board_manufacturer=ASUS&sites=danawa&sort=price_asc&price_min=400000&price_max=600000&currency=KRW"
), { ...importEnv, SEARCH_CURSOR_SECRET: "fixture-cursor-secret-that-is-long-enough" });
assert.equal(workerListings.status, 200);
const workerListingsPayload = await workerListings.json();
assert.equal(workerListingsPayload.data.items[0].canonical_product_id, "gpu:nvidia:rtx-3080");
assert.equal(workerListingsPayload.data.items[0].canonical_manufacturer, null);
assert.equal(workerListingsPayload.data.items[0].board_manufacturer, "ASUS");
assert.equal(workerListingsPayload.data.items[0].quantity, 1);
assert.equal(workerListingsPayload.data.items[0].price_scope, "TOTAL");
assert.equal(workerListingsPayload.data.items[0].listing_kind, "SINGLE_COMPONENT");
assert.equal(workerListingsPayload.data.items[0].image_url, "https://images.example.test/d1-pc.jpg",
  "the D1-backed public listing API must preserve the collected source image URL");
assert.equal(workerListingsPayload.data.items[0].price_eligible, true);
assert.deepEqual(workerListingsPayload.data.items[0].exclusion_reasons, []);
assert.equal(Object.hasOwn(workerListingsPayload.data.pagination, "next_cursor"), true);
assert.equal(workerListings.headers.get("x-free-tier-data-source"), "d1");
assert.equal(workerListings.headers.get("cache-control"), "public, max-age=60");
assert.equal(isCacheableRequest(new Request("https://used-pick.test/api/pc/listings"),
  new URL("https://used-pick.test/api/pc/listings")), false,
"a FRESH listing response must never enter the 24-hour static cache");
assert.equal(workerListingsPayload.data.freshness.last_collected_at, null,
  "listing updated_at must not impersonate collection success when no manifest exists");
assert.equal(workerListingsPayload.data.freshness.last_listing_updated_at, "2026-08-29T00:00:00.000Z");
assert.equal(workerListingsPayload.data.freshness.basis, "SOURCE_TARGET_COLLECTION_MANIFEST_INCOMPLETE");
assert.equal(workerListingsPayload.data.freshness.required_target_count, 1);
assert.equal(workerListingsPayload.data.freshness.covered_target_count, 0);
const d1ListingItemsBeforeFreshnessMirror = structuredClone(workerListingsPayload.data.items);
const sourceRuntimeCollectedAt = new Date(Date.now() - 30_000).toISOString();
const unrelatedSourceRuntimeCollectedAt = new Date(Date.now() - 5_000).toISOString();
const freshnessTargetIds = Object.freeze({
  bunjangGpu: "pc-target:2:market-v5:GPU:0",
  danawaGpu: "pc-target:2:category-v5:GPU",
  danawaCpu: "pc-target:2:category-v5:CPU"
});
const mirrorCollectionManifest = async (sourceId, asOf, successfulTargetIds) => {
  const response = await worker.fetch(new Request("https://used-pick.test/admin/import-listings", {
    method: "POST",
    headers: { authorization: "Bearer import-fixture-token", "content-type": "application/json" },
    body: JSON.stringify({
      items: [],
      collection_manifest: {
        manifest_version: "pc-listing-collection-v1",
        source_id: sourceId,
        status: "SUCCEEDED",
        as_of: asOf,
        successful_target_ids: successfulTargetIds
      }
    })
  }), importEnv);
  return { response, payload: await response.json() };
};
assert.equal((await mirrorCollectionManifest("bunjang", unrelatedSourceRuntimeCollectedAt,
  [freshnessTargetIds.bunjangGpu])).response.status, 200);
const sourceManifest = await mirrorCollectionManifest("danawa", sourceRuntimeCollectedAt,
  [freshnessTargetIds.danawaGpu]);
assert.equal(sourceManifest.response.status, 200);
assert.equal(sourceManifest.payload.collection_manifest.as_of, sourceRuntimeCollectedAt);
assert.deepEqual(sourceManifest.payload.collection_manifest.successful_target_ids, [freshnessTargetIds.danawaGpu]);
const runtimeFreshnessResponse = await worker.fetch(new Request(
  "https://used-pick.test/api/pc/listings?canonical_product_id=gpu%3Anvidia%3Artx-3080&board_manufacturer=ASUS&sites=danawa&sort=price_asc&price_min=400000&price_max=600000&currency=KRW"
), { ...importEnv, SEARCH_CURSOR_SECRET: "fixture-cursor-secret-that-is-long-enough" });
assert.equal(runtimeFreshnessResponse.status, 200);
const runtimeFreshnessPayload = await runtimeFreshnessResponse.json();
assert.deepEqual(runtimeFreshnessPayload.data.items, d1ListingItemsBeforeFreshnessMirror,
  "collection freshness mirroring must not change D1 listing membership or projection fields");
assert.equal(runtimeFreshnessPayload.data.total, workerListingsPayload.data.total);
assert.equal(runtimeFreshnessPayload.data.freshness.last_collected_at, sourceRuntimeCollectedAt,
  "listing freshness must use the matching source's mirrored successful collection manifest");
assert.equal(runtimeFreshnessPayload.data.freshness.last_listing_updated_at, "2026-08-29T00:00:00.000Z");
assert.equal(runtimeFreshnessPayload.data.freshness.basis, "SOURCE_TARGET_COLLECTION_MANIFEST");
assert.equal(runtimeFreshnessPayload.data.freshness.state, "FRESH");
assert.equal(runtimeFreshnessPayload.data.freshness.coverage_state, "COMPLETE");
assert.equal(runtimeFreshnessPayload.data.freshness.required_target_count, 1);
assert.equal(runtimeFreshnessPayload.data.freshness.covered_target_count, 1);
const fetchBeforeD1OnlyFreshness = globalThis.fetch;
let synchronousFreshnessCalls = 0;
try {
  globalThis.fetch = async () => {
    synchronousFreshnessCalls += 1;
    throw new Error("public listing GET must not call the runner");
  };
  const d1OnlyFreshnessResponse = await worker.fetch(new Request(
    "https://used-pick.test/api/pc/listings?canonical_product_id=gpu%3Anvidia%3Artx-3080&sites=danawa&currency=KRW"
  ), {
    ...importEnv,
    SEARCH_CURSOR_SECRET: "fixture-cursor-secret-that-is-long-enough",
    RUNNER_URL: "https://runner.example.test/api/runner/run",
    RUNNER_TOKEN: "fixture-runner-token"
  });
  assert.equal(d1OnlyFreshnessResponse.status, 200);
  assert.equal((await d1OnlyFreshnessResponse.json()).data.freshness.last_collected_at, sourceRuntimeCollectedAt);
  assert.equal(synchronousFreshnessCalls, 0,
    "public listing freshness must be served entirely from D1 without a synchronous runner fetch");
} finally {
  globalThis.fetch = fetchBeforeD1OnlyFreshness;
}
const olderSourceRuntime = new Date(Date.parse(sourceRuntimeCollectedAt) - 60_000).toISOString();
const olderManifest = await mirrorCollectionManifest("danawa", olderSourceRuntime, [freshnessTargetIds.danawaGpu]);
assert.equal(olderManifest.response.status, 200);
assert.equal(olderManifest.payload.collection_manifest.as_of, olderSourceRuntime,
  "append-only history accepts an older immutable manifest without replacing the latest state");
const idempotentManifestRetry = await mirrorCollectionManifest("danawa", sourceRuntimeCollectedAt,
  [freshnessTargetIds.danawaGpu]);
assert.equal(idempotentManifestRetry.response.status, 200,
  "an exact source/as_of manifest retry must be idempotent even when it has no listing rows");
const equalTimeConflict = await mirrorCollectionManifest("danawa", sourceRuntimeCollectedAt,
  [freshnessTargetIds.danawaCpu]);
assert.equal(equalTimeConflict.response.status, 409,
  "the same source/as_of cannot be rewritten with a different successful target set");
const postConflictFreshness = await worker.fetch(new Request(
  "https://used-pick.test/api/pc/listings?canonical_product_id=gpu%3Anvidia%3Artx-3080&sites=danawa&currency=KRW"
), { ...importEnv, SEARCH_CURSOR_SECRET: "fixture-cursor-secret-that-is-long-enough" });
assert.equal((await postConflictFreshness.json()).data.freshness.last_collected_at, sourceRuntimeCollectedAt,
  "a conflicting equal-time manifest must leave the accepted target coverage unchanged");
const concurrentManifestAt = new Date(Date.parse(sourceRuntimeCollectedAt) + 2).toISOString();
const concurrentManifestResults = await Promise.all([
  mirrorCollectionManifest("danawa", concurrentManifestAt, [freshnessTargetIds.danawaGpu]),
  mirrorCollectionManifest("danawa", concurrentManifestAt, [freshnessTargetIds.danawaCpu])
]);
assert.deepEqual(concurrentManifestResults.map((result) => result.response.status).sort(), [200, 409],
  "concurrent different manifests for one immutable source/as_of must have exactly one winner");
const concurrentManifestRow = d1.prepare(`SELECT successful_target_ids_json
  FROM pc_listing_collection_manifests WHERE source_id = 'danawa' AND as_of = ?`).get(concurrentManifestAt);
const concurrentTargetRows = d1.prepare(`SELECT target_id FROM pc_listing_collection_target_runtime
  WHERE source_id = 'danawa' AND last_succeeded_at = ? ORDER BY target_id`).all(concurrentManifestAt);
assert.deepEqual(concurrentTargetRows.map((row) => row.target_id), JSON.parse(concurrentManifestRow.successful_target_ids_json),
  "a losing concurrent manifest cannot pollute the winning manifest's target runtime rows");

const coverageD1 = new DatabaseSync(":memory:");
for (const migration of [
  "0001_free_tier.sql",
  "0003_pc_listing_projection.sql",
  "0006_pc_listing_manufacturer.sql",
  "0009_pc_listing_board_manufacturer.sql",
  "0010_pc_listing_public_pagination.sql",
  "0011_pc_listing_collection_runtime.sql",
  "0012_pc_public_classification.sql"
]) {
  coverageD1.exec(await readFile(new URL(`../cloudflare/migrations/${migration}`, import.meta.url), "utf8"));
}
const insertCoverageListing = coverageD1.prepare(`INSERT INTO listings(
  item_id, site, category_id, title, search_text, price_value, currency, url, updated_at, active,
  canonical_product_id, canonical_display_name, listing_kind, pc_category_code, quantity, price_scope,
  condition_code, lifecycle_status, market_pool, price_eligible, exclusion_reasons_json
) VALUES (?, ?, 'pc', ?, ?, ?, 'KRW', ?, '2026-08-29T00:00:00.000Z', 1,
  'gpu:nvidia:rtx-3080', 'NVIDIA GeForce RTX 3080', 'SINGLE_COMPONENT', 'GPU', 1, 'TOTAL',
  'USED_WORKING', 'ACTIVE', 'KR_C2C_USED', 1, '[]')`);
for (const [site, price, url] of [
  ["danawa", 490_000, "https://dmall.danawa.com/v3/?controller=sale&methods=blog&seq=coverage-danawa"],
  ["bunjang", 500_000, "https://m.bunjang.co.kr/products/990001"],
  ["joonggonara", 510_000, "https://web.joongna.com/product/990002"]
]) {
  insertCoverageListing.run(`${site}:coverage`, site, `${site} coverage`, `${site} coverage`, price, url);
}
const insertCoverageRuntime = (sourceId, targetId, asOf, mirroredAt = asOf) => {
  const targetIdsJson = JSON.stringify([targetId]);
  coverageD1.prepare(`INSERT INTO pc_listing_collection_manifests(
    source_id, as_of, manifest_version, successful_target_ids_json, successful_target_count, mirrored_at
  ) VALUES (?, ?, 'pc-listing-collection-v1', ?, 1, ?)`).run(sourceId, asOf, targetIdsJson, mirroredAt);
  coverageD1.prepare(`INSERT INTO pc_listing_collection_target_runtime(
    source_id, target_id, last_succeeded_at, manifest_version, mirrored_at
  ) VALUES (?, ?, ?, 'pc-listing-collection-v1', ?)`).run(sourceId, targetId, asOf, mirroredAt);
};
const coverageDanawaAt = new Date(Date.now() - 30_000).toISOString();
const coverageBunjangAt = new Date(Date.now() - 3 * 60 * 60 * 1_000).toISOString();
insertCoverageRuntime("danawa", freshnessTargetIds.danawaGpu, coverageDanawaAt);
insertCoverageRuntime("bunjang", freshnessTargetIds.bunjangGpu, coverageBunjangAt);
const coverageEnv = {
  DB: d1Adapter(coverageD1, { maxBindings: 90 }),
  SEARCH_CURSOR_SECRET: "fixture-coverage-secret-that-is-long-enough"
};
const multiSourceCoverage = await worker.fetch(new Request(
  "https://used-pick.test/api/pc/listings?canonical_product_id=gpu%3Anvidia%3Artx-3080&sites=danawa,bunjang&currency=KRW&limit=1"
), coverageEnv);
const multiSourceCoveragePayload = await multiSourceCoverage.json();
assert.equal(multiSourceCoveragePayload.data.freshness.last_collected_at, coverageBunjangAt,
  "a multi-source cohort must use its oldest required target success, not any source's newest success");
assert.equal(multiSourceCoveragePayload.data.freshness.state, "STALE");
assert.equal(multiSourceCoveragePayload.data.freshness.required_target_count, 2);
assert.equal(multiSourceCoveragePayload.data.freshness.covered_target_count, 2);
const incompleteCoverage = await worker.fetch(new Request(
  "https://used-pick.test/api/pc/listings?canonical_product_id=gpu%3Anvidia%3Artx-3080&sites=danawa,joonggonara&currency=KRW"
), coverageEnv);
const incompleteCoveragePayload = await incompleteCoverage.json();
assert.equal(incompleteCoveragePayload.data.freshness.last_collected_at, null);
assert.equal(incompleteCoveragePayload.data.freshness.coverage_state, "INCOMPLETE");
assert.equal(incompleteCoveragePayload.data.freshness.required_target_count, 2);
assert.equal(incompleteCoveragePayload.data.freshness.covered_target_count, 1,
  "one fresh source cannot mask a missing source-target runtime");
const zeroResultSourceCoverage = await worker.fetch(new Request(
  "https://used-pick.test/api/pc/listings?canonical_product_id=gpu%3Anvidia%3Artx-3080&sites=danawa,coolenjoy&currency=KRW"
), coverageEnv);
const zeroResultSourceCoveragePayload = await zeroResultSourceCoverage.json();
assert.equal(zeroResultSourceCoveragePayload.data.total, 1,
  "a requested source with zero matching rows must not alter listing membership");
assert.equal(zeroResultSourceCoveragePayload.data.freshness.last_collected_at, null);
assert.equal(zeroResultSourceCoveragePayload.data.freshness.coverage_state, "INCOMPLETE");
assert.equal(zeroResultSourceCoveragePayload.data.freshness.required_target_count, 2);
assert.equal(zeroResultSourceCoveragePayload.data.freshness.covered_target_count, 1,
  "freshness coverage must include explicitly requested sources even when one has zero matching rows");
const cursorAsOf = multiSourceCoveragePayload.data.as_of;
const lateCoverageAt = new Date(Date.parse(cursorAsOf) - 1_000).toISOString();
const lateMirrorAt = new Date(Date.parse(cursorAsOf) + 1).toISOString();
insertCoverageRuntime("danawa", freshnessTargetIds.danawaGpu, lateCoverageAt, lateMirrorAt);
insertCoverageRuntime("bunjang", freshnessTargetIds.bunjangGpu, lateCoverageAt, lateMirrorAt);
const pinnedCoveragePage = await worker.fetch(new Request(
  `https://used-pick.test/api/pc/listings?canonical_product_id=gpu%3Anvidia%3Artx-3080&sites=danawa,bunjang&currency=KRW&limit=1&cursor=${encodeURIComponent(multiSourceCoveragePayload.data.pagination.next_cursor)}`
), coverageEnv);
assert.equal((await pinnedCoveragePage.json()).data.freshness.last_collected_at, coverageBunjangAt,
  "cursor continuation must exclude a backfilled success that became visible after the first page");
const currentCoverage = await worker.fetch(new Request(
  "https://used-pick.test/api/pc/listings?canonical_product_id=gpu%3Anvidia%3Artx-3080&sites=danawa,bunjang&currency=KRW&limit=1"
), coverageEnv);
assert.equal((await currentCoverage.json()).data.freshness.last_collected_at, lateCoverageAt,
  "a new first page may observe an older collection success mirrored after the prior cursor snapshot");
coverageD1.close();
const genericManufacturerListings = await worker.fetch(new Request(
  "https://used-pick.test/api/pc/listings?canonical_product_id=gpu%3Anvidia%3Artx-3080&manufacturer=ASUS&sites=danawa&currency=KRW"
), { ...importEnv, SEARCH_CURSOR_SECRET: "fixture-cursor-secret-that-is-long-enough" });
assert.equal((await genericManufacturerListings.json()).data.items.length, 1,
  "the legacy manufacturer filter must also match an explicit GPU board manufacturer when canonical_manufacturer is null");
const wrongBoardListings = await worker.fetch(new Request(
  "https://used-pick.test/api/pc/listings?canonical_product_id=gpu%3Anvidia%3Artx-3080&board_manufacturer=MSI"
), { ...importEnv, SEARCH_CURSOR_SECRET: "fixture-cursor-secret-that-is-long-enough" });
assert.equal((await wrongBoardListings.json()).data.items.length, 0);
const unsafeMixedCurrencySort = await worker.fetch(new Request(
  "https://used-pick.test/api/pc/listings?canonical_product_id=gpu%3Anvidia%3Artx-3080&sort=price_asc"
), { ...importEnv, SEARCH_CURSOR_SECRET: "fixture-cursor-secret-that-is-long-enough" });
assert.equal(unsafeMixedCurrencySort.status, 400, "price sorting without an explicit currency must fail closed");
const importResponse = await worker.fetch(new Request("https://used-pick.test/admin/import-listings", {
  method: "POST",
  headers: { authorization: "Bearer import-fixture-token", "content-type": "application/json" },
  body: JSON.stringify({ items: [{
    item_id: "joonggonara:sold-import", site: "joonggonara", category_id: "pc",
    title: "RTX 3080 판매완료 010-1234-5678", search_text: "seller@example.com RTX 3080",
    seller_name: "판매자 010-1234-5678", price: 480_000, currency: "KRW",
    url: "https://web.joongna.com/product/sold-import", lifecycle_status: "SOLD",
    market_pool: "KR_C2C_USED"
  }, {
    item_id: "joonggonara:pii-import", site: "joonggonara", category_id: "pc",
    title: "RTX 3080 010-1234-5678", search_text: "seller@example.com RTX 3080",
    seller_name: "판매자 010-1234-5678", price: 480_000, currency: "KRW",
    url: "https://web.joongna.com/product/pii-import", lifecycle_status: "ACTIVE",
    market_pool: "KR_C2C_USED", canonical_product_id: "gpu:nvidia:rtx-3080",
    canonical_display_name: "NVIDIA GeForce RTX 3080", canonical_manufacturer: "ASUS", listing_kind: "SINGLE_COMPONENT",
    board_manufacturer: "ASUS", category_code: "GPU", quantity: 1, price_scope: "TOTAL", condition_code: "USED_WORKING",
    price_eligible: true, exclusion_reasons: []
  }, staleD1Fixture, {
    item_id: "bunjang:allowed-import", site: "bunjang", category_id: "pc",
    title: "RTX 3080 번개장터", price: 481_000, currency: "KRW",
    url: "https://m.bunjang.co.kr/products/910001", lifecycle_status: "ACTIVE", market_pool: "KR_C2C_USED",
    canonical_product_id: "gpu:nvidia:rtx-3080", canonical_display_name: "NVIDIA GeForce RTX 3080",
    canonical_manufacturer: "NVIDIA", board_manufacturer: "ZOTAC", listing_kind: "SINGLE_COMPONENT", category_code: "GPU",
    quantity: 1, price_scope: "TOTAL", condition_code: "USED_WORKING", price_eligible: true, exclusion_reasons: []
  }, {
    item_id: "hellomarket:allowed-import", site: "hellomarket", category_id: "pc",
    title: "RTX 3080 헬로마켓", price: 482_000, currency: "KRW",
    url: "https://www.hellomarket.com/item/910002", lifecycle_status: "ACTIVE", market_pool: "KR_C2C_USED",
    canonical_product_id: "gpu:nvidia:rtx-3080", canonical_display_name: "NVIDIA GeForce RTX 3080",
    canonical_manufacturer: "NVIDIA", board_manufacturer: "MSI", listing_kind: "SINGLE_COMPONENT", category_code: "GPU",
    quantity: 1, price_scope: "TOTAL", condition_code: "USED_WORKING", price_eligible: true, exclusion_reasons: []
  }, {
    item_id: "coolenjoy:allowed-import", site: "coolenjoy", category_id: "pc",
    title: "RTX 3080 쿨엔조이", price: 484_000, currency: "KRW",
    url: "https://coolenjoy.net/bbs/market/910004", lifecycle_status: "ACTIVE", market_pool: "KR_C2C_USED",
    canonical_product_id: "gpu:nvidia:rtx-3080", canonical_display_name: "NVIDIA GeForce RTX 3080",
    canonical_manufacturer: "NVIDIA", board_manufacturer: "GALAX", listing_kind: "SINGLE_COMPONENT", category_code: "GPU",
    quantity: 1, price_scope: "TOTAL", condition_code: "USED_WORKING", price_eligible: true, exclusion_reasons: []
  }, {
    item_id: "danawa:wrong-source-host", site: "danawa", category_id: "pc",
    title: "RTX 3080 잘못된 출처 URL", price: 485_000, currency: "KRW",
    url: "https://web.joongna.com/product/910005", lifecycle_status: "ACTIVE", market_pool: "KR_C2C_USED",
    canonical_product_id: "gpu:nvidia:rtx-3080", listing_kind: "SINGLE_COMPONENT", category_code: "GPU",
    quantity: 1, price_scope: "TOTAL", condition_code: "USED_WORKING", price_eligible: true, exclusion_reasons: []
  }, {
    item_id: "danawa:allowed-import", site: "danawa", category_id: "pc",
    title: "RTX 3080 다나와 장터", price: 475_000, currency: "KRW",
    url: "http://dmall.danawa.com/v3/?controller=sale&methods=blog&seq=12345",
    lifecycle_status: "ACTIVE", market_pool: "KR_C2C_USED",
    canonical_product_id: "gpu:nvidia:rtx-3080", canonical_display_name: "NVIDIA GeForce RTX 3080",
    canonical_manufacturer: "ASUS", board_manufacturer: "ASUS", listing_kind: "SINGLE_COMPONENT", category_code: "GPU", quantity: 1,
    price_scope: "TOTAL", condition_code: "USED_WORKING", price_eligible: true, exclusion_reasons: []
  }, {
    item_id: "danawa:board-evidence-import", site: "danawa", category_id: "pc",
    title: "MSI RTX 3080 다나와 장터", price: 476_000, currency: "KRW",
    url: "https://dmall.danawa.com/v3/?controller=sale&methods=blog&seq=12346",
    lifecycle_status: "ACTIVE", market_pool: "KR_C2C_USED",
    canonical_product_id: "gpu:nvidia:rtx-3080", canonical_display_name: "NVIDIA GeForce RTX 3080",
    canonical_manufacturer: null, listing_kind: "SINGLE_COMPONENT", category_code: "GPU", quantity: 1,
    price_scope: "TOTAL", condition_code: "USED_WORKING", price_eligible: true, exclusion_reasons: [],
    evidence: [{ field: "board_manufacturer", value: "MSI", source: "TITLE_ALIAS" }]
  }, {
    item_id: "danawa:invalid-quantity-import", site: "danawa", category_id: "pc",
    title: "RTX 3080 수량 미확인", price: 477_000, currency: "KRW",
    url: "https://dmall.danawa.com/v3/?controller=sale&methods=blog&seq=12347",
    lifecycle_status: "ACTIVE", market_pool: "KR_C2C_USED",
    canonical_product_id: "gpu:nvidia:rtx-3080", listing_kind: "SINGLE_COMPONENT", category_code: "GPU",
    quantity: null, price_scope: "TOTAL", condition_code: "USED_WORKING", price_eligible: true, exclusion_reasons: []
  }, {
    item_id: "danawa:ambiguous-price-import", site: "danawa", category_id: "pc",
    title: "RTX 3080 2개 가격범위 불명", price: 478_000, currency: "KRW",
    url: "https://dmall.danawa.com/v3/?controller=sale&methods=blog&seq=12348",
    lifecycle_status: "ACTIVE", market_pool: "KR_C2C_USED",
    canonical_product_id: "gpu:nvidia:rtx-3080", listing_kind: "SAME_PRODUCT_LOT", category_code: "GPU",
    quantity: 2, price_scope: "AMBIGUOUS", condition_code: "USED_WORKING", price_eligible: true, exclusion_reasons: []
  }, {
    item_id: "ebay:987654321", site: "ebay", category_id: "pc",
    title: "RTX 3080 working used", price: 350, currency: "USD",
    url: "https://www.ebay.com/itm/987654321", image_url: "https://i.ebayimg.com/images/g/fixture/s-l1600.jpg",
    lifecycle_status: "ACTIVE", market_pool: "OVERSEAS_USED",
    canonical_product_id: "gpu:nvidia:rtx-3080", canonical_display_name: "NVIDIA GeForce RTX 3080",
    canonical_manufacturer: "NVIDIA", listing_kind: "SINGLE_COMPONENT", category_code: "GPU", quantity: 1,
    price_scope: "TOTAL", condition_code: "USED_WORKING", price_eligible: true, exclusion_reasons: []
  }, {
    item_id: "ebay:https://www.ebay.com/itm/legacy-d1-id", site: "ebay", category_id: "pc",
    title: "legacy eBay URL identity", price: 100, currency: "USD",
    url: "https://www.ebay.com/itm/legacy-d1-id", lifecycle_status: "ACTIVE", market_pool: "OVERSEAS_USED"
  }, {
    item_id: "ebay:zero-price", site: "ebay", category_id: "pc",
    title: "RTX 3080 zero price", price: 0, currency: "USD",
    url: "https://www.ebay.com/itm/zero-price", lifecycle_status: "ACTIVE", market_pool: "OVERSEAS_USED",
    canonical_product_id: "gpu:nvidia:rtx-3080", listing_kind: "SINGLE_COMPONENT", category_code: "GPU"
  }] })
}), importEnv);
assert.equal(importResponse.status, 200);
const importPayload = await importResponse.json();
assert.equal(importPayload.retention_policy, "NON_DESTRUCTIVE");
assert.equal(d1.prepare("SELECT active FROM listings WHERE item_id = ?").get("joonggonara:sold-import")?.active, 0,
  "an imported inactive listing must be retained for audit without entering the public projection");
const importedPii = d1.prepare("SELECT active, title, search_text, seller_name FROM listings WHERE item_id = ?")
  .get("joonggonara:pii-import");
assert.equal(importedPii.active, 1);
assert.equal(importedPii.seller_name, null);
assert.doesNotMatch(JSON.stringify(importedPii), /010-1234-5678|seller@example\.com/u);
for (const itemId of [
  "bunjang:allowed-import",
  "hellomarket:allowed-import",
  "coolenjoy:allowed-import"
]) {
  assert.equal(d1.prepare("SELECT active FROM listings WHERE item_id = ?").get(itemId)?.active, 1,
    `${itemId} must be accepted into the stored PC directory projection`);
}
assert.equal(d1.prepare("SELECT 1 FROM listings WHERE item_id = ?").get("danawa:wrong-source-host"), undefined,
  "a listing URL from another source host must not be stored under the wrong site key");
assert.equal(d1.prepare("SELECT active FROM listings WHERE item_id = ?").get("danawa:allowed-import").active, 1);
assert.match(d1.prepare("SELECT url FROM listings WHERE item_id = ?").get("danawa:allowed-import").url, /^https:/u);
assert.equal(d1.prepare("SELECT board_manufacturer FROM listings WHERE item_id = ?")
  .get("danawa:board-evidence-import").board_manufacturer, "MSI");
const invalidQuantity = d1.prepare("SELECT price_eligible, exclusion_reasons_json FROM listings WHERE item_id = ?")
  .get("danawa:invalid-quantity-import");
assert.equal(invalidQuantity.price_eligible, 0);
assert.ok(JSON.parse(invalidQuantity.exclusion_reasons_json).includes("QUANTITY_UNKNOWN"));
const ambiguousPrice = d1.prepare("SELECT price_eligible, exclusion_reasons_json FROM listings WHERE item_id = ?")
  .get("danawa:ambiguous-price-import");
assert.equal(ambiguousPrice.price_eligible, 0);
assert.ok(JSON.parse(ambiguousPrice.exclusion_reasons_json).includes("PRICE_SCOPE_AMBIGUOUS"));
assert.equal(d1.prepare("SELECT price_eligible FROM listings WHERE item_id = ?")
  .get(staleD1Fixture.item_id).price_eligible, 1, "the fixture starts as a stale v8-eligible D1 row");
const d1TombstoneResponse = await worker.fetch(new Request("https://used-pick.test/admin/import-listings", {
  method: "POST",
  headers: { authorization: "Bearer import-fixture-token", "content-type": "application/json" },
  body: JSON.stringify({ items: [pcProjectionTombstone(staleD1Fixture, {
    updatedAt: "2026-09-01T00:01:00.000Z"
  })] })
}), importEnv);
assert.equal(d1TombstoneResponse.status, 200);
const d1TombstonePayload = await d1TombstoneResponse.json();
assert.equal(d1TombstonePayload.inserted, 1);
assert.equal(d1TombstonePayload.rejected, 0);
assert.equal(d1TombstonePayload.retention_policy, "NON_DESTRUCTIVE");
const retainedD1Tombstone = d1.prepare(`SELECT active, price_eligible, exclusion_reasons_json
  FROM listings WHERE item_id = ?`).get(staleD1Fixture.item_id);
assert.equal(retainedD1Tombstone.active, 1,
  "D1 reconciliation retains the source row while removing its public eligibility");
assert.equal(retainedD1Tombstone.price_eligible, 0);
assert.ok(JSON.parse(retainedD1Tombstone.exclusion_reasons_json)
  .includes("NOT_IN_ACTIVE_PIPELINE_ELIGIBLE_SET"));
const reconciledD1Listings = await worker.fetch(new Request(
  "https://used-pick.test/api/pc/listings?canonical_product_id=gpu%3Anvidia%3Artx-3080&sites=bunjang&currency=KRW"
), { ...importEnv, SEARCH_CURSOR_SECRET: "fixture-cursor-secret-that-is-long-enough" });
assert.equal((await reconciledD1Listings.json()).data.items
  .some((item) => item.item_id === staleD1Fixture.item_id), false,
"a reconciled stale D1 projection remains stored but is absent from the public API");
const boardEvidenceListings = await worker.fetch(new Request(
  "https://used-pick.test/api/pc/listings?canonical_product_id=gpu%3Anvidia%3Artx-3080&board_manufacturer=MSI&sites=danawa&currency=KRW"
), { ...importEnv, SEARCH_CURSOR_SECRET: "fixture-cursor-secret-that-is-long-enough" });
const boardEvidenceItems = (await boardEvidenceListings.json()).data.items;
assert.equal(boardEvidenceItems.length, 1);
assert.equal(boardEvidenceItems[0].board_manufacturer, "MSI");
assert.equal(boardEvidenceItems.some((item) => item.item_id === "danawa:invalid-quantity-import"), false);
assert.equal(boardEvidenceItems.some((item) => item.item_id === "danawa:ambiguous-price-import"), false);
for (const site of ["bunjang", "hellomarket", "coolenjoy"]) {
  const sourceListings = await worker.fetch(new Request(
    `https://used-pick.test/api/pc/listings?canonical_product_id=gpu%3Anvidia%3Artx-3080&sites=${site}&currency=KRW`
  ), { ...importEnv, SEARCH_CURSOR_SECRET: "fixture-cursor-secret-that-is-long-enough" });
  assert.equal(sourceListings.status, 200);
  const sourceItems = (await sourceListings.json()).data.items;
  assert.equal(sourceItems.length, 1);
  assert.equal(sourceItems[0].site, site, `${site} site filter must return only its own stored projection`);
}
const retiredEbayRow = d1.prepare("SELECT active FROM listings WHERE item_id = ?")
  .get("ebay:https://www.ebay.com/itm/legacy-d1-id");
assert.ok(retiredEbayRow,
  "an inactive recovery row must survive unrelated D1 listing imports");
assert.equal(retiredEbayRow.active, 0,
  "a retired URL-based eBay identity must remain inactive after a later publication");
assert.equal(d1.prepare("SELECT active FROM listings WHERE item_id = ?").get("ebay:zero-price")?.active === 1, false,
  "a zero-price listing may be retained for audit but must stay out of the public projection");
const ebayImageListings = await worker.fetch(new Request(
  "https://used-pick.test/api/pc/listings?canonical_product_id=gpu%3Anvidia%3Artx-3080&sites=ebay&market_pool=OVERSEAS_USED&currency=USD"
), { ...importEnv, SEARCH_CURSOR_SECRET: "fixture-cursor-secret-that-is-long-enough" });
assert.equal(ebayImageListings.status, 200);
const ebayImageItems = (await ebayImageListings.json()).data.items;
assert.equal(ebayImageItems.length, 1);
assert.equal(ebayImageItems[0].image_url, "https://i.ebayimg.com/images/g/fixture/s-l1600.jpg",
  "an existing eBay image must survive import and the public listing response");
const wrongPoolResponse = await worker.fetch(new Request("https://used-pick.test/admin/import-listings", {
  method: "POST",
  headers: { authorization: "Bearer import-fixture-token", "content-type": "application/json" },
  body: JSON.stringify({ items: [{
    item_id: "joonggonara:wrong-pool", site: "joonggonara", title: "RTX 3080",
    price: 480_000, currency: "KRW", url: "https://web.joongna.com/product/wrong-pool",
    lifecycle_status: "ACTIVE", market_pool: "OVERSEAS_USED"
  }] })
}), importEnv);
assert.equal((await wrongPoolResponse.json()).rejected, 1);
const previousFetch = globalThis.fetch;
try {
  globalThis.fetch = async () => new Response(JSON.stringify({ status: "error" }), { status: 503 });
  const fallback = await worker.fetch(new Request("https://used-pick.test/api/search", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ keyword: "RTX 3080", sites: ["joonggonara"], pc_category_code: "GPU", manufacturer: "ASUS", limit: 10 })
  }), {
    DB: d1Adapter(d1), SEARCH_RUNNER_URL: "https://runner.example.test/api/search", RUNNER_TOKEN: "fixture-token"
  });
  assert.equal(fallback.status, 200);
  assert.equal(fallback.headers.get("x-search-data-source"), "d1-fallback");
  assert.equal((await fallback.json()).data.items[0].canonical_product_id, "gpu:nvidia:rtx-3080");
  const wrongManufacturer = await worker.fetch(new Request("https://used-pick.test/api/search", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ keyword: "RTX 3080", sites: ["joonggonara"], pc_category_code: "GPU", manufacturer: "MSI", limit: 10 })
  }), {
    DB: d1Adapter(d1), SEARCH_RUNNER_URL: "https://runner.example.test/api/search", RUNNER_TOKEN: "fixture-token"
  });
  assert.equal((await wrongManufacturer.json()).data.items.length, 0);
} finally {
  globalThis.fetch = previousFetch;
  d1.close();
}

const { createServer } = await import("../dist/web-backend/logic/server.js");
const internalSecret = "database-password=must-not-leak";
let localSearchCalls = 0;
const server = createServer(0, {
  initializeStorage: false,
  exposeInternalErrorDetails: false,
  publicApiOnly: true,
  corsAllowedOrigins: ["https://frontend.example"],
  runWebSearch: async () => { localSearchCalls += 1; throw new Error(internalSecret); },
  listPcListings: async (query) => ({
    items: [{ ...items[0], canonical_product_id: query.canonicalProductId, canonical_manufacturer: query.manufacturer }],
    total: 1,
    pagination: { has_more: false, next_cursor: null },
    as_of: "2026-08-29T00:00:00.000Z",
    freshness: { as_of: "2026-08-29T00:00:00.000Z", last_collected_at: "2026-08-29T00:00:00.000Z", age_seconds: 0, state: "FRESH" }
  })
});
try {
  if (!server.listening) await once(server, "listening");
  const address = server.address();
  const baseUrl = `http://127.0.0.1:${address.port}`;
  const deniedCors = await fetch(`${baseUrl}/health`, { headers: { origin: "https://evil.example" } });
  assert.equal(deniedCors.headers.get("access-control-allow-origin"), null);
  const hidden = await fetch(`${baseUrl}/api/search`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ keyword: "RTX 3080", sites: ["joonggonara"] })
  });
  const hiddenText = await hidden.text();
  assert.equal(hidden.status, 500);
  assert.doesNotMatch(hiddenText, new RegExp(internalSecret, "u"));
  const localCatalog = await fetch(`${baseUrl}/api/pc/catalog`);
  assert.equal(localCatalog.status, 200);
  const localProducts = await fetch(`${baseUrl}/api/pc/products?category_code=GPU&query=RTX%203080`);
  assert.equal((await localProducts.json()).data.products.items[0].id, "gpu:nvidia:rtx-3080");
  const localListings = await fetch(`${baseUrl}/api/pc/listings?canonical_product_id=gpu%3Anvidia%3Artx-3080&manufacturer=ASUS&sites=danawa&price_min=400000&price_max=600000`);
  const localListingItem = (await localListings.json()).data.items[0];
  assert.equal(localListingItem.canonical_product_id, "gpu:nvidia:rtx-3080");
  assert.equal(localListingItem.canonical_manufacturer, "ASUS");
  assert.equal(localSearchCalls, 1, "PC directory GET routes must not invoke the live search collector");
} finally {
  server.close();
  if (server.listening) await once(server, "close");
  await rm(directory, { recursive: true, force: true });
}

await import("./monetization-trust-contract.mjs");
console.log(JSON.stringify({ status: "passed", contract: "pc-service" }, null, 2));
