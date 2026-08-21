import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const root = resolve(new URL("..", import.meta.url).pathname.replace(/^\/(\w):/, "$1:"));
const keywords = [
  "RTX 3070",
  "RTX 5070",
  "아이폰 15",
  "아이폰 16",
  "갤럭시 S24",
  "에어팟 프로",
  "닌텐도 스위치",
  "PS5",
  "맥북 프로",
  "RAM 16GB",
  "SSD 1TB",
  "캠핑 의자",
  "여성 바지",
  "남성 후드티",
  "나이키 운동화",
  "샤넬 가방",
  "다이슨 청소기",
  "소니 카메라",
  "레고",
  "자전거",
  "책상"
];
const sources = ["bunjang", "joonggonara", "hellomarket", "rethinkmall"];

const browserCollector = await import(pathToFileURL(resolve(root, "dist/collector/logic/browserCollector.js")).href);
const normalizeRaw = await import(pathToFileURL(resolve(root, "dist/collector/logic/normalize-raw.js")).href);
const helloMarket = await import(pathToFileURL(resolve(root, "dist/collector/logic/helloMarketProbe.js")).href);
const rethinkMall = await import(pathToFileURL(resolve(root, "dist/collector/logic/rethinkmallProbe.js")).href);

const results = [];
for (const keyword of keywords) {
  for (const source of sources) {
    results.push(await checkSearch(source, keyword));
  }
}

const sourceSummary = Object.fromEntries(sources.map((source) => {
  const rows = results.filter((result) => result.source === source);
  return [source, summarizeRows(rows)];
}));
const report = {
  mode: "live",
  generated_at: new Date().toISOString(),
  source_scope: sources,
  keyword_count: keywords.length,
  keywords,
  source_summary: sourceSummary,
  results
};
const runId = `${new Date().toISOString().replace(/[:.]/g, "-")}__general-search-matrix__live`;
const outputDir = resolve(root, "merge/result/harness", runId);
await mkdir(outputDir, { recursive: true });
await writeFile(resolve(outputDir, "output.json"), JSON.stringify(report, null, 2), "utf8");

console.log(JSON.stringify({
  status: results.some((result) => result.status === "fail") ? "completed_with_failures" : "completed",
  keyword_count: keywords.length,
  source_summary: sourceSummary,
  output_dir: outputDir
}, null, 2));

