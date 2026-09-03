import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";
import { SearchIndex } from "./search-index.mjs";
import { PcPartsLedger } from "./pc-parts-ledger.mjs";
import {
  assertPcProjectionApplyConfirmation,
  buildPcProjectionReconciliation,
  collectAuthoritativePcProjections,
  DEFAULT_PC_REPUBLISH_SOURCES,
  parsePcProjectionRepublishArguments,
  pcProjectionTombstone
} from "./pc-projection-republish-policy.mjs";

const IMPORT_BATCH_SIZE = 400;

function parseJson(value, fallback = {}) {
  try {
    const parsed = JSON.parse(String(value ?? ""));
    return parsed ?? fallback;
  } catch {
    return fallback;
  }
}

function productionUrl(value, label) {
  let parsed;
  try {
    parsed = new URL(String(value || ""));
  } catch {
    throw new Error(`${label} must be a valid URL`);
  }
  if (parsed.protocol !== "https:" || parsed.username || parsed.password) {
    throw new Error(`${label} must be an HTTPS URL without embedded credentials`);
  }
  parsed.hash = "";
  return parsed;
}

export function toPcProjectionImportItem(item) {
  return {
    item_id: item.item_id || item.id,
    site: item.site,
    category_id: item.category_id || "pc",
    title: item.title,
    search_text: item.search_text || item.title,
    price_value: item.price ?? item.price_value,
    currency: item.currency || "KRW",
    url: item.url,
    image_url: item.image_url || null,
    seller_name: item.seller_name || null,
    posted_at: item.posted_at || null,
    updated_at: item.updated_at || new Date().toISOString(),
    canonical_product_id: item.canonical_product_id || null,
    canonical_display_name: item.canonical_display_name || null,
    canonical_manufacturer: item.canonical_manufacturer || null,
    board_manufacturer: item.board_manufacturer || null,
    listing_kind: item.listing_kind || "UNKNOWN",
    pc_category_code: item.category_code || item.pc_category_code || null,
    quantity: item.quantity ?? null,
    price_scope: item.price_scope || "UNKNOWN",
    condition_code: item.condition_code || "UNKNOWN",
    lifecycle_status: item.lifecycle_status || "ACTIVE",
    market_pool: item.market_pool || null,
    confidence: item.confidence || {},
    evidence: item.evidence || {},
    price_eligible: item.price_eligible === true,
    exclusion_reasons: item.exclusion_reasons || [],
    good_listing_eligible: item.good_listing_eligible === true,
    reference_price: item.reference_price ?? null
  };
}

function pipelineVersion(activeVersion) {
  if (!activeVersion) throw new Error("ACTIVE_PC_PIPELINE_VERSION_MISSING");
  return {
    version_key: activeVersion.version_key,
    normalization_version: Number(activeVersion.normalization_version),
    parser_version: activeVersion.parser_version,
    rule_version: activeVersion.rule_version,
    filter_version: activeVersion.filter_version
  };
}

function enrichedLedgerProjection(ledger, projection) {
  if (!projection?.canonical_product_id) return projection;
  const product = ledger.getCanonicalProduct(projection.canonical_product_id);
  const boardEvidence = Array.isArray(projection.evidence)
    ? projection.evidence.find((entry) => entry && typeof entry === "object"
      && ["board_manufacturer", "gpu_board_manufacturer"].includes(String(entry.field || "")))
    : null;
  const boardManufacturer = projection.board_manufacturer
    || boardEvidence?.value
    || product?.spec?.board_manufacturer
    || null;
  return {
    ...projection,
    canonical_manufacturer: projection.canonical_manufacturer
      || (projection.category_code === "GPU" ? boardManufacturer : product?.manufacturer)
      || null,
    chip_manufacturer: projection.chip_manufacturer || product?.spec?.chip_manufacturer || null,
    board_manufacturer: boardManufacturer
  };
}

