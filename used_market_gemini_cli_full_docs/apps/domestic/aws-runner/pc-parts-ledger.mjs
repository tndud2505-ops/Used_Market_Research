import { createHash, randomUUID } from "node:crypto";
import path from "node:path";
import { mkdirSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { canonicalSourceListingIdentity } from "./pc-source-listing-identity.mjs";

const HOUR_MS = 60 * 60 * 1000;
const HOURLY_COLLECTION_GUARD_MS = 55 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
const SOLD_EVIDENCE_TYPES = new Set(["STRUCTURED_STATUS", "OFFICIAL_API", "EXPLICIT_TEXT"]);
const LIFECYCLE_STATUSES = new Set([
  "ACTIVE", "RESERVED", "SOLD", "DELETED", "EXPIRED",
  "UNAVAILABLE_UNKNOWN", "BLOCKED_OR_PRIVATE"
]);
const PRODUCT_CATEGORIES = new Set([
  "CPU", "GPU", "RAM", "MOTHERBOARD", "SSD", "HDD", "PSU", "CASE", "COOLING", "EXPANSION_CARD", "ODD"
]);
const POSITIVE_SPEC_FIELDS = new Set([
  "module_capacity_gb", "total_capacity_gb", "capacity_gb", "watts", "vram_gb", "core_count", "thread_count"
]);
const LATEST_STATE_IDENTITY_CHUNK = 200;
const PRICE_STAT_METRIC_SCOPES = ["ACTIVE", "RESERVED", "SOLD", "CONFIRMED_TRANSACTION"];

export const PC_PARTS_LEDGER_TABLES = Object.freeze([
  "sources",
  "source_runtime",
  "crawl_runs",
  "raw_listings",
  "listing_snapshots",
  "normalized_listings",
  "listing_items",
  "product_master",
  "product_aliases",
  "classification_feedback",
  "duplicate_clusters",
  "duplicate_cluster_members",
  "daily_price_stats",
  "daily_price_stat_members",
  "daily_source_price_stats",
  "daily_source_price_stat_members",
  "pc_publication_runtime",
  "pc_pipeline_versions",
  "model_candidates",
  "model_candidate_sightings"
]);

function cleanText(value, maximum = 4_000) {
  return String(value ?? "").normalize("NFKC").replace(/\s+/gu, " ").trim().slice(0, maximum);
}

function iso(value) {
  const parsed = value instanceof Date ? value.getTime() : Date.parse(String(value ?? ""));
  if (!Number.isFinite(parsed)) throw new TypeError(`invalid timestamp: ${value}`);
  return new Date(parsed).toISOString();
}

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stableValue(value[key])]));
  }
  return value;
}

function stableJson(value) {
  return JSON.stringify(stableValue(value));
}

function hash(value) {
  return createHash("sha256").update(typeof value === "string" ? value : stableJson(value)).digest("base64url");
}

function finitePrice(value) {
  if (value === null || value === undefined || (typeof value === "string" && value.trim() === "")) return null;
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric >= 0 ? numeric : null;
}

function comparableScopePrice(value, quantity, priceScope) {
  const price = Number(value);
  if (!Number.isFinite(price) || price <= 0) return null;
  const count = Number.isInteger(Number(quantity)) && Number(quantity) > 0 ? Number(quantity) : 1;
  return priceScope === "TOTAL" && count > 1 ? Number((price / count).toFixed(2)) : price;
}

function priceStatsListingIdentity(row) {
  return row.duplicate_cluster_status === "CONFIRMED"
    ? `cluster:${row.duplicate_cluster_key}`
    : canonicalSourceListingIdentity(row.source_id, row.source_listing_id);
}

function priceStatsRowEligible(row) {
  return Number(row?.exact_product) === 1
    && Number(row?.price_eligible) === 1
    && Number(row?.statistics_eligible) === 1;
}

function migrateDailyPriceStatsReservedScope(db) {
  const table = db.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'daily_price_stats'").get();
  if (!table?.sql || table.sql.includes("'RESERVED'")) return false;

  const tableColumns = (tableName) => new Set(db.prepare(`PRAGMA table_info(${tableName})`).all().map((row) => row.name));
  const oldColumns = {
    stats: tableColumns("daily_price_stats"),
    members: tableColumns("daily_price_stat_members"),
    sourceStats: tableColumns("daily_source_price_stats"),
    sourceMembers: tableColumns("daily_source_price_stat_members")
  };
  const expression = (columns, name, fallback = "NULL") => columns.has(name) ? `\"${name}\"` : fallback;
  const selectList = (columns, names, fallbacks = {}) => names
    .map((name) => `${expression(columns, name, fallbacks[name] || "NULL")} AS \"${name}\"`)
    .join(", ");
  const statColumns = [
    "id", "stat_date", "canonical_product_id", "market_pool", "condition_code", "currency", "metric_scope",
    "sample_count", "unit_count", "mean_value", "median_value", "trimmed_mean_value", "min_value", "max_value",
    "p25_value", "p75_value", "outlier_count", "outlier_lower_bound", "outlier_upper_bound", "seven_day_sold_median",
    "confidence_level", "normalization_version", "parser_version", "rule_version", "filter_version", "as_of"
  ];
  const memberColumns = [
    "id", "daily_price_stat_id", "snapshot_id", "listing_item_id", "raw_listing_id", "member_role", "price_value",
    "included", "exclusion_reason", "outlier_flag", "outlier_reason"
  ];
  const sourceStatColumns = [
    "id", "daily_price_stat_id", "source_id", "sample_count", "unit_count", "mean_value", "median_value",
    "trimmed_mean_value", "min_value", "max_value", "p25_value", "p75_value", "outlier_count",
    "outlier_lower_bound", "outlier_upper_bound", "seven_day_sold_median", "confidence_level"
  ];
  const sourceMemberColumns = [
    "id", "daily_source_price_stat_id", "snapshot_id", "listing_item_id", "raw_listing_id", "member_role", "price_value",
    "outlier_flag", "outlier_reason"
  ];

  db.exec("PRAGMA foreign_keys = OFF; BEGIN IMMEDIATE");
  try {
    db.exec(`
      DROP INDEX IF EXISTS idx_daily_source_price_stats_lookup;
      DROP INDEX IF EXISTS idx_daily_price_stats_lookup;
      ALTER TABLE daily_source_price_stat_members RENAME TO daily_source_price_stat_members_legacy_reserved;
      ALTER TABLE daily_source_price_stats RENAME TO daily_source_price_stats_legacy_reserved;
      ALTER TABLE daily_price_stat_members RENAME TO daily_price_stat_members_legacy_reserved;
      ALTER TABLE daily_price_stats RENAME TO daily_price_stats_legacy_reserved;

      CREATE TABLE daily_price_stats (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        stat_date TEXT NOT NULL,
        canonical_product_id TEXT NOT NULL,
        market_pool TEXT NOT NULL,
        condition_code TEXT NOT NULL,
        currency TEXT NOT NULL,
        metric_scope TEXT NOT NULL CHECK(metric_scope IN ('ACTIVE', 'RESERVED', 'SOLD', 'CONFIRMED_TRANSACTION')),
        sample_count INTEGER NOT NULL,
        unit_count INTEGER NOT NULL DEFAULT 0,
        mean_value REAL,
        median_value REAL,
        trimmed_mean_value REAL,
        min_value REAL,
        max_value REAL,
        p25_value REAL,
        p75_value REAL,
        outlier_count INTEGER NOT NULL DEFAULT 0,
        outlier_lower_bound REAL,
        outlier_upper_bound REAL,
        seven_day_sold_median REAL,
        confidence_level TEXT NOT NULL,
        normalization_version INTEGER NOT NULL DEFAULT 1,
        parser_version TEXT NOT NULL,
        rule_version TEXT NOT NULL,
        filter_version TEXT NOT NULL,
        as_of TEXT NOT NULL,
        UNIQUE(stat_date, canonical_product_id, market_pool, condition_code, currency, metric_scope)
      ) STRICT;
      CREATE TABLE daily_price_stat_members (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        daily_price_stat_id INTEGER NOT NULL REFERENCES daily_price_stats(id) ON DELETE CASCADE,
        snapshot_id INTEGER NOT NULL REFERENCES listing_snapshots(id) ON DELETE RESTRICT,
        listing_item_id INTEGER NOT NULL REFERENCES listing_items(id) ON DELETE RESTRICT,
        raw_listing_id INTEGER NOT NULL REFERENCES raw_listings(id) ON DELETE RESTRICT,
        member_role TEXT NOT NULL,
        price_value REAL NOT NULL,
        included INTEGER NOT NULL DEFAULT 1 CHECK(included IN (0, 1)),
        exclusion_reason TEXT,
        outlier_flag INTEGER NOT NULL DEFAULT 0 CHECK(outlier_flag IN (0, 1)),
        outlier_reason TEXT,
        UNIQUE(daily_price_stat_id, snapshot_id, listing_item_id, member_role)
      ) STRICT;
      CREATE TABLE daily_source_price_stats (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        daily_price_stat_id INTEGER NOT NULL REFERENCES daily_price_stats(id) ON DELETE CASCADE,
        source_id TEXT NOT NULL REFERENCES sources(source_id) ON DELETE RESTRICT,
        sample_count INTEGER NOT NULL,
        unit_count INTEGER NOT NULL DEFAULT 0,
        mean_value REAL,
        median_value REAL,
        trimmed_mean_value REAL,
        min_value REAL,
        max_value REAL,
        p25_value REAL,
        p75_value REAL,
        outlier_count INTEGER NOT NULL DEFAULT 0,
        outlier_lower_bound REAL,
        outlier_upper_bound REAL,
        seven_day_sold_median REAL,
        confidence_level TEXT NOT NULL,
        UNIQUE(daily_price_stat_id, source_id)
      ) STRICT;
      CREATE TABLE daily_source_price_stat_members (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        daily_source_price_stat_id INTEGER NOT NULL REFERENCES daily_source_price_stats(id) ON DELETE CASCADE,
        snapshot_id INTEGER NOT NULL REFERENCES listing_snapshots(id) ON DELETE RESTRICT,
        listing_item_id INTEGER NOT NULL REFERENCES listing_items(id) ON DELETE RESTRICT,
        raw_listing_id INTEGER NOT NULL REFERENCES raw_listings(id) ON DELETE RESTRICT,
        member_role TEXT NOT NULL,
        price_value REAL NOT NULL,
        outlier_flag INTEGER NOT NULL DEFAULT 0 CHECK(outlier_flag IN (0, 1)),
        outlier_reason TEXT,
        UNIQUE(daily_source_price_stat_id, snapshot_id, listing_item_id, member_role)
      ) STRICT;

      INSERT INTO daily_price_stats (${statColumns.join(", ")})
        SELECT ${selectList(oldColumns.stats, statColumns, { unit_count: "0", outlier_count: "0", normalization_version: "1" })}
        FROM daily_price_stats_legacy_reserved;
      INSERT INTO daily_price_stat_members (${memberColumns.join(", ")})
        SELECT ${selectList(oldColumns.members, memberColumns, { included: "1", outlier_flag: "0" })}
        FROM daily_price_stat_members_legacy_reserved;
      INSERT INTO daily_source_price_stats (${sourceStatColumns.join(", ")})
        SELECT ${selectList(oldColumns.sourceStats, sourceStatColumns, { unit_count: "0", outlier_count: "0" })}
        FROM daily_source_price_stats_legacy_reserved;
      INSERT INTO daily_source_price_stat_members (${sourceMemberColumns.join(", ")})
        SELECT ${selectList(oldColumns.sourceMembers, sourceMemberColumns, { outlier_flag: "0" })}
        FROM daily_source_price_stat_members_legacy_reserved;
      DROP TABLE daily_source_price_stat_members_legacy_reserved;
      DROP TABLE daily_source_price_stats_legacy_reserved;
      DROP TABLE daily_price_stat_members_legacy_reserved;
      DROP TABLE daily_price_stats_legacy_reserved;
      CREATE INDEX idx_daily_price_stats_lookup ON daily_price_stats(canonical_product_id, market_pool, condition_code, currency, stat_date DESC);
      CREATE INDEX idx_daily_source_price_stats_lookup ON daily_source_price_stats(source_id, daily_price_stat_id);
    `);
    db.exec("COMMIT");
    return true;
  } catch (error) {
    try { db.exec("ROLLBACK"); } catch {}
    throw error;
  } finally {
    db.exec("PRAGMA foreign_keys = ON");
  }
}

function priceStatsScopeMatches(row, scope) {
  return cleanText(row?.canonical_product_id, 300) === scope.canonicalProductId
    && cleanText(row?.market_pool, 80) === scope.marketPool
    && cleanText(row?.condition_code, 80) === scope.condition
    && cleanText(row?.currency, 20).toUpperCase() === scope.currency;
}

function currentIdentityRowEligible(identity, row, latestByListing, scope, lifecycleStatus) {
  const latest = latestByListing.get(identity);
  return Boolean(latest)
    && Number(latest.id) === Number(row?.id)
    && latest.lifecycle_status === lifecycleStatus
    && priceStatsRowEligible(latest)
    && priceStatsScopeMatches(latest, scope);
}

function currentSoldIdentityEligible(identity, firstSoldByListing, latestByListing, scope) {
  const firstSold = firstSoldByListing.get(identity);
  const latest = latestByListing.get(identity);
  return Boolean(firstSold)
    && priceStatsRowEligible(firstSold)
    && latest?.lifecycle_status === "SOLD"
    && priceStatsRowEligible(latest)
    && priceStatsScopeMatches(latest, scope);
}

function redactString(value) {
  return cleanText(value, 20_000)
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/giu, "[EMAIL]")
    .replace(/(?<!\d)(?:\+?82[- .]?)?0?1[016789][-. ]?\d{3,4}[-. ]?\d{4}(?!\d)/gu, "[PHONE]")
    .replace(/(?<!\d)0\d{1,2}[-. ]?\d{3,4}[-. ]?\d{4}(?!\d)/gu, "[PHONE]");
}

function redactPayload(value, key = "") {
  if (Array.isArray(value)) return value.map((entry) => redactPayload(entry));
  if (value && typeof value === "object") {
    const result = {};
    for (const [childKey, childValue] of Object.entries(value)) {
      const normalizedKey = childKey.toLowerCase();
      if (/(?:email|phone|mobile|tel|seller.?name|username|account|address|contact)/u.test(normalizedKey)) {
        result[childKey] = childValue == null ? null : `[REDACTED:${normalizedKey}]`;
      } else {
        result[childKey] = redactPayload(childValue, childKey);
      }
    }
    return result;
  }
  return typeof value === "string" ? redactString(value) : value;
}

function parseJson(value, fallback) {
  try {
    return JSON.parse(String(value ?? ""));
  } catch {
    return fallback;
  }
}

function lifecycleStatus(status, evidence) {
  const normalized = cleanText(status || "ACTIVE", 40).toUpperCase();
  if (!LIFECYCLE_STATUSES.has(normalized)) return "UNAVAILABLE_UNKNOWN";
  if (normalized !== "SOLD") return normalized;
  const evidenceType = cleanText(evidence?.type, 40).toUpperCase();
  const evidenceValue = cleanText(evidence?.value, 500);
  if (!SOLD_EVIDENCE_TYPES.has(evidenceType)) return "UNAVAILABLE_UNKNOWN";
  const explicitlySold = /(?:판매\s*완료|거래\s*완료|판매됨|\bsold(?:\s*out)?\b|\bcompleted\b)/iu.test(evidenceValue);
  return explicitlySold ? "SOLD" : "UNAVAILABLE_UNKNOWN";
}

function percentile(sorted, fraction) {
  if (sorted.length === 0) return null;
  const position = (sorted.length - 1) * fraction;
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  if (lower === upper) return sorted[lower];
  return sorted[lower] + (sorted[upper] - sorted[lower]) * (position - lower);
}

function round(value) {
  return value == null ? null : Number(Number(value).toFixed(2));
}

function summarize(values, unitCount = null) {
  const sorted = values.filter(Number.isFinite).sort((left, right) => left - right);
  const sampleCount = sorted.length;
  const median = sampleCount >= 3 ? percentile(sorted, 0.5) : null;
  const mean = sampleCount >= 5 ? sorted.reduce((sum, value) => sum + value, 0) / sampleCount : null;
  let trimmedMean = null;
  let p25 = null;
  let p75 = null;
  let outlierLowerBound = null;
  let outlierUpperBound = null;
  let outlierCount = 0;
  if (sampleCount >= 10) {
    const trim = Math.floor(sampleCount * 0.1);
    const trimmed = sorted.slice(trim, sorted.length - trim);
    trimmedMean = trimmed.reduce((sum, value) => sum + value, 0) / trimmed.length;
    p25 = percentile(sorted, 0.25);
    p75 = percentile(sorted, 0.75);
    const iqr = p75 - p25;
    outlierLowerBound = p25 - 1.5 * iqr;
    outlierUpperBound = p75 + 1.5 * iqr;
    outlierCount = sorted.filter((value) => value < outlierLowerBound || value > outlierUpperBound).length;
  }
  return {
    sample_count: sampleCount,
    unit_count: unitCount == null ? sampleCount : Math.max(0, Number(unitCount) || 0),
    min: sampleCount > 0 ? round(sorted[0]) : null,
    max: sampleCount > 0 ? round(sorted.at(-1)) : null,
    mean: round(mean),
    median: round(median),
    trimmed_mean: round(trimmedMean),
    p25: round(p25),
    p75: round(p75),
    outlier_count: outlierCount,
    outlier_lower_bound: round(outlierLowerBound),
    outlier_upper_bound: round(outlierUpperBound),
    confidence_level: sampleCount < 3 ? "INSUFFICIENT" : sampleCount < 5 ? "LOW_SAMPLE" : sampleCount < 10 ? "MEDIUM" : "HIGH"
  };
}

function outlierReason(value, summary) {
  if (summary.sample_count < 10) return null;
  if (value < summary.outlier_lower_bound) return "IQR_LOW";
  if (value > summary.outlier_upper_bound) return "IQR_HIGH";
  return null;
}

function dayKey(value) {
  return iso(value).slice(0, 10);
}

function priceStatsWindow(asOfValue, daysValue) {
  const asOf = iso(asOfValue);
  const days = Math.min(365, Math.max(1, Number(daysValue) || 30));
  const asOfDay = Date.parse(`${dayKey(asOf)}T00:00:00.000Z`);
  const from = new Date(asOfDay - (days - 1) * DAY_MS).toISOString();
  return { asOf, days, from };
}

function requireValue(value, label) {
  const cleaned = cleanText(value, 300);
  if (!cleaned) throw new TypeError(`${label} is required`);
  return cleaned;
}

function validatedProductSpec(categoryCode, value) {
  if (value == null) return {};
  if (typeof value !== "object" || Array.isArray(value)) throw new TypeError("spec must be an object");
  const spec = stableValue(value);
  for (const [key, fieldValue] of Object.entries(spec)) {
    if (POSITIVE_SPEC_FIELDS.has(key) && (!Number.isFinite(Number(fieldValue)) || Number(fieldValue) <= 0)) {
      throw new TypeError(`invalid positive product spec: ${key}`);
    }
    if (fieldValue !== null && !["string", "number", "boolean"].includes(typeof fieldValue)
      && !Array.isArray(fieldValue) && typeof fieldValue !== "object") {
      throw new TypeError(`invalid product spec value: ${key}`);
    }
  }
  if (categoryCode === "GPU" && spec.chip_manufacturer != null && typeof spec.chip_manufacturer !== "string") {
    throw new TypeError("GPU chip_manufacturer must be a string");
  }
  return spec;
}

export function normalizeProductAlias(value) {
  return cleanText(value, 500)
    .toLowerCase()
    .replace(/[^0-9a-z가-힣]+/gu, "")
    .trim();
}

export class PcPartsLedger {
  constructor(options = {}) {
    this.now = typeof options.now === "function" ? options.now : () => Date.now();
    this.ownsDb = !options.db;
    this.filePath = options.filePath || ":memory:";
    if (!options.db && this.filePath !== ":memory:") mkdirSync(path.dirname(this.filePath), { recursive: true });
    this.db = options.db || new DatabaseSync(this.filePath);
    this.db.function("pc_source_listing_identity", { deterministic: true }, (sourceId, sourceListingId) => (
      canonicalSourceListingIdentity(sourceId, sourceListingId)
    ));
    this.db.exec("PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;");
  }

