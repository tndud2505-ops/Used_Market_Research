import { randomUUID } from "node:crypto";
import path from "node:path";

import { compactStatsForPublication, statsChecksum, statsPublicationKey } from "../cloudflare/public-product-stats.mjs";
import { PC_DIRECTORY_PUBLICATION_SOURCE_KEYS } from "../collector/logic/pc-source-registry.mjs";
import { PcPartsLedger } from "./pc-parts-ledger.mjs";
import { evaluatePipelineQualityReports, loadPipelineQualityReports } from "./pc-pipeline-governance.mjs";
import { SearchIndex } from "./search-index.mjs";
import { storeCompletedPricePublication, storedPricePublicationKey } from './pc-stored-price-publication.mjs';
import { fullPublicationScopes, assertFullPublicationActivation } from './pc-publication-scopes.mjs';
import { pcStatsTraceability } from './pc-stats-traceability.mjs';
import { publishStatsInChunks, readActiveStatsScopes } from './pc-stats-publication-client.mjs';

const indexValue = String(process.env.RUNNER_INDEX_PATH || "").trim();
const importUrlValue = String(process.env.D1_STATS_IMPORT_URL || "").trim();
const importToken = String(process.env.CLOUDFLARE_MANUAL_RUN_TOKEN || process.env.IMPORT_TOKEN || "").trim();
const publicationTimeoutMs = Math.min(15 * 60 * 1000, Math.max(2 * 60 * 1000,
  Number.parseInt(process.env.PC_STATS_PUBLICATION_TIMEOUT_MS || String(15 * 60 * 1000), 10)
    || 15 * 60 * 1000));
const aliasPromotionEvidence = (() => {
  const raw = String(process.env.PC_ALIAS_PROMOTION_EVIDENCE_JSON || "").trim();
  if (!raw) return {};
  try {
    const value = JSON.parse(raw);
    return value && typeof value === "object" && !Array.isArray(value) ? value : {};
  } catch {
    throw new Error("PC_ALIAS_PROMOTION_EVIDENCE_JSON_INVALID");
  }
})();
const pipelineQualityReportsPath = String(process.env.PC_PIPELINE_QUALITY_REPORTS_PATH || "").trim();
const statsProductIds = [...new Set(String(process.env.PC_STATS_PRODUCT_IDS || "")
  .split(",")
  .map((value) => value.trim())
  .filter(Boolean))].sort();
if (statsProductIds.length > 0) throw new Error('PC_STATS_PARTIAL_PUBLICATION_DISABLED: use the offline prepare/complete workflow');
const sampleDropAcknowledgement = (() => {
  const raw = String(process.env.PC_STATS_SAMPLE_DROP_ACKNOWLEDGEMENT_JSON || "").trim();
  if (!raw) return null;
  try {
    const value = JSON.parse(raw);
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error();
    return value;
  } catch {
    throw new Error("PC_STATS_SAMPLE_DROP_ACKNOWLEDGEMENT_JSON_INVALID");
  }
})();

if (!indexValue) throw new Error("RUNNER_INDEX_PATH is required");
if (!importUrlValue || !importToken) throw new Error("D1_STATS_PUBLICATION_NOT_CONFIGURED");
const importUrl = new URL(importUrlValue);
if (importUrl.protocol !== "https:" || importUrl.username || importUrl.password
  || importUrl.pathname !== "/admin/import-product-stats") {
  throw new Error("D1_STATS_IMPORT_URL must be an HTTPS /admin/import-product-stats endpoint without credentials");
}

const indexPath = path.resolve(indexValue);
const index = new SearchIndex({ filePath: indexPath, backupDir: path.join(path.dirname(indexPath), "backups") });
const ledger = new PcPartsLedger({ db: index.db });