function localPublicRows(db, requestedSources) {
  const placeholders = requestedSources.map(() => "?").join(", ");
  const rows = db.prepare(`SELECT item_id, site, category_id, title, search_text, price_value, currency,
      url, image_url, posted_at, last_checked_at, pc_metadata_json
    FROM listings
    WHERE site IN (${placeholders})
      AND active = 1 AND price_value IS NOT NULL AND price_value > 0
      AND json_extract(pc_metadata_json, '$.canonical_product_id') IS NOT NULL
      AND json_extract(pc_metadata_json, '$.listing_kind') IN ('SINGLE_COMPONENT', 'SAME_PRODUCT_LOT')
      AND json_extract(pc_metadata_json, '$.lifecycle_status') = 'ACTIVE'
      AND json_extract(pc_metadata_json, '$.price_eligible') = 1
      AND json_extract(pc_metadata_json, '$.condition_code') = 'USED_WORKING'
      AND CAST(json_extract(pc_metadata_json, '$.quantity') AS INTEGER) >= 1
      AND json_extract(pc_metadata_json, '$.price_scope') IN ('TOTAL', 'UNIT')
      AND ((json_extract(pc_metadata_json, '$.market_pool') IN ('KR_C2C_USED', 'KR_DEALER_USED', 'KR_REFURB_RETAIL') AND currency = 'KRW')
        OR (json_extract(pc_metadata_json, '$.market_pool') = 'OVERSEAS_USED' AND currency = 'USD'))
    ORDER BY site, item_id`).all(...requestedSources);
  return rows.map((row) => {
    const metadata = parseJson(row.pc_metadata_json, {});
    return {
      id: row.item_id,
      item_id: row.item_id,
      site: row.site,
      category_id: row.category_id,
      title: row.title,
      search_text: row.search_text,
      price: row.price_value,
      currency: row.currency,
      url: row.url,
      image_url: row.image_url,
      posted_at: row.posted_at,
      updated_at: row.last_checked_at,
      ...metadata
    };
  });
}

function readLocalState(indexPath, requestedSources) {
  if (!existsSync(indexPath)) throw new Error(`RUNNER_INDEX_NOT_FOUND:${indexPath}`);
  const db = new DatabaseSync(indexPath, { readOnly: true });
  try {
    const ledger = new PcPartsLedger({ db });
    const activeVersion = pipelineVersion(ledger.getActivePipelineVersion());
    const placeholders = requestedSources.map(() => "?").join(", ");
    const identities = db.prepare(`SELECT s.source_id, s.source_listing_id
      FROM listing_snapshots s
      JOIN normalized_listings n ON n.snapshot_id = s.id
      WHERE s.source_id IN (${placeholders})
        AND s.id = (
          SELECT latest.id FROM listing_snapshots latest
          WHERE latest.source_id = s.source_id AND latest.source_listing_id = s.source_listing_id
          ORDER BY latest.observed_at DESC, latest.id DESC LIMIT 1
        )
        AND n.normalization_version = ? AND n.parser_version = ?
        AND n.rule_version = ? AND n.filter_version = ?
        AND s.lifecycle_status = 'ACTIVE' AND s.price_value IS NOT NULL AND s.price_value > 0
        AND n.canonical_product_id IS NOT NULL AND n.exact_product = 1 AND n.price_eligible = 1
        AND n.listing_kind IN ('SINGLE_COMPONENT', 'SAME_PRODUCT_LOT')
        AND n.condition_code = 'USED_WORKING' AND n.quantity IS NOT NULL AND n.quantity >= 1
        AND n.price_scope IN ('TOTAL', 'UNIT')
        AND ((n.market_pool IN ('KR_C2C_USED', 'KR_DEALER_USED', 'KR_REFURB_RETAIL') AND s.currency = 'KRW')
          OR (n.market_pool = 'OVERSEAS_USED' AND s.currency = 'USD'))
      ORDER BY s.source_id, s.source_listing_id`).all(
        ...requestedSources,
        activeVersion.normalization_version,
        activeVersion.parser_version,
        activeVersion.rule_version,
        activeVersion.filter_version
      );
    const authority = collectAuthoritativePcProjections(
      identities,
      (sourceId, sourceListingId) => enrichedLedgerProjection(
        ledger,
        ledger.getPublicProjection(sourceId, sourceListingId)
      ),
      { pipelineVersion: activeVersion }
    );
    return { activeVersion, authority, localPublic: localPublicRows(db, requestedSources) };
  } finally {
    db.close();
  }
}

async function readJsonResponse(response, label) {
  const payload = await response.json().catch(() => null);
  if (!response.ok) throw new Error(`${label}_HTTP_${response.status}`);
  if (!payload || typeof payload !== "object") throw new Error(`${label}_INVALID_JSON`);
  return payload;
}