async function checkSearch(source, keyword) {
  try {
    if (source === "hellomarket" || source === "rethinkmall") {
      const probe = source === "hellomarket"
        ? await helloMarket.fetchHelloMarketSearch(keyword, { settleMs: 900 })
        : await rethinkMall.fetchRethinkMallSearch(keyword, { settleMs: 1200 });
      return {
        source,
        keyword,
        search_mode: "keyword_inferred",
        requested_url: probe.requested_url,
        response_url: probe.response_url,
        status: probe.validation.status === "fail" ? "fail" : probe.validation.status === "pass" ? "pass" : "warn",
        extracted_count: probe.validation.extracted_count,
        visible_count: probe.relevant_items.length,
        relevant_count: probe.validation.relevant_count,
        relevance_rate: probe.validation.relevance_rate,
        valid_item_rate: rate(probe.relevant_items.filter((item) => item.title && item.url && item.sale_price !== null).length, probe.relevant_items.length),
        valid_item_count: probe.relevant_items.filter((item) => item.title && item.url && item.sale_price !== null).length,
        image_rate: rate(probe.relevant_items.filter((item) => item.image_url).length, probe.relevant_items.length),
        image_count: probe.relevant_items.filter((item) => item.image_url).length,
        duplicate_count: probe.validation.duplicate_count,
        filtered_count: Math.max(0, probe.validation.extracted_count - probe.validation.relevant_count),
        warnings: probe.validation.warnings,
        errors: probe.validation.errors,
        sample_titles: probe.relevant_items.slice(0, 5).map((item) => item.title)
      };
    }

    const raw = await browserCollector.collectSearchListings({
      site: source,
      keyword,
      keywordIsExplicit: true,
      limit: 20
    });
    const normalized = normalizeRaw.normalizeRawResult(raw);
    const rawItems = Array.isArray(raw.items) ? raw.items : [];
    const normalizedItems = Array.isArray(normalized.items) ? normalized.items : [];
    const rawUrls = rawItems.map((item) => item.url).filter(Boolean);
    const duplicateCount = rawUrls.length - new Set(rawUrls).size;
    return {
      source,
      keyword,
      search_mode: "official_search",
      requested_url: null,
      response_url: rawItems[0]?.url ?? null,
      status: raw.errors.length > 0 ? "fail" : normalizedItems.length > 0 ? "pass" : "warn",
      extracted_count: raw.quality_meta.extracted_count,
      visible_count: normalizedItems.length,
      relevant_count: normalizedItems.length,
      relevance_rate: rate(normalizedItems.length, rawItems.length),
      valid_item_rate: rate(normalizedItems.filter((item) => item.title && item.url && item.price !== null).length, normalizedItems.length),
      valid_item_count: normalizedItems.filter((item) => item.title && item.url && item.price !== null).length,
      image_rate: rate(normalizedItems.filter((item) => item.image_url).length, normalizedItems.length),
      image_count: normalizedItems.filter((item) => item.image_url).length,
      duplicate_count: duplicateCount,
      filtered_count: normalized.quality_meta.filtered_count,
      warnings: normalized.warnings,
      errors: normalized.errors,
      sample_titles: normalizedItems.slice(0, 5).map((item) => item.title)
    };
  } catch (error) {
    return {
      source,
      keyword,
      search_mode: source === "hellomarket" || source === "rethinkmall" ? "keyword_inferred" : "official_search",
      requested_url: null,
      response_url: null,
      status: "fail",
      extracted_count: 0,
      visible_count: 0,
      relevant_count: 0,
      relevance_rate: 0,
      valid_item_rate: 0,
      valid_item_count: 0,
      image_rate: 0,
      image_count: 0,
      duplicate_count: 0,
      filtered_count: 0,
      warnings: [],
      errors: [error instanceof Error ? error.message : String(error)],
      sample_titles: []
    };
  }
}

function summarizeRows(rows) {
  const totalVisible = rows.reduce((sum, row) => sum + row.visible_count, 0);
  const totalExtracted = rows.reduce((sum, row) => sum + row.extracted_count, 0);
  const totalRelevant = rows.reduce((sum, row) => sum + row.relevant_count, 0);
  const totalValid = rows.reduce((sum, row) => sum + row.valid_item_count, 0);
  const totalImages = rows.reduce((sum, row) => sum + row.image_count, 0);
  return {
    checked_keywords: rows.length,
    with_results: rows.filter((row) => row.visible_count > 0).length,
    total_visible_items: totalVisible,
    weighted_relevance_rate: rate(totalRelevant, totalExtracted),
    weighted_valid_item_rate: rate(totalValid, totalVisible),
    weighted_image_rate: rate(totalImages, totalVisible),
    pass: rows.filter((row) => row.status === "pass").length,
    warn: rows.filter((row) => row.status === "warn").length,
    fail: rows.filter((row) => row.status === "fail").length,
    average_relevance_rate: average(rows.map((row) => row.relevance_rate)),
    average_valid_item_rate: average(rows.map((row) => row.valid_item_rate)),
    average_image_rate: average(rows.map((row) => row.image_rate)),
    total_duplicates: rows.reduce((sum, row) => sum + row.duplicate_count, 0),
    total_filtered: rows.reduce((sum, row) => sum + row.filtered_count, 0)
  };
}

function rate(numerator, denominator) {
  return denominator > 0 ? Number((numerator / denominator).toFixed(3)) : 0;
}

function average(values) {
  return values.length > 0 ? Number((values.reduce((sum, value) => sum + value, 0) / values.length).toFixed(3)) : 0;
}
