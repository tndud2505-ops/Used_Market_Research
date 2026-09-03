import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { statsChecksum, statsPublicationKey } from "../cloudflare/public-product-stats.mjs";
import { explicitSoldText } from "../market/logic/listing-lifecycle.mjs";
import { PcPartsLedger } from "./pc-parts-ledger.mjs";
import { pcStatsTraceability } from "./pc-stats-traceability.mjs";
import { SearchIndex } from "./search-index.mjs";

const SOLD_EVIDENCE_TYPES = new Set(["STRUCTURED_STATUS", "OFFICIAL_API", "EXPLICIT_TEXT"]);
const indexValue = String(process.env.RUNNER_INDEX_PATH || "").trim();
const publicationValue = String(process.env.PC_STATS_PUBLICATION_INPUT || "").trim();
const importUrlValue = String(process.env.D1_STATS_IMPORT_URL || "").trim();
const importToken = String(process.env.CLOUDFLARE_MANUAL_RUN_TOKEN || process.env.IMPORT_TOKEN || "").trim();

if (!indexValue) throw new Error("RUNNER_INDEX_PATH is required");
if (!publicationValue) throw new Error("PC_STATS_PUBLICATION_INPUT is required");
if (!importUrlValue) throw new Error("D1_STATS_IMPORT_URL is required");
if (!importToken) throw new Error("CLOUDFLARE_MANUAL_RUN_TOKEN or IMPORT_TOKEN is required");

const indexPath = path.resolve(indexValue);
const publicationPath = path.resolve(publicationValue);
const importUrl = new URL(importUrlValue);
if (importUrl.protocol !== "https:" || importUrl.username || importUrl.password
  || importUrl.pathname !== "/admin/import-product-stats") {
  throw new Error("D1_STATS_IMPORT_URL must be an HTTPS /admin/import-product-stats endpoint without credentials");
}
await stat(indexPath);
await stat(publicationPath);

const payload = JSON.parse(await readFile(publicationPath, "utf8"));
if (payload.merge_with_active === true) throw new Error("cross-version stats publication must not merge with active rows");
if (!Array.isArray(payload.rows) || payload.rows.length === 0) throw new Error("stats publication rows are empty");
if (payload.rows.length !== Number(payload.expected_row_count)) throw new Error("stats publication row count mismatch");

const keys = payload.rows.map(statsPublicationKey).sort();
const expectedKeys = Array.isArray(payload.expected_keys) ? [...payload.expected_keys].map(String).sort() : [];
if (new Set(keys).size !== keys.length) throw new Error("stats publication contains duplicate scope keys");
if (keys.length !== expectedKeys.length || keys.some((value, index) => value !== expectedKeys[index])) {
  throw new Error("stats publication scope manifest mismatch");
}
const checksum = await statsChecksum(payload.rows);
if (checksum !== String(payload.checksum || "")) throw new Error("stats publication checksum mismatch");

