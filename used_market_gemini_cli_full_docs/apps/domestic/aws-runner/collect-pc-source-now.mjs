import { createHash } from "node:crypto";
import { writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { collectOne } from "../cloudflare/live-search.mjs";
import { pcCollectionTargetSetV2 } from "../cloudflare/pc-directory-http.mjs";
import {
  PC_SOURCE_REGISTRY,
  getPcSource,
  operatorAttestedSourceGovernance
} from "../collector/logic/pc-source-registry.mjs";
import {
  SPECIALIST_FIXTURE_PARSERS,
  collectDanawaCategoryListings
} from "../collector/logic/pc-source-adapters.mjs";
import { SearchIndex } from "./search-index.mjs";
import { PcPartsLedger } from "./pc-parts-ledger.mjs";
import { PcShadowPipeline } from "./pc-shadow-pipeline.mjs";

const sourceKey = String(process.env.PC_COLLECT_SOURCE || "").trim().toLowerCase();
const operationalSourceKeys = PC_SOURCE_REGISTRY
  .filter((source) => source.directory_source === true
    && source.policy_status === "APPROVED" && source.runtime_status === "ENABLED")
  .map((source) => source.key);
if (!new Set(operationalSourceKeys).has(sourceKey)) {
  throw new Error(`PC_COLLECT_SOURCE must be one of: ${operationalSourceKeys.join(", ")}`);
}
const indexRoot = process.env.RUNNER_INDEX_DIR || (process.platform === "linux"
  ? "/var/lib/used-market-runner"
  : path.join(os.tmpdir(), "used-market-runner"));
const indexPath = process.env.RUNNER_INDEX_PATH || path.join(indexRoot, "search-index.sqlite");
const importUrl = String(process.env.D1_IMPORT_URL || "").trim();
const importToken = String(process.env.CLOUDFLARE_MANUAL_RUN_TOKEN || process.env.IMPORT_TOKEN || "").trim();
const sqlOutputPath = String(process.env.PC_D1_SQL_OUTPUT || "").trim();
const collectLimit = Math.min(80, Math.max(1, Number(process.env.PC_COLLECT_LIMIT || 20) || 20));
const collectCadenceClass = String(process.env.PC_COLLECT_CADENCE_CLASS || "HOURLY_CATEGORY").trim().toUpperCase();
if (!["HOURLY_CATEGORY", "DAILY_MASTER", "ALL"].includes(collectCadenceClass)) {
  throw new Error("PC_COLLECT_CADENCE_CLASS must be HOURLY_CATEGORY, DAILY_MASTER, or ALL");
}
if ((!importUrl || !importToken) && !sqlOutputPath) {
  throw new Error("D1 projection import or PC_D1_SQL_OUTPUT is required");
}
if ((importUrl && !importToken) || (!importUrl && importToken)) throw new Error("D1 import URL and token must be configured together");

const DANAWA_REQUEST_MIN_INTERVAL_MS = 650;
let lastDanawaRequestAt = 0;

async function fetchDanawaPublicWithPacing(input, init) {
  const remaining = DANAWA_REQUEST_MIN_INTERVAL_MS - (Date.now() - lastDanawaRequestAt);
  if (remaining > 0) await new Promise((resolve) => setTimeout(resolve, remaining));
  lastDanawaRequestAt = Date.now();
  return fetch(input, init);
}

function jsonEnvironment(name) {
  const raw = String(process.env[name] || "").trim();
  if (!raw) return {};
  try {
    const value = JSON.parse(raw);
    return value && typeof value === "object" && !Array.isArray(value) ? value : {};
  } catch (error) {
    throw new Error(`INVALID_${name}:${error instanceof Error ? error.message : String(error)}`);
  }
}

const specialistSearchUrls = Object.freeze({
  coolenjoy: "https://coolenjoy.net/bbs/mart2?sfl=wr_subject&stx={query}&sop=and",
  ...jsonEnvironment("PC_SPECIALIST_SEARCH_URLS_JSON")
});
const specialistHosts = Object.freeze({
  coolenjoy: new Set(["coolenjoy.net", "www.coolenjoy.net"])
});
const specialistPublicQueryOverrides = Object.freeze({});
const sourceTargetPacingMs = Object.freeze({
  coolenjoy: 200,
  ebay: 300
});

function specialistSearchUrl(source, target) {
  const template = String(specialistSearchUrls[source] || "").trim();
  if (!template) throw new Error(`SPECIALIST_SEARCH_URL_NOT_CONFIGURED:${source}`);
  const sourceQuery = specialistPublicQueryOverrides[source]?.[target.query_text] || target.query_text;
  const url = new URL(template.replace("{query}", encodeURIComponent(sourceQuery)));
  if (url.protocol !== "https:" || !specialistHosts[source]?.has(url.hostname.toLowerCase())) {
    throw new Error(`SPECIALIST_SEARCH_URL_NOT_ALLOWED:${source}`);
  }
  return url;
}

async function collectTargetItems(target) {
  if (sourceKey === "danawa") {
    return (await collectDanawaCategoryListings({
      categoryCode: target.category_code,
      fetchImpl: fetchDanawaPublicWithPacing
    })).items.slice(0, collectLimit);
  }
  const parser = SPECIALIST_FIXTURE_PARSERS[sourceKey];
  if (parser) {
    const response = await fetch(specialistSearchUrl(sourceKey, target), {
      headers: {
        accept: "text/html,application/xhtml+xml",
        "accept-language": "ko-KR,ko;q=0.9,en;q=0.7",
        referer: "https://used-pick.com/",
        "user-agent": "USED-PICK-PC-Collector/2.0 (+https://used-pick.com/)"
      },
      signal: AbortSignal.timeout(20_000)
    });
    if (!response.ok) throw new Error(`SPECIALIST_HTTP_${response.status}:${sourceKey}`);
    return parser(await response.text()).slice(0, collectLimit).map((item) => ({ ...item, site: sourceKey }));
  }
  return collectOne(
    sourceKey, target.query_text, sourceKey === "ebay" ? target.category_code : "pc", collectLimit,
    target.query_text, "recent", { min: null, max: null }
  );
}

function toImportItem(item) {
  return {
    item_id: item.item_id || item.id, site: item.site, category_id: item.category_id || "pc",
    title: item.title, search_text: item.search_text || item.title, price_value: item.price,
    currency: item.currency || "KRW", url: item.url, image_url: item.image_url || null,
    seller_name: item.seller_name || null, posted_at: item.posted_at || null,
    updated_at: item.updated_at || new Date().toISOString(), canonical_product_id: item.canonical_product_id || null,
    canonical_display_name: item.canonical_display_name || null,
    canonical_manufacturer: item.canonical_manufacturer || null, listing_kind: item.listing_kind || "UNKNOWN",
    board_manufacturer: item.board_manufacturer || item.spec?.board_manufacturer || null,
    pc_category_code: item.category_code || item.pc_category_code || null, quantity: item.quantity || null,
    market_segment: item.market_segment || "UNKNOWN", listing_type: item.listing_type || "UNKNOWN",
    condition_group: item.condition_group || "UNKNOWN", spec_group_id: item.spec_group_id || null,
    classification_confidence: Number(item.classification_confidence || 0), model_confidence: Number(item.model_confidence || 0),
    quantity_confidence: Number(item.quantity_confidence || 0), price_scope_confidence: Number(item.price_scope_confidence || 0),
    statistics_eligible: item.statistics_eligible === true, statistics_exclusion_reasons: item.statistics_exclusion_reasons || [],
    price_scope: item.price_scope || "UNKNOWN", condition_code: item.condition_code || "UNKNOWN",
    lifecycle_status: item.lifecycle_status || "ACTIVE", market_pool: item.market_pool || null,
    confidence: item.confidence || {}, evidence: item.evidence || {}, price_eligible: item.price_eligible === true,
    exclusion_reasons: item.exclusion_reasons || [], good_listing_eligible: item.good_listing_eligible === true,
    reference_price: item.reference_price ?? null
  };
}

function redactPublicText(value, maximum = 1_000) {
  return String(value || "").normalize("NFKC").replace(/\s+/gu, " ").trim().slice(0, maximum)
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/giu, "[EMAIL]")
    .replace(/(?<!\d)(?:\+?82[-.\s]?)?0?1[016789][-.\s]?\d{3,4}[-.\s]?\d{4}(?!\d)/gu, "[PHONE]");
}

