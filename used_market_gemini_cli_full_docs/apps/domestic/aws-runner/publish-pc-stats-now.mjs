import { randomUUID } from "node:crypto";
import { stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { compactStatsForPublication, statsChecksum, statsPublicationKey } from "../cloudflare/public-product-stats.mjs";
import { PcPartsLedger } from "./pc-parts-ledger.mjs";
import { pcStatsTraceability } from "./pc-stats-traceability.mjs";
import { SearchIndex } from "./search-index.mjs";

const indexPath = path.resolve(String(process.env.RUNNER_INDEX_PATH || "").trim());
const outputPath = path.resolve(String(process.env.PC_STATS_PUBLICATION_OUTPUT || "").trim());
const asOf = String(process.env.PC_STATS_AS_OF || new Date().toISOString()).trim();

if (!String(process.env.RUNNER_INDEX_PATH || "").trim()) {
  throw new Error("RUNNER_INDEX_PATH is required so an empty ledger cannot be published by mistake");
}
if (!String(process.env.PC_STATS_PUBLICATION_OUTPUT || "").trim()) {
  throw new Error("PC_STATS_PUBLICATION_OUTPUT is required");
}
if (!Number.isFinite(Date.parse(asOf))) throw new Error("PC_STATS_AS_OF must be an ISO timestamp");
await stat(indexPath);

const index = new SearchIndex({ filePath: indexPath, backupDir: path.join(path.dirname(indexPath), "backups") });
const ledger = new PcPartsLedger({ db: index.db });

try {
  ledger.migrate();
  index.createBackup();
  const activePipelineVersion = ledger.getActivePipelineVersion();
  const versionOptions = {
    normalizationVersion: Number(activePipelineVersion?.normalization_version || 1),
    parserVersion: activePipelineVersion?.parser_version || "pc-parser-v1",
    ruleVersion: activePipelineVersion?.rule_version || "pc-rules-v1",
    filterVersion: activePipelineVersion?.filter_version || "pc-filter-v1"
  };
  const scopes = ledger.db.prepare(`SELECT DISTINCT n.canonical_product_id, n.market_pool,
      n.condition_code, s.currency
    FROM normalized_listings n
    JOIN listing_snapshots s ON s.id = n.snapshot_id
    WHERE n.canonical_product_id IS NOT NULL
      AND n.normalization_version = ?
      AND n.parser_version = ? AND n.rule_version = ? AND n.filter_version = ?
    ORDER BY n.canonical_product_id, n.market_pool, n.condition_code, s.currency`).all(
      versionOptions.normalizationVersion,
      versionOptions.parserVersion,
      versionOptions.ruleVersion,
      versionOptions.filterVersion
    );
  if (scopes.length === 0) throw new Error("STATS_PUBLICATION_HAS_NO_SCOPES");

  const rows = [];
  for (const scope of scopes) {
    const options = {
      canonicalProductId: scope.canonical_product_id,
      days: 30,
      marketPool: scope.market_pool,
      condition: scope.condition_code,
      currency: scope.currency,
      asOf,
      ...versionOptions
    };
    const stats = compactStatsForPublication(ledger.rebuildAndGetPriceStats(options));
    rows.push({
      canonical_product_id: scope.canonical_product_id,
      market_pool: scope.market_pool,
      condition_code: scope.condition_code,
      currency: scope.currency,
      days: 30,
      stats_json: {
        ...stats,
        traceability: pcStatsTraceability(ledger, options)
      },
      as_of: asOf
    });
  }

  const nonEmptyScopeCount = rows.filter((row) => {
    const stats = row.stats_json;
    return Number(stats.active?.sample_count || 0) + Number(stats.reserved?.sample_count || 0) + Number(stats.sold?.sample_count || 0)
      + Number(stats.confirmed_transactions?.sample_count || 0) > 0;
  }).length;
  if (nonEmptyScopeCount === 0) throw new Error("STATS_PUBLICATION_HAS_NO_SAMPLES");

  const checksum = await statsChecksum(rows);
  const payload = {
    publication_id: randomUUID(),
    checksum,
    expected_row_count: rows.length,
    expected_non_empty_scope_count: nonEmptyScopeCount,
    expected_keys: rows.map(statsPublicationKey).sort(),
    normalization_version: versionOptions.normalizationVersion,
    parser_version: versionOptions.parserVersion,
    rule_version: versionOptions.ruleVersion,
    filter_version: versionOptions.filterVersion,
    created_at: asOf,
    rows
  };
  await writeFile(outputPath, `${JSON.stringify(payload)}\n`, { encoding: "utf8", flag: "wx" });
  console.log(JSON.stringify({
    publication_id: payload.publication_id,
    checksum,
    row_count: rows.length,
    non_empty_scope_count: nonEmptyScopeCount,
    output_path: outputPath
  }));
} finally {
  index.close();
}
