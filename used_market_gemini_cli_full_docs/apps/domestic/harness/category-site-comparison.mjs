import { mkdir, readFile, writeFile } from "node:fs/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, resolve } from "node:path";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const categoryCatalog = await import(pathToFileURL(resolve(root, "dist/market/logic/category-catalog.js")).href);
const browserCollector = await import(pathToFileURL(resolve(root, "dist/collector/logic/browserCollector.js")).href);
const siteCatalog = await import(pathToFileURL(resolve(root, "dist/collector/logic/sites/index.js")).href);
const helloMarketProbe = await import(pathToFileURL(resolve(root, "dist/collector/logic/helloMarketProbe.js")).href);
const rethinkMallProbe = await import(pathToFileURL(resolve(root, "dist/collector/logic/rethinkmallProbe.js")).href);

const CATEGORY_IDS = [
  "luxury",
  "fashion",
  "fashion_goods",
  "beauty",
  "kids",
  "mobile",
  "appliances",
  "pc",
  "camera",
  "furniture",
  "living",
  "games",
  "hobby",
  "books",
  "tickets",
  "sports",
  "travel",
  "vehicles",
  "motorcycle",
  "tools",
  "free_share"
];

const SOURCE_LABELS = {
  joonggonara: "중고나라",
  bunjang: "번개장터",
  hellomarket: "헬로마켓",
  rethinkmall: "리씽크몰"
};

const CSV_COLUMNS = [
  "category_id", "category_label", "joonggonara_source_ids", "joonggonara_mapping", "joonggonara_status", "joonggonara_visible_count", "joonggonara_match_rate", "bunjang_source_ids", "bunjang_mapping", "bunjang_status", "bunjang_visible_count", "bunjang_match_rate", "hellomarket_mode", "hellomarket_status", "hellomarket_visible_count", "hellomarket_relevant_count", "hellomarket_category_match_count", "hellomarket_category_match_rate", "rethinkmall_mode", "rethinkmall_status", "rethinkmall_visible_count", "rethinkmall_relevant_count", "rethinkmall_category_match_count", "rethinkmall_category_match_rate", "decision", "evidence_urls"
];

const categories = CATEGORY_IDS
  .map((id) => categoryCatalog.resolveCategory(id))
  .filter(Boolean);

const outputDir = resolve(root, "merge/result/harness/category-comparison");
await mkdir(outputDir, { recursive: true });
const cachePath = resolve(outputDir, "latest.json");
let rows;
let report;
if (process.env.CATEGORY_COMPARE_USE_CACHE === "1") {
  report = JSON.parse(await readFile(cachePath, "utf8"));
  rows = report.rows;
} else {
  rows = [];
  for (const category of categories) {
    const joonggonara = await collectOfficial("joonggonara", category);
    const bunjang = await collectOfficial("bunjang", category);
    const hellomarket = await collectKeyword("hellomarket", category);
    const rethinkmall = await collectKeyword("rethinkmall", category);
    rows.push({
      category_id: category.id,
      category_label: category.label,
      category_path: category.path,
      joonggonara,
      bunjang,
      hellomarket,
      rethinkmall,
      decision: decide(joonggonara, bunjang),
      evidence_urls: [joonggonara.requested_url, bunjang.requested_url, hellomarket.requested_url, rethinkmall.requested_url].filter(Boolean)
    });
  }
  report = {
    mode: "live_category_site_comparison",
    generated_at: new Date().toISOString(),
    policy: "중고나라 21개 상위 카테고리를 기준으로 공식 ID가 있는 사이트만 카테고리 통합. 헬로마켓·리씽크몰은 키워드 결과만 비교하고 카테고리 통합에서는 제외.",
    category_count: rows.length,
    category_ids: rows.map((row) => row.category_id),
    site_summary: Object.fromEntries(Object.keys(SOURCE_LABELS).map((source) => [source, summarize(rows, source)])),
    rows
  };
}
const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
await writeFile(resolve(outputDir, "latest.json"), JSON.stringify(report, null, 2), "utf8");
await writeFile(resolve(outputDir, `${timestamp}.json`), JSON.stringify(report, null, 2), "utf8");
await writeFile(resolve(outputDir, "latest.csv"), buildCsv(rows), "utf8");
await writeFile(resolve(outputDir, "latest.md"), buildMarkdown(report), "utf8");