function sqlLiteral(value) {
  if (value === null || value === undefined || value === "") return "NULL";
  if (typeof value === "number") {
    if (!Number.isFinite(value)) return "NULL";
    return String(value);
  }
  return `'${String(value).replaceAll("'", "''")}'`;
}

function d1ProjectionSql(items, generatedAt) {
  const columns = [
    "item_id", "site", "category_id", "title", "search_text", "price_value", "currency", "url", "image_url", "seller_name",
    "posted_at", "updated_at", "active", "canonical_product_id", "canonical_display_name", "canonical_manufacturer", "board_manufacturer",
    "listing_kind", "pc_category_code", "market_segment", "listing_type", "condition_group", "spec_group_id",
    "classification_confidence", "model_confidence", "quantity_confidence", "price_scope_confidence", "statistics_eligible", "statistics_exclusion_reasons_json",
    "quantity", "price_scope", "condition_code", "lifecycle_status", "market_pool",
    "confidence_json", "evidence_json", "price_eligible", "exclusion_reasons_json", "good_listing_eligible", "reference_price"
  ];
  const rows = items.map(toImportItem)
    .filter((item) => item.price_eligible === true && item.statistics_eligible === true && item.canonical_product_id
      && item.lifecycle_status === "ACTIVE" && item.condition_code === "USED_WORKING"
      && ["SINGLE_COMPONENT", "SAME_PRODUCT_LOT"].includes(item.listing_kind)
      && Number(item.price_value) > 0)
    .slice(0, 500)
    .map((item) => ({
      ...item,
      title: redactPublicText(item.title, 500),
      search_text: redactPublicText(item.search_text || item.title, 1_000),
      seller_name: null,
      active: 1,
      confidence_json: JSON.stringify(item.confidence || {}),
      evidence_json: JSON.stringify(item.evidence || {}),
      price_eligible: 1,
      statistics_eligible: 1,
      exclusion_reasons_json: JSON.stringify(item.exclusion_reasons || []),
      statistics_exclusion_reasons_json: JSON.stringify(item.statistics_exclusion_reasons || []),
      good_listing_eligible: item.good_listing_eligible === true ? 1 : 0
    }));
  const statements = rows.map((row) => `INSERT OR REPLACE INTO listings (${columns.join(", ")}) VALUES (${columns
    .map((column) => sqlLiteral(row[column])).join(", ")});`);
  return {
    rows,
    // Wrangler's remote D1 import already rolls the uploaded batch back on
    // failure and rejects explicit BEGIN/COMMIT statements.
    sql: [`-- generated_at=${generatedAt}`, ...statements, ""].join("\n")
  };
}