  migrate() {
    migrateDailyPriceStatsReservedScope(this.db);
    this.db.exec("BEGIN IMMEDIATE");
    try {
      this.db.exec(`
        CREATE TABLE IF NOT EXISTS pc_parts_schema_migrations (
          version INTEGER PRIMARY KEY,
          applied_at TEXT NOT NULL
        ) STRICT;

        CREATE TABLE IF NOT EXISTS sources (
          source_id TEXT PRIMARY KEY,
          display_name TEXT NOT NULL,
          default_market_pool TEXT NOT NULL,
          allowed_market_pools_json TEXT NOT NULL DEFAULT '[]',
          policy_status TEXT NOT NULL CHECK(policy_status IN ('REVIEW_REQUIRED', 'APPROVED', 'DENIED')),
          policy_reviewed_at TEXT,
          policy_note TEXT,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        ) STRICT;

        CREATE TABLE IF NOT EXISTS source_runtime (
          source_id TEXT PRIMARY KEY REFERENCES sources(source_id) ON DELETE RESTRICT,
          runtime_status TEXT NOT NULL CHECK(runtime_status IN ('DISABLED', 'ADAPTER_READY', 'ENABLED', 'QUARANTINED')),
          last_started_at TEXT,
          last_succeeded_at TEXT,
          quarantined_at TEXT,
          backoff_until TEXT,
          quarantine_until TEXT,
          incremental_cursor TEXT,
          failure_count INTEGER NOT NULL DEFAULT 0,
          last_error TEXT,
          updated_at TEXT NOT NULL
        ) STRICT;

        CREATE TABLE IF NOT EXISTS pc_collection_target_sets (
          target_set_version TEXT PRIMARY KEY,
          directory_version TEXT NOT NULL,
          target_count INTEGER NOT NULL,
          target_checksum TEXT NOT NULL,
          set_status TEXT NOT NULL CHECK(set_status IN ('ACTIVE', 'SUPERSEDED')),
          created_at TEXT NOT NULL,
          activated_at TEXT
        ) STRICT;
        CREATE UNIQUE INDEX IF NOT EXISTS idx_pc_collection_target_set_active
          ON pc_collection_target_sets(set_status) WHERE set_status = 'ACTIVE';

        CREATE TABLE IF NOT EXISTS pc_collection_targets (
          target_id TEXT PRIMARY KEY,
          target_set_version TEXT NOT NULL REFERENCES pc_collection_target_sets(target_set_version) ON DELETE RESTRICT,
          canonical_product_id TEXT,
          category_code TEXT NOT NULL,
          query_text TEXT NOT NULL,
          source_keys_json TEXT NOT NULL DEFAULT '[]',
          cadence_class TEXT NOT NULL DEFAULT 'HOURLY_CATEGORY',
          minimum_interval_minutes INTEGER NOT NULL DEFAULT 55,
          target_order INTEGER NOT NULL DEFAULT 0,
          enabled INTEGER NOT NULL DEFAULT 1 CHECK(enabled IN (0, 1)),
          created_at TEXT NOT NULL
        ) STRICT;
        CREATE INDEX IF NOT EXISTS idx_pc_collection_targets_active
          ON pc_collection_targets(target_set_version, enabled, target_order, target_id);

        CREATE TABLE IF NOT EXISTS pc_source_target_runtime (
          source_id TEXT NOT NULL REFERENCES sources(source_id) ON DELETE RESTRICT,
          target_id TEXT NOT NULL REFERENCES pc_collection_targets(target_id) ON DELETE RESTRICT,
          last_started_at TEXT,
          last_succeeded_at TEXT,
          failure_count INTEGER NOT NULL DEFAULT 0,
          incremental_cursor TEXT,
          last_error TEXT,
          updated_at TEXT NOT NULL,
          PRIMARY KEY(source_id, target_id)
        ) STRICT;
        CREATE INDEX IF NOT EXISTS idx_pc_source_target_due
          ON pc_source_target_runtime(source_id, last_succeeded_at, updated_at);

        CREATE TABLE IF NOT EXISTS pc_publication_runtime (
          publication_kind TEXT PRIMARY KEY,
          publication_id TEXT NOT NULL,
          checksum TEXT NOT NULL,
          row_count INTEGER NOT NULL CHECK(row_count > 0),
          published_at TEXT NOT NULL
        ) STRICT;

        CREATE TABLE IF NOT EXISTS crawl_runs (
          crawl_run_id TEXT PRIMARY KEY,
          source_id TEXT NOT NULL REFERENCES sources(source_id) ON DELETE RESTRICT,
          started_at TEXT NOT NULL,
          finished_at TEXT,
          run_status TEXT NOT NULL CHECK(run_status IN ('RUNNING', 'SUCCEEDED', 'FAILED', 'QUARANTINED')),
          collected_count INTEGER NOT NULL DEFAULT 0,
          changed_count INTEGER NOT NULL DEFAULT 0,
          request_count INTEGER NOT NULL DEFAULT 0,
          request_failure_count INTEGER NOT NULL DEFAULT 0,
          parsed_count INTEGER NOT NULL DEFAULT 0,
          parse_failure_count INTEGER NOT NULL DEFAULT 0,
          http_blocked_count INTEGER NOT NULL DEFAULT 0,
          captcha_count INTEGER NOT NULL DEFAULT 0,
          error_message TEXT,
          adapter_version TEXT
        ) STRICT;
        CREATE INDEX IF NOT EXISTS idx_crawl_runs_source_started ON crawl_runs(source_id, started_at DESC);

        CREATE TABLE IF NOT EXISTS raw_listings (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          source_id TEXT NOT NULL REFERENCES sources(source_id) ON DELETE RESTRICT,
          source_listing_id TEXT NOT NULL,
          payload_hash TEXT NOT NULL,
          raw_json TEXT NOT NULL,
          title TEXT NOT NULL,
          description TEXT,
          seller_ref_masked TEXT,
          captured_at TEXT NOT NULL,
          last_seen_at TEXT NOT NULL,
          last_checked_at TEXT NOT NULL,
          missing_check_count INTEGER NOT NULL DEFAULT 0,
          last_missing_checked_at TEXT,
          UNIQUE(source_id, source_listing_id, payload_hash)
        ) STRICT;
        CREATE INDEX IF NOT EXISTS idx_raw_listing_identity ON raw_listings(source_id, source_listing_id, id DESC);

        CREATE TRIGGER IF NOT EXISTS raw_listings_content_immutable
        BEFORE UPDATE OF source_id, source_listing_id, payload_hash, raw_json, title, description, seller_ref_masked, captured_at ON raw_listings
        BEGIN SELECT RAISE(ABORT, 'raw listing content is immutable'); END;
        CREATE TRIGGER IF NOT EXISTS raw_listings_delete_immutable
        BEFORE DELETE ON raw_listings
        BEGIN SELECT RAISE(ABORT, 'raw listing content is immutable'); END;

        CREATE TABLE IF NOT EXISTS listing_snapshots (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          raw_listing_id INTEGER NOT NULL REFERENCES raw_listings(id) ON DELETE RESTRICT,
          source_id TEXT NOT NULL,
          source_listing_id TEXT NOT NULL,
          observed_at TEXT NOT NULL,
          state_hash TEXT NOT NULL,
          lifecycle_status TEXT NOT NULL CHECK(lifecycle_status IN ('ACTIVE', 'RESERVED', 'SOLD', 'DELETED', 'EXPIRED', 'UNAVAILABLE_UNKNOWN', 'BLOCKED_OR_PRIVATE')),
          availability TEXT NOT NULL,
          price_value REAL,
          currency TEXT NOT NULL,
          sold_last_ask_price REAL,
          transaction_price REAL,
          status_evidence_json TEXT NOT NULL,
          transaction_evidence_json TEXT NOT NULL DEFAULT '{}',
          created_at TEXT NOT NULL
        ) STRICT;
        CREATE INDEX IF NOT EXISTS idx_listing_snapshots_identity ON listing_snapshots(source_id, source_listing_id, observed_at DESC, id DESC);
        CREATE INDEX IF NOT EXISTS idx_listing_snapshots_status ON listing_snapshots(lifecycle_status, observed_at);

        CREATE TABLE IF NOT EXISTS normalized_listings (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          snapshot_id INTEGER NOT NULL REFERENCES listing_snapshots(id) ON DELETE RESTRICT,
          normalization_version INTEGER NOT NULL DEFAULT 1,
          parser_version TEXT NOT NULL,
          rule_version TEXT NOT NULL,
          filter_version TEXT NOT NULL,
          canonical_product_id TEXT,
          canonical_display_name TEXT,
          category_code TEXT NOT NULL,
          market_segment TEXT NOT NULL DEFAULT 'UNKNOWN',
          listing_type TEXT NOT NULL DEFAULT 'UNKNOWN',
          condition_group TEXT NOT NULL DEFAULT 'UNKNOWN',
          spec_group_id TEXT,
          classification_confidence REAL NOT NULL DEFAULT 0,
          model_confidence REAL NOT NULL DEFAULT 0,
          quantity_confidence REAL NOT NULL DEFAULT 0,
          price_scope_confidence REAL NOT NULL DEFAULT 0,
          statistics_eligible INTEGER NOT NULL DEFAULT 0 CHECK(statistics_eligible IN (0, 1)),
          statistics_exclusion_reasons_json TEXT NOT NULL DEFAULT '[]',
          listing_kind TEXT NOT NULL,
          quantity INTEGER,
          price_scope TEXT,
          condition_code TEXT NOT NULL,
          market_pool TEXT NOT NULL,
          exact_product INTEGER NOT NULL CHECK(exact_product IN (0, 1)),
          price_eligible INTEGER NOT NULL CHECK(price_eligible IN (0, 1)),
          exclusion_reasons_json TEXT NOT NULL,
          confidence_json TEXT NOT NULL,
          evidence_json TEXT NOT NULL,
          normalized_at TEXT NOT NULL,
          UNIQUE(snapshot_id, normalization_version)
        ) STRICT;
        CREATE INDEX IF NOT EXISTS idx_normalized_product ON normalized_listings(canonical_product_id, market_pool, condition_code);

        CREATE TABLE IF NOT EXISTS listing_items (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          normalized_listing_id INTEGER NOT NULL REFERENCES normalized_listings(id) ON DELETE RESTRICT,
          item_index INTEGER NOT NULL,
          canonical_product_id TEXT,
          quantity INTEGER,
          unit_price REAL,
          total_price REAL,
          currency TEXT NOT NULL,
          spec_json TEXT NOT NULL,
          UNIQUE(normalized_listing_id, item_index)
        ) STRICT;

        CREATE TABLE IF NOT EXISTS product_master (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          canonical_product_id TEXT NOT NULL,
          master_version INTEGER NOT NULL,
          canonical_display_name TEXT NOT NULL,
          manufacturer TEXT,
          brand TEXT,
          category_code TEXT NOT NULL,
          product_group_key TEXT NOT NULL,
          spec_json TEXT NOT NULL,
          valid_from TEXT NOT NULL,
          valid_to TEXT,
          created_at TEXT NOT NULL,
          UNIQUE(canonical_product_id, master_version)
        ) STRICT;

        CREATE TABLE IF NOT EXISTS product_aliases (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          canonical_product_id TEXT NOT NULL,
          master_version INTEGER NOT NULL,
          alias_text TEXT NOT NULL,
          alias_type TEXT NOT NULL CHECK(alias_type IN ('ALIAS', 'FORBIDDEN')),
          validation_status TEXT NOT NULL CHECK(validation_status IN ('CANDIDATE', 'SHADOW', 'APPROVED', 'REJECTED')),
          shadow_started_at TEXT,
          approved_at TEXT,
          created_at TEXT NOT NULL,
          UNIQUE(canonical_product_id, master_version, alias_text, alias_type),
          FOREIGN KEY(canonical_product_id, master_version)
            REFERENCES product_master(canonical_product_id, master_version) ON DELETE RESTRICT
        ) STRICT;

        CREATE TABLE IF NOT EXISTS classification_feedback (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          snapshot_id INTEGER NOT NULL REFERENCES listing_snapshots(id) ON DELETE RESTRICT,
          field_name TEXT NOT NULL,
          previous_value_json TEXT,
          corrected_value_json TEXT NOT NULL,
          reviewer_ref TEXT,
          reason TEXT,
          created_at TEXT NOT NULL
        ) STRICT;

        CREATE TABLE IF NOT EXISTS duplicate_clusters (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          cluster_key TEXT NOT NULL UNIQUE,
          confidence REAL NOT NULL CHECK(confidence >= 0 AND confidence <= 1),
          cluster_status TEXT NOT NULL CHECK(cluster_status IN ('UNCERTAIN', 'CONFIRMED', 'REJECTED')),
          evidence_json TEXT NOT NULL,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        ) STRICT;

        CREATE TABLE IF NOT EXISTS duplicate_cluster_members (
          cluster_id INTEGER NOT NULL REFERENCES duplicate_clusters(id) ON DELETE CASCADE,
          snapshot_id INTEGER NOT NULL REFERENCES listing_snapshots(id) ON DELETE RESTRICT,
          source_id TEXT NOT NULL,
          source_listing_id TEXT NOT NULL,
          added_at TEXT NOT NULL,
          PRIMARY KEY(cluster_id, snapshot_id),
          UNIQUE(snapshot_id)
        ) STRICT;

        CREATE TABLE IF NOT EXISTS daily_price_stats (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          stat_date TEXT NOT NULL,
          canonical_product_id TEXT NOT NULL,
          market_pool TEXT NOT NULL,
          condition_code TEXT NOT NULL,
          currency TEXT NOT NULL,
          metric_scope TEXT NOT NULL CHECK(metric_scope IN ('ACTIVE', 'RESERVED', 'SOLD', 'CONFIRMED_TRANSACTION')),
          sample_count INTEGER NOT NULL,
          unit_count INTEGER NOT NULL DEFAULT 0,
          mean_value REAL,
          median_value REAL,
          trimmed_mean_value REAL,
          min_value REAL,
          max_value REAL,
          p25_value REAL,
          p75_value REAL,
          outlier_count INTEGER NOT NULL DEFAULT 0,
          outlier_lower_bound REAL,
          outlier_upper_bound REAL,
          seven_day_sold_median REAL,
          confidence_level TEXT NOT NULL,
          normalization_version INTEGER NOT NULL DEFAULT 1,
          parser_version TEXT NOT NULL,
          rule_version TEXT NOT NULL,
          filter_version TEXT NOT NULL,
          as_of TEXT NOT NULL,
          UNIQUE(stat_date, canonical_product_id, market_pool, condition_code, currency, metric_scope)
        ) STRICT;
        CREATE INDEX IF NOT EXISTS idx_daily_price_stats_lookup ON daily_price_stats(canonical_product_id, market_pool, condition_code, currency, stat_date DESC);

        CREATE TABLE IF NOT EXISTS daily_price_stat_members (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          daily_price_stat_id INTEGER NOT NULL REFERENCES daily_price_stats(id) ON DELETE CASCADE,
          snapshot_id INTEGER NOT NULL REFERENCES listing_snapshots(id) ON DELETE RESTRICT,
          listing_item_id INTEGER NOT NULL REFERENCES listing_items(id) ON DELETE RESTRICT,
          raw_listing_id INTEGER NOT NULL REFERENCES raw_listings(id) ON DELETE RESTRICT,
          member_role TEXT NOT NULL,
          price_value REAL NOT NULL,
          included INTEGER NOT NULL DEFAULT 1 CHECK(included IN (0, 1)),
          exclusion_reason TEXT,
          outlier_flag INTEGER NOT NULL DEFAULT 0 CHECK(outlier_flag IN (0, 1)),
          outlier_reason TEXT,
          UNIQUE(daily_price_stat_id, snapshot_id, listing_item_id, member_role)
        ) STRICT;

        CREATE TABLE IF NOT EXISTS daily_source_price_stats (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          daily_price_stat_id INTEGER NOT NULL REFERENCES daily_price_stats(id) ON DELETE CASCADE,
          source_id TEXT NOT NULL REFERENCES sources(source_id) ON DELETE RESTRICT,
          sample_count INTEGER NOT NULL,
          unit_count INTEGER NOT NULL DEFAULT 0,
          mean_value REAL,
          median_value REAL,
          trimmed_mean_value REAL,
          min_value REAL,
          max_value REAL,
          p25_value REAL,
          p75_value REAL,
          outlier_count INTEGER NOT NULL DEFAULT 0,
          outlier_lower_bound REAL,
          outlier_upper_bound REAL,
          seven_day_sold_median REAL,
          confidence_level TEXT NOT NULL,
          UNIQUE(daily_price_stat_id, source_id)
        ) STRICT;
        CREATE INDEX IF NOT EXISTS idx_daily_source_price_stats_lookup
          ON daily_source_price_stats(source_id, daily_price_stat_id);

        CREATE TABLE IF NOT EXISTS daily_source_price_stat_members (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          daily_source_price_stat_id INTEGER NOT NULL REFERENCES daily_source_price_stats(id) ON DELETE CASCADE,
          snapshot_id INTEGER NOT NULL REFERENCES listing_snapshots(id) ON DELETE RESTRICT,
          listing_item_id INTEGER NOT NULL REFERENCES listing_items(id) ON DELETE RESTRICT,
          raw_listing_id INTEGER NOT NULL REFERENCES raw_listings(id) ON DELETE RESTRICT,
          member_role TEXT NOT NULL,
          price_value REAL NOT NULL,
          outlier_flag INTEGER NOT NULL DEFAULT 0 CHECK(outlier_flag IN (0, 1)),
          outlier_reason TEXT,
          UNIQUE(daily_source_price_stat_id, snapshot_id, listing_item_id, member_role)
        ) STRICT;

        CREATE TABLE IF NOT EXISTS pc_pipeline_versions (
          version_key TEXT PRIMARY KEY,
          normalization_version INTEGER NOT NULL,
          parser_version TEXT NOT NULL,
          rule_version TEXT NOT NULL,
          filter_version TEXT NOT NULL,
          model_version TEXT NOT NULL,
          version_status TEXT NOT NULL CHECK(version_status IN ('STAGED', 'ACTIVE', 'SUPERSEDED', 'ROLLED_BACK')),
          previous_version_key TEXT REFERENCES pc_pipeline_versions(version_key) ON DELETE RESTRICT,
          quality_report_json TEXT NOT NULL DEFAULT '{}',
          activated_at TEXT,
          rolled_back_at TEXT,
          created_at TEXT NOT NULL
        ) STRICT;
        CREATE UNIQUE INDEX IF NOT EXISTS idx_pc_pipeline_single_active
          ON pc_pipeline_versions(version_status) WHERE version_status = 'ACTIVE';

        CREATE TABLE IF NOT EXISTS model_candidates (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          category_code TEXT NOT NULL,
          candidate_text TEXT NOT NULL,
          candidate_status TEXT NOT NULL CHECK(candidate_status IN ('CANDIDATE', 'REVIEW_REQUIRED', 'PROMOTED', 'REJECTED')),
          first_seen_at TEXT NOT NULL,
          last_seen_at TEXT NOT NULL,
          distinct_listing_count INTEGER NOT NULL DEFAULT 0,
          distinct_source_count INTEGER NOT NULL DEFAULT 0,
          evidence_json TEXT NOT NULL DEFAULT '{}',
          UNIQUE(category_code, candidate_text)
        ) STRICT;

        CREATE TABLE IF NOT EXISTS model_candidate_sightings (
          candidate_id INTEGER NOT NULL REFERENCES model_candidates(id) ON DELETE CASCADE,
          source_id TEXT NOT NULL,
          source_listing_id TEXT NOT NULL,
          snapshot_id INTEGER NOT NULL REFERENCES listing_snapshots(id) ON DELETE RESTRICT,
          observed_at TEXT NOT NULL,
          PRIMARY KEY(candidate_id, source_id, source_listing_id)
        ) STRICT;
      `);
      const snapshotColumns = new Set(this.db.prepare("PRAGMA table_info(listing_snapshots)").all().map((row) => row.name));
      if (!snapshotColumns.has("transaction_evidence_json")) {
        this.db.exec("ALTER TABLE listing_snapshots ADD COLUMN transaction_evidence_json TEXT NOT NULL DEFAULT '{}'");
      }
      const normalizedColumns = new Set(this.db.prepare("PRAGMA table_info(normalized_listings)").all().map((row) => row.name));
      if (!normalizedColumns.has("market_segment")) this.db.exec("ALTER TABLE normalized_listings ADD COLUMN market_segment TEXT NOT NULL DEFAULT 'UNKNOWN'");
      if (!normalizedColumns.has("listing_type")) this.db.exec("ALTER TABLE normalized_listings ADD COLUMN listing_type TEXT NOT NULL DEFAULT 'UNKNOWN'");
      if (!normalizedColumns.has("condition_group")) this.db.exec("ALTER TABLE normalized_listings ADD COLUMN condition_group TEXT NOT NULL DEFAULT 'UNKNOWN'");
      if (!normalizedColumns.has("spec_group_id")) this.db.exec("ALTER TABLE normalized_listings ADD COLUMN spec_group_id TEXT");
      if (!normalizedColumns.has("classification_confidence")) this.db.exec("ALTER TABLE normalized_listings ADD COLUMN classification_confidence REAL NOT NULL DEFAULT 0");
      if (!normalizedColumns.has("model_confidence")) this.db.exec("ALTER TABLE normalized_listings ADD COLUMN model_confidence REAL NOT NULL DEFAULT 0");
      if (!normalizedColumns.has("quantity_confidence")) this.db.exec("ALTER TABLE normalized_listings ADD COLUMN quantity_confidence REAL NOT NULL DEFAULT 0");
      if (!normalizedColumns.has("price_scope_confidence")) this.db.exec("ALTER TABLE normalized_listings ADD COLUMN price_scope_confidence REAL NOT NULL DEFAULT 0");
      if (!normalizedColumns.has("statistics_eligible")) this.db.exec("ALTER TABLE normalized_listings ADD COLUMN statistics_eligible INTEGER NOT NULL DEFAULT 0");
      if (!normalizedColumns.has("statistics_exclusion_reasons_json")) this.db.exec("ALTER TABLE normalized_listings ADD COLUMN statistics_exclusion_reasons_json TEXT NOT NULL DEFAULT '[]'");
      const runtimeColumns = new Set(this.db.prepare("PRAGMA table_info(source_runtime)").all().map((row) => row.name));
      if (!runtimeColumns.has("backoff_until")) this.db.exec("ALTER TABLE source_runtime ADD COLUMN backoff_until TEXT");
      if (!runtimeColumns.has("quarantine_until")) this.db.exec("ALTER TABLE source_runtime ADD COLUMN quarantine_until TEXT");
      if (!runtimeColumns.has("incremental_cursor")) this.db.exec("ALTER TABLE source_runtime ADD COLUMN incremental_cursor TEXT");
      const targetSetColumns = new Set(this.db.prepare("PRAGMA table_info(pc_collection_target_sets)").all().map((row) => row.name));
      if (!targetSetColumns.has("target_checksum")) this.db.exec("ALTER TABLE pc_collection_target_sets ADD COLUMN target_checksum TEXT NOT NULL DEFAULT ''");
      const collectionTargetColumns = new Set(this.db.prepare("PRAGMA table_info(pc_collection_targets)").all().map((row) => row.name));
      if (!collectionTargetColumns.has("source_keys_json")) {
        this.db.exec("ALTER TABLE pc_collection_targets ADD COLUMN source_keys_json TEXT NOT NULL DEFAULT '[]'");
      }
      if (!collectionTargetColumns.has("cadence_class")) {
        this.db.exec("ALTER TABLE pc_collection_targets ADD COLUMN cadence_class TEXT NOT NULL DEFAULT 'HOURLY_CATEGORY'");
      }
      if (!collectionTargetColumns.has("minimum_interval_minutes")) {
        this.db.exec("ALTER TABLE pc_collection_targets ADD COLUMN minimum_interval_minutes INTEGER NOT NULL DEFAULT 55");
      }
      const sourceColumns = new Set(this.db.prepare("PRAGMA table_info(sources)").all().map((row) => row.name));
      if (!sourceColumns.has("allowed_market_pools_json")) this.db.exec("ALTER TABLE sources ADD COLUMN allowed_market_pools_json TEXT NOT NULL DEFAULT '[]'");
      const crawlRunColumns = new Set(this.db.prepare("PRAGMA table_info(crawl_runs)").all().map((row) => row.name));
      for (const column of ["request_count", "request_failure_count", "parsed_count", "parse_failure_count", "http_blocked_count", "captcha_count"]) {
        if (!crawlRunColumns.has(column)) this.db.exec(`ALTER TABLE crawl_runs ADD COLUMN ${column} INTEGER NOT NULL DEFAULT 0`);
      }
      const statColumns = new Set(this.db.prepare("PRAGMA table_info(daily_price_stats)").all().map((row) => row.name));
      if (!statColumns.has("outlier_count")) this.db.exec("ALTER TABLE daily_price_stats ADD COLUMN outlier_count INTEGER NOT NULL DEFAULT 0");
      if (!statColumns.has("outlier_lower_bound")) this.db.exec("ALTER TABLE daily_price_stats ADD COLUMN outlier_lower_bound REAL");
      if (!statColumns.has("outlier_upper_bound")) this.db.exec("ALTER TABLE daily_price_stats ADD COLUMN outlier_upper_bound REAL");
      if (!statColumns.has("unit_count")) this.db.exec("ALTER TABLE daily_price_stats ADD COLUMN unit_count INTEGER NOT NULL DEFAULT 0");
      if (!statColumns.has("min_value")) this.db.exec("ALTER TABLE daily_price_stats ADD COLUMN min_value REAL");
      if (!statColumns.has("max_value")) this.db.exec("ALTER TABLE daily_price_stats ADD COLUMN max_value REAL");
      if (!statColumns.has("seven_day_sold_median")) this.db.exec("ALTER TABLE daily_price_stats ADD COLUMN seven_day_sold_median REAL");
      if (!statColumns.has("normalization_version")) this.db.exec("ALTER TABLE daily_price_stats ADD COLUMN normalization_version INTEGER NOT NULL DEFAULT 1");
      const memberColumns = new Set(this.db.prepare("PRAGMA table_info(daily_price_stat_members)").all().map((row) => row.name));
      if (!memberColumns.has("outlier_flag")) this.db.exec("ALTER TABLE daily_price_stat_members ADD COLUMN outlier_flag INTEGER NOT NULL DEFAULT 0");
      if (!memberColumns.has("outlier_reason")) this.db.exec("ALTER TABLE daily_price_stat_members ADD COLUMN outlier_reason TEXT");
      this.db.prepare("INSERT OR IGNORE INTO pc_parts_schema_migrations(version, applied_at) VALUES (1, ?)").run(new Date(this.now()).toISOString());
      this.db.prepare("INSERT OR IGNORE INTO pc_parts_schema_migrations(version, applied_at) VALUES (2, ?)").run(new Date(this.now()).toISOString());
      this.db.prepare("INSERT OR IGNORE INTO pc_parts_schema_migrations(version, applied_at) VALUES (3, ?)").run(new Date(this.now()).toISOString());
      this.db.prepare("INSERT OR IGNORE INTO pc_parts_schema_migrations(version, applied_at) VALUES (4, ?)").run(new Date(this.now()).toISOString());
      const versionTimestamp = new Date(this.now()).toISOString();
      this.db.prepare(`INSERT OR IGNORE INTO pc_pipeline_versions(
        version_key, normalization_version, parser_version, rule_version, filter_version, model_version,
        version_status, previous_version_key, quality_report_json, activated_at, rolled_back_at, created_at
      ) VALUES ('pc-v1', 1, 'pc-parser-v1', 'pc-rules-v1', 'pc-filter-v1', 'pc-master-v1',
        'ACTIVE', NULL, '{}', ?, NULL, ?)`)
        .run(versionTimestamp, versionTimestamp);
      this.db.prepare("INSERT OR IGNORE INTO pc_parts_schema_migrations(version, applied_at) VALUES (5, ?)").run(versionTimestamp);
      this.db.prepare("INSERT OR IGNORE INTO pc_parts_schema_migrations(version, applied_at) VALUES (6, ?)").run(versionTimestamp);
      this.db.prepare("INSERT OR IGNORE INTO pc_parts_schema_migrations(version, applied_at) VALUES (7, ?)").run(versionTimestamp);
      this.db.prepare("INSERT OR IGNORE INTO pc_parts_schema_migrations(version, applied_at) VALUES (8, ?)").run(versionTimestamp);
      this.db.prepare("INSERT OR IGNORE INTO pc_parts_schema_migrations(version, applied_at) VALUES (9, ?)").run(versionTimestamp);
      this.db.exec("COMMIT");
    } catch (error) {
      try { this.db.exec("ROLLBACK"); } catch {}
      throw error;
    }
  }

