import { randomUUID } from "node:crypto";
import { readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { compactStatsForPublication, statsChecksum, statsPublicationKey } from "../cloudflare/public-product-stats.mjs";
import { PcPartsLedger } from "./pc-parts-ledger.mjs";
import { pcStatsTraceability } from "./pc-stats-traceability.mjs";
import { SearchIndex } from "./search-index.mjs";

const indexValue = String(process.env.RUNNER_INDEX_PATH || "").trim();
const inputValue = String(process.env.PC_STATS_PUBLICATION_INPUT || "").trim();
const outputValue = String(process.env.PC_STATS_PUBLICATION_OUTPUT || "").trim();
if (!indexValue) throw new Error("RUNNER_INDEX_PATH is required");
if (!inputValue) throw new Error("PC_STATS_PUBLICATION_INPUT is required");
if (!outputValue) throw new Error("PC_STATS_PUBLICATION_OUTPUT is required");

const indexPath = path.resolve(indexValue);
const inputPath = path.resolve(inputValue);
const outputPath = path.resolve(outputValue);
if (inputPath === outputPath) throw new Error("PC_STATS_PUBLICATION_OUTPUT must differ from input");
await stat(indexPath);
await stat(inputPath);

let activeManifestText = "";
for await (const chunk of process.stdin) activeManifestText += chunk;
const activeManifestResult = JSON.parse(activeManifestText);
const queryResult = Array.isArray(activeManifestResult) ? activeManifestResult[0] : activeManifestResult;
if (queryResult?.success !== true || !Array.isArray(queryResult.results)) {
  throw new Error("active D1 scope query did not return a successful result set");
}
const activeRows = queryResult.results.map((row) => ({
  canonical_product_id: String(row.canonical_product_id || ""),
  market_pool: String(row.market_pool || ""),
  condition_code: String(row.condition_code || ""),
  currency: String(row.currency || ""),
  days: Number(row.days)
}));
if (activeRows.some((row) => !row.canonical_product_id || !row.market_pool || !row.condition_code
  || !row.currency || row.days !== 30)) {
  throw new Error("active D1 scope query contains an invalid scope key");
}
const activeKeys = activeRows.map(statsPublicationKey);
if (new Set(activeKeys).size !== activeKeys.length) throw new Error("active D1 scope query contains duplicate keys");

const input = JSON.parse(await readFile(inputPath, "utf8"));
if (input.merge_with_active === true) throw new Error("cross-version stats publication must not merge with active rows");
if (!Array.isArray(input.rows) || input.rows.length !== Number(input.expected_row_count)) {
  throw new Error("input publication row manifest is invalid");
}
if (await statsChecksum(input.rows) !== String(input.checksum || "")) {
  throw new Error("input publication checksum mismatch");
}

const index = new SearchIndex({ filePath: indexPath, backupDir: path.join(path.dirname(indexPath), "backups") });
const ledger = new PcPartsLedger({ db: index.db });
try {
  ledger.migrate();
  const activePipeline = ledger.getActivePipelineVersion();
  const versionOptions = {
    normalizationVersion: Number(activePipeline?.normalization_version),
    parserVersion: String(activePipeline?.parser_version || ""),
    ruleVersion: String(activePipeline?.rule_version || ""),
    filterVersion: String(activePipeline?.filter_version || "")
  };
  if (!Number.isInteger(versionOptions.normalizationVersion) || versionOptions.normalizationVersion < 1
    || Number(input.normalization_version) !== versionOptions.normalizationVersion
    || input.parser_version !== versionOptions.parserVersion
    || input.rule_version !== versionOptions.ruleVersion
    || input.filter_version !== versionOptions.filterVersion) {
    throw new Error("input publication does not match the active pipeline");
  }

  const rows = [...input.rows];
  const currentKeys = new Set(rows.map(statsPublicationKey));
  const missingRows = activeRows.filter((row) => !currentKeys.has(statsPublicationKey(row)));
  for (const scope of missingRows) {
    const options = {
      canonicalProductId: scope.canonical_product_id,
      marketPool: scope.market_pool,
      condition: scope.condition_code,
      currency: scope.currency,
      days: 30,
      asOf: input.created_at,
      ...versionOptions
    };
    const stats = compactStatsForPublication(ledger.rebuildAndGetPriceStats(options));
    rows.push({
      ...scope,
      stats_json: {
        ...stats,
        traceability: pcStatsTraceability(ledger, options)
      },
      as_of: input.created_at
    });
  }

  const finalKeys = rows.map(statsPublicationKey).sort();
  if (new Set(finalKeys).size !== finalKeys.length) throw new Error("completed publication contains duplicate keys");
  if (activeKeys.some((key) => !finalKeys.includes(key))) throw new Error("completed publication still omits an active scope key");
  const nonEmptyScopeCount = rows.filter((row) => {
    const stats = typeof row.stats_json === "string" ? JSON.parse(row.stats_json) : row.stats_json;
    return Number(stats?.active?.sample_count || 0) + Number(stats?.reserved?.sample_count || 0) + Number(stats?.sold?.sample_count || 0)
      + Number(stats?.confirmed_transactions?.sample_count || 0) > 0;
  }).length;
  const payload = {
    publication_id: randomUUID(),
    checksum: await statsChecksum(rows),
    expected_row_count: rows.length,
    expected_non_empty_scope_count: nonEmptyScopeCount,
    expected_keys: finalKeys,
    normalization_version: versionOptions.normalizationVersion,
    parser_version: versionOptions.parserVersion,
    rule_version: versionOptions.ruleVersion,
    filter_version: versionOptions.filterVersion,
    created_at: input.created_at,
    rows
  };
  await writeFile(outputPath, `${JSON.stringify(payload)}\n`, { encoding: "utf8", flag: "wx" });
  console.log(JSON.stringify({
    publication_id: payload.publication_id,
    checksum: payload.checksum,
    input_row_count: input.rows.length,
    active_scope_count: activeRows.length,
    added_scope_count: missingRows.length,
    row_count: rows.length,
    non_empty_scope_count: nonEmptyScopeCount,
    output_path: outputPath
  }));
} finally {
  index.close();
}