console.log(JSON.stringify({
  status: "completed",
  output_dir: outputDir,
  category_count: rows.length,
  site_summary: report.site_summary
}, null, 2));

async function collectOfficial(source, category) {
  const plan = categoryCatalog.resolveCategoryCollectionPlan(source, category.id);
  const isOfficial = plan?.strategy === "source_category" && plan.resolvedCategoryId === category.id;
  const binding = isOfficial ? plan.binding : null;
  const sourceCategoryIds = binding?.sourceCategoryIds ?? [];
  const adapter = sourceCatalogAdapter(source);
  const requestedUrl = sourceCategoryIds[0] && adapter?.categoryUrl
    ? adapter.categoryUrl(sourceCategoryIds[0], 20)
    : null;

  if (!isOfficial) {
    return {
      source,
      mapping_status: "unavailable",
      mapping_label: "공식 매핑 없음",
      source_category_ids: [],
      source_category_paths: [],
      requested_url: null,
      response_url: null,
      actual_status: "excluded",
      extracted_count: 0,
      visible_count: 0,
      category_match_count: 0,
      category_match_rate: 0,
      warnings: ["NO_OFFICIAL_SOURCE_CATEGORY_MAPPING"],
      errors: []
    };
  }

  try {
    const result = await browserCollector.collectSearchListings({
      site: source,
      keyword: "",
      keywordIsExplicit: false,
      limit: 20,
      category
    });
    const items = Array.isArray(result.items) ? result.items : [];
    const matches = items.filter((item) => {
      const itemIds = new Set([
        ...(Array.isArray(item.source_category_ids) ? item.source_category_ids : []),
        item.source_category_id
      ].filter(Boolean).map(String));
      return sourceCategoryIds.some((id) => itemIds.has(String(id)));
    });
    const matchRate = items.length > 0 ? matches.length / items.length : 0;
    const warnings = Array.isArray(result.warnings) ? result.warnings : [];
    const errors = Array.isArray(result.errors) ? result.errors : [];
    return {
      source,
      mapping_status: "official",
      mapping_label: binding.confidence === "aggregate_exact" ? "공식 집계 매핑" : "공식 매핑",
      source_category_ids: sourceCategoryIds,
      source_category_paths: sourceCategoryIds.map((id) => binding.sourceCategoryPaths?.[id] ?? binding.sourceCategoryPath),
      requested_url: requestedUrl,
      response_url: requestedUrl,
      actual_status: errors.length > 0 ? "fail" : items.length > 0 && matchRate === 1 ? "pass" : "warn",
      extracted_count: result.quality_meta?.extracted_count ?? items.length,
      visible_count: items.length,
      category_match_count: matches.length,
      category_match_rate: roundRate(matchRate),
      warnings,
      errors
    };
  } catch (error) {
    return {
      source,
      mapping_status: "official",
      mapping_label: binding.confidence === "aggregate_exact" ? "공식 집계 매핑" : "공식 매핑",
      source_category_ids: sourceCategoryIds,
      source_category_paths: sourceCategoryIds.map((id) => binding.sourceCategoryPaths?.[id] ?? binding.sourceCategoryPath),
      requested_url: requestedUrl,
      response_url: null,
      actual_status: "fail",
      extracted_count: 0,
      visible_count: 0,
      category_match_count: 0,
      category_match_rate: 0,
      warnings: [],
      errors: [error instanceof Error ? error.message : String(error)]
    };
  }
}