export async function fetchAllPublicPcListings(apiBase, auditKey = Date.now().toString(36)) {
  const items = [];
  const seenCursors = new Set();
  let cursor = "";
  let expectedTotal = null;
  do {
    const url = new URL("/api/pc/listings", apiBase);
    url.searchParams.set("limit", "100");
    url.searchParams.set("reconciliation_audit", auditKey);
    if (cursor) url.searchParams.set("cursor", cursor);
    const payload = await readJsonResponse(await fetch(url, {
      method: "GET",
      cache: "no-store",
      headers: { accept: "application/json", "cache-control": "no-cache" },
      signal: AbortSignal.timeout(30_000)
    }), "D1_PUBLIC_LISTINGS");
    const page = payload.data;
    if (!page || !Array.isArray(page.items) || !page.pagination) throw new Error("D1_PUBLIC_LISTINGS_SHAPE_INVALID");
    const total = Number(page.total);
    if (!Number.isInteger(total) || total < 0) throw new Error("D1_PUBLIC_LISTINGS_TOTAL_INVALID");
    if (expectedTotal === null) expectedTotal = total;
    else if (expectedTotal !== total) throw new Error("D1_PUBLIC_LISTINGS_TOTAL_CHANGED");
    items.push(...page.items);
    const next = page.pagination.has_more ? String(page.pagination.next_cursor || "") : "";
    if (page.pagination.has_more && !next) throw new Error("D1_PUBLIC_LISTINGS_CURSOR_MISSING");
    if (next && seenCursors.has(next)) throw new Error("D1_PUBLIC_LISTINGS_CURSOR_LOOP");
    if (next) seenCursors.add(next);
    cursor = next;
  } while (cursor);
  if (items.length !== expectedTotal) {
    throw new Error(`D1_PUBLIC_LISTINGS_PAGINATION_MISMATCH:${expectedTotal}:${items.length}`);
  }
  if (new Set(items.map((item) => item.item_id)).size !== items.length) throw new Error("D1_PUBLIC_LISTINGS_DUPLICATE_ITEM_ID");
  return items;
}

async function importD1Plan(importUrl, importToken, items) {
  const aggregate = { inserted: 0, rejected: 0, batches: 0 };
  for (let offset = 0; offset < items.length; offset += IMPORT_BATCH_SIZE) {
    const batch = items.slice(offset, offset + IMPORT_BATCH_SIZE).map(toPcProjectionImportItem);
    const response = await fetch(importUrl, {
      method: "POST",
      headers: { authorization: `Bearer ${importToken}`, "content-type": "application/json" },
      body: JSON.stringify({ items: batch }),
      signal: AbortSignal.timeout(30_000)
    });
    const payload = await readJsonResponse(response, "D1_IMPORT");
    const result = payload.data || payload;
    const inserted = Number(result.inserted);
    const rejected = Number(result.rejected);
    if (inserted !== batch.length || rejected !== 0 || result.retention_policy !== "NON_DESTRUCTIVE") {
      throw new Error(`D1_IMPORT_INTEGRITY_FAILURE:${aggregate.batches + 1}`);
    }
    aggregate.inserted += inserted;
    aggregate.rejected += rejected;
    aggregate.batches += 1;
  }
  return aggregate;
}

function planOutput(plan, authorityAudit, mode) {
  const summary = (item) => ({
    item_id: item.item_id || item.id,
    site: item.site,
    title: item.title,
    canonical_product_id: item.canonical_product_id,
    listing_kind: item.listing_kind,
    market_pool: item.market_pool,
    currency: item.currency,
    url: item.url
  });
  return {
    mode,
    checksum: plan.checksum,
    pipeline_version: plan.pipeline_version,
    sources: plan.sources,
    ledger_scanned_count: authorityAudit.scanned_count,
    source_pair_count: authorityAudit.source_pair_count,
    projection_count: authorityAudit.projection_count,
    version_covered_count: authorityAudit.version_covered_count,
    version_mismatch_count: authorityAudit.version_mismatch_count,
    ledger_unprojected_count: authorityAudit.unprojected_count,
    ledger_ineligible_count: authorityAudit.ineligible_count,
    stable_identity_collision_group_count: authorityAudit.stable_identity_collision_group_count,
    stable_identity_collision_extra_count: authorityAudit.stable_identity_collision_extra_count,
    latest_selection_count: authorityAudit.latest_selection_count,
    latest_selection_checksum: authorityAudit.latest_selection_checksum,
    source_pair_checksum: authorityAudit.source_pair_checksum,
    authoritative_count: plan.authoritative_count,
    d1_public_count: plan.d1_public_count,
    d1_stale_count: plan.d1_stale_count,
    d1_missing_count: plan.d1_missing_count,
    local_public_count: plan.local_public_count,
    local_stale_count: plan.local_stale_count,
    local_missing_count: plan.local_missing_count,
    d1_stale: plan.d1_stale.map(summary),
    local_stale: plan.local_stale.map(summary)
  };
}