try {
  ledger.migrate();
  const asOf = new Date().toISOString();
  const integrityAudit = ledger.runIntegrityAudit(asOf);
  if (integrityAudit.ok !== true) throw new Error('PC_STATS_LEDGER_INTEGRITY_FAILED');
  const aliasEvaluations = ledger.evaluateDueAliasShadows(asOf, aliasPromotionEvidence);
  const pipelineDecisions = evaluatePipelineQualityReports({
    ledger,
    reports: loadPipelineQualityReports(pipelineQualityReportsPath),
    evaluatedAt: asOf
  });
  const activePipelineVersion = ledger.getActivePipelineVersion();
  if (!activePipelineVersion) throw new Error('PC_STATS_ACTIVE_PIPELINE_REQUIRED');
  const versionOptions = activePipelineVersion ? {
    normalizationVersion: activePipelineVersion.normalization_version,
    parserVersion: activePipelineVersion.parser_version,
    ruleVersion: activePipelineVersion.rule_version,
    filterVersion: activePipelineVersion.filter_version
  } : {};
  const availableScopes = ledger.db.prepare(`SELECT DISTINCT n.canonical_product_id, n.market_pool,
      n.condition_code, s.currency
    FROM normalized_listings n
    JOIN listing_snapshots s ON s.id = n.snapshot_id
    WHERE n.canonical_product_id IS NOT NULL
      AND n.normalization_version = ?
      AND n.parser_version = ? AND n.rule_version = ? AND n.filter_version = ?
      AND s.source_id IN (${PC_DIRECTORY_PUBLICATION_SOURCE_KEYS.map(() => "?").join(", ")})
    ORDER BY n.canonical_product_id, n.market_pool, n.condition_code, s.currency`).all(
      Number(activePipelineVersion?.normalization_version || 1),
      versionOptions.parserVersion || "pc-parser-v1",
      versionOptions.ruleVersion || "pc-rules-v1",
      versionOptions.filterVersion || "pc-filter-v1",
      ...PC_DIRECTORY_PUBLICATION_SOURCE_KEYS
    );
  const externalActive = await readActiveStatsScopes({ importUrl, token: importToken });
  const scopes = fullPublicationScopes(ledger.db, availableScopes, { externalActive });
  const rows = [];
  for (const scope of scopes) {
    const options = {
      canonicalProductId: scope.canonical_product_id,
      days: 30,
      marketPool: scope.market_pool,
      condition: scope.condition_code,
      currency: scope.currency,
      asOf,
      sourceIds: PC_DIRECTORY_PUBLICATION_SOURCE_KEYS,
      ...versionOptions
    };
    const stats = compactStatsForPublication(ledger.rebuildAndGetPriceStats(options));
    const traceability = pcStatsTraceability(ledger, options);
    rows.push({
      canonical_product_id: scope.canonical_product_id,
      market_pool: scope.market_pool,
      condition_code: scope.condition_code,
      currency: scope.currency,
      days: 30,
      stats_json: { ...stats, traceability },
      as_of: asOf
    });
  }
  const nonEmptyScopeCount = rows.filter((row) => {
    const stats = row.stats_json || {};
    return Number(stats.active?.sample_count || 0) + Number(stats.reserved?.sample_count || 0)
      + Number(stats.sold?.sample_count || 0) + Number(stats.confirmed_transactions?.sample_count || 0) > 0;
  }).length;
  if (nonEmptyScopeCount === 0) throw new Error("STATS_PUBLICATION_HAS_NO_SAMPLES");
  const publication = {
    publication_id: randomUUID(),
    checksum: await statsChecksum(rows),
    expected_row_count: rows.length,
    merge_with_active: false,
    normalization_version: Number(activePipelineVersion?.normalization_version || 1),
    parser_version: versionOptions.parserVersion || "pc-parser-v1",
    rule_version: versionOptions.ruleVersion || "pc-rules-v1",
    filter_version: versionOptions.filterVersion || "pc-filter-v1",
    created_at: asOf,
    expected_non_empty_scope_count: nonEmptyScopeCount,
    expected_keys: rows.map(statsPublicationKey).sort(),
    expected_previous_publication: { publication_id: externalActive.publication_id, checksum: externalActive.checksum },
    rows,
    ...(sampleDropAcknowledgement ? { sample_drop_acknowledgement: sampleDropAcknowledgement } : {})
  };
  const publicationBody = JSON.stringify(publication);
  if (JSON.stringify(ledger.getActivePipelineVersion()) !== JSON.stringify(activePipelineVersion)) {
    throw new Error('PC_STATS_PIPELINE_CHANGED_DURING_PREPARATION');
  }
  storeCompletedPricePublication(ledger.db, {
    publicationId: publication.publication_id, rows, expectedRowCount: rows.length,
    expectedKeys: rows.map(storedPricePublicationKey), allowedSourceIds: PC_DIRECTORY_PUBLICATION_SOURCE_KEYS,
    validateOnly: true
  });
  console.error(JSON.stringify({
    phase: "prepared",
    publication_id: publication.publication_id,
    row_count: rows.length,
    non_empty_scope_count: nonEmptyScopeCount,
    product_ids: statsProductIds,
    body_bytes: Buffer.byteLength(publicationBody)
  }));
  const activated = await publishStatsInChunks({
    importUrl,
    token: importToken,
    publication,
    timeoutMs: publicationTimeoutMs,
    onProgress: ({ staged, total }) => {
      if (staged === total || staged % 10 === 0) console.error(JSON.stringify({ phase: "staging", staged, total }));
    }
  });
  assertFullPublicationActivation(publication, activated);
  const publishedAt = new Date().toISOString();
  const localPublication = storeCompletedPricePublication(ledger.db, {
    publicationId: activated.publication_id, rows, expectedRowCount: rows.length,
    expectedKeys: rows.map(storedPricePublicationKey), publishedAt,
    allowedSourceIds: PC_DIRECTORY_PUBLICATION_SOURCE_KEYS
  });
  ledger.recordPublicationSuccess({
    publicationId: activated.publication_id,
    checksum: activated.checksum,
    rowCount: Number(activated.row_count),
    publishedAt
  });
  console.log(JSON.stringify({
    published: true,
    local_publication: localPublication,
    row_count: Number(activated.row_count),
    input_row_count: rows.length,
    preserved_row_count: Number(activated.preserved_row_count || 0),
    overwritten_row_count: Number(activated.overwritten_row_count || 0),
    checksum: activated.checksum,
    publication_id: activated.publication_id,
    published_at: publishedAt,
    integrity_audit: integrityAudit,
    alias_evaluations: aliasEvaluations,
    pipeline_decisions: pipelineDecisions
  }));
} finally {
  index.close();
}
