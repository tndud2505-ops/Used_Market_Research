import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const root = resolve(new URL("..", import.meta.url).pathname.replace(/^\/(\w):/, "$1:"));
const hello = await import(pathToFileURL(resolve(root, "dist/collector/logic/helloMarketProbe.js")).href);
const rethink = await import(pathToFileURL(resolve(root, "dist/collector/logic/rethinkmallProbe.js")).href);
const registry = await import(pathToFileURL(resolve(root, "dist/collector/logic/searchOnlySources.js")).href);
const classifier = await import(pathToFileURL(resolve(root, "dist/collector/logic/searchOnlyCategoryClassifier.js")).href);
const helloHtml = await readFile(resolve(root, "harness/fixtures/hello-market-search.html"), "utf8");
const rethinkHtml = await readFile(resolve(root, "harness/fixtures/rethinkmall-search.html"), "utf8");
const helloResult = hello.buildHelloMarketProbeResult("RTX 3070", helloHtml, "https://fixture.invalid/hello-market", "fixture");
const rethinkResult = rethink.buildRethinkMallProbeResult("RTX 5070", rethinkHtml, "https://fixture.invalid/rethinkmall", "fixture");
const helloPartialResult = hello.buildHelloMarketProbeResult("RTX 3070", helloHtml.replace("20개의 상품이 있습니다", "30개의 상품이 있습니다"), "https://fixture.invalid/hello-market", "fixture");
const helloMalformedUrlResult = hello.buildHelloMarketProbeResult(
  "RTX 3070",
  helloHtml.replace("/item/20001?viewLocation=search_result", "/item/20001?[object%20Object]"),
  "https://fixture.invalid/hello-market",
  "fixture"
);
const helloLazyImageResult = hello.buildHelloMarketProbeResult(
  "RTX 3070",
  helloHtml.replace(
    'src="https://ccimg.hellomarket.com/item/20001.jpg"',
    'src="https://ccimage.hellomarket.com/img/common/empty/image_placeholder.png" data-src="https://ccimg.hellomarket.com/item/20001.jpg"'
  ),
  "https://fixture.invalid/hello-market",
  "fixture"
);
const helloImageEnrichmentItems = Array.from({ length: 12 }, (_, index) => ({
  ...helloResult.items[0],
  id: `image-${index}`,
  url: `https://www.hellomarket.com/item/image-${index}`,
  image_url: ""
}));
let activeImageRequests = 0;
let maxActiveImageRequests = 0;
await hello.enrichHelloMarketImages(helloImageEnrichmentItems, {
  concurrency: 4,
  fetchImpl: async (url) => {
    activeImageRequests += 1;
    maxActiveImageRequests = Math.max(maxActiveImageRequests, activeImageRequests);
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 2));
    activeImageRequests -= 1;
    return {
      ok: true,
      async text() {
        const id = url.split("/").at(-1);
        return `<meta property="og:image" content="https://ccimg.hellomarket.com/item/${id}.jpg">`;
      }
    };
  }
});
const rethinkPartialResult = rethink.buildRethinkMallProbeResult("RTX 5070", rethinkHtml.replace("<strong>2</strong>", "<strong>4</strong>"), "https://fixture.invalid/rethinkmall", "fixture");
const lowRelevanceValidation = rethink.validateRethinkMallListings("RTX 5070", [
  { ...rethinkResult.items[0], title: "RTX 5070 그래픽카드", description: "RTX 5070" },
  { ...rethinkResult.items[1], id: "low-relevance-2", url: "https://web.rethinkmall.com/goods/low-relevance-2", title: "소파", description: "가구" },
  { ...rethinkResult.items[1], id: "low-relevance-3", url: "https://web.rethinkmall.com/goods/low-relevance-3", title: "책", description: "도서" }
]);
const registeredSources = registry.listSearchOnlySources();