  getActivePipelineVersion() {
    return this.db.prepare(`SELECT * FROM pc_pipeline_versions
      WHERE version_status = 'ACTIVE' ORDER BY activated_at DESC, created_at DESC LIMIT 1`).get() || null;
  }

  registerPipelineVersion(input) {
    const versionKey = requireValue(input.versionKey, "versionKey");
    const normalizationVersion = Number(input.normalizationVersion);
    if (!Number.isInteger(normalizationVersion) || normalizationVersion < 1) throw new TypeError("invalid normalizationVersion");
    const parserVersion = requireValue(input.parserVersion, "parserVersion");
    const ruleVersion = requireValue(input.ruleVersion, "ruleVersion");
    const filterVersion = requireValue(input.filterVersion, "filterVersion");
    const modelVersion = requireValue(input.modelVersion || "pc-master-v1", "modelVersion");
    const previousVersionKey = cleanText(input.previousVersionKey || this.getActivePipelineVersion()?.version_key, 300) || null;
    const existing = this.db.prepare("SELECT * FROM pc_pipeline_versions WHERE version_key = ?").get(versionKey);
    if (existing) {
      if (existing.normalization_version !== normalizationVersion || existing.parser_version !== parserVersion
        || existing.rule_version !== ruleVersion || existing.filter_version !== filterVersion
        || existing.model_version !== modelVersion) {
        throw new Error(`PIPELINE_VERSION_IDENTITY_CONFLICT:${versionKey}`);
      }
      return existing;
    }
    const timestamp = new Date(this.now()).toISOString();
    this.db.prepare(`INSERT INTO pc_pipeline_versions(
      version_key, normalization_version, parser_version, rule_version, filter_version, model_version,
      version_status, previous_version_key, quality_report_json, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, 'STAGED', ?, '{}', ?)`)
      .run(versionKey, normalizationVersion, parserVersion, ruleVersion, filterVersion, modelVersion, previousVersionKey, timestamp);
    return this.db.prepare("SELECT * FROM pc_pipeline_versions WHERE version_key = ?").get(versionKey);
  }

  evaluatePipelineVersion({ versionKey, qualityReport, baselineReport = null, evaluatedAt = new Date(this.now()) }) {
    const candidate = this.db.prepare("SELECT * FROM pc_pipeline_versions WHERE version_key = ?").get(requireValue(versionKey, "versionKey"));
    if (!candidate) throw new Error("pipeline version not found");
    if (!new Set(["STAGED", "ACTIVE"]).has(candidate.version_status)) throw new Error("pipeline version cannot be evaluated");
    if (candidate.version_status === "STAGED") {
      const coverage = this.db.prepare(`SELECT
          (SELECT COUNT(*) FROM listing_snapshots) AS total_snapshots,
          COUNT(DISTINCT n.snapshot_id) AS normalized_snapshots
        FROM normalized_listings n
        WHERE n.normalization_version = ? AND n.parser_version = ? AND n.rule_version = ? AND n.filter_version = ?`)
        .get(candidate.normalization_version, candidate.parser_version, candidate.rule_version, candidate.filter_version);
      if (Number(coverage?.normalized_snapshots || 0) !== Number(coverage?.total_snapshots || 0)) {
        return {
          status: "STAGED",
          changed: false,
          reason: "NORMALIZATION_COVERAGE_INCOMPLETE",
          totalSnapshots: Number(coverage?.total_snapshots || 0),
          normalizedSnapshots: Number(coverage?.normalized_snapshots || 0)
        };
      }
    }
    const report = qualityReport && typeof qualityReport === "object" ? qualityReport : {};
    const targetStates = Object.values(report.targets || {}).map((target) => target?.met);
    const hasCompleteEvidence = Number(report.metrics?.reviewed_records || 0) > 0
      && targetStates.length >= 6 && targetStates.every((met) => met === true || met === false);
    if (!hasCompleteEvidence) {
      return { status: candidate.version_status, changed: false, reason: "INSUFFICIENT_QUALITY_EVIDENCE" };
    }
    const blockers = Object.values(report.integrity_blockers || {}).some((value) => Number(value) > 0);
    const failedTargetCount = targetStates.filter((met) => met === false).length;
    // Quality percentages are review-set signals, not integrity invariants. A
    // single small miss must not roll back an otherwise safe pipeline; exact
    // fail-closed behavior remains reserved for the integrity blockers above.
    const severeQualityFailure = (
      (Number.isFinite(report.metrics?.category_precision) && report.metrics.category_precision < 0.95)
      || (Number.isFinite(report.metrics?.exact_model_accuracy) && report.metrics.exact_model_accuracy <= 0.90)
      || (Number.isFinite(report.metrics?.ram_quantity_price_scope_accuracy) && report.metrics.ram_quantity_price_scope_accuracy < 0.98)
      || (Number.isFinite(report.metrics?.bundle_contamination_rate) && report.metrics.bundle_contamination_rate > 0.02)
      || (Number.isFinite(report.metrics?.unknown_rate) && report.metrics.unknown_rate > 0.20)
    );
    const targetFailure = severeQualityFailure || failedTargetCount >= 2;
    const baseline = baselineReport || parseJson(this.db.prepare(
      "SELECT quality_report_json FROM pc_pipeline_versions WHERE version_key = ?"
    ).get(candidate.previous_version_key)?.quality_report_json, null);
    const baselineRegressionSignals = baseline?.metrics ? [
      ["category_precision", 0.005, "higher"],
      ["exact_model_accuracy", 0.01, "higher"],
      ["ram_quantity_price_scope_accuracy", 0.005, "higher"],
      ["bundle_contamination_rate", 0.0025, "lower"],
      ["false_dedupe_rate", 0, "lower"],
      ["unknown_rate", 0.05, "lower"]
    ].filter(([key, tolerance, direction]) => (
      Number.isFinite(report.metrics?.[key]) && Number.isFinite(baseline.metrics?.[key])
      && (direction === "higher"
        ? baseline.metrics[key] - report.metrics[key] > tolerance
        : report.metrics[key] - baseline.metrics[key] > tolerance)
    )) : [];
    const degraded = baselineRegressionSignals.length >= 2;
    if ((blockers || targetFailure || degraded) && candidate.previous_version_key) {
      const previous = this.db.prepare("SELECT * FROM pc_pipeline_versions WHERE version_key = ?")
        .get(candidate.previous_version_key);
      if (!previous) throw new Error(`ROLLBACK_VERSION_NOT_FOUND:${candidate.previous_version_key}`);
      const rollbackCoverage = this.db.prepare(`SELECT
          (SELECT COUNT(*) FROM listing_snapshots) AS total_snapshots,
          COUNT(DISTINCT n.snapshot_id) AS normalized_snapshots
        FROM normalized_listings n
        WHERE n.normalization_version = ? AND n.parser_version = ? AND n.rule_version = ? AND n.filter_version = ?`)
        .get(previous.normalization_version, previous.parser_version, previous.rule_version, previous.filter_version);
      if (Number(rollbackCoverage?.normalized_snapshots || 0) !== Number(rollbackCoverage?.total_snapshots || 0)) {
        return {
          status: candidate.version_status,
          changed: false,
          reason: "ROLLBACK_COVERAGE_INCOMPLETE",
          totalSnapshots: Number(rollbackCoverage?.total_snapshots || 0),
          normalizedSnapshots: Number(rollbackCoverage?.normalized_snapshots || 0)
        };
      }
    }
    const timestamp = iso(evaluatedAt);
    return this.transaction(() => {
      if (blockers || targetFailure || degraded) {
        this.db.prepare(`UPDATE pc_pipeline_versions SET version_status = 'ROLLED_BACK',
          quality_report_json = ?, rolled_back_at = ? WHERE version_key = ?`)
          .run(stableJson(report), timestamp, candidate.version_key);
        if (candidate.previous_version_key) {
          this.db.prepare(`UPDATE pc_pipeline_versions SET version_status = 'ACTIVE', activated_at = ?, rolled_back_at = NULL
            WHERE version_key = ?`).run(timestamp, candidate.previous_version_key);
        }
        return { status: "ROLLED_BACK", changed: true, reason: blockers ? "INTEGRITY_BLOCKER" : targetFailure ? "QUALITY_TARGET_MISSED" : "BASELINE_DEGRADED" };
      }
      this.db.prepare("UPDATE pc_pipeline_versions SET version_status = 'SUPERSEDED' WHERE version_status = 'ACTIVE' AND version_key <> ?")
        .run(candidate.version_key);
      this.db.prepare(`UPDATE pc_pipeline_versions SET version_status = 'ACTIVE', quality_report_json = ?,
        activated_at = ?, rolled_back_at = NULL WHERE version_key = ?`)
        .run(stableJson(report), timestamp, candidate.version_key);
      return { status: "ACTIVE", changed: true, reason: "QUALITY_GATES_PASSED" };
    });
  }

