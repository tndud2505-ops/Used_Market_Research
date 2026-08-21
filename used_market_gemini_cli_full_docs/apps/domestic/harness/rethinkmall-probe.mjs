import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const root = resolve(new URL("..", import.meta.url).pathname.replace(/^\/(\w):/, "$1:"));
const args = process.argv.slice(2);
const mode = cleanCliArgument(valueOf("--mode") || "fixture");
const keyword = cleanCliArgument(valueOf("--keyword") || "RTX 5070");
const settleMs = Number(cleanCliArgument(valueOf("--settle-ms") || "3000"));
const module = await import(pathToFileURL(resolve(root, "dist/collector/logic/rethinkmallProbe.js")).href);

let result;
if (mode === "live") {
  result = await module.fetchRethinkMallSearch(keyword, { settleMs });
} else if (mode === "fixture") {
  const html = await readFile(resolve(root, "harness/fixtures/rethinkmall-search.html"), "utf8");
  result = module.buildRethinkMallProbeResult(keyword, html, "https://fixture.invalid/rethinkmall", "fixture");
} else {
  throw new Error(`Unsupported mode: ${mode}`);
}

const runId = `${new Date().toISOString().replace(/[:.]/g, "-")}__rethinkmall__${mode}`;
const outputDir = resolve(root, "merge/result/harness", runId);
await mkdir(outputDir, { recursive: true });
await writeFile(resolve(outputDir, "output.json"), JSON.stringify(result, null, 2), "utf8");

console.log(JSON.stringify({
  status: result.validation.status,
  source: result.source,
  keyword: result.keyword,
  extracted_count: result.validation.extracted_count,
  relevant_count: result.validation.relevant_count,
  relevance_rate: result.validation.relevance_rate,
  warnings: result.validation.warnings,
  errors: result.validation.errors,
  response_url: result.response_url,
  output_dir: outputDir,
  sample_items: result.items.slice(0, 5).map((item) => ({
    id: item.id,
    title: item.title,
    condition_grade: item.condition_grade,
    sale_price: item.sale_price,
    original_price: item.original_price,
    discount_rate: item.discount_rate,
    image_url: item.image_url,
    url: item.url
  }))
}, null, 2));

if (result.validation.status === "fail") process.exitCode = 1;

function valueOf(flag) {
  const index = args.indexOf(flag);
  return index >= 0 ? args[index + 1] : undefined;
}

function cleanCliArgument(value) {
  return String(value).replace(/\^/g, "");
}
