import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const root = resolve(new URL("..", import.meta.url).pathname.replace(/^\/(\w):/, "$1:"));
const args = process.argv.slice(2);
const mode = cleanCliArgument(valueOf("--mode") || "fixture");
const keyword = cleanCliArgument(valueOf("--keyword") || "RTX 3070");
const settleMs = Number(cleanCliArgument(valueOf("--settle-ms") || "1500"));
const module = await import(pathToFileURL(resolve(root, "dist/collector/logic/helloMarketProbe.js")).href);

let result;
if (mode === "live") {
  result = await module.fetchHelloMarketSearch(keyword, { settleMs });
} else if (mode === "fixture") {
  const html = await readFile(resolve(root, "harness/fixtures/hello-market-search.html"), "utf8");
  result = module.buildHelloMarketProbeResult(keyword, html, "https://fixture.invalid/hello-market", "fixture");
} else {
  throw new Error(`Unsupported mode: ${mode}`);
}

const runId = `${new Date().toISOString().replace(/[:.]/g, "-")}__hello-market__${mode}`;
const outputDir = resolve(root, "merge/result/harness", runId);
await mkdir(outputDir, { recursive: true });
await writeFile(resolve(outputDir, "output.json"), JSON.stringify(result, null, 2), "utf8");

console.log(JSON.stringify({
  status: result.validation.status,
  source: result.source,
  keyword: result.keyword,
  extracted_count: result.validation.extracted_count,
  relevant_count: result.validation.relevant_count,
  active_relevant_count: result.validation.active_relevant_count,
  sold_count: result.validation.sold_count,
  relevance_rate: result.validation.relevance_rate,
  warnings: result.validation.warnings,
  errors: result.validation.errors,
  response_url: result.response_url,
  output_dir: outputDir,
  sample_items: result.items.slice(0, 5)
}, null, 2));

if (result.validation.status === "fail") process.exitCode = 1;

function valueOf(flag) {
  const index = args.indexOf(flag);
  return index >= 0 ? args[index + 1] : undefined;
}

function cleanCliArgument(value) {
  return String(value).replace(/\^/g, "");
}
