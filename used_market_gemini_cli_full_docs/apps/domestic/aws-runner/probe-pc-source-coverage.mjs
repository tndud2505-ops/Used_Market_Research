import { collectOne } from "../cloudflare/live-search.mjs";
import { pcCollectionTargetSetV2 } from "../cloudflare/pc-directory-http.mjs";
import { collectDanawaCategoryListings, SPECIALIST_FIXTURE_PARSERS } from "../collector/logic/pc-source-adapters.mjs";
import { PC_SOURCE_REGISTRY, getPcSource } from "../collector/logic/pc-source-registry.mjs";
import { PC_PRODUCT_MASTER_V2 } from "../market/data/pc-product-master-v2.mjs";
import { publicPcProducts } from "../market/logic/pc-public-catalog.mjs";
import { PcPartsLedger } from "./pc-parts-ledger.mjs";
import { PcShadowPipeline } from "./pc-shadow-pipeline.mjs";
import {
  assessProbeRun,
  parseProbeConfig,
  pcProductQueryVariants,
  selectProbeRuns,
  summarizeProbeRuns,
} from "./pc-source-coverage-core.mjs";

const operationalSources = PC_SOURCE_REGISTRY.filter((source) => source.directory_source === true
  && source.policy_status === "APPROVED" && source.runtime_status === "ENABLED");
const config = parseProbeConfig(process.env, operationalSources.map((source) => source.key));
const targetSet = pcCollectionTargetSetV2();
const selection = selectProbeRuns(targetSet.targets, config);
if (selection.runs.length === 0) throw new Error("PC_PROBE_TARGETS_MISSING");
if (selection.runs.some(({ target }) => /MONITOR|모니터/iu.test(`${target.categoryCode} ${target.queryText}`))) {
  throw new Error("PC_PROBE_MONITOR_TARGET_FORBIDDEN");
}

const specialistSearchUrls = Object.freeze({
  coolenjoy: "https://coolenjoy.net/bbs/mart2?sfl=wr_subject&stx={query}&sop=and",
});
const specialistHosts = Object.freeze({
  coolenjoy: new Set(["coolenjoy.net", "www.coolenjoy.net"]),
});

async function collectTargetItems(sourceKey, target) {
  if (sourceKey === "danawa") {
    return (await collectDanawaCategoryListings({ categoryCode: target.categoryCode })).items.slice(0, config.itemLimit);
  }
  const parser = SPECIALIST_FIXTURE_PARSERS[sourceKey];
  if (parser && specialistSearchUrls[sourceKey]) {
    const url = new URL(specialistSearchUrls[sourceKey].replace("{query}", encodeURIComponent(target.queryText)));
    if (!specialistHosts[sourceKey].has(url.hostname.toLowerCase())) {
      throw new Error(`PC_PROBE_SPECIALIST_HOST_NOT_ALLOWED:${sourceKey}`);
    }
    const response = await fetch(url, {
      headers: {
        accept: "text/html,application/xhtml+xml",
        "accept-language": "ko-KR,ko;q=0.9,en;q=0.7",
        referer: "https://used-pick.com/",
        "user-agent": "USED-PICK-PC-Collector/2.0 (+https://used-pick.com/)",
      },
      signal: AbortSignal.timeout(20_000),
    });
    if (!response.ok) throw new Error(`PC_PROBE_SPECIALIST_HTTP_${response.status}:${sourceKey}`);
    return parser(await response.text()).slice(0, config.itemLimit).map((item) => ({ ...item, site: sourceKey }));
  }
  return collectOne(sourceKey, target.queryText, sourceKey === "ebay" ? target.categoryCode : "pc",
    config.itemLimit, target.queryText, "recent", { min: null, max: null });
}

async function publicListingEvidence(sourceKey, target) {
  if (!config.comparePublic || !target.canonicalProductId) return { count: null, freshness: null };
  const url = new URL("/api/pc/listings", config.publicBaseUrl);
  url.searchParams.set("canonical_product_id", target.canonicalProductId);
  url.searchParams.set("site", sourceKey);
  url.searchParams.set("limit", "1");
  url.searchParams.set("sort", "recent");
  const response = await fetch(url, { headers: { accept: "application/json" }, signal: AbortSignal.timeout(20_000) });
  if (!response.ok) throw new Error(`PC_PROBE_PUBLIC_HTTP_${response.status}`);
  const payload = await response.json();
  const data = payload?.data || payload;
  const explicitTotal = Number(data?.total);
  const sourceTotal = Number(data?.source_counts?.[sourceKey]);
  const itemCount = Array.isArray(data?.items) ? data.items.length : 0;
  const count = data?.total !== null && data?.total !== undefined && Number.isFinite(explicitTotal)
    ? explicitTotal
    : Number.isFinite(sourceTotal) ? sourceTotal : itemCount;
  return { count, freshness: data?.freshness?.state || null };
}

