import path from "node:path";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";
import { SearchIndex } from "./search-index.mjs";
import { PcPartsLedger } from "./pc-parts-ledger.mjs";
import { PcShadowPipeline } from "./pc-shadow-pipeline.mjs";
import { PC_PART_CATEGORY_CODES, danawaTargetsForCategory } from "../collector/logic/pc-specialist-targets.mjs";

function option(argv, name) {
  const index = argv.indexOf(name);
  return index >= 0 ? argv[index + 1] : undefined;
}

function requiredOption(argv, name) {
  const value = String(option(argv, name) || "").trim();
  if (!value || value.startsWith("--")) throw new Error(`Missing required option: ${name}`);
  return value;
}

function danawaStructuredCategory(raw) {
  const explicitRequested = String(raw.requested_category_code || "").trim().toUpperCase();
  const explicitSource = String(raw.source_category_code || "").trim();
  if (explicitRequested && explicitSource) {
    return { requested_category_code: explicitRequested, source_category_code: explicitSource };
  }
  const candidateUrl = String(raw.url || raw.item_url || raw.href || "").replace(/&amp;/giu, "&");
  let parsed;
  try { parsed = new URL(candidateUrl, "https://dmall.danawa.com"); } catch { return {}; }
  const parent = parsed.searchParams.get("parentCategoryCode");
  const child = parsed.searchParams.get("childCategoryCode");
  if (!parent || !child) return {};
  const sourceCategoryCode = `${parent}:${child}`;
  const requestedCategoryCode = PC_PART_CATEGORY_CODES.find((categoryCode) => (
    danawaTargetsForCategory(categoryCode).some((target) => (
      `${target.parent_category_code}:${target.child_category_code}` === sourceCategoryCode
    ))
  ));
  return requestedCategoryCode
    ? { requested_category_code: requestedCategoryCode, source_category_code: sourceCategoryCode }
    : {};
}

function snapshotItem(row) {
  let raw = {};
  try {
    raw = JSON.parse(String(row.raw_json || "{}"));
  } catch {
    throw new Error(`Invalid raw_json for snapshot ${row.snapshot_id}`);
  }
  const structuredCategory = row.source_id === "danawa" ? danawaStructuredCategory(raw) : {};
  return {
    ...raw,
    ...structuredCategory,
    site: row.source_id,
    source_listing_id: row.source_listing_id,
    item_id: raw.item_id || raw.id || `${row.source_id}:${row.source_listing_id}`,
    title: row.title,
    description: row.description,
    price: row.price_value,
    currency: row.currency,
    lifecycle_status: row.lifecycle_status,
    availability: row.availability,
    transaction_price: row.transaction_price,
    raw_payload: raw
  };
}

function validateTarget(ledger, versions) {
  const normalizationVersion = Number(versions.normalizationVersion);
  if (!Number.isInteger(normalizationVersion) || normalizationVersion < 2) {
    throw new Error("--normalization-version must be an integer >= 2");
  }
  const maximum = Number(ledger.db.prepare("SELECT COALESCE(MAX(normalization_version), 0) AS value FROM normalized_listings").get()?.value || 0);
  if (maximum > normalizationVersion) {
    throw new Error(`Refusing to write older normalization version ${normalizationVersion}; current maximum is ${maximum}`);
  }
  const existing = ledger.db.prepare(`SELECT DISTINCT parser_version, rule_version, filter_version
    FROM normalized_listings WHERE normalization_version = ?`).all(normalizationVersion);
  if (existing.some((row) => row.parser_version !== versions.parserVersion
    || row.rule_version !== versions.ruleVersion
    || row.filter_version !== versions.filterVersion)) {
    throw new Error(`Normalization version ${normalizationVersion} already exists with different rule labels`);
  }
  if (versions.parserVersion === "pc-parser-v1"
    && versions.ruleVersion === "pc-rules-v1"
    && versions.filterVersion === "pc-filter-v1") {
    throw new Error("At least one parser/rule/filter label must advance from v1");
  }
}