async function main() {
  const options = parsePcProjectionRepublishArguments(process.argv.slice(2));
  const indexRoot = process.env.RUNNER_INDEX_DIR || (process.platform === "linux"
    ? "/var/lib/used-market-runner"
    : path.join(os.tmpdir(), "used-market-runner"));
  const indexPath = process.env.RUNNER_INDEX_PATH || path.join(indexRoot, "search-index.sqlite");
  const requestedSources = [...new Set(String(process.env.PC_REPUBLISH_SOURCES || DEFAULT_PC_REPUBLISH_SOURCES.join(","))
    .split(",").map((value) => value.trim().toLowerCase()).filter(Boolean))];
  const apiBase = productionUrl(process.env.PC_PUBLIC_API_BASE || "https://used-pick.com", "PC_PUBLIC_API_BASE");
  const local = readLocalState(indexPath, requestedSources);
  const d1Public = await fetchAllPublicPcListings(apiBase);
  const plan = buildPcProjectionReconciliation({
    authoritative: local.authority.items,
    d1Public,
    localPublic: local.localPublic,
    pipelineVersion: local.activeVersion,
    authorityCoverage: local.authority,
    sources: requestedSources
  });
  if (!options.apply) {
    console.log(JSON.stringify(planOutput(plan, local.authority, "dry-run"), null, 2));
    return;
  }
  if (local.authority.projection_count !== local.authority.source_pair_count
    || local.authority.version_covered_count !== local.authority.source_pair_count
    || local.authority.unprojected_count !== 0
    || local.authority.version_mismatch_count !== 0) {
    throw new Error("AUTHORITATIVE_SOURCE_PAIR_VERSION_COVERAGE_INCOMPLETE");
  }
  assertPcProjectionApplyConfirmation(options, plan);
  const importUrl = productionUrl(process.env.D1_IMPORT_URL || new URL("/admin/import-listings", apiBase), "D1_IMPORT_URL");
  if (importUrl.origin !== apiBase.origin || importUrl.pathname !== "/admin/import-listings") {
    throw new Error("D1_IMPORT_URL must be the /admin/import-listings endpoint on PC_PUBLIC_API_BASE");
  }
  const importToken = String(process.env.CLOUDFLARE_MANUAL_RUN_TOKEN || process.env.IMPORT_TOKEN || "").trim();
  if (!importToken) throw new Error("D1 import token is required for --apply");
  const appliedAt = new Date().toISOString();
  const d1Items = [
    ...plan.d1_upserts,
    ...plan.d1_stale.map((item) => pcProjectionTombstone(item, { updatedAt: appliedAt }))
  ];
  const d1Import = await importD1Plan(importUrl, importToken, d1Items);
  const index = new SearchIndex({ filePath: indexPath, backupDir: path.join(indexRoot, "backups") });
  let localUpsert;
  try {
    localUpsert = index.upsertPublicProjections([
      ...plan.local_upserts,
      ...plan.local_stale.map((item) => pcProjectionTombstone(item, { updatedAt: appliedAt }))
    ], { observedAt: appliedAt });
  } finally {
    index.close();
  }
  const verifiedLocal = readLocalState(indexPath, requestedSources);
  const verifiedD1Public = await fetchAllPublicPcListings(apiBase, `verify-${Date.now().toString(36)}`);
  const verified = buildPcProjectionReconciliation({
    authoritative: verifiedLocal.authority.items,
    d1Public: verifiedD1Public,
    localPublic: verifiedLocal.localPublic,
    pipelineVersion: verifiedLocal.activeVersion,
    authorityCoverage: verifiedLocal.authority,
    sources: requestedSources
  });
  if (verified.d1_stale_count !== 0 || verified.d1_missing_count !== 0
    || verified.local_stale_count !== 0 || verified.local_missing_count !== 0
    || verified.d1_public_count !== verified.authoritative_count
    || verified.local_public_count !== verified.authoritative_count) {
    throw new Error("POST_APPLY_RECONCILIATION_INTEGRITY_FAILURE");
  }
  console.log(JSON.stringify({
    ...planOutput(plan, local.authority, "apply"),
    d1_import: d1Import,
    local_upsert: localUpsert,
    verified_authoritative_count: verified.authoritative_count,
    verified_d1_public_count: verified.d1_public_count,
    verified_local_public_count: verified.local_public_count
  }, null, 2));
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
