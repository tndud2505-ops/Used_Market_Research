import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const root = resolve(new URL("..", import.meta.url).pathname.replace(/^\/(\w):/, "$1:"));
const categoryIds = [
  "fashion_women_outer",
  "fashion_women_tops",
  "fashion_women_bottoms",
  "fashion_women_skirts",
  "fashion_men_outer",
  "fashion_men_tops",
  "fashion_men_bottoms",
  "fashion_goods",
  "luxury",
  "beauty",
  "kids",
  "mobile",
  "appliances",
  "pc",
  "camera",
  "furniture",
  "living",
  "games",
  "books",
  "sports",
  "tools"
];
const sourceKeys = ["bunjang", "joonggonara", "hellomarket", "rethinkmall"];

const categoryCatalog = await import(pathToFileURL(resolve(root, "dist/market/logic/category-catalog.js")).href);
const browserCollector = await import(pathToFileURL(resolve(root, "dist/collector/logic/browserCollector.js")).href);
const siteCatalog = await import(pathToFileURL(resolve(root, "dist/collector/logic/sites/index.js")).href);

const results = [];
for (const categoryId of categoryIds) {
  const category = categoryCatalog.resolveCategory(categoryId);
  if (!category) continue;
  for (const source of sourceKeys) {
    results.push(await checkCategory(source, category));
  }
}

const sourceSummary = Object.fromEntries(sourceKeys.map((source) => {
  const rows = results.filter((result) => result.source === source);
  return [source, {
    checked_categories: rows.length,
    with_results: rows.filter((row) => row.visible_count > 0).length,
    pass: rows.filter((row) => row.status === "pass").length,
    warn: rows.filter((row) => row.status === "warn").length,
    fail: rows.filter((row) => row.status === "fail").length,
    excluded: rows.filter((row) => row.status === "excluded").length,
    official_category_checks: rows.filter((row) => row.mapping_mode === "official").length,
    keyword_fallback_checks: rows.filter((row) => row.mapping_mode === "keyword_inferred").length,
    unavailable_mapping_checks: rows.filter((row) => row.mapping_mode === "unavailable").length
  }];
}));

const report = {
  mode: "live",
  generated_at: new Date().toISOString(),
  source_scope: sourceKeys,
  category_count: categoryIds.length,
  category_ids: categoryIds,
  source_summary: sourceSummary,
  results
};
const runId = `${new Date().toISOString().replace(/[:.]/g, "-")}__category-matrix__live`;
const outputDir = resolve(root, "merge/result/harness", runId);
await mkdir(outputDir, { recursive: true });
await writeFile(resolve(outputDir, "output.json"), JSON.stringify(report, null, 2), "utf8");

console.log(JSON.stringify({
  status: results.some((result) => result.status === "fail") ? "completed_with_failures" : "completed",
  category_count: categoryIds.length,
  source_summary: sourceSummary,
  output_dir: outputDir
}, null, 2));

async function checkCategory(source, category) {
  const plan = categoryCatalog.resolveCategoryCollectionPlan(source, category.id);
  const mappingMode = plan?.strategy === "source_category" && plan.resolvedCategoryId === category.id
      ? "official"
      : plan?.strategy === "source_category"
        ? "parent_fallback"
        : "unavailable";
  const sourceCategoryIds = plan?.binding?.sourceCategoryIds ?? [];

  try {
    if (!plan || mappingMode === "unavailable") {
      return {
        source,
        category_id: category.id,
        category_label: category.label,
        category_path: category.path,
        mapping_mode: "unavailable",
        source_category_ids: [],
        requested_url: null,
        response_url: null,
        status: "excluded",
        extracted_count: 0,
        relevant_count: 0,
        visible_count: 0,
        category_match_count: 0,
        category_match_rate: 0,
        relevance_rate: 0,
        warnings: ["NO_OFFICIAL_SOURCE_CATEGORY_MAPPING"],
        errors: []
      };
    }

    const adapter = siteCatalog.resolveBrowserSiteAdapter(source);
    const firstSourceCategoryId = sourceCategoryIds[0] ?? plan.binding?.sourceCategoryId ?? "";
    const requestedUrl = adapter.categoryUrl?.(firstSourceCategoryId, 20) ?? null;
    const result = await browserCollector.collectSearchListings({
      site: source,
      keyword: "",
      keywordIsExplicit: false,
      limit: 20,
      category
    });
    const items = Array.isArray(result.items) ? result.items : [];
    const matchingItems = items.filter((item) => {
      const itemSourceIds = new Set([
        ...(Array.isArray(item.source_category_ids) ? item.source_category_ids : []),
        item.source_category_id
      ].filter(Boolean).map(String));
      return sourceCategoryIds.some((id) => itemSourceIds.has(String(id)));
    });
    const warnings = Array.isArray(result.warnings) ? result.warnings : [];
    const errors = Array.isArray(result.errors) ? result.errors : [];
    const matchRate = items.length > 0 ? matchingItems.length / items.length : 0;
    return {
      source,
      category_id: category.id,
      category_label: category.label,
      category_path: category.path,
      mapping_mode: mappingMode,
      source_category_ids: sourceCategoryIds,
      requested_url: requestedUrl,
      response_url: requestedUrl,
      status: errors.length > 0 ? "fail" : items.length > 0 && matchRate === 1 ? "pass" : "warn",
      extracted_count: result.quality_meta?.extracted_count ?? items.length,
      relevant_count: matchingItems.length,
      visible_count: items.length,
      category_match_count: matchingItems.length,
      category_match_rate: Number(matchRate.toFixed(3)),
      relevance_rate: Number(matchRate.toFixed(3)),
      warnings,
      errors
    };
  } catch (error) {
    return {
      source,
      category_id: category.id,
      category_label: category.label,
      category_path: category.path,
      mapping_mode: mappingMode,
      source_category_ids: sourceCategoryIds,
      requested_url: null,
      response_url: null,
      status: "fail",
      extracted_count: 0,
      relevant_count: 0,
      visible_count: 0,
      category_match_count: 0,
      category_match_rate: 0,
      relevance_rate: 0,
      warnings: [],
      errors: [error instanceof Error ? error.message : String(error)]
    };
  }
}