const index = new SearchIndex({ filePath: indexPath, backupDir: path.join(path.dirname(indexPath), "backups") });
const ledger = new PcPartsLedger({ db: index.db });
try {
  ledger.migrate();
  const activePipeline = ledger.getActivePipelineVersion();
  const versions = {
    normalization: Number(activePipeline?.normalization_version),
    parser: String(activePipeline?.parser_version || ""),
    rule: String(activePipeline?.rule_version || ""),
    filter: String(activePipeline?.filter_version || "")
  };
  if (!Number.isInteger(versions.normalization) || versions.normalization < 1
    || Number(payload.normalization_version) !== versions.normalization
    || payload.parser_version !== versions.parser
    || payload.rule_version !== versions.rule
    || payload.filter_version !== versions.filter) {
    throw new Error(`stats publication version does not match active pipeline: ${JSON.stringify(versions)}`);
  }

  let nonEmptyScopeCount = 0;
  for (const row of payload.rows) {
    if (Number(row.days) !== 30) throw new Error("stats publication contains a non-30-day scope");
    if (row.as_of !== payload.created_at) throw new Error("stats publication as_of values are inconsistent");
    const stats = typeof row.stats_json === "string" ? JSON.parse(row.stats_json) : row.stats_json;
    if (stats?.versions?.normalization !== versions.normalization
      || stats?.versions?.parser !== versions.parser
      || stats?.versions?.rule !== versions.rule
      || stats?.versions?.filter !== versions.filter) {
      throw new Error(`stats row contains a mixed pipeline version: ${statsPublicationKey(row)}`);
    }
    const sampleCount = Number(stats?.active?.sample_count || 0)
      + Number(stats?.reserved?.sample_count || 0)
      + Number(stats?.sold?.sample_count || 0)
      + Number(stats?.confirmed_transactions?.sample_count || 0);
    if (sampleCount > 0) nonEmptyScopeCount += 1;
  }
  if (nonEmptyScopeCount !== Number(payload.expected_non_empty_scope_count)) {
    throw new Error("stats publication non-empty scope count mismatch");
  }

  const traceabilityMismatches = [];
  for (const row of payload.rows) {
    const stats = typeof row.stats_json === "string" ? JSON.parse(row.stats_json) : row.stats_json;
    const options = {
      canonicalProductId: row.canonical_product_id,
      marketPool: row.market_pool,
      condition: row.condition_code,
      currency: row.currency,
      days: 30,
      asOf: payload.created_at,
      normalizationVersion: versions.normalization,
      parserVersion: versions.parser,
      ruleVersion: versions.rule,
      filterVersion: versions.filter
    };
    const actualTraceability = pcStatsTraceability(ledger, options);
    if (actualTraceability.member_count !== Number(stats?.traceability?.member_count)
      || actualTraceability.member_checksum !== String(stats?.traceability?.member_checksum || "")) {
      traceabilityMismatches.push(statsPublicationKey(row));
    }
  }
  if (traceabilityMismatches.length > 0) {
    throw new Error(`stats publication traceability mismatch: ${traceabilityMismatches.length}`);
  }

  const poolOrCurrencyMismatches = Number(index.db.prepare(`SELECT COUNT(*) AS count
    FROM daily_price_stats d
    JOIN daily_price_stat_members m ON m.daily_price_stat_id = d.id AND m.included = 1
    JOIN listing_snapshots s ON s.id = m.snapshot_id
    JOIN listing_items i ON i.id = m.listing_item_id
    JOIN normalized_listings n ON n.id = i.normalized_listing_id
    WHERE d.normalization_version = ? AND d.parser_version = ? AND d.rule_version = ? AND d.filter_version = ?
      AND d.stat_date BETWEEN date(?, '-29 days') AND date(?)
      AND (d.canonical_product_id <> n.canonical_product_id OR d.market_pool <> n.market_pool
        OR d.condition_code <> n.condition_code OR d.currency <> s.currency)`)
    .get(versions.normalization, versions.parser, versions.rule, versions.filter,
      payload.created_at, payload.created_at)?.count || 0);
  if (poolOrCurrencyMismatches > 0) {
    throw new Error(`stats publication pool/currency member mismatch: ${poolOrCurrencyMismatches}`);
  }

  const integrity = ledger.runIntegrityAudit();
  if (integrity?.ok !== true) throw new Error("ledger integrity audit did not pass");

  const soldMembers = index.db.prepare(`SELECT d.id AS daily_price_stat_id, s.id AS snapshot_id,
      s.raw_listing_id, s.source_id, s.source_listing_id, s.observed_at, s.sold_last_ask_price,
      json_extract(s.status_evidence_json, '$.type') AS evidence_type,
      json_extract(s.status_evidence_json, '$.value') AS evidence_value
    FROM daily_price_stats d
    JOIN daily_price_stat_members m ON m.daily_price_stat_id = d.id AND m.included = 1
    JOIN listing_snapshots s ON s.id = m.snapshot_id
    WHERE d.metric_scope = 'SOLD'
      AND d.normalization_version = ? AND d.parser_version = ? AND d.rule_version = ? AND d.filter_version = ?
      AND d.stat_date BETWEEN date(?, '-29 days') AND date(?)`).all(
        versions.normalization, versions.parser, versions.rule, versions.filter,
        payload.created_at, payload.created_at
      );
  if (soldMembers.length === 0) throw new Error("stats publication contains no SOLD members");
  const firstSold = index.db.prepare(`SELECT id FROM listing_snapshots
    WHERE source_id = ? AND source_listing_id = ? AND lifecycle_status = 'SOLD'
    ORDER BY observed_at, id LIMIT 1`);
  const invalidEvidence = soldMembers.filter((row) => !SOLD_EVIDENCE_TYPES.has(String(row.evidence_type || "").toUpperCase())
    || !explicitSoldText(String(row.evidence_value || "").replace(/[_-]+/gu, " ")));
  const missingLastAsk = soldMembers.filter((row) => !(Number(row.sold_last_ask_price) > 0));
  const nonFirstSold = soldMembers.filter((row) => Number(firstSold.get(
    row.source_id, row.source_listing_id
  )?.id) !== Number(row.snapshot_id));
  if (invalidEvidence.length > 0 || missingLastAsk.length > 0 || nonFirstSold.length > 0) {
    throw new Error(`SOLD member audit failed: ${JSON.stringify({
      invalid_evidence: invalidEvidence.length,
      missing_last_ask: missingLastAsk.length,
      non_first_sold: nonFirstSold.length
    })}`);
  }

  const response = await fetch(importUrl, {
    method: "POST",
    headers: {
      authorization: `Bearer ${importToken}`,
      "content-type": "application/json",
      accept: "application/json"
    },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(120_000)
  });
  const result = await response.json().catch(() => null);
  if (!response.ok || result?.ok !== true) {
    throw new Error(`D1 stats import failed with HTTP ${response.status}: ${JSON.stringify(result)}`);
  }
  const publication = result.publication;
  if (publication?.active !== true
    || publication?.publication_id !== payload.publication_id
    || publication?.checksum !== payload.checksum
    || Number(publication?.row_count) !== payload.rows.length
    || Number(publication?.input_row_count) !== payload.rows.length
    || Number(publication?.scope_key_count) !== payload.rows.length
    || Number(publication?.preserved_row_count) !== 0
    || publication?.merged_with_active !== false) {
    throw new Error(`D1 stats activation manifest mismatch: ${JSON.stringify(publication)}`);
  }

  const publishedAt = new Date().toISOString();
  ledger.recordPublicationSuccess({
    publicationId: publication.publication_id,
    checksum: publication.checksum,
    rowCount: publication.row_count,
    publishedAt
  });
  console.log(JSON.stringify({
    publication_id: publication.publication_id,
    checksum: publication.checksum,
    row_count: publication.row_count,
    non_empty_scope_count: nonEmptyScopeCount,
    sold_member_count: soldMembers.length,
    invalid_sold_evidence_count: invalidEvidence.length,
    missing_sold_last_ask_count: missingLastAsk.length,
    non_first_sold_member_count: nonFirstSold.length,
    traceability_mismatch_count: traceabilityMismatches.length,
    pool_currency_mismatch_count: poolOrCurrencyMismatches,
    integrity_blocker_count: 0,
    published_at: publishedAt
  }));
} finally {
  index.close();
}