export function reclassifyPcSnapshots({ ledger, pipeline, versions, versionKey = null, apply = false, batchSize = 250, limit = Infinity }) {
  validateTarget(ledger, versions);
  if (apply) {
    const active = ledger.getActivePipelineVersion();
    ledger.registerPipelineVersion({
      versionKey: versionKey || `pc-normalization-v${versions.normalizationVersion}`,
      ...versions,
      modelVersion: versions.modelVersion || active?.model_version || "pc-master-v1",
      previousVersionKey: active?.version_key
    });
  }
  const readBatch = ledger.db.prepare(`SELECT s.id AS snapshot_id, s.source_id, s.source_listing_id,
      s.observed_at, s.lifecycle_status, s.availability, s.price_value, s.currency, s.transaction_price,
      r.raw_json, r.title, r.description
    FROM listing_snapshots s
    JOIN raw_listings r ON r.id = s.raw_listing_id
    WHERE s.id > ? ORDER BY s.id LIMIT ?`);
  const alreadyInserted = ledger.db.prepare(`SELECT 1 AS present FROM normalized_listings
    WHERE snapshot_id = ? AND normalization_version = ?`);
  let afterId = 0;
  let scanned = 0;
  let eligible = 0;
  let inserted = 0;
  let skipped = 0;

  while (scanned < limit) {
    const rows = readBatch.all(afterId, Math.min(batchSize, limit - scanned));
    if (rows.length === 0) break;
    for (const row of rows) {
      afterId = Number(row.snapshot_id);
      scanned += 1;
      if (alreadyInserted.get(row.snapshot_id, versions.normalizationVersion)) {
        skipped += 1;
        continue;
      }
      const item = snapshotItem(row);
      const result = pipeline.normalizeItem(item, row.observed_at, versions);
      eligible += 1;
      if (apply) {
        ledger.insertNormalization(row.snapshot_id, result.normalized, row.price_value, row.currency, versions);
        inserted += 1;
      }
    }
  }
  return {
    mode: apply ? "apply" : "dry-run",
    version_key: versionKey || `pc-normalization-v${versions.normalizationVersion}`,
    normalization_version: versions.normalizationVersion,
    parser_version: versions.parserVersion,
    rule_version: versions.ruleVersion,
    filter_version: versions.filterVersion,
    scanned,
    eligible,
    inserted,
    skipped
  };
}

async function main(argv) {
  const filePath = path.resolve(requiredOption(argv, "--db"));
  if (!existsSync(filePath)) throw new Error(`SQLite file does not exist: ${filePath}`);
  const apply = argv.includes("--apply");
  if (apply && !argv.includes("--confirm-reclassification")) {
    throw new Error("Refusing to mutate without --confirm-reclassification");
  }
  const versions = {
    normalizationVersion: Number(requiredOption(argv, "--normalization-version")),
    parserVersion: requiredOption(argv, "--parser-version"),
    ruleVersion: requiredOption(argv, "--rule-version"),
    filterVersion: requiredOption(argv, "--filter-version")
  };
  const versionKey = String(option(argv, "--version-key") || `pc-normalization-v${versions.normalizationVersion}`).trim();
  if (!/^pc-normalization-v[0-9]+(?:-[a-z0-9-]+)?$/iu.test(versionKey)) {
    throw new Error("--version-key must be a scoped pc-normalization version key");
  }
  const limitValue = option(argv, "--limit");
  const limit = limitValue === undefined ? Infinity : Number(limitValue);
  if (!(limit === Infinity || (Number.isInteger(limit) && limit > 0))) throw new Error("--limit must be a positive integer");

  if (!apply) {
    const db = new DatabaseSync(filePath, { readOnly: true });
    try {
      const ledger = new PcPartsLedger({ db });
      const pipeline = new PcShadowPipeline({ ledger });
      const result = reclassifyPcSnapshots({ ledger, pipeline, versions, versionKey, limit });
      console.log(JSON.stringify(result, null, 2));
    } finally {
      db.close();
    }
    return;
  }

  const index = new SearchIndex({ filePath, backupDir: path.join(path.dirname(filePath), "backups") });
  try {
    const backup = index.createBackup();
    if (!backup) throw new Error("A recovery backup is required before reclassification");
    const ledger = new PcPartsLedger({ db: index.db });
    const pipeline = new PcShadowPipeline({ ledger });
    index.db.exec("BEGIN IMMEDIATE");
    try {
      const result = reclassifyPcSnapshots({ ledger, pipeline, versions, versionKey, apply: true, limit });
      const audit = ledger.runIntegrityAudit();
      index.db.exec("COMMIT");
      console.log(JSON.stringify({ ...result, backup, integrity_audit: audit }, null, 2));
    } catch (error) {
      index.db.exec("ROLLBACK");
      throw error;
    }
  } finally {
    index.close();
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  main(process.argv.slice(2)).catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