const index = new SearchIndex({ filePath: indexPath, backupDir: path.join(indexRoot, "backups") });
const ledger = new PcPartsLedger({ db: index.db });
const startedAt = new Date().toISOString();
let crawlRunId = null;
try {
  ledger.migrate();
  const registeredSource = getPcSource(sourceKey);
  const operatorGovernance = operatorAttestedSourceGovernance(registeredSource);
  ledger.upsertSource({
    sourceId: registeredSource.key,
    displayName: registeredSource.name,
    marketPool: registeredSource.market_pool,
    marketPools: registeredSource.market_pools,
    policyStatus: registeredSource.policy_status,
    runtimeStatus: registeredSource.runtime_status,
    policyReviewedAt: registeredSource.policy_reviewed_at || operatorGovernance?.policy_reviewed_at || null,
    policyNote: registeredSource.policy_note || (operatorGovernance
      ? `access=${operatorGovernance.approved_access_mode}; approval=operator-attested-registry; operator=enabled; constraints=${operatorGovernance.access_constraints}`
      : null)
  });
  ledger.activateCollectionTargets(pcCollectionTargetSetV2());
  const pipeline = new PcShadowPipeline({ ledger });
  await pipeline.initialize();
  const targets = ledger.listActiveCollectionTargets(sourceKey).filter((target) => (
    collectCadenceClass === "ALL" || String(target.cadence_class || "HOURLY_CATEGORY") === collectCadenceClass
  ));
  if (targets.length === 0) throw new Error(`NO_COLLECTION_TARGETS:${sourceKey}:${collectCadenceClass}`);
  crawlRunId = ledger.startCrawlRun({ sourceId: sourceKey, startedAt, adapterVersion: "operator-source-refresh-v1" });
  const collectTarget = async (target) => ({ target, items: await collectTargetItems(target) });
  const settled = [];
  for (const target of targets) {
    try { settled.push({ status: "fulfilled", value: await collectTarget(target) }); }
    catch (reason) { settled.push({ status: "rejected", reason }); }
    await new Promise((resolve) => setTimeout(resolve, sourceTargetPacingMs[sourceKey] || 200));
  }
  const successful = settled.filter((result) => result.status === "fulfilled");
  const failed = settled.filter((result) => result.status === "rejected");
  const failureMessages = failed
    .map((result) => result.reason instanceof Error ? result.reason.message : String(result.reason));
  if (successful.length === 0) {
    throw new Error(`ALL_SOURCE_TARGETS_FAILED:${sourceKey}:0/${targets.length}:${failureMessages.join(";")}`);
  }
  console.info(JSON.stringify({ phase: "collected", source: sourceKey, targets: successful.length,
    items: successful.reduce((count, result) => count + (result.value.items || []).length, 0), limit: collectLimit }));
  const deduped = new Map();
  for (const result of successful) {
    for (const item of result.value.items || []) {
      const sourceListingId = String(item.source_listing_id || item.item_id || item.id || item.url || "").trim();
      if (!sourceListingId) continue;
      const itemId = String(item.item_id || item.id || "").startsWith(`${sourceKey}:`)
        ? String(item.item_id || item.id) : `${sourceKey}:${sourceListingId}`;
      deduped.set(sourceListingId, {
        ...item, id: itemId, item_id: itemId, source_listing_id: sourceListingId,
        raw_payload: item.raw_payload && typeof item.raw_payload === "object"
          ? item.raw_payload : { ...item, source_listing_id: sourceListingId }
      });
    }
  }
  settled.forEach((result, index) => ledger.updateSourceTargetRuntime({
    sourceId: sourceKey,
    targetId: targets[index].target_id,
    startedAt,
    succeededAt: result.status === "fulfilled" ? startedAt : null,
    cursor: result.status === "fulfilled"
      ? (result.value.target.incremental_cursor || null)
      : (targets[index].incremental_cursor || null),
    error: result.status === "rejected"
      ? (result.reason instanceof Error ? result.reason.message : String(result.reason))
      : null
  }));
  const projections = pipeline.recordItems([...deduped.values()], { observedAt: startedAt });
  console.info(JSON.stringify({ phase: "classified", source: sourceKey, projections: projections.length }));
  index.upsertPublicProjections(projections, { observedAt: startedAt });
  const imported = { inserted: 0, rejected: 0, batches: 0 };
  for (let offset = 0; importUrl && importToken && offset < projections.length; offset += 400) {
    const response = await fetch(importUrl, {
      method: "POST",
      headers: { authorization: `Bearer ${importToken}`, "content-type": "application/json" },
      body: JSON.stringify({ items: projections.slice(offset, offset + 400).map(toImportItem) }),
      signal: AbortSignal.timeout(15_000)
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(`D1_IMPORT_HTTP_${response.status}:${JSON.stringify(payload)}`);
    const result = payload.data || payload;
    imported.inserted += Number(result.inserted || 0);
    imported.rejected += Number(result.rejected || 0);
    imported.batches += 1;
  }
  let sqlExport = null;
  if (sqlOutputPath) {
    const exported = d1ProjectionSql(projections, startedAt);
    await writeFile(sqlOutputPath, exported.sql, { encoding: "utf8", flag: "wx" });
    sqlExport = {
      path: sqlOutputPath,
      rows: exported.rows.length,
      checksum: createHash("sha256").update(exported.sql).digest("hex")
    };
  }
  const finishedAt = new Date().toISOString();
  const blockedFailure = failureMessages.some((message) => /(?:HTTP[_ ]?(?:403|429)|\b403\b|\b429\b|blocked|captcha)/iu.test(message));
  ledger.finishCrawlRun({
    crawlRunId, status: failed.length > 0 ? (blockedFailure ? "QUARANTINED" : "FAILED") : "SUCCEEDED", finishedAt,
    collectedCount: projections.length, changedCount: projections.filter((item) => item._pc_snapshot_created === true).length,
    requestCount: targets.length, requestFailureCount: failed.length, parsedCount: projections.length,
    httpBlockedCount: blockedFailure ? failed.length : 0,
    error: failed.length > 0 ? failureMessages.join("; ") : null,
    adapterVersion: "operator-source-refresh-v1"
  });
  if (failed.length === 0) ledger.updateSourceRuntime(sourceKey, {
      runtime_status: "ENABLED",
      consecutive_failures: 0,
      backoff_until: null,
      quarantine_until: null,
      incremental_cursor: null,
      last_started_at: startedAt,
      last_succeeded_at: finishedAt,
      last_error: null
    });
  console.log(JSON.stringify({ source: sourceKey, targets: targets.length, successful_targets: successful.length,
    failed_targets: failed.length, collected: projections.length, imported, sql_export: sqlExport }));
  if (failed.length > 0) process.exitCode = 1;
} catch (error) {
  if (crawlRunId) {
    try { ledger.finishCrawlRun({ crawlRunId, status: "FAILED", finishedAt: new Date().toISOString(), error: error.message }); }
    catch {}
  }
  throw error;
} finally {
  index.close();
}
