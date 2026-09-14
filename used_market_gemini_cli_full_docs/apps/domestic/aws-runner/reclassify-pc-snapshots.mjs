import path from "node:path";
import { existsSync, mkdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";
import { PcPartsLedger } from "./pc-parts-ledger.mjs";
import { PcShadowPipeline } from "./pc-shadow-pipeline.mjs";
import { PC_PART_CATEGORY_CODES, danawaTargetsForCategory } from "../collector/logic/pc-specialist-targets.mjs";
import { PC_SOURCE_REGISTRY } from "../collector/logic/pc-source-registry.mjs";

const KNOWN_SOURCE_KEYS = new Set(PC_SOURCE_REGISTRY.map((source) => source.key));

function parseJson(value, fallback) {
  try { return JSON.parse(String(value ?? "")); } catch { return fallback; }
}

function option(argv, name) {
  const index = argv.indexOf(name);
  return index >= 0 ? argv[index + 1] : undefined;
}

function requiredOption(argv, name) {
  const value = String(option(argv, name) || "").trim();
  if (!value || value.startsWith("--")) throw new Error(`Missing required option: ${name}`);
  return value;
}

function createRecoveryBackup(db, filePath) {
  const backupDir = path.join(path.dirname(filePath), "backups");
  mkdirSync(backupDir, { recursive: true });
  const destination = path.join(backupDir,
    `search-index-pre-reclassification-${new Date().toISOString().replace(/[:.]/gu, "-")}.sqlite`);
  db.exec(`VACUUM INTO '${destination.replaceAll("'", "''")}'`);
  if (!existsSync(destination) || statSync(destination).size <= 0) {
    throw new Error("A non-empty recovery backup is required before reclassification");
  }
  return destination;
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
  const existingTargetCount = Number(ledger.db.prepare(`SELECT COUNT(*) AS value FROM normalized_listings
    WHERE normalization_version = ?`).get(versions.normalizationVersion)?.value || 0);
  const latestNormalization = ledger.db.prepare(`SELECT * FROM normalized_listings
    WHERE snapshot_id = ? ORDER BY normalization_version DESC, id DESC LIMIT 1`);
  const normalizationItems = ledger.db.prepare(`SELECT * FROM listing_items
    WHERE normalized_listing_id = ? ORDER BY item_index`);
  const preserveHistoricalNormalization = (snapshotId) => {
    const previous = latestNormalization.get(snapshotId);
    if (!previous) throw new Error(`HISTORICAL_SOURCE_NORMALIZATION_MISSING:${snapshotId}`);
    const historicalReason = "HISTORICAL_INACTIVE_SOURCE";
    return {
      normalizationVersion: versions.normalizationVersion,
      canonicalProductId: previous.canonical_product_id,
      canonicalDisplayName: previous.canonical_display_name,
      categoryCode: previous.category_code,
      marketSegment: previous.market_segment,
      listingType: previous.listing_type,
      conditionGroup: previous.condition_group,
      specGroupId: previous.spec_group_id,
      classificationConfidence: previous.classification_confidence,
      modelConfidence: previous.model_confidence,
      quantityConfidence: previous.quantity_confidence,
      priceScopeConfidence: previous.price_scope_confidence,
      statisticsEligible: false,
      statisticsExclusionReasons: [...new Set([
        ...parseJson(previous.statistics_exclusion_reasons_json, []), historicalReason
      ])],
      listingKind: previous.listing_kind,
      quantity: previous.quantity,
      priceScope: previous.price_scope,
      conditionCode: previous.condition_code,
      marketPool: previous.market_pool,
      exactProduct: previous.exact_product === 1,
      priceEligible: false,
      exclusionReasons: [...new Set([...parseJson(previous.exclusion_reasons_json, []), historicalReason])],
      confidence: parseJson(previous.confidence_json, {}),
      evidence: parseJson(previous.evidence_json, {}),
      items: normalizationItems.all(previous.id).map((item) => ({
        canonicalProductId: item.canonical_product_id,
        quantity: item.quantity,
        unitPrice: item.unit_price,
        totalPrice: item.total_price,
        spec: parseJson(item.spec_json, {})
      }))
    };
  };
  let afterId = 0;
  let scanned = 0;
  let eligible = 0;
  let inserted = 0;
  let skipped = 0;
  let historicalInactiveSource = 0;
  const motherboardAudit = {
    scanned: 0,
    exact_model_matches: {},
    exact_model_match_count: 0,
    unidentified_count: 0,
    variant_or_manufacturer_conflict_count: 0,
    accessory_or_bundle_blocked_count: 0,
    previous_facet_statistics_member_count: 0,
    next_facet_statistics_member_count: 0,
    next_exact_statistics_member_count: 0
  };

  while (scanned < limit) {
    const rows = readBatch.all(afterId, Math.min(batchSize, limit - scanned));
    if (rows.length === 0) break;
    for (const row of rows) {
      afterId = Number(row.snapshot_id);
      scanned += 1;
      if (existingTargetCount > 0 && alreadyInserted.get(row.snapshot_id, versions.normalizationVersion)) {
        skipped += 1;
        continue;
      }
      const item = snapshotItem(row);
      const result = KNOWN_SOURCE_KEYS.has(row.source_id)
        ? pipeline.normalizeItem(item, row.observed_at, versions, { reclassification: true })
        : { normalized: preserveHistoricalNormalization(row.snapshot_id) };
      const previous = latestNormalization.get(row.snapshot_id);
      const next = result.normalized;
      if (previous?.category_code === "MOTHERBOARD" || next.categoryCode === "MOTHERBOARD") {
        motherboardAudit.scanned += 1;
        const reasons = [...(next.statisticsExclusionReasons || []), ...(next.exclusionReasons || [])];
        const exactId = next.exactProduct === true && String(next.canonicalProductId || "").startsWith("motherboard:")
          ? next.canonicalProductId : null;
        if (exactId) {
          motherboardAudit.exact_model_matches[exactId] = (motherboardAudit.exact_model_matches[exactId] || 0) + 1;
          motherboardAudit.exact_model_match_count += 1;
        } else motherboardAudit.unidentified_count += 1;
        if (reasons.some((reason) => ["MANUFACTURER_CONFLICT", "EXACT_MODEL_REQUIRED"].includes(reason))) {
          motherboardAudit.variant_or_manufacturer_conflict_count += 1;
        }
        if (["ACCESSORY_ONLY", "COMPONENT_BUNDLE", "OPTION_AD", "FULL_SYSTEM"].includes(next.listingKind)) {
          motherboardAudit.accessory_or_bundle_blocked_count += 1;
        }
        if (previous?.statistics_eligible === 1 && String(previous.canonical_product_id || "").startsWith("motherboard:platform:")) {
          motherboardAudit.previous_facet_statistics_member_count += 1;
        }
        if (next.statisticsEligible === true && String(next.canonicalProductId || "").startsWith("motherboard:platform:")) {
          motherboardAudit.next_facet_statistics_member_count += 1;
        }
        if (next.statisticsEligible === true && exactId) motherboardAudit.next_exact_statistics_member_count += 1;
      }
      if (!KNOWN_SOURCE_KEYS.has(row.source_id)) historicalInactiveSource += 1;
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
    model_version: versions.modelVersion || null,
    scanned,
    eligible,
    inserted,
    skipped,
    historical_inactive_source: historicalInactiveSource,
    motherboard_dry_run: motherboardAudit
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
    filterVersion: requiredOption(argv, "--filter-version"),
    modelVersion: requiredOption(argv, "--model-version")
  };
  if (!/^pc-master-v[0-9]+(?:-[a-z0-9-]+)?$/iu.test(versions.modelVersion)) {
    throw new Error("--model-version must be a scoped pc-master version label");
  }
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

  const db = new DatabaseSync(filePath);
  const ledger = new PcPartsLedger({ db });
  try {
    const backup = createRecoveryBackup(db, filePath);
    ledger.migrate();
    const pipeline = new PcShadowPipeline({ ledger });
    db.exec("BEGIN IMMEDIATE");
    try {
      const result = reclassifyPcSnapshots({ ledger, pipeline, versions, versionKey, apply: true, limit });
      const audit = ledger.runIntegrityAudit();
      db.exec("COMMIT");
      console.log(JSON.stringify({ ...result, backup, integrity_audit: audit }, null, 2));
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
  } finally {
    db.close();
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  main(process.argv.slice(2)).catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