const checks = {
  hello_items: helloResult.items.length === 2,
  hello_relevant_items: helloResult.validation.relevant_count === 2,
  hello_sold_detection: helloResult.validation.sold_count === 1,
  hello_unknown_status_is_explicit: helloResult.validation.unknown_relevant_count === 1 && helloResult.validation.warnings.includes("ACTIVE_STATUS_UNAVAILABLE"),
  hello_image_quality_is_explicit: helloResult.validation.image_unavailable_count === 0,
  hello_image_and_url: helloResult.items.every((item) => item.image_url && item.url.startsWith("https://www.hellomarket.com/item/")),
  hello_lazy_image_attribute: helloLazyImageResult.items[0]?.image_url === "https://ccimg.hellomarket.com/item/20001.jpg",
  hello_all_missing_images_are_enriched: helloImageEnrichmentItems.every((item) => item.image_url) && maxActiveImageRequests <= 4,
  hello_malformed_url_is_normalized: helloMalformedUrlResult.items[0]?.url === "https://www.hellomarket.com/item/20001",
  rethink_items: rethinkResult.items.length === 2,
  rethink_relevant_items: rethinkResult.validation.relevant_count === 1,
  rethink_price_fields: rethinkResult.items.every((item) => item.sale_price !== null && item.original_price !== null),
  rethink_image_and_url: rethinkResult.items.every((item) => item.image_url && item.url.startsWith("https://web.rethinkmall.com/goods/")),
  hello_category_metadata: helloResult.items.every((item) => item.canonical_category_id === "pc" && item.category_source === "listing_text"),
  rethink_category_metadata: rethinkResult.items.every((item) => item.canonical_category_id === "pc" && item.category_confidence !== "unknown"),
  category_summary_present: helloResult.category_summary.some((category) => category.canonical_category_id === "pc") && rethinkResult.category_summary.some((category) => category.canonical_category_id === "pc"),
  unknown_category_is_explicit: classifier.classifySearchOnlyListing({ title: "무관한 물품" }).category_confidence === "unknown",
  hello_partial_page_warn: helloPartialResult.validation.status === "warn" && helloPartialResult.validation.warnings.some((warning) => warning.startsWith("PARTIAL_RESULT_PAGE:")),
  rethink_partial_page_warn: rethinkPartialResult.validation.status === "warn" && rethinkPartialResult.validation.warnings.some((warning) => warning.startsWith("PARTIAL_RESULT_PAGE:")),
  rethink_low_relevance_warn: lowRelevanceValidation.status === "warn" && lowRelevanceValidation.warnings.includes("LOW_RELEVANCE_RATE"),
  classifier_matrix: [
    ["RTX 3070 그래픽카드", "pc"],
    ["아이폰 15 Pro", "mobile"],
    ["나이키 후드티", "fashion"],
    ["나이키 운동화", "sports"],
    ["스마트워치", "mobile"],
    ["소파 RTX 3070", null],
    ["페가수스 니혼오버록 L52-05 관리 잘된 기계", "tools"],
    ["하의 가봉 마네킹 피팅바디", "tools"],
    ["닌텐도 스위치", "games"],
    ["소파", "furniture"]
  ].every(([title, expected]) => classifier.classifySearchOnlyListing({ title }).canonical_category_id === expected),
  classifier_priority_regression: [
    ["\uC0E4\uB12C \uAC00\uBC29", "luxury"],
    ["\uB8E8\uC774\uBE44\uD1B5 \uC9C0\uAC11", "luxury"],
    ["\uB098\uC774\uD0A4 \uC6B4\uB3D9\uD654", "sports"],
    ["\uBB34\uB8CC\uB098\uB214 \uC758\uC790", "free_share"]
  ].every(([title, expected]) => classifier.classifySearchOnlyListing({ title }).canonical_category_id === expected),
  registry_is_main_search_integrated: registeredSources.length === 2 && registeredSources.every((source) => source.ui_registered === true && source.main_search_registered === true),
  registry_sources_are_feasible: registeredSources.some((source) => source.key === "hellomarket" && source.category_mode === "keyword_inferred") && registeredSources.some((source) => source.key === "rethinkmall" && source.classifiable_category_ids.includes("pc"))
};

const passed = Object.values(checks).every(Boolean);
console.log(JSON.stringify({ status: passed ? "passed" : "failed", checks }, null, 2));
if (!passed) process.exitCode = 1;