  transaction(operation) {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const value = operation();
      this.db.exec("COMMIT");
      return value;
    } catch (error) {
      try { this.db.exec("ROLLBACK"); } catch {}
      throw error;
    }
  }

  upsertSource(input) {
    const sourceId = requireValue(input.sourceId, "sourceId");
    const observedAt = new Date(this.now()).toISOString();
    const policyStatus = cleanText(input.policyStatus || "REVIEW_REQUIRED", 40).toUpperCase();
    const runtimeStatus = cleanText(input.runtimeStatus || "DISABLED", 40).toUpperCase();
    if (!new Set(["REVIEW_REQUIRED", "APPROVED", "DENIED"]).has(policyStatus)) throw new TypeError("invalid policyStatus");
    if (!new Set(["DISABLED", "ADAPTER_READY", "ENABLED", "QUARANTINED"]).has(runtimeStatus)) throw new TypeError("invalid runtimeStatus");
    if (runtimeStatus === "ENABLED" && policyStatus !== "APPROVED") throw new Error("source cannot be enabled without approved policy");
    return this.transaction(() => {
      this.db.prepare(`
        INSERT INTO sources(source_id, display_name, default_market_pool, allowed_market_pools_json, policy_status, policy_reviewed_at, policy_note, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(source_id) DO UPDATE SET
          display_name = excluded.display_name,
          default_market_pool = excluded.default_market_pool,
          allowed_market_pools_json = excluded.allowed_market_pools_json,
          policy_status = excluded.policy_status,
          policy_reviewed_at = excluded.policy_reviewed_at,
          policy_note = excluded.policy_note,
          updated_at = excluded.updated_at
      `).run(sourceId, requireValue(input.displayName, "displayName"), requireValue(input.marketPool, "marketPool"), stableJson(
        [...new Set((Array.isArray(input.marketPools) ? input.marketPools : [input.marketPool]).map((value) => requireValue(value, "marketPool")))]
      ), policyStatus,
        input.policyReviewedAt ? iso(input.policyReviewedAt) : null, cleanText(input.policyNote, 2_000) || null, observedAt, observedAt);
      this.db.prepare(`
        INSERT INTO source_runtime(source_id, runtime_status, updated_at) VALUES (?, ?, ?)
        ON CONFLICT(source_id) DO NOTHING
      `).run(sourceId, runtimeStatus, observedAt);
      if (policyStatus === "APPROVED" && runtimeStatus === "ENABLED") {
        this.db.prepare(`UPDATE source_runtime SET
          runtime_status = 'ENABLED', quarantined_at = NULL, backoff_until = NULL,
          quarantine_until = NULL, failure_count = 0, last_error = NULL, updated_at = ?
          WHERE source_id = ? AND runtime_status IN ('DISABLED', 'ADAPTER_READY')`)
          .run(observedAt, sourceId);
      }
      return this.getSource(sourceId);
    });
  }

  getSource(sourceId) {
    return this.db.prepare(`
      SELECT s.*, sr.runtime_status, sr.last_started_at, sr.last_succeeded_at, sr.backoff_until,
             sr.quarantine_until, sr.incremental_cursor, sr.failure_count, sr.last_error
        FROM sources s JOIN source_runtime sr USING(source_id) WHERE s.source_id = ?
    `).get(requireValue(sourceId, "sourceId")) || null;
  }

  activateCollectionTargets({ targetSetVersion, directoryVersion, targets }) {
    const version = requireValue(targetSetVersion, "targetSetVersion");
    const directory = requireValue(directoryVersion, "directoryVersion");
    const normalizedTargets = (Array.isArray(targets) ? targets : []).map((target, index) => ({
      targetId: requireValue(target.targetId, "targetId"),
      canonicalProductId: cleanText(target.canonicalProductId, 300) || null,
      categoryCode: requireValue(target.categoryCode, "categoryCode").toUpperCase(),
      queryText: requireValue(target.queryText, "queryText"),
      sourceKeys: [...new Set((Array.isArray(target.sourceKeys) ? target.sourceKeys : [])
        .map((value) => cleanText(value, 100).toLowerCase()).filter(Boolean))].sort(),
      cadenceClass: cleanText(target.cadenceClass || "HOURLY_CATEGORY", 40).toUpperCase(),
      minimumIntervalMinutes: Math.max(55, Number.isInteger(Number(target.minimumIntervalMinutes))
        ? Number(target.minimumIntervalMinutes) : 55),
      targetOrder: Number.isInteger(target.targetOrder) ? target.targetOrder : index,
      enabled: target.enabled !== false
    }));
    if (normalizedTargets.length === 0) throw new TypeError("at least one collection target is required");
    for (const target of normalizedTargets) {
      if (!["HOURLY_CATEGORY", "DAILY_MASTER"].includes(target.cadenceClass)) {
        throw new TypeError(`invalid collection target cadence: ${target.cadenceClass}`);
      }
    }
    if (new Set(normalizedTargets.map((target) => target.targetId)).size !== normalizedTargets.length) {
      throw new TypeError("collection target ids must be unique");
    }
    const checksum = createHash("sha256").update(stableJson(normalizedTargets)).digest("base64url");
    const timestamp = new Date(this.now()).toISOString();
    return this.transaction(() => {
      const existing = this.db.prepare("SELECT * FROM pc_collection_target_sets WHERE target_set_version = ?").get(version);
      if (existing && (existing.directory_version !== directory || Number(existing.target_count) !== normalizedTargets.length
        || (existing.target_checksum && existing.target_checksum !== checksum))) {
        throw new Error(`COLLECTION_TARGET_SET_IDENTITY_CONFLICT:${version}`);
      }
      this.db.prepare("UPDATE pc_collection_target_sets SET set_status = 'SUPERSEDED' WHERE target_set_version <> ? AND set_status = 'ACTIVE'")
        .run(version);
      this.db.prepare(`INSERT INTO pc_collection_target_sets(
        target_set_version, directory_version, target_count, target_checksum, set_status, created_at, activated_at
      ) VALUES (?, ?, ?, ?, 'ACTIVE', ?, ?)
      ON CONFLICT(target_set_version) DO UPDATE SET target_checksum = excluded.target_checksum,
        set_status = 'ACTIVE', activated_at = excluded.activated_at`)
        .run(version, directory, normalizedTargets.length, checksum, timestamp, timestamp);
      const insertTarget = this.db.prepare(`INSERT INTO pc_collection_targets(
        target_id, target_set_version, canonical_product_id, category_code, query_text, source_keys_json,
        cadence_class, minimum_interval_minutes, target_order, enabled, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(target_id) DO UPDATE SET
        canonical_product_id = excluded.canonical_product_id,
        category_code = excluded.category_code,
        query_text = excluded.query_text,
        source_keys_json = excluded.source_keys_json,
        cadence_class = excluded.cadence_class,
        minimum_interval_minutes = excluded.minimum_interval_minutes,
        target_order = excluded.target_order,
        enabled = excluded.enabled`);
      for (const target of normalizedTargets) {
        const owned = this.db.prepare("SELECT target_set_version FROM pc_collection_targets WHERE target_id = ?").get(target.targetId);
        if (owned && owned.target_set_version !== version) throw new Error(`COLLECTION_TARGET_ID_REUSED:${target.targetId}`);
        insertTarget.run(target.targetId, version, target.canonicalProductId, target.categoryCode,
          target.queryText, stableJson(target.sourceKeys), target.cadenceClass,
          target.minimumIntervalMinutes, target.targetOrder, target.enabled ? 1 : 0, timestamp);
      }
      return { target_set_version: version, directory_version: directory, target_count: normalizedTargets.length, target_checksum: checksum };
    });
  }

  listActiveCollectionTargets(sourceId = null) {
    const rows = this.db.prepare(`SELECT t.* FROM pc_collection_targets t
      JOIN pc_collection_target_sets s ON s.target_set_version = t.target_set_version
      WHERE s.set_status = 'ACTIVE' AND t.enabled = 1
      ORDER BY t.target_order, t.target_id`).all();
    if (!sourceId) return rows;
    const source = requireValue(sourceId, "sourceId").toLowerCase();
    return rows.filter((row) => {
      const sourceKeys = parseJson(row.source_keys_json, []);
      return !Array.isArray(sourceKeys) || sourceKeys.length === 0 || sourceKeys.includes(source);
    });
  }

  getActiveCollectionTargetSummary() {
    const activeSet = this.db.prepare(`SELECT target_set_version, directory_version, target_count,
        target_checksum, activated_at
      FROM pc_collection_target_sets
      WHERE set_status = 'ACTIVE'`).get();
    if (!activeSet) return null;
    const targets = this.listActiveCollectionTargets();
    const sourceTargetCounts = {};
    const cadenceClassCounts = {};
    const categoryCodes = new Set();
    let monitorTargetCount = 0;
    for (const target of targets) {
      categoryCodes.add(cleanText(target.category_code, 80).toUpperCase());
      const cadenceClass = cleanText(target.cadence_class || "HOURLY_CATEGORY", 40).toUpperCase();
      cadenceClassCounts[cadenceClass] = (cadenceClassCounts[cadenceClass] || 0) + 1;
      if (/monitor|모니터/iu.test(`${target.category_code || ""} ${target.query_text || ""}`)) {
        monitorTargetCount += 1;
      }
      const sourceKeys = parseJson(target.source_keys_json, []);
      for (const sourceKey of Array.isArray(sourceKeys) ? sourceKeys : []) {
        const normalizedSourceKey = cleanText(sourceKey, 100).toLowerCase();
        if (!normalizedSourceKey) continue;
        sourceTargetCounts[normalizedSourceKey] = (sourceTargetCounts[normalizedSourceKey] || 0) + 1;
      }
    }
    return {
      target_set_version: activeSet.target_set_version,
      directory_version: activeSet.directory_version,
      declared_target_count: Number(activeSet.target_count || 0),
      enabled_target_count: targets.length,
      target_checksum: activeSet.target_checksum || null,
      activated_at: activeSet.activated_at || null,
      source_target_counts: Object.fromEntries(Object.entries(sourceTargetCounts).sort(([left], [right]) => left.localeCompare(right))),
      cadence_class_counts: Object.fromEntries(Object.entries(cadenceClassCounts).sort(([left], [right]) => left.localeCompare(right))),
      category_codes: [...categoryCodes].filter(Boolean).sort(),
      monitor_target_count: monitorTargetCount
    };
  }

  listDueCollectionTargets(sourceId, asOf = new Date(this.now()), minimumIntervalMs = HOURLY_COLLECTION_GUARD_MS, limit = null) {
    const source = requireValue(sourceId, "sourceId");
    const asOfMs = new Date(asOf).getTime();
    if (!Number.isFinite(asOfMs)) throw new TypeError("asOf must be a valid date");
    const globalIntervalMs = Math.max(HOURLY_COLLECTION_GUARD_MS,
      Number(minimumIntervalMs) || HOURLY_COLLECTION_GUARD_MS);
    const rows = this.db.prepare(`SELECT t.*, r.last_started_at, r.last_succeeded_at, r.failure_count,
        r.incremental_cursor, r.last_error
      FROM pc_collection_targets t
      JOIN pc_collection_target_sets s ON s.target_set_version = t.target_set_version
      LEFT JOIN pc_source_target_runtime r ON r.source_id = ? AND r.target_id = t.target_id
      WHERE s.set_status = 'ACTIVE' AND t.enabled = 1
      ORDER BY t.target_order, t.target_id`).all(source);
    const due = rows.filter((row) => {
      const sourceKeys = parseJson(row.source_keys_json, []);
      if (Array.isArray(sourceKeys) && sourceKeys.length > 0 && !sourceKeys.includes(source.toLowerCase())) return false;
      if (!row.last_started_at) return true;
      const lastStartedMs = Date.parse(row.last_started_at);
      if (!Number.isFinite(lastStartedMs)) return true;
      const targetIntervalMs = Math.max(55, Number(row.minimum_interval_minutes) || 55) * 60 * 1_000;
      return asOfMs - lastStartedMs >= Math.max(globalIntervalMs, targetIntervalMs);
    });
    const maximum = Number.isInteger(Number(limit)) && Number(limit) > 0 ? Number(limit) : null;
    return maximum ? due.slice(0, maximum) : due;
  }

  updateSourceTargetRuntime({ sourceId, targetId, startedAt, succeededAt = null, cursor = null, error = null }) {
    const source = requireValue(sourceId, "sourceId");
    const target = requireValue(targetId, "targetId");
    const started = iso(startedAt || new Date(this.now()));
    const succeeded = succeededAt ? iso(succeededAt) : null;
    const timestamp = new Date(this.now()).toISOString();
    this.db.prepare(`INSERT INTO pc_source_target_runtime(
      source_id, target_id, last_started_at, last_succeeded_at, failure_count, incremental_cursor, last_error, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(source_id, target_id) DO UPDATE SET
      last_started_at = excluded.last_started_at,
      last_succeeded_at = COALESCE(excluded.last_succeeded_at, pc_source_target_runtime.last_succeeded_at),
      failure_count = CASE WHEN excluded.last_succeeded_at IS NULL THEN pc_source_target_runtime.failure_count + 1 ELSE 0 END,
      incremental_cursor = COALESCE(excluded.incremental_cursor, pc_source_target_runtime.incremental_cursor),
      last_error = excluded.last_error,
      updated_at = excluded.updated_at`)
      .run(source, target, started, succeeded, succeeded ? 0 : 1, cleanText(cursor, 2_000) || null,
        cleanText(error, 2_000) || null, timestamp);
    return this.db.prepare("SELECT * FROM pc_source_target_runtime WHERE source_id = ? AND target_id = ?").get(source, target);
  }

  updateSourceRuntime(sourceId, runtime) {
    const timestamp = new Date(this.now()).toISOString();
    const runtimeStatus = cleanText(runtime.runtime_status || "DISABLED", 40).toUpperCase();
    if (!new Set(["DISABLED", "ADAPTER_READY", "ENABLED", "QUARANTINED"]).has(runtimeStatus)) throw new TypeError("invalid source runtime status");
    this.db.prepare(`UPDATE source_runtime SET
      runtime_status = ?, last_started_at = ?, last_succeeded_at = ?, quarantined_at = ?,
      backoff_until = ?, quarantine_until = ?, incremental_cursor = ?, failure_count = ?, last_error = ?, updated_at = ?
      WHERE source_id = ?`).run(
      runtimeStatus, runtime.last_started_at || null, runtime.last_succeeded_at || null,
      runtimeStatus === "QUARANTINED" ? timestamp : null,
      runtime.backoff_until || null, runtime.quarantine_until || null,
      cleanText(runtime.incremental_cursor, 4_000) || null,
      Math.max(0, Number(runtime.consecutive_failures ?? runtime.failure_count) || 0),
      cleanText(runtime.last_error, 2_000) || null, timestamp, requireValue(sourceId, "sourceId")
    );
    return this.getSource(sourceId);
  }

  registerProduct(input) {
    const canonicalProductId = requireValue(input.canonicalProductId, "canonicalProductId");
    const masterVersion = Math.max(1, Number(input.masterVersion) || 1);
    const categoryCode = requireValue(input.categoryCode, "categoryCode").toUpperCase();
    if (!PRODUCT_CATEGORIES.has(categoryCode)) throw new TypeError(`invalid product category: ${categoryCode}`);
    const spec = validatedProductSpec(categoryCode, input.spec);
    const validFrom = iso(input.validFrom || new Date(this.now()));
    const createdAt = new Date(this.now()).toISOString();
    return this.transaction(() => {
      const existing = this.db.prepare("SELECT * FROM product_master WHERE canonical_product_id = ? AND master_version = ?")
        .get(canonicalProductId, masterVersion);
      if (existing) return existing;
      this.db.prepare(`
        UPDATE product_master SET valid_to = ?
         WHERE canonical_product_id = ? AND valid_to IS NULL AND master_version < ?
      `).run(validFrom, canonicalProductId, masterVersion);
      const result = this.db.prepare(`
        INSERT INTO product_master(canonical_product_id, master_version, canonical_display_name, manufacturer, brand, category_code, product_group_key, spec_json, valid_from, valid_to, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?)
      `).run(
        canonicalProductId, masterVersion, requireValue(input.canonicalDisplayName, "canonicalDisplayName"),
        cleanText(input.manufacturer, 300) || null, cleanText(input.brand, 300) || null,
        categoryCode, requireValue(input.productGroupKey, "productGroupKey"),
        stableJson(spec), validFrom, createdAt
      );
      return this.db.prepare("SELECT * FROM product_master WHERE id = ?").get(Number(result.lastInsertRowid));
    });
  }

  getCanonicalProduct(canonicalProductId, masterVersion = null) {
    const id = requireValue(canonicalProductId, "canonicalProductId");
    const row = masterVersion == null
      ? this.db.prepare("SELECT * FROM product_master WHERE canonical_product_id = ? ORDER BY master_version DESC LIMIT 1").get(id)
      : this.db.prepare("SELECT * FROM product_master WHERE canonical_product_id = ? AND master_version = ?").get(id, Number(masterVersion));
    return row ? { ...row, spec: parseJson(row.spec_json, {}) } : null;
  }

  addAlias(input) {
    const canonicalProductId = requireValue(input.canonicalProductId, "canonicalProductId");
    const product = this.getCanonicalProduct(canonicalProductId, input.masterVersion);
    if (!product) throw new Error("canonical product version not found");
    const aliasText = normalizeProductAlias(requireValue(input.aliasText, "aliasText"));
    if (!aliasText) throw new TypeError("aliasText has no searchable characters");
    const aliasType = cleanText(input.aliasType || "ALIAS", 40).toUpperCase();
    const validationStatus = cleanText(input.validationStatus || "CANDIDATE", 40).toUpperCase();
    if (!new Set(["ALIAS", "FORBIDDEN"]).has(aliasType)) throw new TypeError("invalid aliasType");
    if (!new Set(["CANDIDATE", "SHADOW", "APPROVED", "REJECTED"]).has(validationStatus)) throw new TypeError("invalid validationStatus");
    const createdAt = new Date(this.now()).toISOString();
    this.db.prepare(`
      INSERT INTO product_aliases(canonical_product_id, master_version, alias_text, alias_type, validation_status, shadow_started_at, approved_at, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(canonical_product_id, master_version, alias_text, alias_type) DO UPDATE SET
        validation_status = excluded.validation_status,
        shadow_started_at = COALESCE(product_aliases.shadow_started_at, excluded.shadow_started_at),
        approved_at = COALESCE(product_aliases.approved_at, excluded.approved_at)
    `).run(canonicalProductId, product.master_version, aliasText, aliasType, validationStatus,
      input.shadowStartedAt ? iso(input.shadowStartedAt) : validationStatus === "SHADOW" ? createdAt : null,
      input.approvedAt ? iso(input.approvedAt) : validationStatus === "APPROVED" ? createdAt : null, createdAt);
    return this.db.prepare(`SELECT * FROM product_aliases WHERE canonical_product_id = ? AND master_version = ? AND alias_text = ? AND alias_type = ?`)
      .get(canonicalProductId, product.master_version, aliasText, aliasType);
  }

  startAliasShadow(aliasId, startedAt = new Date(this.now())) {
    const timestamp = iso(startedAt);
    const alias = this.db.prepare("SELECT * FROM product_aliases WHERE id = ?").get(Number(aliasId));
    if (!alias) throw new Error("product alias not found");
    if (alias.alias_type !== "ALIAS") throw new Error("forbidden expressions cannot enter automatic shadow promotion");
    if (!new Set(["CANDIDATE", "SHADOW"]).has(alias.validation_status)) throw new Error("only candidate aliases can enter shadow");
    this.db.prepare(`UPDATE product_aliases
      SET validation_status = 'SHADOW', shadow_started_at = COALESCE(shadow_started_at, ?), approved_at = NULL
      WHERE id = ?`).run(timestamp, alias.id);
    return this.db.prepare("SELECT * FROM product_aliases WHERE id = ?").get(alias.id);
  }

  evaluateAliasShadow({
    aliasId,
    observedMatches,
    confirmedMatches,
    distinctSourceCount = 0,
    officialMasterVerified = false,
    conflictCount = 0,
    fixedValidationPrecision = null,
    regressionPassed = null,
    evaluatedAt = new Date(this.now())
  }) {
    const alias = this.db.prepare("SELECT * FROM product_aliases WHERE id = ?").get(Number(aliasId));
    if (!alias) throw new Error("product alias not found");
    if (alias.validation_status !== "SHADOW" || !alias.shadow_started_at) throw new Error("alias is not in shadow");
    const timestamp = iso(evaluatedAt);
    const elapsedMs = Date.parse(timestamp) - Date.parse(alias.shadow_started_at);
    if (elapsedMs < 72 * HOUR_MS) return { status: "SHADOW", promoted: false, reason: "SHADOW_WINDOW_INCOMPLETE" };
    const observed = Math.max(0, Number(observedMatches) || 0);
    const confirmed = Math.max(0, Math.min(observed, Number(confirmedMatches) || 0));
    if (observed < 5) return { status: "SHADOW", promoted: false, reason: "INSUFFICIENT_VALIDATION_SAMPLE" };
    const precision = confirmed / observed;
    const validationPrecision = Number(fixedValidationPrecision);
    let nextStatus = null;
    let reason = null;
    if (Number(conflictCount) > 0 || precision < 0.995) {
      nextStatus = "REJECTED";
      reason = "ALIAS_CONFLICT_OR_LOW_REVIEW_PRECISION";
    } else if (Number(distinctSourceCount) < 2 && officialMasterVerified !== true) {
      return { status: "SHADOW", promoted: false, reason: "SOURCE_COVERAGE_REQUIRED", precision };
    } else if (!Number.isFinite(validationPrecision) || validationPrecision < 0 || validationPrecision > 1) {
      return { status: "SHADOW", promoted: false, reason: "FIXED_VALIDATION_REQUIRED", precision };
    } else if (validationPrecision < 0.995 || regressionPassed === false) {
      nextStatus = "REJECTED";
      reason = "VALIDATION_OR_REGRESSION_DEGRADED";
    } else if (regressionPassed !== true) {
      return { status: "SHADOW", promoted: false, reason: "REGRESSION_EVIDENCE_REQUIRED", precision };
    } else {
      nextStatus = "APPROVED";
      reason = "PROMOTION_GATES_PASSED";
    }
    this.db.prepare(`UPDATE product_aliases
      SET validation_status = ?, approved_at = CASE WHEN ? = 'APPROVED' THEN ? ELSE NULL END
      WHERE id = ?`).run(nextStatus, nextStatus, timestamp, alias.id);
    return {
      status: nextStatus,
      promoted: nextStatus === "APPROVED",
      rolledBack: nextStatus === "REJECTED",
      precision,
      fixedValidationPrecision: Number.isFinite(validationPrecision) ? validationPrecision : null,
      reason
    };
  }

  matchAlias(categoryCode, value, options = {}) {
    const aliasText = normalizeProductAlias(value);
    if (!aliasText) return null;
    const statuses = options.includeShadow === true ? ["APPROVED", "SHADOW"] : ["APPROVED"];
    const placeholders = statuses.map(() => "?").join(",");
    const rows = this.db.prepare(`
      SELECT a.*, p.canonical_display_name, p.category_code, p.product_group_key, p.spec_json
        FROM product_aliases a
        JOIN product_master p ON p.canonical_product_id = a.canonical_product_id AND p.master_version = a.master_version
       WHERE p.category_code = ? AND a.alias_text = ? AND a.validation_status IN (${placeholders})
       ORDER BY CASE a.alias_type WHEN 'FORBIDDEN' THEN 0 ELSE 1 END, a.master_version DESC
    `).all(requireValue(categoryCode, "categoryCode").toUpperCase(), aliasText, ...statuses);
    const forbidden = rows.find((row) => row.alias_type === "FORBIDDEN");
    if (forbidden) {
      return { ...forbidden, matched: false, forbidden: true, spec: parseJson(forbidden.spec_json, {}) };
    }
    const aliases = rows.filter((row) => row.alias_type === "ALIAS");
    if (new Set(aliases.map((row) => row.canonical_product_id)).size > 1) return null;
    const row = aliases[0];
    return row ? { ...row, matched: row.alias_type === "ALIAS", forbidden: row.alias_type === "FORBIDDEN", spec: parseJson(row.spec_json, {}) } : null;
  }

  matchAliasInText(categoryCode, value, options = {}) {
    const text = normalizeProductAlias(value);
    if (!text) return null;
    const statuses = options.includeShadow === true ? ["APPROVED", "SHADOW"] : ["APPROVED"];
    const placeholders = statuses.map(() => "?").join(",");
    const rows = this.db.prepare(`
      SELECT a.*, p.canonical_display_name, p.category_code, p.product_group_key, p.spec_json
        FROM product_aliases a
        JOIN product_master p ON p.canonical_product_id = a.canonical_product_id AND p.master_version = a.master_version
       WHERE p.category_code = ? AND a.alias_type IN ('ALIAS', 'FORBIDDEN') AND a.validation_status IN (${placeholders})
       ORDER BY LENGTH(a.alias_text) DESC,
                CASE a.alias_type WHEN 'FORBIDDEN' THEN 0 ELSE 1 END,
                a.master_version DESC, p.canonical_product_id
    `).all(requireValue(categoryCode, "categoryCode").toUpperCase(), ...statuses)
      .filter((row) => text.includes(row.alias_text));
    if (rows.length === 0) return null;
    const longestLength = rows[0].alias_text.length;
    const longest = rows.filter((row) => row.alias_text.length === longestLength);
    const forbidden = longest.find((row) => row.alias_type === "FORBIDDEN");
    if (forbidden) return { ...forbidden, matched: false, forbidden: true, spec: parseJson(forbidden.spec_json, {}) };
    if (new Set(longest.map((row) => row.canonical_product_id)).size > 1) return null;
    const row = longest[0];
    return { ...row, matched: row.alias_type === "ALIAS", forbidden: false, spec: parseJson(row.spec_json, {}) };
  }

  findApprovedProductsInText(value) {
    const text = normalizeProductAlias(value);
    if (!text) return [];
    const rows = this.db.prepare(`SELECT a.alias_text, p.*
      FROM product_aliases a
      JOIN product_master p ON p.canonical_product_id = a.canonical_product_id AND p.master_version = a.master_version
      WHERE a.alias_type = 'ALIAS' AND a.validation_status = 'APPROVED'
      ORDER BY LENGTH(a.alias_text) DESC, p.canonical_product_id`).all();
    const products = new Map();
    for (const row of rows) {
      if (!text.includes(row.alias_text) || products.has(row.canonical_product_id)) continue;
      products.set(row.canonical_product_id, { ...row, spec: parseJson(row.spec_json, {}) });
    }
    return [...products.values()];
  }

  recordClassificationFeedback(input) {
    const snapshotId = Number(input.snapshotId);
    if (!this.db.prepare("SELECT 1 FROM listing_snapshots WHERE id = ?").get(snapshotId)) throw new Error("listing snapshot not found");
    const fieldName = requireValue(input.fieldName, "fieldName");
    const createdAt = iso(input.createdAt || new Date(this.now()));
    const result = this.db.prepare(`INSERT INTO classification_feedback
      (snapshot_id, field_name, previous_value_json, corrected_value_json, reviewer_ref, reason, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)`)
      .run(snapshotId, fieldName, stableJson(input.previousValue ?? null), stableJson(input.correctedValue),
        cleanText(input.reviewerRef, 200) || null, cleanText(input.reason, 1_000) || null, createdAt);
    let alias = null;
    if (input.aliasCandidate && input.canonicalProductId) {
      alias = this.addAlias({
        canonicalProductId: input.canonicalProductId,
        aliasText: input.aliasCandidate,
        validationStatus: "CANDIDATE"
      });
      if (input.approvedForShadow === true) alias = this.startAliasShadow(alias.id, createdAt);
    }
    return { feedbackId: Number(result.lastInsertRowid), alias };
  }

  observeModelCandidate({ snapshotId, categoryCode, candidateText, evidence = {}, observedAt = new Date(this.now()) }) {
    const snapshot = this.db.prepare("SELECT * FROM listing_snapshots WHERE id = ?").get(Number(snapshotId));
    if (!snapshot) throw new Error("listing snapshot not found");
    const category = requireValue(categoryCode, "categoryCode").toUpperCase();
    const candidate = normalizeProductAlias(requireValue(candidateText, "candidateText"));
    if (!candidate) throw new Error("candidateText has no searchable characters");
    const timestamp = iso(observedAt);
    return this.transaction(() => {
      this.db.prepare(`INSERT INTO model_candidates(
        category_code, candidate_text, candidate_status, first_seen_at, last_seen_at, evidence_json
      ) VALUES (?, ?, 'CANDIDATE', ?, ?, ?)
      ON CONFLICT(category_code, candidate_text) DO UPDATE SET
        last_seen_at = excluded.last_seen_at,
        evidence_json = excluded.evidence_json`)
        .run(category, candidate, timestamp, timestamp, stableJson(redactPayload(evidence)));
      const row = this.db.prepare("SELECT * FROM model_candidates WHERE category_code = ? AND candidate_text = ?")
        .get(category, candidate);
      this.db.prepare(`INSERT OR IGNORE INTO model_candidate_sightings(
        candidate_id, source_id, source_listing_id, snapshot_id, observed_at
      ) VALUES (?, ?, ?, ?, ?)`)
        .run(row.id, snapshot.source_id, snapshot.source_listing_id, snapshot.id, timestamp);
      const counts = this.db.prepare(`SELECT COUNT(*) AS listing_count, COUNT(DISTINCT source_id) AS source_count
        FROM model_candidate_sightings WHERE candidate_id = ?`).get(row.id);
      const status = Number(counts.listing_count) >= 5 && Number(counts.source_count) >= 2 ? "REVIEW_REQUIRED" : row.candidate_status;
      this.db.prepare(`UPDATE model_candidates SET distinct_listing_count = ?, distinct_source_count = ?,
        candidate_status = ?, last_seen_at = ? WHERE id = ?`)
        .run(counts.listing_count, counts.source_count, status, timestamp, row.id);
      return this.db.prepare("SELECT * FROM model_candidates WHERE id = ?").get(row.id);
    });
  }

  evaluateDueAliasShadows(evaluatedAt = new Date(this.now()), verificationByAlias = {}) {
    const timestamp = iso(evaluatedAt);
    const aliases = this.db.prepare("SELECT * FROM product_aliases WHERE validation_status = 'SHADOW' ORDER BY id").all();
    return aliases.map((alias) => {
      const reviewedRows = this.db.prepare(`SELECT f.corrected_value_json, f.reviewer_ref, f.created_at,
               s.source_id, s.source_listing_id, r.title, r.description
        FROM classification_feedback f
        JOIN listing_snapshots s ON s.id = f.snapshot_id
        JOIN raw_listings r ON r.id = s.raw_listing_id
       WHERE f.field_name = 'canonical_product_id' AND f.reviewer_ref IS NOT NULL
       ORDER BY f.created_at, f.id`).all()
        .filter((row) => normalizeProductAlias(`${row.title || ""} ${row.description || ""}`).includes(alias.alias_text));
      const distinctListings = new Map();
      for (const row of reviewedRows) distinctListings.set(`${row.source_id}\u0000${row.source_listing_id}`, row);
      const reviewed = [...distinctListings.values()];
      const confirmedMatches = reviewed.filter((row) => {
        const corrected = parseJson(row.corrected_value_json, null);
        return corrected === alias.canonical_product_id
          || corrected?.canonical_product_id === alias.canonical_product_id;
      }).length;
      const conflicts = reviewed.length - confirmedMatches;
      const verification = verificationByAlias[alias.id] || verificationByAlias[alias.alias_text] || {};
      return { aliasId: alias.id, ...this.evaluateAliasShadow({
        aliasId: alias.id,
        observedMatches: reviewed.length,
        confirmedMatches,
        distinctSourceCount: new Set(reviewed.map((row) => row.source_id)).size,
        officialMasterVerified: verification.officialMasterVerified === true,
        conflictCount: conflicts,
        fixedValidationPrecision: verification.fixedValidationPrecision,
        regressionPassed: verification.regressionPassed,
        evaluatedAt: timestamp
      }) };
    });
  }

  startCrawlRun({ sourceId, startedAt, adapterVersion }) {
    const id = randomUUID();
    const timestamp = iso(startedAt || new Date(this.now()));
    this.transaction(() => {
      const source = this.getSource(sourceId);
      if (!source || source.policy_status !== "APPROVED" || source.runtime_status !== "ENABLED") throw new Error("source is not enabled and approved");
      this.db.prepare(`INSERT INTO crawl_runs(crawl_run_id, source_id, started_at, run_status, adapter_version) VALUES (?, ?, ?, 'RUNNING', ?)`)
        .run(id, sourceId, timestamp, cleanText(adapterVersion, 100) || null);
      this.db.prepare("UPDATE source_runtime SET last_started_at = ?, updated_at = ? WHERE source_id = ?").run(timestamp, timestamp, sourceId);
    });
    return id;
  }

  finishCrawlRun({
    crawlRunId, status = "SUCCEEDED", finishedAt, collectedCount = 0, changedCount = 0,
    requestCount = 0, requestFailureCount = 0, parsedCount = collectedCount, parseFailureCount = 0,
    httpBlockedCount = 0, captchaCount = 0, error
  }) {
    const normalizedStatus = cleanText(status, 40).toUpperCase();
    if (!new Set(["SUCCEEDED", "FAILED", "QUARANTINED"]).has(normalizedStatus)) throw new TypeError("invalid crawl run status");
    const timestamp = iso(finishedAt || new Date(this.now()));
    return this.transaction(() => {
      const run = this.db.prepare("SELECT * FROM crawl_runs WHERE crawl_run_id = ?").get(crawlRunId);
      if (!run) throw new Error("crawl run not found");
      const metrics = [requestCount, requestFailureCount, parsedCount, parseFailureCount, httpBlockedCount, captchaCount]
        .map((value) => Math.max(0, Math.trunc(Number(value) || 0)));
      this.db.prepare(`UPDATE crawl_runs SET finished_at = ?, run_status = ?, collected_count = ?, changed_count = ?,
        request_count = ?, request_failure_count = ?, parsed_count = ?, parse_failure_count = ?, http_blocked_count = ?, captcha_count = ?,
        error_message = ? WHERE crawl_run_id = ?`)
        .run(timestamp, normalizedStatus, Math.max(0, Number(collectedCount) || 0), Math.max(0, Number(changedCount) || 0),
          ...metrics, cleanText(error, 2_000) || null, crawlRunId);
      if (normalizedStatus === "SUCCEEDED") {
        this.db.prepare("UPDATE source_runtime SET last_succeeded_at = ?, failure_count = 0, last_error = NULL, updated_at = ? WHERE source_id = ?")
          .run(timestamp, timestamp, run.source_id);
      } else {
        this.db.prepare(`UPDATE source_runtime SET failure_count = failure_count + 1, last_error = ?, runtime_status = CASE WHEN ? = 'QUARANTINED' THEN 'QUARANTINED' ELSE runtime_status END, quarantined_at = CASE WHEN ? = 'QUARANTINED' THEN ? ELSE quarantined_at END, updated_at = ? WHERE source_id = ?`)
          .run(cleanText(error, 2_000) || null, normalizedStatus, normalizedStatus, timestamp, timestamp, run.source_id);
      }
      return this.db.prepare("SELECT * FROM crawl_runs WHERE crawl_run_id = ?").get(crawlRunId);
    });
  }

  getSourceCollectionCoverage(sourceId, asOf = new Date(this.now())) {
    const source = requireValue(sourceId, "sourceId");
    const end = iso(asOf);
    const from = new Date(Date.parse(end) - 31 * DAY_MS).toISOString();
    const committedRun = `(run_status = 'SUCCEEDED' OR (
      run_status = 'FAILED' AND collected_count > 0 AND parsed_count > 0
      AND request_count >= 10 AND request_failure_count = 1
      AND parse_failure_count = 0 AND http_blocked_count = 0 AND captcha_count = 0
    ))`;
    const row = this.db.prepare(`WITH success_days AS (
        SELECT DISTINCT date(finished_at) AS day
          FROM crawl_runs
         WHERE source_id = ? AND ${committedRun} AND finished_at >= ? AND finished_at <= ?
      ), day_gaps AS (
        SELECT julianday(day) - julianday(LAG(day) OVER (ORDER BY day)) AS gap_days
          FROM success_days
      )
      SELECT (SELECT MIN(started_at) FROM crawl_runs WHERE source_id = ? AND ${committedRun}) AS first_committed_crawl_at,
             (SELECT MAX(finished_at) FROM crawl_runs WHERE source_id = ? AND ${committedRun}) AS last_committed_crawl_at,
             (SELECT COUNT(*) FROM success_days) AS success_day_count,
             COALESCE((SELECT MAX(gap_days) FROM day_gaps), 0) AS max_gap_days`)
      .get(source, from, end, source, source);
    const successDayCount = Number(row?.success_day_count || 0);
    const maxGapDays = Number(row?.max_gap_days || 0);
    return {
      first_committed_crawl_at: row?.first_committed_crawl_at || null,
      last_committed_crawl_at: row?.last_committed_crawl_at || null,
      success_day_count_31d: successDayCount,
      max_gap_days_31d: maxGapDays,
      continuous_30_day_coverage: successDayCount >= 28 && maxGapDays <= 2
    };
  }

  latestSnapshot(sourceId, sourceListingId) {
    return this.db.prepare(`SELECT * FROM listing_snapshots WHERE source_id = ? AND source_listing_id = ? ORDER BY observed_at DESC, id DESC LIMIT 1`)
      .get(sourceId, sourceListingId) || null;
  }

  insertNormalization(snapshotId, normalized, price, currency, versions = {}) {
    if (!normalized) return null;
    const normalizedAt = new Date(this.now()).toISOString();
    const exclusionReasons = Array.isArray(normalized.exclusionReasons) ? normalized.exclusionReasons.map(String) : [];
    const statisticsExclusionReasons = Array.isArray(normalized.statisticsExclusionReasons)
      ? normalized.statisticsExclusionReasons.map(String)
      : Array.isArray(normalized.statistics_exclusion_reasons) ? normalized.statistics_exclusion_reasons.map(String) : exclusionReasons;
    const statisticsEligible = normalized.statisticsEligible === true || normalized.statistics_eligible === true;
    const result = this.db.prepare(`
      INSERT INTO normalized_listings(
        snapshot_id, normalization_version, parser_version, rule_version, filter_version,
        canonical_product_id, canonical_display_name, category_code, market_segment, listing_type, condition_group,
        spec_group_id, classification_confidence, model_confidence, quantity_confidence, price_scope_confidence,
        statistics_eligible, statistics_exclusion_reasons_json, listing_kind, quantity,
        price_scope, condition_code, market_pool, exact_product, price_eligible,
        exclusion_reasons_json, confidence_json, evidence_json, normalized_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      snapshotId, Number(normalized.normalizationVersion || 1), cleanText(versions.parserVersion || normalized.parserVersion || "pc-parser-v1", 100),
      cleanText(versions.ruleVersion || normalized.ruleVersion || "pc-rules-v1", 100), cleanText(versions.filterVersion || normalized.filterVersion || "pc-filter-v1", 100),
      cleanText(normalized.canonicalProductId, 300) || null, cleanText(normalized.canonicalDisplayName, 500) || null,
      cleanText(normalized.categoryCode || normalized.category_code || "UNKNOWN", 80),
      cleanText(normalized.marketSegment || normalized.market_segment || "UNKNOWN", 80),
      cleanText(normalized.listingType || normalized.listing_type || "UNKNOWN", 80),
      cleanText(normalized.conditionGroup || normalized.condition_group || "UNKNOWN", 80),
      cleanText(normalized.specGroupId || normalized.spec_group_id, 300) || null,
      Number(normalized.classificationConfidence ?? normalized.classification_confidence ?? normalized.confidence?.category ?? 0) || 0,
      Number(normalized.modelConfidence ?? normalized.model_confidence ?? normalized.confidence?.model ?? 0) || 0,
      Number(normalized.quantityConfidence ?? normalized.quantity_confidence ?? normalized.confidence?.quantity ?? 0) || 0,
      Number(normalized.priceScopeConfidence ?? normalized.price_scope_confidence ?? normalized.confidence?.price_scope ?? 0) || 0,
      statisticsEligible ? 1 : 0,
      stableJson(statisticsExclusionReasons), cleanText(normalized.listingKind || normalized.listing_kind || "UNKNOWN", 80),
      Number.isInteger(Number(normalized.quantity)) ? Number(normalized.quantity) : null, cleanText(normalized.priceScope, 80) || null,
      cleanText(normalized.conditionCode || "UNKNOWN", 80), cleanText(normalized.marketPool || "UNKNOWN", 80),
      normalized.exactProduct === true ? 1 : 0,
      normalized.priceEligible === true && exclusionReasons.every((reason) => reason === "ANOMALOUS_LOW_PRICE") ? 1 : 0,
      stableJson(exclusionReasons), stableJson(normalized.confidence || {}), stableJson(normalized.evidence || {}), normalizedAt
    );
    const normalizedId = Number(result.lastInsertRowid);
    const items = Array.isArray(normalized.items) && normalized.items.length > 0 ? normalized.items : [{
      canonicalProductId: normalized.canonicalProductId,
      quantity: normalized.quantity,
      unitPrice: normalized.unitPrice,
      totalPrice: normalized.totalPrice ?? price,
      spec: normalized.spec || {}
    }];
    const insertItem = this.db.prepare(`INSERT INTO listing_items(normalized_listing_id, item_index, canonical_product_id, quantity, unit_price, total_price, currency, spec_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`);
    items.forEach((item, index) => insertItem.run(
      normalizedId, index, cleanText(item.canonicalProductId || normalized.canonicalProductId, 300) || null,
      Number.isInteger(Number(item.quantity ?? normalized.quantity)) ? Number(item.quantity ?? normalized.quantity) : null,
      finitePrice(Object.hasOwn(item, "unitPrice") ? item.unitPrice : normalized.unitPrice),
      finitePrice(Object.hasOwn(item, "totalPrice") ? item.totalPrice : normalized.totalPrice ?? price), currency,
      stableJson(item.spec || normalized.spec || {})
    ));
    return normalizedId;
  }

  copyNormalization(fromSnapshotId, toSnapshotId) {
    const previousRows = this.db.prepare(`SELECT * FROM normalized_listings
      WHERE snapshot_id = ? ORDER BY normalization_version, id`).all(fromSnapshotId);
    if (previousRows.length === 0) return [];
    const currency = this.db.prepare("SELECT currency FROM listing_snapshots WHERE id = ?").get(toSnapshotId)?.currency || "KRW";
    return previousRows.map((previous) => this.insertNormalization(toSnapshotId, {
      normalizationVersion: previous.normalization_version,
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
      statisticsEligible: previous.statistics_eligible === 1,
      statisticsExclusionReasons: parseJson(previous.statistics_exclusion_reasons_json, []),
      listingKind: previous.listing_kind,
      quantity: previous.quantity,
      priceScope: previous.price_scope,
      conditionCode: previous.condition_code,
      marketPool: previous.market_pool,
      exactProduct: previous.exact_product === 1,
      priceEligible: previous.price_eligible === 1,
      exclusionReasons: parseJson(previous.exclusion_reasons_json, []),
      confidence: parseJson(previous.confidence_json, {}),
      evidence: parseJson(previous.evidence_json, {}),
      items: this.db.prepare("SELECT * FROM listing_items WHERE normalized_listing_id = ? ORDER BY item_index").all(previous.id).map((item) => ({
        canonicalProductId: item.canonical_product_id,
        quantity: item.quantity,
        unitPrice: item.unit_price,
        totalPrice: item.total_price,
        spec: parseJson(item.spec_json, {})
      }))
    }, null, currency, {
      parserVersion: previous.parser_version,
      ruleVersion: previous.rule_version,
      filterVersion: previous.filter_version
    }));
  }

  recordObservation(input) {
    const sourceId = requireValue(input.sourceId, "sourceId");
    const sourceListingId = requireValue(input.sourceListingId, "sourceListingId");
    const source = this.getSource(sourceId);
    if (!source) throw new Error(`unknown source: ${sourceId}`);
    const allowedMarketPools = parseJson(source.allowed_market_pools_json, [source.default_market_pool]);
    if (input.normalized && !allowedMarketPools.includes(cleanText(input.normalized.marketPool, 80))) {
      throw new Error(`MARKET_POOL_MISMATCH:${sourceId}`);
    }
    const observedAt = iso(input.observedAt || new Date(this.now()));
    let status = lifecycleStatus(input.status, input.statusEvidence);
    let availability = cleanText(input.availability || (status === "ACTIVE" ? "AVAILABLE" : "UNKNOWN"), 80).toUpperCase();
    const currency = requireValue(input.currency || "KRW", "currency").toUpperCase();
    const price = finitePrice(input.price);
    const statusEvidenceType = cleanText(input.statusEvidence?.type, 40).toUpperCase();
    const transactionEvidenceType = cleanText(input.transactionEvidence?.type, 40).toUpperCase();
    const transactionEvidenceSourceField = cleanText(input.transactionEvidence?.source_field, 200);
    const transactionEvidenceValue = cleanText(input.transactionEvidence?.value, 500);
    const transactionEvidenceMeaning = cleanText(input.transactionEvidence?.meaning, 80).toUpperCase();
    const suppliedTransactionPrice = finitePrice(input.transactionPrice);
    const evidenceNumericValue = Number(transactionEvidenceValue.replace(/[^0-9.-]+/gu, ""));
    const transactionEvidenceAllowed = new Set(["OFFICIAL_API", "STRUCTURED_TRANSACTION"]).has(transactionEvidenceType)
      && Boolean(transactionEvidenceSourceField && transactionEvidenceValue)
      && transactionEvidenceMeaning === "TRANSACTION_PRICE"
      && Number.isFinite(evidenceNumericValue)
      && Math.abs(evidenceNumericValue - suppliedTransactionPrice) < 0.01;
    const transactionPrice = status === "SOLD" && transactionEvidenceAllowed && suppliedTransactionPrice > 0
      ? suppliedTransactionPrice
      : null;
    const safeTitle = redactString(input.title);
    const safeDescription = redactString(input.description);
    const redactedSellerRef = input.sellerRef == null ? "" : redactString(input.sellerRef);
    const safeSellerRef = redactedSellerRef ? `[SELLER:${hash(redactedSellerRef).slice(0, 16)}]` : null;
    const safePayload = redactPayload(input.rawPayload ?? {});
    const rawJson = stableJson(safePayload);
    const payloadHash = hash({ rawJson, title: safeTitle, description: safeDescription, sellerRef: safeSellerRef });

    return this.transaction(() => {
      let raw = this.db.prepare("SELECT * FROM raw_listings WHERE source_id = ? AND source_listing_id = ? AND payload_hash = ?")
        .get(sourceId, sourceListingId, payloadHash);
      if (!raw) {
        const inserted = this.db.prepare(`
          INSERT INTO raw_listings(source_id, source_listing_id, payload_hash, raw_json, title, description, seller_ref_masked, captured_at, last_seen_at, last_checked_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(sourceId, sourceListingId, payloadHash, rawJson, safeTitle, safeDescription || null, safeSellerRef, observedAt, observedAt, observedAt);
        raw = this.db.prepare("SELECT * FROM raw_listings WHERE id = ?").get(Number(inserted.lastInsertRowid));
      } else {
        this.db.prepare("UPDATE raw_listings SET last_seen_at = ?, last_checked_at = ?, missing_check_count = 0, last_missing_checked_at = NULL WHERE id = ?")
          .run(observedAt, observedAt, raw.id);
      }

      const previous = this.latestSnapshot(sourceId, sourceListingId);
      const ensureRequestedNormalization = (snapshotId) => {
        if (!input.normalized) return;
        const normalizationVersion = Number(input.normalized.normalizationVersion || 1);
        const exists = this.db.prepare(`SELECT 1 FROM normalized_listings
          WHERE snapshot_id = ? AND normalization_version = ?`).get(snapshotId, normalizationVersion);
        if (!exists) this.insertNormalization(snapshotId, input.normalized, price, currency, input.versions || {});
      };
      if (previous?.lifecycle_status === "SOLD" && status !== "SOLD") {
        const evidenceType = cleanText(input.statusEvidence?.type, 40).toUpperCase();
        const evidenceValue = cleanText(input.statusEvidence?.value, 500).toUpperCase();
        const explicitReactivation = status === "ACTIVE"
          && new Set(["STRUCTURED_STATUS", "OFFICIAL_API"]).has(evidenceType)
          && /ACTIVE|판매\s*중|판매\s*가능/iu.test(evidenceValue);
        if (!explicitReactivation) {
          status = "SOLD";
          availability = "SOLD_TERMINAL";
        }
      }
      if (previous?.lifecycle_status === "SOLD" && status === "SOLD") {
        const lateTransaction = transactionPrice != null && previous.transaction_price !== transactionPrice;
        if (!lateTransaction) {
          ensureRequestedNormalization(previous.id);
          return { rawListingId: raw.id, snapshotId: previous.id, snapshotCreated: false, status: "SOLD", soldLastAskPrice: previous.sold_last_ask_price };
        }
      }
      let soldLastAskPrice = previous?.lifecycle_status === "SOLD" ? previous.sold_last_ask_price : null;
      if (status === "SOLD") {
        soldLastAskPrice = this.db.prepare(`
          SELECT price_value FROM listing_snapshots
           WHERE source_id = ? AND source_listing_id = ? AND lifecycle_status <> 'SOLD'
             AND price_value IS NOT NULL AND price_value > 0 AND currency = ?
           ORDER BY observed_at DESC, id DESC LIMIT 1
        `).get(sourceId, sourceListingId, currency)?.price_value
          ?? (SOLD_EVIDENCE_TYPES.has(statusEvidenceType) && price > 0 ? price : null);
      }
      const stateHash = hash({ payloadHash, status, availability, price, currency, soldLastAskPrice, transactionPrice });
      if (previous?.state_hash === stateHash) {
        ensureRequestedNormalization(previous.id);
        return { rawListingId: raw.id, snapshotId: previous.id, snapshotCreated: false, status, soldLastAskPrice };
      }
      const inserted = this.db.prepare(`
        INSERT INTO listing_snapshots(raw_listing_id, source_id, source_listing_id, observed_at, state_hash, lifecycle_status, availability, price_value, currency, sold_last_ask_price, transaction_price, status_evidence_json, transaction_evidence_json, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(raw.id, sourceId, sourceListingId, observedAt, stateHash, status, availability, price, currency, soldLastAskPrice,
        transactionPrice, stableJson(input.statusEvidence || {}), stableJson(transactionEvidenceAllowed ? input.transactionEvidence : {}), new Date(this.now()).toISOString());
      const snapshotId = Number(inserted.lastInsertRowid);
      if (input.normalized) this.insertNormalization(snapshotId, input.normalized, price, currency, input.versions || {});
      else if (previous) this.copyNormalization(previous.id, snapshotId);
      if (previous) this.copyDuplicateClusterMembership(previous.id, snapshotId);
      return { rawListingId: raw.id, snapshotId, snapshotCreated: true, status, soldLastAskPrice };
    });
  }

  recordMissingCheck({ sourceId, sourceListingId, checkedAt }) {
    sourceId = requireValue(sourceId, "sourceId");
    sourceListingId = requireValue(sourceListingId, "sourceListingId");
    const timestamp = iso(checkedAt || new Date(this.now()));
    return this.transaction(() => {
      const raw = this.db.prepare("SELECT * FROM raw_listings WHERE source_id = ? AND source_listing_id = ? ORDER BY last_checked_at DESC, id DESC LIMIT 1").get(sourceId, sourceListingId);
      if (!raw) return { accepted: false, reason: "unknown_listing" };
      const previousMissingAt = Date.parse(raw.last_missing_checked_at || "");
      if (Number.isFinite(previousMissingAt) && Date.parse(timestamp) - previousMissingAt < 6 * HOUR_MS) {
        this.db.prepare("UPDATE raw_listings SET last_checked_at = ? WHERE id = ?").run(timestamp, raw.id);
        return { accepted: false, reason: "minimum_interval", missingCheckCount: raw.missing_check_count };
      }
      const missingCheckCount = Number(raw.missing_check_count || 0) + 1;
      this.db.prepare("UPDATE raw_listings SET last_checked_at = ?, last_missing_checked_at = ?, missing_check_count = ? WHERE id = ?")
        .run(timestamp, timestamp, missingCheckCount, raw.id);
      const previous = this.latestSnapshot(sourceId, sourceListingId);
      if (missingCheckCount < 3 || previous?.lifecycle_status === "UNAVAILABLE_UNKNOWN") {
        return { accepted: true, missingCheckCount, status: previous?.lifecycle_status || null, snapshotCreated: false };
      }
      const status = "UNAVAILABLE_UNKNOWN";
      const availability = "MISSING_AFTER_RECHECK";
      const stateHash = hash({ rawId: raw.id, status, availability, price: previous?.price_value ?? null, currency: previous?.currency || "KRW" });
      const result = this.db.prepare(`
        INSERT INTO listing_snapshots(raw_listing_id, source_id, source_listing_id, observed_at, state_hash, lifecycle_status, availability, price_value, currency, sold_last_ask_price, transaction_price, status_evidence_json, transaction_evidence_json, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, ?, '{}', ?)
      `).run(raw.id, sourceId, sourceListingId, timestamp, stateHash, status, availability, previous?.price_value ?? null,
        previous?.currency || "KRW", stableJson({ type: "RECHECKED_MISSING", count: missingCheckCount, minimumIntervalHours: 6 }), new Date(this.now()).toISOString());
      const snapshotId = Number(result.lastInsertRowid);
      if (previous) this.copyNormalization(previous.id, snapshotId);
      if (previous) this.copyDuplicateClusterMembership(previous.id, snapshotId);
      return { accepted: true, missingCheckCount, status, snapshotCreated: true, snapshotId };
    });
  }

  dueRechecks({ sourceId, checkedBefore, limit = 20 }) {
    const cutoff = iso(checkedBefore || new Date(this.now() - 6 * HOUR_MS));
    const boundedLimit = Math.min(100, Math.max(1, Number(limit) || 20));
    return this.db.prepare(`
      SELECT s.source_id, s.source_listing_id, s.lifecycle_status, s.price_value, s.currency,
             r.raw_json, r.title, r.description, r.seller_ref_masked, r.last_checked_at
        FROM listing_snapshots s
        JOIN raw_listings r ON r.id = s.raw_listing_id
       WHERE s.source_id = ? AND s.lifecycle_status IN ('ACTIVE', 'RESERVED')
         AND r.last_checked_at <= ?
         AND NOT EXISTS (
           SELECT 1 FROM listing_snapshots newer
            WHERE newer.source_id = s.source_id AND newer.source_listing_id = s.source_listing_id
              AND (newer.observed_at > s.observed_at OR (newer.observed_at = s.observed_at AND newer.id > s.id))
         )
       ORDER BY r.last_checked_at, s.source_listing_id
       LIMIT ?
    `).all(requireValue(sourceId, "sourceId"), cutoff, boundedLimit);
  }

  reconcileSourceObservation({ sourceId, sourceKey, observedListingIds, checkedAt }) {
    const resolvedSourceId = requireValue(sourceId || sourceKey, "sourceId");
    const timestamp = iso(checkedAt || new Date(this.now()));
    const observed = new Set((Array.isArray(observedListingIds) ? observedListingIds : []).map((value) => cleanText(value, 300)).filter(Boolean));
    const candidates = this.db.prepare(`
      SELECT s.source_listing_id
        FROM listing_snapshots s
       WHERE s.source_id = ?
         AND s.lifecycle_status IN ('ACTIVE', 'RESERVED')
         AND NOT EXISTS (
           SELECT 1 FROM listing_snapshots newer
            WHERE newer.source_id = s.source_id AND newer.source_listing_id = s.source_listing_id
              AND (newer.observed_at > s.observed_at OR (newer.observed_at = s.observed_at AND newer.id > s.id))
         )
       ORDER BY s.source_listing_id
    `).all(resolvedSourceId);
    const results = [];
    for (const candidate of candidates) {
      if (observed.has(candidate.source_listing_id)) continue;
      results.push({
        sourceListingId: candidate.source_listing_id,
        ...this.recordMissingCheck({ sourceId: resolvedSourceId, sourceListingId: candidate.source_listing_id, checkedAt: timestamp })
      });
    }
    return {
      sourceId: resolvedSourceId,
      checkedAt: timestamp,
      activeCandidates: candidates.length,
      observedCount: observed.size,
      missingCandidates: results.length,
      transitionedToUnavailable: results.filter((result) => result.status === "UNAVAILABLE_UNKNOWN" && result.snapshotCreated).length,
      results
    };
  }

  getListingState(sourceId, sourceListingId) {
    const snapshot = this.latestSnapshot(requireValue(sourceId, "sourceId"), requireValue(sourceListingId, "sourceListingId"));
    return snapshot ? {
      status: snapshot.lifecycle_status,
      availability: snapshot.availability,
      price: snapshot.price_value,
      currency: snapshot.currency,
      soldLastAskPrice: snapshot.sold_last_ask_price,
      observedAt: snapshot.observed_at
    } : null;
  }

  getPublicProjection(sourceId, sourceListingId) {
    const activeVersion = this.getActivePipelineVersion();
    const row = this.db.prepare(`
      SELECT s.*, r.raw_json, r.title, r.description,
             n.canonical_product_id, n.canonical_display_name, n.category_code, n.listing_kind,
             n.quantity, n.price_scope, n.condition_code, n.market_pool, n.price_eligible,
             n.normalization_version, n.parser_version, n.rule_version, n.filter_version,
             n.exclusion_reasons_json, n.confidence_json, n.evidence_json,
             li.unit_price, li.total_price
        FROM listing_snapshots s
        JOIN raw_listings r ON r.id = s.raw_listing_id
        LEFT JOIN normalized_listings n ON n.id = (
          SELECT newest.id FROM normalized_listings newest
          WHERE newest.snapshot_id = s.id
            AND newest.normalization_version = ?
            AND newest.parser_version = ? AND newest.rule_version = ? AND newest.filter_version = ?
          ORDER BY newest.normalization_version DESC, newest.id DESC LIMIT 1
        )
        LEFT JOIN listing_items li ON li.normalized_listing_id = n.id AND li.item_index = 0
       WHERE s.source_id = ? AND s.source_listing_id = ?
       ORDER BY s.observed_at DESC, s.id DESC LIMIT 1
    `).get(
      activeVersion?.normalization_version || 1,
      activeVersion?.parser_version || "pc-parser-v1",
      activeVersion?.rule_version || "pc-rules-v1",
      activeVersion?.filter_version || "pc-filter-v1",
      requireValue(sourceId, "sourceId"), requireValue(sourceListingId, "sourceListingId")
    );
    if (!row) return null;
    const raw = parseJson(row.raw_json, {});
    return {
      item_id: cleanText(raw.item_id || raw.id || (raw.url || raw.item_url
        ? `${row.source_id}:${raw.url || raw.item_url}`
        : `${row.source_id}:${row.source_listing_id}`), 700),
      source_listing_id: row.source_listing_id,
      site: row.source_id,
      category_id: cleanText(raw.category_id || "pc", 120),
      title: row.title,
      description: row.description,
      search_text: cleanText(raw.search_text || row.title, 1_000),
      price: row.price_value,
      currency: row.currency,
      url: cleanText(raw.url || raw.item_url, 2_000),
      image_url: cleanText(raw.image_url, 2_000) || null,
      posted_at: cleanText(raw.posted_at, 80) || null,
      updated_at: row.observed_at,
      canonical_product_id: row.canonical_product_id,
      canonical_display_name: row.canonical_display_name,
      listing_kind: row.listing_kind || "UNKNOWN",
      category_code: row.category_code,
      quantity: row.quantity,
      price_scope: row.price_scope || "UNKNOWN",
      condition_code: row.condition_code || "UNKNOWN",
      lifecycle_status: row.lifecycle_status,
      market_pool: row.market_pool,
      confidence: parseJson(row.confidence_json, {}),
      evidence: parseJson(row.evidence_json, []),
      price_eligible: row.price_eligible === 1,
      exclusion_reasons: parseJson(row.exclusion_reasons_json, []),
      good_listing_eligible: false,
      reference_price: null,
      normalization_version: row.normalization_version || null,
      parser_version: row.parser_version || null,
      rule_version: row.rule_version || null,
      filter_version: row.filter_version || null
    };
  }

  assignDuplicateCluster({ snapshotId, clusterKey, confidence, evidence = {} }) {
    const snapshot = this.db.prepare("SELECT * FROM listing_snapshots WHERE id = ?").get(Number(snapshotId));
    if (!snapshot) throw new Error("listing snapshot not found");
    const score = Number(confidence);
    if (!Number.isFinite(score) || score < 0 || score > 1) throw new TypeError("duplicate confidence must be between 0 and 1");
    const identityKeys = new Set((Array.isArray(evidence.identity_keys) ? evidence.identity_keys : []).map((value) => cleanText(value, 80)));
    const strongIdentityKeys = ["seller_fingerprint", "serial_number", "source_listing_linkage", "image_hash"]
      .filter((key) => identityKeys.has(key));
    const identityEvidenceStrong = score >= 0.98 && strongIdentityKeys.length >= 2;
    const timestamp = new Date(this.now()).toISOString();
    return this.transaction(() => {
      this.db.prepare(`INSERT INTO duplicate_clusters(cluster_key, confidence, cluster_status, evidence_json, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT(cluster_key) DO UPDATE SET
          confidence = excluded.confidence,
          cluster_status = CASE WHEN duplicate_clusters.cluster_status = 'REJECTED' THEN 'REJECTED' ELSE excluded.cluster_status END,
          evidence_json = excluded.evidence_json,
          updated_at = excluded.updated_at`).run(requireValue(clusterKey, "clusterKey"), score, "UNCERTAIN", stableJson(evidence), timestamp, timestamp);
      const cluster = this.db.prepare("SELECT * FROM duplicate_clusters WHERE cluster_key = ?").get(clusterKey);
      this.db.prepare(`INSERT INTO duplicate_cluster_members(cluster_id, snapshot_id, source_id, source_listing_id, added_at)
        VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(snapshot_id) DO UPDATE SET cluster_id = excluded.cluster_id, added_at = excluded.added_at`)
        .run(cluster.id, snapshot.id, snapshot.source_id, snapshot.source_listing_id, timestamp);
      const sourceCount = Number(this.db.prepare("SELECT COUNT(DISTINCT source_id) AS count FROM duplicate_cluster_members WHERE cluster_id = ?")
        .get(cluster.id)?.count || 0);
      if (identityEvidenceStrong && sourceCount >= 2 && cluster.cluster_status !== "REJECTED") {
        this.db.prepare("UPDATE duplicate_clusters SET cluster_status = 'CONFIRMED', updated_at = ? WHERE id = ?")
          .run(timestamp, cluster.id);
      }
      const updated = this.db.prepare("SELECT * FROM duplicate_clusters WHERE id = ?").get(cluster.id);
      return { ...updated, auto_merge_eligible: updated.cluster_status === "CONFIRMED" };
    });
  }

  copyDuplicateClusterMembership(fromSnapshotId, toSnapshotId) {
    return this.db.prepare(`INSERT OR IGNORE INTO duplicate_cluster_members
      (cluster_id, snapshot_id, source_id, source_listing_id, added_at)
      SELECT cluster_id, ?, source_id, source_listing_id, ?
      FROM duplicate_cluster_members WHERE snapshot_id = ?`)
      .run(Number(toSnapshotId), new Date(this.now()).toISOString(), Number(fromSnapshotId)).changes;
  }

  rejectDuplicateCluster(clusterKey) {
    this.db.prepare("UPDATE duplicate_clusters SET cluster_status = 'REJECTED', updated_at = ? WHERE cluster_key = ?")
      .run(new Date(this.now()).toISOString(), requireValue(clusterKey, "clusterKey"));
  }

  eligibleRows({ canonicalProductId, marketPool, condition, currency, from, asOf, normalizationVersion, parserVersion, ruleVersion, filterVersion }) {
    return this.db.prepare(`
      SELECT s.*, n.id AS normalized_listing_id, n.canonical_product_id, n.market_pool, n.condition_code,
             n.quantity, n.price_scope, n.exact_product, n.price_eligible, n.statistics_eligible,
             n.parser_version, n.rule_version, n.filter_version,
             li.id AS listing_item_id, li.total_price, li.unit_price,
             json_extract(li.spec_json, '$.board_manufacturer') AS board_manufacturer,
             COALESCE(li.unit_price, li.total_price) AS comparable_price, r.id AS raw_id,
             r.last_seen_at AS raw_last_seen_at,
             dc.cluster_key AS duplicate_cluster_key, dc.cluster_status AS duplicate_cluster_status
        FROM listing_snapshots s
        JOIN normalized_listings n ON n.snapshot_id = s.id
        JOIN listing_items li ON li.normalized_listing_id = n.id AND li.canonical_product_id = n.canonical_product_id
        JOIN raw_listings r ON r.id = s.raw_listing_id
        LEFT JOIN duplicate_cluster_members dcm ON dcm.snapshot_id = s.id
        LEFT JOIN duplicate_clusters dc ON dc.id = dcm.cluster_id
       WHERE n.canonical_product_id = ? AND n.market_pool = ? AND n.condition_code = ?
         AND s.currency = ?
         AND n.normalization_version = ?
         AND n.parser_version = ? AND n.rule_version = ? AND n.filter_version = ?
         AND (s.observed_at >= ? OR (s.lifecycle_status IN ('ACTIVE', 'RESERVED') AND r.last_seen_at >= ?))
         AND s.observed_at <= ?
       ORDER BY s.observed_at, s.id
    `).all(canonicalProductId, marketPool, condition, currency, normalizationVersion, parserVersion, ruleVersion, filterVersion, from, from, asOf);
  }

  latestIdentityStates(rows, { asOf, normalizationVersion, parserVersion, ruleVersion, filterVersion }) {
    const identities = [...new Set((Array.isArray(rows) ? rows : []).map(priceStatsListingIdentity))].sort();
    const candidates = new Set(identities);
    const latest = new Map();
    const sourceIdentitySql = "pc_source_listing_identity(s.source_id, s.source_listing_id)";
    const clusterIdentitySql = "'cluster:' || dc.cluster_key";
    const keepLatest = (identity, row) => {
      if (!candidates.has(identity)) return;
      const previous = latest.get(identity);
      if (!previous || String(row.observed_at) > String(previous.observed_at)
        || (row.observed_at === previous.observed_at && Number(row.id) > Number(previous.id))) {
        latest.set(identity, row);
      }
    };
    for (let offset = 0; offset < identities.length; offset += LATEST_STATE_IDENTITY_CHUNK) {
      const chunk = identities.slice(offset, offset + LATEST_STATE_IDENTITY_CHUNK);
      const sourceIdentities = chunk.filter((identity) => !identity.startsWith("cluster:"));
      const clusterIdentities = chunk.filter((identity) => identity.startsWith("cluster:"));
      const identityConditions = [];
      const identityBindings = [];
      if (sourceIdentities.length > 0) {
        identityConditions.push(`${sourceIdentitySql} IN (${sourceIdentities.map(() => "?").join(", ")})`);
        identityBindings.push(...sourceIdentities);
      }
      if (clusterIdentities.length > 0) {
        identityConditions.push(`(dc.cluster_status = 'CONFIRMED' AND ${clusterIdentitySql} IN (${clusterIdentities.map(() => "?").join(", ")}))`);
        identityBindings.push(...clusterIdentities);
      }
      const stateRows = this.db.prepare(`
        SELECT s.id, s.source_id, s.source_listing_id, s.observed_at, s.lifecycle_status, s.currency,
               n.canonical_product_id, n.market_pool, n.condition_code, n.exact_product, n.price_eligible,
               n.statistics_eligible,
               CASE WHEN dc.cluster_status = 'CONFIRMED' THEN ${clusterIdentitySql} ELSE NULL END AS cluster_identity
          FROM listing_snapshots s
          LEFT JOIN normalized_listings n ON n.snapshot_id = s.id
            AND n.normalization_version = ?
            AND n.parser_version = ? AND n.rule_version = ? AND n.filter_version = ?
          LEFT JOIN duplicate_cluster_members dcm ON dcm.snapshot_id = s.id
          LEFT JOIN duplicate_clusters dc ON dc.id = dcm.cluster_id
         WHERE s.observed_at <= ? AND (${identityConditions.join(" OR ")})
         ORDER BY s.observed_at, s.id
      `).all(normalizationVersion, parserVersion, ruleVersion, filterVersion, asOf, ...identityBindings);
      for (const row of stateRows) {
        keepLatest(canonicalSourceListingIdentity(row.source_id, row.source_listing_id), row);
        if (row.cluster_identity) keepLatest(row.cluster_identity, row);
      }
    }
    return latest;
  }

  rebuildDailyPriceStats(options) {
    const canonicalProductId = requireValue(options.canonicalProductId, "canonicalProductId");
    const marketPool = requireValue(options.marketPool, "marketPool");
    const condition = requireValue(options.condition, "condition");
    const currency = requireValue(options.currency, "currency").toUpperCase();
    const { asOf, days, from } = priceStatsWindow(options.asOf || new Date(this.now()), options.days);
    const normalizationVersion = Math.max(1, Number(options.normalizationVersion) || 1);
    const parserVersion = cleanText(options.parserVersion || "pc-parser-v1", 100);
    const ruleVersion = cleanText(options.ruleVersion || "pc-rules-v1", 100);
    const filterVersion = cleanText(options.filterVersion || "pc-filter-v1", 100);
    const rows = this.eligibleRows({ canonicalProductId, marketPool, condition, currency, from, asOf, normalizationVersion, parserVersion, ruleVersion, filterVersion });
    const currentScope = { canonicalProductId, marketPool, condition, currency };
    const latestByListing = this.latestIdentityStates(rows, {
      asOf, normalizationVersion, parserVersion, ruleVersion, filterVersion
    });
    const sourceIds = [...new Set(rows.filter(priceStatsRowEligible)
      .map((row) => cleanText(row.source_id, 100)).filter(Boolean))].sort();

    const firstSoldByListing = new Map();
    const transactionByListing = new Map();
    const latestByListingDay = new Map();
    for (const row of rows) {
      const identity = priceStatsListingIdentity(row);
      if (row.lifecycle_status === "ACTIVE" || row.lifecycle_status === "RESERVED") {
        const firstDay = Math.max(Date.parse(from), Date.parse(dayKey(row.observed_at)));
        const lastDay = Math.min(Date.parse(asOf), Date.parse(dayKey(row.raw_last_seen_at || row.observed_at)));
        for (let day = firstDay; day <= lastDay; day += DAY_MS) {
          latestByListingDay.set(`${identity}\u0000${dayKey(new Date(day))}`, row);
        }
      } else {
        latestByListingDay.set(`${identity}\u0000${dayKey(row.observed_at)}`, row);
      }
      if (row.lifecycle_status === "SOLD" && !firstSoldByListing.has(identity)) firstSoldByListing.set(identity, row);
      if (row.lifecycle_status === "SOLD" && row.transaction_price != null) transactionByListing.set(identity, row);
    }
    const groups = new Map();
    const add = (date, scope, row, price) => {
      if (!Number.isFinite(Number(price)) || Number(price) <= 0) return;
      const key = `${date}\u0000${scope}`;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push({ row, price: Number(price) });
    };
    for (const [key, row] of latestByListingDay) {
      if ((row.lifecycle_status === "ACTIVE" || row.lifecycle_status === "RESERVED") && priceStatsRowEligible(row)) {
        add(key.split("\u0000").at(-1), row.lifecycle_status, row, row.comparable_price ?? row.price_value);
      }
    }
    for (const [identity, row] of firstSoldByListing) {
      if (currentSoldIdentityEligible(identity, firstSoldByListing, latestByListing, currentScope)) {
        add(dayKey(row.observed_at), "SOLD", row, comparableScopePrice(row.sold_last_ask_price, row.quantity, row.price_scope));
      }
    }
    for (const [identity, row] of transactionByListing) {
      const soldRow = firstSoldByListing.get(identity);
      if (priceStatsRowEligible(row) && currentSoldIdentityEligible(identity, firstSoldByListing, latestByListing, currentScope)) {
        add(dayKey(soldRow.observed_at), "CONFIRMED_TRANSACTION", row, comparableScopePrice(row.transaction_price, row.quantity, row.price_scope));
      }
    }
    for (let day = Date.parse(`${from.slice(0, 10)}T00:00:00.000Z`);
      day <= Date.parse(`${asOf.slice(0, 10)}T00:00:00.000Z`); day += DAY_MS) {
      const date = dayKey(new Date(day));
      for (const scope of PRICE_STAT_METRIC_SCOPES) {
        const key = `${date}\u0000${scope}`;
        if (!groups.has(key)) groups.set(key, []);
      }
    }
    const aggregateScopeSummaries = new Map();
    for (const [key, members] of groups) {
      const scope = key.split("\u0000")[1];
      const prices = aggregateScopeSummaries.get(scope) || [];
      prices.push(...members.map((member) => member.price));
      aggregateScopeSummaries.set(scope, prices);
    }
    for (const [scope, prices] of aggregateScopeSummaries) {
      aggregateScopeSummaries.set(scope, summarize(prices));
    }
    const soldGroups = [...groups.entries()]
      .filter(([key]) => key.endsWith("\u0000SOLD"))
      .map(([key, members]) => ({ date: key.split("\u0000")[0], members }));
    const sevenDaySoldMedian = new Map(soldGroups.map(({ date }) => {
      const day = Date.parse(`${date}T00:00:00.000Z`);
      const prices = soldGroups
        .filter((candidate) => {
          const candidateDay = Date.parse(`${candidate.date}T00:00:00.000Z`);
          return candidateDay <= day && candidateDay >= day - 6 * DAY_MS;
        })
        .flatMap((candidate) => candidate.members.map((member) => member.price))
        .sort((left, right) => left - right);
      return [date, prices.length > 0 ? round(percentile(prices, 0.5)) : null];
    }));

    return this.transaction(() => {
      this.db.prepare(`DELETE FROM daily_price_stats WHERE canonical_product_id = ? AND market_pool = ? AND condition_code = ? AND currency = ? AND stat_date >= ? AND stat_date <= ?`)
        .run(canonicalProductId, marketPool, condition, currency, from.slice(0, 10), asOf.slice(0, 10));
      const insertStat = this.db.prepare(`
        INSERT INTO daily_price_stats(stat_date, canonical_product_id, market_pool, condition_code, currency, metric_scope,
          sample_count, unit_count, mean_value, median_value, trimmed_mean_value, min_value, max_value, p25_value, p75_value,
          outlier_count, outlier_lower_bound, outlier_upper_bound, seven_day_sold_median,
          confidence_level, normalization_version, parser_version, rule_version, filter_version, as_of)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      const insertMember = this.db.prepare(`INSERT INTO daily_price_stat_members(daily_price_stat_id, snapshot_id, listing_item_id, raw_listing_id, member_role, price_value, included, outlier_flag, outlier_reason) VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?)`);
      const insertSourceStat = this.db.prepare(`INSERT INTO daily_source_price_stats(
        daily_price_stat_id, source_id, sample_count, unit_count, mean_value, median_value, trimmed_mean_value,
        min_value, max_value, p25_value, p75_value, outlier_count, outlier_lower_bound, outlier_upper_bound,
        seven_day_sold_median, confidence_level
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
      const insertSourceMember = this.db.prepare(`INSERT INTO daily_source_price_stat_members(
        daily_source_price_stat_id, snapshot_id, listing_item_id, raw_listing_id, member_role, price_value,
        outlier_flag, outlier_reason
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`);
      let statCount = 0;
      for (const [key, members] of [...groups.entries()].sort(([left], [right]) => left.localeCompare(right))) {
        const [date, scope] = key.split("\u0000");
        const summary = summarize(
          members.map((member) => member.price),
          members.reduce((sum, member) => sum + Math.max(1, Number(member.row.quantity) || 1), 0)
        );
        const result = insertStat.run(date, canonicalProductId, marketPool, condition, currency, scope,
          summary.sample_count, summary.unit_count, summary.mean, summary.median, summary.trimmed_mean,
          summary.min, summary.max, summary.p25, summary.p75,
          summary.outlier_count, summary.outlier_lower_bound, summary.outlier_upper_bound,
          scope === "SOLD" ? sevenDaySoldMedian.get(date) ?? null : null,
          summary.confidence_level, normalizationVersion, parserVersion, ruleVersion, filterVersion, asOf);
        const statId = Number(result.lastInsertRowid);
        for (const member of members) {
          const reason = outlierReason(member.price, aggregateScopeSummaries.get(scope));
          insertMember.run(statId, member.row.id, member.row.listing_item_id, member.row.raw_id, scope, member.price, reason ? 1 : 0, reason);
        }
        for (const sourceId of sourceIds) {
          const sourceMembers = members.filter((member) => member.row.source_id === sourceId);
          const sourceSummary = summarize(
            sourceMembers.map((member) => member.price),
            sourceMembers.reduce((sum, member) => sum + Math.max(1, Number(member.row.quantity) || 1), 0)
          );
          let sourceSevenDaySoldMedian = null;
          if (scope === "SOLD") {
            const day = Date.parse(`${date}T00:00:00.000Z`);
            const sourceWindowPrices = [...groups.entries()]
              .filter(([candidateKey]) => {
                const [candidateDate, candidateScope] = candidateKey.split("\u0000");
                const candidateDay = Date.parse(`${candidateDate}T00:00:00.000Z`);
                return candidateScope === "SOLD" && candidateDay <= day && candidateDay >= day - 6 * DAY_MS;
              })
              .flatMap(([, candidateMembers]) => candidateMembers
                .filter((member) => member.row.source_id === sourceId)
                .map((member) => member.price))
              .sort((left, right) => left - right);
            sourceSevenDaySoldMedian = sourceWindowPrices.length > 0 ? round(percentile(sourceWindowPrices, 0.5)) : null;
          }
          const sourceResult = insertSourceStat.run(
            statId, sourceId, sourceSummary.sample_count, sourceSummary.unit_count, sourceSummary.mean,
            sourceSummary.median, sourceSummary.trimmed_mean, sourceSummary.min, sourceSummary.max,
            sourceSummary.p25, sourceSummary.p75, sourceSummary.outlier_count,
            sourceSummary.outlier_lower_bound, sourceSummary.outlier_upper_bound,
            sourceSevenDaySoldMedian, sourceSummary.confidence_level
          );
          const sourceStatId = Number(sourceResult.lastInsertRowid);
          for (const member of sourceMembers) {
            const reason = outlierReason(member.price, sourceSummary);
            insertSourceMember.run(
              sourceStatId, member.row.id, member.row.listing_item_id, member.row.raw_id,
              scope, member.price, reason ? 1 : 0, reason
            );
          }
        }
        statCount += 1;
      }
      return { statCount, memberCount: [...groups.values()].reduce((sum, members) => sum + members.length, 0), from, asOf };
    });
  }

  getPriceStats(options) {
    const canonicalProductId = requireValue(options.canonicalProductId, "canonicalProductId");
    const marketPool = requireValue(options.marketPool, "marketPool");
    const condition = requireValue(options.condition, "condition");
    const currency = requireValue(options.currency, "currency").toUpperCase();
    const { asOf, days, from } = priceStatsWindow(options.asOf || new Date(this.now()), options.days);
    const normalizationVersion = Math.max(1, Number(options.normalizationVersion) || 1);
    const parserVersion = cleanText(options.parserVersion || "pc-parser-v1", 100);
    const ruleVersion = cleanText(options.ruleVersion || "pc-rules-v1", 100);
    const filterVersion = cleanText(options.filterVersion || "pc-filter-v1", 100);
    const rows = this.eligibleRows({ canonicalProductId, marketPool, condition, currency, from, asOf, normalizationVersion, parserVersion, ruleVersion, filterVersion });
    const currentScope = { canonicalProductId, marketPool, condition, currency };
    const currentByListing = this.latestIdentityStates(rows, {
      asOf, normalizationVersion, parserVersion, ruleVersion, filterVersion
    });
    const latestByListing = new Map();
    const firstSoldByListing = new Map();
    const transactionByListing = new Map();
    for (const row of rows) {
      const identity = priceStatsListingIdentity(row);
      latestByListing.set(identity, row);
      if (row.lifecycle_status === "SOLD" && !firstSoldByListing.has(identity)) firstSoldByListing.set(identity, row);
      if (row.lifecycle_status === "SOLD" && row.transaction_price != null) transactionByListing.set(identity, row);
    }
    const activeRows = [...latestByListing.entries()]
      .filter(([identity, row]) => currentIdentityRowEligible(identity, row, currentByListing, currentScope, "ACTIVE"))
      .map(([, row]) => row);
    const reservedRows = [...latestByListing.entries()]
      .filter(([identity, row]) => currentIdentityRowEligible(identity, row, currentByListing, currentScope, "RESERVED"))
      .map(([, row]) => row);
    const soldRows = [...firstSoldByListing.entries()]
      .filter(([identity]) => currentSoldIdentityEligible(identity, firstSoldByListing, currentByListing, currentScope))
      .map(([, row]) => row);
    const transactionRows = [...transactionByListing.entries()]
      .filter(([identity, row]) => priceStatsRowEligible(row)
        && currentSoldIdentityEligible(identity, firstSoldByListing, currentByListing, currentScope))
      .map(([, row]) => row);
    const unitCount = (entries) => entries.reduce((sum, row) => sum + Math.max(1, Number(row.quantity) || 1), 0);
    const active = summarize(activeRows.map((row) => Number(row.comparable_price ?? row.price_value)), unitCount(activeRows));
    const reserved = summarize(reservedRows.map((row) => Number(row.comparable_price ?? row.price_value)), unitCount(reservedRows));
    const sold = summarize(
      soldRows.map((row) => comparableScopePrice(row.sold_last_ask_price, row.quantity, row.price_scope)),
      unitCount(soldRows)
    );
    const confirmed = summarize(
      transactionRows.map((row) => comparableScopePrice(row.transaction_price, row.quantity, row.price_scope)),
      unitCount(transactionRows)
    );
    reserved.disclosure = "예약중 매물에 표시된 가격이며 실제 거래가격이 아닙니다.";
    sold.disclosure = "판매완료 매물에 마지막으로 표시된 가격이며 실제 거래가격이 아닙니다.";
    const dailyRows = this.db.prepare(`
      SELECT * FROM daily_price_stats WHERE canonical_product_id = ? AND market_pool = ? AND condition_code = ?
        AND currency = ? AND stat_date >= ? AND stat_date <= ?
        AND normalization_version = ?
        AND parser_version = ? AND rule_version = ? AND filter_version = ?
      ORDER BY stat_date, metric_scope
    `).all(canonicalProductId, marketPool, condition, currency, from.slice(0, 10), asOf.slice(0, 10),
      normalizationVersion, parserVersion, ruleVersion, filterVersion);
    const versionKeys = new Set(dailyRows.map((row) => `${row.parser_version}\u0000${row.rule_version}\u0000${row.filter_version}`));
    if (versionKeys.size > 1) throw new Error("MIXED_STAT_RULE_VERSIONS");
    const dailyMap = new Map();
    for (const row of dailyRows) {
      if (!dailyMap.has(row.stat_date)) dailyMap.set(row.stat_date, { date: row.stat_date });
      dailyMap.get(row.stat_date)[row.metric_scope === "CONFIRMED_TRANSACTION" ? "confirmed_transactions" : row.metric_scope.toLowerCase()] = {
        sample_count: row.sample_count,
        unit_count: row.unit_count,
        mean: row.mean_value,
        median: row.median_value,
        trimmed_mean: row.trimmed_mean_value,
        min: row.min_value,
        max: row.max_value,
        p25: row.p25_value,
        p75: row.p75_value,
        seven_day_sold_median: row.metric_scope === "SOLD" ? row.seven_day_sold_median : null,
        outlier_count: row.outlier_count,
        outlier_lower_bound: row.outlier_lower_bound,
        outlier_upper_bound: row.outlier_upper_bound,
        confidence_level: row.confidence_level
      };
    }
    const versionRow = dailyRows.at(-1);
    const dailySourceRows = this.db.prepare(`
      SELECT d.stat_date, d.metric_scope, ds.*
        FROM daily_source_price_stats ds
        JOIN daily_price_stats d ON d.id = ds.daily_price_stat_id
       WHERE d.canonical_product_id = ? AND d.market_pool = ? AND d.condition_code = ?
         AND d.currency = ? AND d.stat_date >= ? AND d.stat_date <= ?
         AND d.normalization_version = ?
         AND d.parser_version = ? AND d.rule_version = ? AND d.filter_version = ?
       ORDER BY ds.source_id, d.stat_date, d.metric_scope
    `).all(canonicalProductId, marketPool, condition, currency, from.slice(0, 10), asOf.slice(0, 10),
      normalizationVersion, parserVersion, ruleVersion, filterVersion);
    const sourceDailyMaps = new Map();
    for (const row of dailySourceRows) {
      if (!sourceDailyMaps.has(row.source_id)) sourceDailyMaps.set(row.source_id, new Map());
      const daily = sourceDailyMaps.get(row.source_id);
      if (!daily.has(row.stat_date)) daily.set(row.stat_date, { date: row.stat_date });
      daily.get(row.stat_date)[row.metric_scope === "CONFIRMED_TRANSACTION" ? "confirmed_transactions" : row.metric_scope.toLowerCase()] = {
        sample_count: row.sample_count,
        unit_count: row.unit_count,
        mean: row.mean_value,
        median: row.median_value,
        trimmed_mean: row.trimmed_mean_value,
        min: row.min_value,
        max: row.max_value,
        p25: row.p25_value,
        p75: row.p75_value,
        seven_day_sold_median: row.metric_scope === "SOLD" ? row.seven_day_sold_median : null,
        outlier_count: row.outlier_count,
        outlier_lower_bound: row.outlier_lower_bound,
        outlier_upper_bound: row.outlier_upper_bound,
        confidence_level: row.confidence_level
      };
    }
    const rowsBySource = new Map();
    for (const row of rows) {
      if (!rowsBySource.has(row.source_id)) rowsBySource.set(row.source_id, []);
      rowsBySource.get(row.source_id).push(row);
    }
    const bySource = [...rowsBySource.entries()]
      .filter(([, sourceRows]) => sourceRows.some(priceStatsRowEligible))
      .sort(([left], [right]) => left.localeCompare(right)).map(([sourceId, sourceRows]) => {
      const sourceLatest = new Map();
      const sourceFirstSold = new Map();
      const sourceTransactions = new Map();
      for (const row of sourceRows) {
        const identity = priceStatsListingIdentity(row);
        sourceLatest.set(identity, row);
        if (row.lifecycle_status === "SOLD" && !sourceFirstSold.has(identity)) sourceFirstSold.set(identity, row);
        if (row.lifecycle_status === "SOLD" && row.transaction_price != null) sourceTransactions.set(identity, row);
      }
      const sourceActiveRows = [...sourceLatest.entries()]
        .filter(([identity, row]) => currentIdentityRowEligible(identity, row, currentByListing, currentScope, "ACTIVE"))
        .map(([, row]) => row);
      const sourceReservedRows = [...sourceLatest.entries()]
        .filter(([identity, row]) => currentIdentityRowEligible(identity, row, currentByListing, currentScope, "RESERVED"))
        .map(([, row]) => row);
      const sourceSoldRows = [...sourceFirstSold.entries()]
        .filter(([identity]) => currentSoldIdentityEligible(identity, sourceFirstSold, currentByListing, currentScope))
        .map(([, row]) => row);
      const sourceTransactionRows = [...sourceTransactions.entries()]
        .filter(([identity, row]) => priceStatsRowEligible(row)
          && currentSoldIdentityEligible(identity, sourceFirstSold, currentByListing, currentScope))
        .map(([, row]) => row);
      const sourceUnitCount = (entries) => entries.reduce((sum, row) => sum + Math.max(1, Number(row.quantity) || 1), 0);
      const sourceActive = summarize(sourceActiveRows.map((row) => Number(row.comparable_price ?? row.price_value)), sourceUnitCount(sourceActiveRows));
      const sourceReserved = summarize(sourceReservedRows.map((row) => Number(row.comparable_price ?? row.price_value)), sourceUnitCount(sourceReservedRows));
      const sourceSold = summarize(sourceSoldRows.map((row) => comparableScopePrice(row.sold_last_ask_price, row.quantity, row.price_scope)), sourceUnitCount(sourceSoldRows));
      const sourceConfirmed = summarize(sourceTransactionRows.map((row) => comparableScopePrice(row.transaction_price, row.quantity, row.price_scope)), sourceUnitCount(sourceTransactionRows));
      sourceReserved.disclosure = "예약중 매물에 표시된 가격이며 실제 거래가격이 아닙니다.";
      sourceSold.disclosure = "판매완료 매물에 마지막으로 표시된 가격이며 실제 거래가격이 아닙니다.";
      const traceability = this.db.prepare(`SELECT COUNT(*) AS count
        FROM daily_source_price_stat_members sm
        JOIN daily_source_price_stats ds ON ds.id = sm.daily_source_price_stat_id
        JOIN daily_price_stats d ON d.id = ds.daily_price_stat_id
        WHERE ds.source_id = ? AND d.canonical_product_id = ? AND d.market_pool = ?
          AND d.condition_code = ? AND d.currency = ? AND d.stat_date >= ? AND d.stat_date <= ?
          AND d.normalization_version = ?
          AND d.parser_version = ? AND d.rule_version = ? AND d.filter_version = ?`).get(
            sourceId, canonicalProductId, marketPool, condition, currency, from.slice(0, 10), asOf.slice(0, 10),
            normalizationVersion, parserVersion, ruleVersion, filterVersion
          );
      return {
        source_id: sourceId,
        active: sourceActive,
        reserved: sourceReserved,
        sold: sourceSold,
        confirmed_transactions: sourceConfirmed,
        daily: [...(sourceDailyMaps.get(sourceId)?.values() || [])],
        traceability: { member_count: Number(traceability?.count || 0) }
      };
    });
    const rowsByManufacturer = new Map();
    for (const row of rows) {
      const manufacturer = cleanText(row.board_manufacturer, 120);
      if (!manufacturer) continue;
      if (!rowsByManufacturer.has(manufacturer)) rowsByManufacturer.set(manufacturer, []);
      rowsByManufacturer.get(manufacturer).push(row);
    }
    const byManufacturer = [...rowsByManufacturer.entries()]
      .filter(([, manufacturerRows]) => manufacturerRows.some(priceStatsRowEligible))
      .sort(([left], [right]) => left.localeCompare(right)).map(([manufacturer, manufacturerRows]) => {
      const latest = new Map();
      const firstSold = new Map();
      const transactions = new Map();
      for (const row of manufacturerRows) {
        const identity = priceStatsListingIdentity(row);
        latest.set(identity, row);
        if (row.lifecycle_status === "SOLD" && !firstSold.has(identity)) firstSold.set(identity, row);
        if (row.lifecycle_status === "SOLD" && row.transaction_price != null) transactions.set(identity, row);
      }
      const activeRowsForManufacturer = [...latest.entries()]
        .filter(([identity, row]) => currentIdentityRowEligible(identity, row, currentByListing, currentScope, "ACTIVE"))
        .map(([, row]) => row);
      const reservedRowsForManufacturer = [...latest.entries()]
        .filter(([identity, row]) => currentIdentityRowEligible(identity, row, currentByListing, currentScope, "RESERVED"))
        .map(([, row]) => row);
      const soldRowsForManufacturer = [...firstSold.entries()]
        .filter(([identity]) => currentSoldIdentityEligible(identity, firstSold, currentByListing, currentScope))
        .map(([, row]) => row);
      const transactionRowsForManufacturer = [...transactions.entries()]
        .filter(([identity, row]) => priceStatsRowEligible(row)
          && currentSoldIdentityEligible(identity, firstSold, currentByListing, currentScope))
        .map(([, row]) => row);
      const countUnits = (entries) => entries.reduce((sum, row) => sum + Math.max(1, Number(row.quantity) || 1), 0);
      const activeForManufacturer = summarize(activeRowsForManufacturer.map((row) => Number(row.comparable_price ?? row.price_value)), countUnits(activeRowsForManufacturer));
      const reservedForManufacturer = summarize(reservedRowsForManufacturer.map((row) => Number(row.comparable_price ?? row.price_value)), countUnits(reservedRowsForManufacturer));
      const soldForManufacturer = summarize(soldRowsForManufacturer.map((row) => comparableScopePrice(row.sold_last_ask_price, row.quantity, row.price_scope)), countUnits(soldRowsForManufacturer));
      reservedForManufacturer.disclosure = "예약중 매물에 표시된 가격이며 실제 거래가격이 아닙니다.";
      soldForManufacturer.disclosure = "판매완료 매물에 마지막으로 표시된 가격이며 실제 거래가격이 아닙니다.";
      return {
        manufacturer,
        active: activeForManufacturer,
        reserved: reservedForManufacturer,
        sold: soldForManufacturer,
        confirmed_transactions: summarize(transactionRowsForManufacturer.map((row) => comparableScopePrice(row.transaction_price, row.quantity, row.price_scope)), countUnits(transactionRowsForManufacturer))
      };
    });
    const excludedRows = this.db.prepare(`SELECT n.exclusion_reasons_json
      FROM normalized_listings n
      JOIN listing_snapshots s ON s.id = n.snapshot_id
      WHERE n.canonical_product_id = ? AND n.market_pool = ? AND n.condition_code = ?
        AND s.currency = ? AND s.observed_at >= ? AND s.observed_at <= ?
        AND n.normalization_version = ?
        AND n.parser_version = ? AND n.rule_version = ? AND n.filter_version = ?
        AND n.price_eligible = 0`).all(
          canonicalProductId, marketPool, condition, currency, from, asOf,
          normalizationVersion, parserVersion, ruleVersion, filterVersion
        );
    const exclusionReasons = {};
    for (const row of excludedRows) {
      for (const reason of parseJson(row.exclusion_reasons_json, [])) {
        exclusionReasons[reason] = Number(exclusionReasons[reason] || 0) + 1;
      }
    }
    return {
      canonical_product_id: canonicalProductId,
      active,
      reserved,
      sold,
      confirmed_transactions: confirmed,
      by_source: bySource,
      by_manufacturer: byManufacturer,
      daily: [...dailyMap.values()],
      confidence: { level: sold.confidence_level, reasons: sold.sample_count < 5 ? ["판매완료 표본 부족"] : [] },
      exclusions: { total: excludedRows.length, reasons: exclusionReasons },
      methodology: {
        days,
        market_pool: marketPool,
        condition,
        currency,
        active_rule: "기간 내 매물별 마지막 유효 관측",
        sold_rule: "기간 내 최초 SOLD 관측에서 확인한 마지막 유효 표시가격",
        sample_thresholds: { representative_null_below: 3, mean_from: 5, trimmed_mean_and_iqr_from: 10 }
      },
      versions: {
        normalization: normalizationVersion,
        parser: versionRow?.parser_version || cleanText(options.parserVersion || "pc-parser-v1", 100),
        rule: versionRow?.rule_version || cleanText(options.ruleVersion || "pc-rules-v1", 100),
        filter: versionRow?.filter_version || cleanText(options.filterVersion || "pc-filter-v1", 100)
      },
      as_of: asOf
    };
  }

  rebuildAndGetPriceStats(options) {
    this.rebuildDailyPriceStats(options);
    return this.getPriceStats(options);
  }

  traceStatMembers({ canonicalProductId, marketPool, condition, currency, days = 30, asOf = new Date(this.now()), normalizationVersion = 1, parserVersion = "pc-parser-v1", ruleVersion = "pc-rules-v1", filterVersion = "pc-filter-v1" }) {
    const { asOf: end, from: start } = priceStatsWindow(asOf, days);
    return this.db.prepare(`
      SELECT d.stat_date, d.metric_scope, m.price_value, m.outlier_flag, m.outlier_reason, s.id AS snapshot_id,
             r.id AS raw_listing_id, r.source_id, r.source_listing_id, i.id AS listing_item_id
        FROM daily_price_stat_members m
        JOIN daily_price_stats d ON d.id = m.daily_price_stat_id
        JOIN listing_snapshots s ON s.id = m.snapshot_id
        JOIN raw_listings r ON r.id = m.raw_listing_id
        JOIN listing_items i ON i.id = m.listing_item_id
       WHERE d.canonical_product_id = ? AND d.market_pool = ? AND d.condition_code = ? AND d.currency = ?
         AND d.stat_date >= ? AND d.stat_date <= ?
         AND d.normalization_version = ?
         AND d.parser_version = ? AND d.rule_version = ? AND d.filter_version = ?
       ORDER BY d.stat_date, d.metric_scope, r.source_id, r.source_listing_id
    `).all(requireValue(canonicalProductId, "canonicalProductId"), requireValue(marketPool, "marketPool"), requireValue(condition, "condition"), requireValue(currency, "currency").toUpperCase(), start.slice(0, 10), end.slice(0, 10), Math.max(1, Number(normalizationVersion) || 1), cleanText(parserVersion, 100), cleanText(ruleVersion, 100), cleanText(filterVersion, 100));
  }

  recordPublicationSuccess({ publicationKind = "PRODUCT_STATS", publicationId, checksum, rowCount, publishedAt = new Date(this.now()) }) {
    const validatedRowCount = Number(rowCount);
    if (!Number.isInteger(validatedRowCount) || validatedRowCount <= 0) throw new TypeError("rowCount must be a positive integer");
    this.db.prepare(`INSERT INTO pc_publication_runtime (
        publication_kind, publication_id, checksum, row_count, published_at
      ) VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(publication_kind) DO UPDATE SET
        publication_id = excluded.publication_id,
        checksum = excluded.checksum,
        row_count = excluded.row_count,
        published_at = excluded.published_at`).run(
      requireValue(publicationKind, "publicationKind"),
      requireValue(publicationId, "publicationId"),
      requireValue(checksum, "checksum"),
      validatedRowCount,
      iso(publishedAt)
    );
  }

  getPublicationRuntime(publicationKind = "PRODUCT_STATS") {
    return this.db.prepare(`SELECT publication_kind, publication_id, checksum, row_count, published_at
      FROM pc_publication_runtime WHERE publication_kind = ?`).get(requireValue(publicationKind, "publicationKind")) || null;
  }

  runIntegrityAudit(auditedAt = new Date(this.now())) {
    const blockers = [];
    const quickCheck = this.db.prepare("PRAGMA quick_check").get()?.quick_check;
    if (quickCheck !== "ok") blockers.push(`SQLITE_QUICK_CHECK:${quickCheck || "unknown"}`);
    const foreignKeyViolations = this.db.prepare("PRAGMA foreign_key_check").all();
    if (foreignKeyViolations.length > 0) blockers.push(`FOREIGN_KEY_VIOLATIONS:${foreignKeyViolations.length}`);
    const immutableTriggers = Number(this.db.prepare(`SELECT COUNT(*) AS count FROM sqlite_master
      WHERE type = 'trigger' AND name IN ('raw_listings_content_immutable', 'raw_listings_delete_immutable')`).get()?.count || 0);
    if (immutableTriggers !== 2) blockers.push("RAW_IMMUTABILITY_TRIGGERS_MISSING");

    const memberMismatches = this.db.prepare(`SELECT d.id
      FROM daily_price_stats d
      LEFT JOIN daily_price_stat_members m ON m.daily_price_stat_id = d.id AND m.included = 1
      GROUP BY d.id HAVING COUNT(m.snapshot_id) <> d.sample_count`).all();
    if (memberMismatches.length > 0) blockers.push(`STAT_MEMBER_COUNT_MISMATCH:${memberMismatches.length}`);

    const soldRows = this.db.prepare(`SELECT id, status_evidence_json FROM listing_snapshots
      WHERE lifecycle_status = 'SOLD'`).all();
    const invalidSoldEvidence = soldRows.filter((row) => !SOLD_EVIDENCE_TYPES.has(
      cleanText(parseJson(row.status_evidence_json, {})?.type, 40).toUpperCase()
    ));
    if (invalidSoldEvidence.length > 0) blockers.push(`INVALID_SOLD_EVIDENCE:${invalidSoldEvidence.length}`);

    const poolRows = this.db.prepare(`SELECT n.id, n.market_pool, s.allowed_market_pools_json
      FROM normalized_listings n
      JOIN listing_snapshots ls ON ls.id = n.snapshot_id
      JOIN sources s ON s.source_id = ls.source_id`).all();
    const marketPoolMismatches = poolRows.filter((row) => !parseJson(row.allowed_market_pools_json, []).includes(row.market_pool));
    if (marketPoolMismatches.length > 0) blockers.push(`MARKET_POOL_MISMATCH:${marketPoolMismatches.length}`);

    const confirmedClusterViolations = this.db.prepare(`SELECT c.id
      FROM duplicate_clusters c
      LEFT JOIN duplicate_cluster_members m ON m.cluster_id = c.id
      WHERE c.cluster_status = 'CONFIRMED'
      GROUP BY c.id HAVING COUNT(DISTINCT m.source_id) < 2`).all();
    if (confirmedClusterViolations.length > 0) blockers.push(`INVALID_CONFIRMED_DUPLICATE_CLUSTER:${confirmedClusterViolations.length}`);
    const activePipelineCount = Number(this.db.prepare(`SELECT COUNT(*) AS count FROM pc_pipeline_versions
      WHERE version_status = 'ACTIVE'`).get()?.count || 0);
    if (activePipelineCount !== 1) blockers.push(`ACTIVE_PIPELINE_VERSION_COUNT:${activePipelineCount}`);
    if (blockers.length > 0) throw new Error(`PC_LEDGER_INTEGRITY_FAILED:${blockers.join(",")}`);
    return {
      ok: true,
      audited_at: iso(auditedAt),
      quick_check: quickCheck,
      foreign_key_violations: 0,
      stat_member_mismatches: 0,
      invalid_sold_evidence: 0,
      market_pool_mismatches: 0,
      invalid_confirmed_duplicate_clusters: 0,
      active_pipeline_version_count: 1
    };
  }

  close() {
    if (this.ownsDb) this.db.close();
  }
}

export const PC_PARTS_PRICE_POLICY = Object.freeze({
  defaultDays: 30,
  minimumRecheckIntervalMs: 6 * HOUR_MS,
  missingChecksBeforeUnavailable: 3,
  representativeMinimum: 3,
  meanMinimum: 5,
  trimmedMeanMinimum: 10,
  soldEvidenceTypes: [...SOLD_EVIDENCE_TYPES]
});
