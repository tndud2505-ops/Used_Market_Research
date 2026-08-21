import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const root = resolve(new URL("..", import.meta.url).pathname.replace(/^\/(\w):/, "$1:"));
const catalog = await import(pathToFileURL(resolve(root, "dist/market/logic/category-catalog.js")).href);
const publicCatalog = catalog.categoryCatalogForApi();
const targetSites = ["joonggonara", "bunjang", "hellomarket", "rethinkmall"];
const categories = publicCatalog.categories.filter((category) => category.id !== "all");
const primaryCategories = categories.filter((category) => !category.parentId);

function unavailablePlan() {
  return {
    strategy: "keyword",
    availability: "unavailable",
    selectable: false,
    resolvedCategoryId: null,
    binding: null
  };
}

function planFor(site, categoryId) {
  return publicCatalog.site_plans?.[site]?.[categoryId] || unavailablePlan();
}

function bindingFor(site, categoryId) {
  return publicCatalog.source_bindings?.[site]?.[categoryId] || null;
}

function sourceIds(binding) {
  if (!binding) return [];
  return binding.sourceCategoryIds?.length
    ? binding.sourceCategoryIds.map(String)
    : binding.sourceCategoryId
      ? [String(binding.sourceCategoryId)]
      : [];
}

const classificationMatrix = categories.map((category) => ({
  canonical_id: category.id,
  label: category.label,
  path: category.parentId
    ? [...(catalog.resolveCategory(category.id)?.path || [])]
    : [category.label],
  parent_id: category.parentId || null,
  joongna_source_category_ids: sourceIds(bindingFor("joonggonara", category.id)),
  sites: Object.fromEntries(targetSites.map((site) => {
    const plan = planFor(site, category.id);
    return [site, {
      availability: plan.availability,
      selectable: plan.selectable === true,
      strategy: plan.strategy,
      resolved_category_id: plan.resolvedCategoryId || null,
      source_category_ids: sourceIds(bindingFor(site, category.id))
    }];
  }))
}));

const siteSummary = Object.fromEntries(targetSites.map((site) => {
  const plans = categories.map((category) => planFor(site, category.id));
  return [site, {
    official: plans.filter((plan) => plan.availability === "official").length,
    parent_fallback: plans.filter((plan) => plan.availability === "parent_fallback").length,
    unavailable: plans.filter((plan) => plan.availability === "unavailable").length,
    selectable: plans.filter((plan) => plan.selectable === true).length
  }];
}));

const report = {
  status: "recorded",
  generated_at: new Date().toISOString(),
  policy_version: "joongna-primary-v1",
  canonical_basis: {
    site: "joonggonara",
    primary_category_count: primaryCategories.length,
    primary_categories: primaryCategories.map((category) => ({
      id: category.id,
      label: category.label,
      source_category_ids: sourceIds(bindingFor("joonggonara", category.id))
    })),
    excluded_source_ids: ["18"],
    excluded_source_id_reason: "중고나라 메뉴와 실제 검색 결과에서 확인되지 않은 ID는 임의로 추가하지 않음"
  },
  classification_rules: [
    "canonical ID와 화면 이름은 중고나라 21개 1차 카테고리를 기준으로 고정한다.",
    "다른 사이트의 공식 카테고리 ID가 확인되면 해당 canonical 카테고리에 매핑한다.",
    "여러 공식 ID가 하나의 canonical 카테고리를 구성하면 aggregate_exact로 합산한다.",
    "부모 카테고리만 확인된 자식은 parent_fallback으로 기록하되 selectable=false로 둔다.",
    "공식 카테고리 경로가 없는 사이트는 키워드 검색은 별도로 허용할 수 있지만 category mode에는 통합하지 않는다.",
    "카테고리 요청은 선택된 모든 카테고리에 공식 경로가 있는 사이트만 호출한다."
  ],
  scope: {
    canonical_category_count: categories.length,
    primary_category_count: primaryCategories.length,
    target_sites: targetSites
  },
  site_summary: siteSummary,
  classification_matrix: classificationMatrix,
  verification_commands: [
    "npm run build",
    "npm run category:record",
    "npm run category:harness",
    "npm run category:live",
    "npm run category:matrix:live",
    "npm run browser:contract"
  ],
  verification_note: "실제 사이트 결과가 0건이어도 매핑 오류와 사이트 일시 장애를 구분해 warnings/errors로 기록한다."
};

const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const outputDir = resolve(root, "merge/result/harness/category-mapping");
await mkdir(outputDir, { recursive: true });
const outputPath = resolve(outputDir, `${stamp}.json`);
const latestPath = resolve(outputDir, "latest.json");
await writeFile(outputPath, JSON.stringify(report, null, 2), "utf8");
await writeFile(latestPath, JSON.stringify(report, null, 2), "utf8");

console.log(JSON.stringify({
  status: report.status,
  generated_at: report.generated_at,
  output_path: outputPath,
  latest_path: latestPath,
  primary_category_count: primaryCategories.length,
  canonical_category_count: categories.length,
  site_summary: siteSummary
}, null, 2));
