import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const root = resolve(new URL("..", import.meta.url).pathname.replace(/^\/(\w):/, "$1:"));
const args = process.argv.slice(2);
const mode = valueOf("--mode") || "live";
const keywords = readKeywords(cleanCliArgument(valueOf("--keywords") || ""));
const settleMs = Number(valueOf("--settle-ms") || (mode === "live" ? "1800" : "0"));
const helloMarket = await import(pathToFileURL(resolve(root, "dist/collector/logic/helloMarketProbe.js")).href);
const rethinkMall = await import(pathToFileURL(resolve(root, "dist/collector/logic/rethinkmallProbe.js")).href);

const results = [];
for (const keyword of keywords) {
  results.push(await runSource("hellomarket", keyword, helloMarket));
  results.push(await runSource("rethinkmall", keyword, rethinkMall));
}

const runId = `${new Date().toISOString().replace(/[:.]/g, "-")}__multi-source__${mode}`;
const outputDir = resolve(root, "merge/result/harness", runId);
await mkdir(outputDir, { recursive: true });
const report = {
  source_scope: ["hellomarket", "rethinkmall"],
  mode,
  keywords,
  generated_at: new Date().toISOString(),
  results
};
await writeFile(resolve(outputDir, "output.json"), JSON.stringify(report, null, 2), "utf8");

console.log(JSON.stringify({
  status: results.some((result) => result.status === "error") ? "completed_with_errors" : "completed",
  mode,
  keywords,
  results: results.map((result) => ({
    source: result.source,
    keyword: result.keyword,
    status: result.status,
    extracted_count: result.validation?.extracted_count ?? 0,
    relevant_count: result.validation?.relevant_count ?? 0,
    relevance_rate: result.validation?.relevance_rate ?? 0,
    warnings: result.validation?.warnings ?? [],
    errors: result.validation?.errors ?? [],
    error: result.error ?? null
  })),
  output_dir: outputDir
}, null, 2));

async function runSource(source, keyword, module) {
  try {
    if (mode === "live") {
      const result = source === "hellomarket"
        ? await module.fetchHelloMarketSearch(keyword, { settleMs })
        : await module.fetchRethinkMallSearch(keyword, { settleMs });
      return compactResult(source, keyword, result);
    }

    const fixtureName = source === "hellomarket"
      ? "hello-market-search.html"
      : "rethinkmall-search.html";
    const fixturePath = resolve(root, "harness/fixtures", fixtureName);
    const html = await readFile(fixturePath, "utf8");
    const result = source === "hellomarket"
      ? module.buildHelloMarketProbeResult(keyword, html, `https://fixture.invalid/${source}`, "fixture")
      : module.buildRethinkMallProbeResult(keyword, html, `https://fixture.invalid/${source}`, "fixture");
    return compactResult(source, keyword, result);
  } catch (error) {
    return {
      source,
      keyword,
      status: "error",
      error: error instanceof Error ? error.message : String(error)
    };
  }
}

function compactResult(source, keyword, result) {
  return {
    source,
    keyword,
    status: result.validation.status,
    validation: result.validation,
    response_url: result.response_url,
    reported_count: result.reported_count,
    items: result.items,
    relevant_items: result.relevant_items
  };
}

function readKeywords(value) {
  const parsed = value
    ? value.split(",").map((item) => cleanCliArgument(item).trim()).filter(Boolean)
    : ["RTX 3070", "아이폰 15", "에어팟 프로", "닌텐도 스위치", "캠핑 의자", "여성 바지"];
  return [...new Set(parsed)].slice(0, 10);
}

function valueOf(flag) {
  const index = args.indexOf(flag);
  return index >= 0 ? args[index + 1] : undefined;
}

function cleanCliArgument(value) {
  return String(value).replace(/\^/g, "");
}