const ledger = new PcPartsLedger();
ledger.migrate();
const pipeline = new PcShadowPipeline({ ledger });
await pipeline.initialize();
const checkedAt = new Date().toISOString();
const productById = new Map([...PC_PRODUCT_MASTER_V2, ...publicPcProducts()]
  .map((product) => [product.id, product]));
const rows = [];
for (const { sourceKey, target } of selection.runs) {
  try {
    getPcSource(sourceKey);
    const product = productById.get(target.canonicalProductId) || null;
    const queryVariants = config.queryVariants && product
      ? pcProductQueryVariants(product, { sourceKey, maximum: config.maxQueryVariants })
      : [target.queryText];
    const dedupedItems = new Map();
    const queryResults = [];
    for (let queryIndex = 0; queryIndex < queryVariants.length; queryIndex += 1) {
      const queryText = queryVariants[queryIndex];
      try {
        const collected = await collectTargetItems(sourceKey, { ...target, queryText });
        for (const item of collected) {
          const identity = String(item?.source_listing_id || item?.item_id || item?.id || item?.url || "").trim();
          if (identity && !dedupedItems.has(identity)) dedupedItems.set(identity, item);
        }
        queryResults.push({ query_text: queryText, received_count: collected.length, error: null });
      } catch (error) {
        queryResults.push({
          query_text: queryText,
          received_count: 0,
          error: error instanceof Error ? error.message : String(error),
        });
      }
      if (queryIndex + 1 < queryVariants.length && config.delayMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, config.delayMs));
      }
    }
    if (queryResults.every((result) => result.error)) {
      throw new Error(`ALL_QUERY_VARIANTS_FAILED:${queryResults.map((result) => result.error).join(";")}`);
    }
    const items = [...dedupedItems.values()];
    const projections = items.map((item) => {
      const normalized = pipeline.normalizeItem({ ...item, site: sourceKey }, checkedAt);
      return {
        canonical_product_id: normalized.normalized.canonicalProductId,
        category_code: normalized.normalized.categoryCode,
        pc_category_code: normalized.normalized.publicCategoryCode,
        lifecycle_status: normalized.state.status,
        price_eligible: normalized.priceEligible,
        statistics_eligible: normalized.normalized.statisticsEligible,
        listing_kind: normalized.normalized.listingKind,
        condition_code: normalized.normalized.conditionCode,
        unit_price: normalized.normalized.unitPrice,
        exclusion_reasons: normalized.exclusionReasons,
        statistics_exclusion_reasons: normalized.normalized.statisticsExclusionReasons,
      };
    });
    const publicEvidence = await publicListingEvidence(sourceKey, target);
    rows.push(assessProbeRun({
      sourceKey, target, items, projections,
      publicListingCount: publicEvidence.count,
      publicFreshness: publicEvidence.freshness,
      product,
      queryVariants,
    }));
    rows.at(-1).query_results = queryResults;
  } catch (error) {
    rows.push({
      source_key: sourceKey,
      target_id: target.targetId,
      canonical_product_id: target.canonicalProductId || null,
      category_code: target.categoryCode,
      query_text: target.queryText,
      cadence_class: target.cadenceClass,
      status: "SOURCE_ERROR",
      error: error instanceof Error ? error.message : String(error),
    });
  }
  if (config.delayMs > 0) await new Promise((resolve) => setTimeout(resolve, config.delayMs));
}
ledger.close();

const report = {
  report_version: "pc-source-coverage-v3",
  target_set_version: targetSet.targetSetVersion,
  checked_at: checkedAt,
  source_keys: config.sourceKeys,
  filters: {
    product_ids: config.productIds,
    categories: config.categories,
    cadence_class: config.cadenceClass,
    query_variants: config.queryVariants,
    max_query_variants: config.maxQueryVariants,
  },
  offset: config.offset,
  target_limit: config.targetLimit,
  item_limit: config.itemLimit,
  total_target_runs: selection.totalRuns,
  next_offset: selection.nextOffset,
  summary: summarizeProbeRuns(rows, {
    offset: config.offset,
    targetLimit: config.targetLimit,
    totalRuns: selection.totalRuns,
  }),
  rows,
};

console.log(JSON.stringify(report, null, 2));
if (rows.length > 0 && rows.every((row) => row.status === "SOURCE_ERROR")) process.exitCode = 2;