async function collectKeyword(source, category) {
  try {
    const result = source === "hellomarket"
      ? await helloMarketProbe.fetchHelloMarketSearch(category.label, { settleMs: 1200 })
      : await rethinkMallProbe.fetchRethinkMallSearch(category.label, { settleMs: 1800 });
    const items = Array.isArray(result.items) ? result.items : [];
    const relevant = Array.isArray(result.relevant_items) ? result.relevant_items : [];
    const categoryMatches = relevant.filter((item) => item.canonical_category_id === category.id);
    const warnings = Array.isArray(result.validation?.warnings) ? result.validation.warnings : [];
    const errors = Array.isArray(result.validation?.errors) ? result.validation.errors : [];
    return {
      source,
      mapping_status: "keyword_only",
      mapping_label: "키워드 전용(통합 제외)",
      source_category_ids: [],
      source_category_paths: [],
      requested_url: result.requested_url ?? null,
      response_url: result.response_url ?? null,
      actual_status: result.validation?.status ?? (errors.length > 0 ? "fail" : "warn"),
      extracted_count: result.validation?.extracted_count ?? items.length,
      visible_count: items.length,
      relevant_count: relevant.length,
      category_match_count: categoryMatches.length,
      category_match_rate: roundRate(relevant.length > 0 ? categoryMatches.length / relevant.length : 0),
      relevance_rate: result.validation?.relevance_rate ?? 0,
      warnings,
      errors
    };
  } catch (error) {
    return {
      source,
      mapping_status: "keyword_only",
      mapping_label: "키워드 전용(통합 제외)",
      source_category_ids: [],
      source_category_paths: [],
      requested_url: null,
      response_url: null,
      actual_status: "fail",
      extracted_count: 0,
      visible_count: 0,
      relevant_count: 0,
      category_match_count: 0,
      category_match_rate: 0,
      relevance_rate: 0,
      warnings: [],
      errors: [error instanceof Error ? error.message : String(error)]
    };
  }
}

function sourceCatalogAdapter(source) {
  try {
    return siteCatalog.resolveBrowserSiteAdapter(source);
  } catch {
    return null;
  }
}

function decide(joonggonara, bunjang) {
  if (joonggonara.mapping_status === "official" && bunjang.mapping_status === "official") {
    return "중고나라+번개장터 공식 통합 가능";
  }
  if (joonggonara.mapping_status === "official") {
    return "중고나라 공식 기준 유지(번개장터 매핑 없음)";
  }
  return "공식 카테고리 통합 불가";
}

function roundRate(value) {
  return Number(Number(value || 0).toFixed(3));
}

function summarize(rows, source) {
  const entries = rows.map((row) => row[source]);
  return {
    official_mapping_count: entries.filter((entry) => entry.mapping_status === "official").length,
    keyword_only_count: entries.filter((entry) => entry.mapping_status === "keyword_only").length,
    unavailable_mapping_count: entries.filter((entry) => entry.mapping_status === "unavailable").length,
    actual_pass_count: entries.filter((entry) => entry.actual_status === "pass").length,
    actual_warn_count: entries.filter((entry) => entry.actual_status === "warn").length,
    actual_fail_count: entries.filter((entry) => entry.actual_status === "fail").length,
    actual_excluded_count: entries.filter((entry) => entry.actual_status === "excluded").length,
    with_visible_results: entries.filter((entry) => entry.visible_count > 0).length
  };
}

function buildMarkdown(report) {
  const lines = [
    "# 카테고리 매핑·실제 사이트 비교표",
    "",
    `생성 시각: ${report.generated_at}`,
    "",
    `검증 범위: 중고나라 상위 카테고리 ${report.category_count}개. 공식 ID가 있는 사이트는 카테고리 URL로 직접 검색하고, 헬로마켓·리씽크몰은 동일 명칭 키워드 검색 결과만 비교했습니다.`,
    "",
    "판정 기준: `공식 통합 가능`은 원본 사이트 카테고리 ID가 존재하고 실제 추출 상품의 원본 카테고리 ID가 요청 ID와 일치한 경우입니다. 키워드 결과는 상품이 나와도 공식 카테고리 매핑으로 승격하지 않습니다.",
    "",
    "## 사이트별 요약",
    "",
    "| 사이트 | 공식 매핑 | 키워드 전용 | 매핑 없음 | 실제 pass | 실제 warn/fail | 결과 상품 있음 |",
    "|---|---:|---:|---:|---:|---:|---:|",
    ...Object.entries(report.site_summary).map(([source, summary]) => `| ${SOURCE_LABELS[source]} | ${summary.official_mapping_count} | ${summary.keyword_only_count} | ${summary.unavailable_mapping_count} | ${summary.actual_pass_count} | ${summary.actual_warn_count + summary.actual_fail_count} | ${summary.with_visible_results} |`),
    "",
    "## 21개 기준 카테고리 비교",
    "",
    "| 기준 카테고리 | 중고나라 | 번개장터 | 헬로마켓 | 리씽크몰 | 최종 판정 |",
    "|---|---|---|---|---|---|",
    ...report.rows.map((row) => `| ${row.category_label} \`${row.category_id}\` | ${formatCell(row.joonggonara)} | ${formatCell(row.bunjang)} | ${formatCell(row.hellomarket)} | ${formatCell(row.rethinkmall)} | ${row.decision} |`),
    "",
    "## 해석",
    "",
    "- 중고나라: 21개 모두 공식 카테고리 ID로 직접 검색하는 기준 사이트입니다.",
    "- 번개장터: 공식 ID가 있는 항목만 중고나라와 통합합니다. 매핑이 없는 수입명품·레저/여행·중고차·무료나눔은 카테고리 모드에서 제외합니다.",
    "- 헬로마켓·리씽크몰: 실제 키워드 검색은 비교용으로 남기지만 공식 카테고리 ID가 확인되지 않아 카테고리 통합 대상에서 제외합니다.",
    "- 교차 확인 시 리씽크몰은 브라우저 화면 요약 수와 수집기 원자료 추출 수가 달라지는 현상이 있어 `warn`으로 남겼습니다. 공식 통합 대상이 아니므로 결과 혼입은 막지만, 향후 통합 전 추출기 점검이 필요합니다.",
    "",
    "원자료: `latest.json`, `latest.csv`"
  ];
  return `${lines.join("\n")}\n`;
}

function formatCell(entry) {
  const mapping = entry.mapping_label;
  const count = entry.visible_count;
  const rate = entry.mapping_status === "keyword_only"
    ? `관련 ${entry.relevant_count ?? 0}건 / 분류일치 ${entry.category_match_count}건`
    : `ID ${entry.source_category_ids.join(", ") || "-"} / ${entry.category_match_count}/${count}건`;
  const url = entry.requested_url ? `[검색](${entry.requested_url})` : "검색 경로 없음";
  return `${mapping}<br>${entry.actual_status}, ${rate}<br>${url}`;
}

function buildCsv(rows) {
  const lines = [CSV_COLUMNS.join(",")];
  for (const row of rows) {
    const values = [
      row.category_id,
      row.category_label,
      row.joonggonara.source_category_ids.join("|") ,
      row.joonggonara.mapping_label,
      row.joonggonara.actual_status,
      row.joonggonara.visible_count,
      row.joonggonara.category_match_rate,
      row.bunjang.source_category_ids.join("|"),
      row.bunjang.mapping_label,
      row.bunjang.actual_status,
      row.bunjang.visible_count,
      row.bunjang.category_match_rate,
      row.hellomarket.mapping_label,
      row.hellomarket.actual_status,
      row.hellomarket.visible_count,
      row.hellomarket.relevant_count ?? 0,
      row.hellomarket.category_match_count,
      row.hellomarket.category_match_rate,
      row.rethinkmall.mapping_label,
      row.rethinkmall.actual_status,
      row.rethinkmall.visible_count,
      row.rethinkmall.relevant_count ?? 0,
      row.rethinkmall.category_match_count,
      row.rethinkmall.category_match_rate,
      row.decision,
      row.evidence_urls.join(" ")
    ];
    lines.push(values.map(csvEscape).join(","));
  }
  return `${lines.join("\n")}\n`;
}

function csvEscape(value) {
  const text = String(value ?? "");
  return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}
