import { createHash, randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, statSync, unlinkSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { dedupePcListingRows } from "../cloudflare/pc-listings-contract.mjs";

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
const FRESH_MAX_AGE_MS = 6 * HOUR_MS;
const HOT_REFRESH_MS = 15 * 60 * 1000;
const WARM_REFRESH_MS = HOUR_MS;
const QUERY_ACTIVE_MS = 7 * DAY_MS;
const QUERY_RETENTION_MS = 30 * DAY_MS;
const INACTIVE_RETENTION_MS = 14 * DAY_MS;
const PRICE_HISTORY_RETENTION_MS = 30 * DAY_MS;
const REFRESH_JOB_TTL_MS = 10 * 60 * 1000;
const REFRESH_RETRY_BASE_MS = 5 * 60 * 1000;
const REFRESH_RETRY_MAX_MS = 6 * HOUR_MS;
const SEARCH_SNAPSHOT_RETENTION_MS = FRESH_MAX_AGE_MS;
const MAX_SNAPSHOT_ITEMS = 1_000;
const SITE_RESULT_WINDOW_INITIAL = 160;
const SITE_RESULT_WINDOW_MAX = 640;
const MISSING_PRICE_SORT_VALUE = 9_007_199_254_740_991;
const PC_COLLECTION_NAMESPACE = "pc_parts_v1";
const LEGACY_COLLECTION_NAMESPACE = "legacy_general";
export const SEARCH_INDEX_SCHEMA_VERSION = 9;

const DEFAULT_LIMITS = Object.freeze({
  maxActiveListings: 100_000,
  maxQueries: 10_000,
  softBytes: 750 * 1024 * 1024,
  hardBytes: 1024 * 1024 * 1024
});

const QUERY_ALIASES = Object.freeze([
  [/iphone/giu, "아이폰"],
  [/galaxy/giu, "갤럭시"],
  [/airpods?/giu, "에어팟"],
  [/macbook/giu, "맥북"]
]);

function cleanText(value, maximum = 2_000) {
  return String(value ?? "").replace(/\s+/gu, " ").trim().slice(0, maximum);
}

function redactStoredText(value, maximum = 2_000) {
  return cleanText(value, maximum)
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/giu, "[EMAIL]")
    .replace(/(?<!\d)(?:\+?82[-.\s]?)?0?1[016789][-.\s]?\d{3,4}[-.\s]?\d{4}(?!\d)/gu, "[PHONE]");
}

function requestedSiteWindow(body = {}) {
  const value = Number(body.site_window);
  return Number.isInteger(value) && value > 0
    ? Math.min(value, SITE_RESULT_WINDOW_MAX)
    : SITE_RESULT_WINDOW_INITIAL;
}

export function canonicalCollectionQuery(value) {
  let normalized = cleanText(value, 300).normalize("NFKC").toLowerCase();
  for (const [pattern, replacement] of QUERY_ALIASES) normalized = normalized.replace(pattern, replacement);
  return normalized
    .replace(/[^0-9a-z가-힣]+/giu, " ")
    .replace(/([가-힣]|[a-z]{2,})(\d)/giu, "$1 $2")
    .replace(/(\d)([가-힣]|[a-z]{2,})/giu, "$1 $2")
    .replace(/\b([a-z])\s+(\d{1,4})\b/giu, "$1$2")
    .replace(/\s+/gu, " ")
    .trim();
}

export function normalizeSearchQuery(value) {
  return canonicalCollectionQuery(value).replace(/\s+/gu, "");
}

function sortedStrings(values) {
  return [...new Set((Array.isArray(values) ? values : []).map((value) => cleanText(value, 120)).filter(Boolean))].sort();
}

function requireTargetSites(identity) {
  if (identity.sites.length > 0) return identity;
  const error = new Error("at least one target site is required");
  error.statusCode = 400;
  throw error;
}

function categoryIdsFromBody(body) {
  return sortedStrings([
    ...(Array.isArray(body?.category_ids) ? body.category_ids : []),
    body?.category_id && body.category_id !== "all" ? body.category_id : ""
  ]);
}

export function collectionIdentity(body = {}) {
  const collectionQuery = canonicalCollectionQuery(body.keyword);
  const canonicalQuery = normalizeSearchQuery(body.keyword);
  const categoryIds = categoryIdsFromBody(body);
  const sites = sortedStrings(body.sites);
  const pcCategoryCode = cleanText(body.pc_category_code, 80).toUpperCase();
  const manufacturer = cleanText(body.manufacturer, 120);
  const namespace = body.collection_namespace === PC_COLLECTION_NAMESPACE || categoryIds.includes("pc")
    ? PC_COLLECTION_NAMESPACE
    : LEGACY_COLLECTION_NAMESPACE;
  // legacy_general deliberately keeps the pre-refactor hash shape so existing
  // cache rows and signed cursor snapshots remain valid during the parallel run.
  const identity = namespace === PC_COLLECTION_NAMESPACE
    ? JSON.stringify({ namespace, canonicalQuery, categoryIds, sites, pcCategoryCode, manufacturer })
    : JSON.stringify({ canonicalQuery, categoryIds, sites });
  return {
    key: createHash("sha256").update(identity).digest("base64url").slice(0, 24),
    collectionQuery,
    canonicalQuery,
    categoryIds,
    sites,
    pcCategoryCode,
    manufacturer,
    namespace
  };
}

function iso(value) {
  return new Date(value).toISOString();
}

function parseTime(value) {
  const parsed = Date.parse(String(value || ""));
  return Number.isFinite(parsed) ? parsed : 0;
}

function jsonArray(value) {
  try {
    const parsed = JSON.parse(String(value || "[]"));
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function jsonObject(value) {
  try {
    const parsed = JSON.parse(String(value || "{}"));
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function pcProjection(item = {}) {
  const exclusionReasons = Array.isArray(item.exclusion_reasons)
    ? item.exclusion_reasons.map((value) => cleanText(value, 80)).filter(Boolean)
    : [];
  const quantity = Number(item.quantity);
  return {
    canonical_product_id: cleanText(item.canonical_product_id, 200) || null,
    canonical_display_name: cleanText(item.canonical_display_name, 300) || null,
    canonical_manufacturer: cleanText(item.canonical_manufacturer, 120) || null,
    chip_manufacturer: cleanText(item.chip_manufacturer, 120) || null,
    board_manufacturer: cleanText(item.board_manufacturer, 120) || null,
    listing_kind: cleanText(item.listing_kind, 80) || "UNKNOWN",
    category_code: cleanText(item.pc_category_code || item.category_code, 80) || null,
    market_segment: cleanText(item.market_segment, 80) || "UNKNOWN",
    listing_type: cleanText(item.listing_type, 80) || "UNKNOWN",
    condition_group: cleanText(item.condition_group, 80) || "UNKNOWN",
    spec_group_id: cleanText(item.spec_group_id, 300) || null,
    classification_confidence: Number.isFinite(Number(item.classification_confidence)) ? Number(item.classification_confidence) : 0,
    model_confidence: Number.isFinite(Number(item.model_confidence)) ? Number(item.model_confidence) : 0,
    quantity_confidence: Number.isFinite(Number(item.quantity_confidence)) ? Number(item.quantity_confidence) : 0,
    price_scope_confidence: Number.isFinite(Number(item.price_scope_confidence)) ? Number(item.price_scope_confidence) : 0,
    statistics_eligible: item.statistics_eligible === true,
    statistics_exclusion_reasons: Array.isArray(item.statistics_exclusion_reasons) ? item.statistics_exclusion_reasons.map((value) => cleanText(value, 80)).filter(Boolean) : [],
    quantity: Number.isInteger(quantity) && quantity > 0 ? quantity : null,
    price_scope: cleanText(item.price_scope, 80) || "UNKNOWN",
    condition_code: cleanText(item.condition_code, 80) || "UNKNOWN",
    lifecycle_status: cleanText(item.lifecycle_status, 80) || "ACTIVE",
    market_pool: cleanText(item.market_pool, 80) || null,
    confidence: item.confidence && typeof item.confidence === "object" ? item.confidence : {},
    evidence: item.evidence && typeof item.evidence === "object" ? item.evidence : {},
    price_eligible: item.price_eligible === true,
    exclusion_reasons: exclusionReasons,
    good_listing_eligible: item.good_listing_eligible === true,
    reference_price: item.reference_price !== null && item.reference_price !== undefined && item.reference_price !== ""
      && Number.isFinite(Number(item.reference_price)) ? Number(item.reference_price) : null
  };
}

function pcListingColumnValues(metadata = {}) {
  const quantity = Number(metadata.quantity);
  return [
    cleanText(metadata.canonical_product_id, 200) || null,
    cleanText(metadata.category_code, 80) || null,
    cleanText(metadata.listing_kind, 80) || "UNKNOWN",
    cleanText(metadata.lifecycle_status, 80) || "ACTIVE",
    metadata.price_eligible === true ? 1 : 0,
    cleanText(metadata.condition_code, 80) || "UNKNOWN",
    Number.isInteger(quantity) && quantity > 0 ? quantity : null,
    cleanText(metadata.price_scope, 80) || "UNKNOWN",
    cleanText(metadata.market_pool, 80) || null,
    cleanText(metadata.canonical_manufacturer, 120) || null,
    cleanText(metadata.board_manufacturer, 120) || null
  ];
}

function contentHash(item) {
  return createHash("sha256").update(JSON.stringify({
    title: cleanText(item.title, 500),
    search_text: cleanText(item.search_text || item.title, 1_000),
    price: Number.isFinite(Number(item.price)) ? Number(item.price) : null,
    url: cleanText(item.url, 2_000),
    image_url: cleanText(item.image_url, 2_000),
    location: cleanText(item.location, 300),
    description: cleanText(item.description, 2_000),
    posted_at: cleanText(item.posted_at, 80),
    pc: pcProjection(item),
    quality: {
      price_suspect: item.price_suspect === true,
      quality_suspect: item.quality_suspect === true,
      noise_filtered: item.noise_filtered === true,
      noise_filter_reason: cleanText(item.noise_filter_reason, 200) || null,
      fraud_risk: Number.isFinite(Number(item.fraud_risk)) ? Number(item.fraud_risk) : null
    }
  })).digest("base64url").slice(0, 24);
}

function sqlPlaceholders(values) {
  return values.map(() => "?").join(",");
}

function pcListingOrderClause(sort) {
  if (sort === "price_asc") return "price_value ASC, last_checked_at DESC, item_id ASC";
  if (sort === "price_desc") return "price_value DESC, last_checked_at DESC, item_id ASC";
  return "last_checked_at DESC, item_id ASC";
}

function pcListingKeysetPredicate(sort, afterRow) {
  if (sort === "price_asc") {
    return {
      clause: "(price_value > ? OR (price_value = ? AND (last_checked_at < ? OR (last_checked_at = ? AND item_id > ?))))",
      params: [afterRow.price_value, afterRow.price_value, afterRow.last_checked_at, afterRow.last_checked_at, afterRow.item_id]
    };
  }
  if (sort === "price_desc") {
    return {
      clause: "(price_value < ? OR (price_value = ? AND (last_checked_at < ? OR (last_checked_at = ? AND item_id > ?))))",
      params: [afterRow.price_value, afterRow.price_value, afterRow.last_checked_at, afterRow.last_checked_at, afterRow.item_id]
    };
  }
  return {
    clause: "(last_checked_at < ? OR (last_checked_at = ? AND item_id > ?))",
    params: [afterRow.last_checked_at, afterRow.last_checked_at, afterRow.item_id]
  };
}

function publicItem(row) {
  const pc = jsonObject(row.pc_metadata_json);
  return {
    id: row.item_id,
    item_id: row.item_id,
    site: row.site,
    category_id: row.category_id,
    title: row.title,
    search_text: row.search_text,
    price: typeof row.price_value === "number" ? row.price_value : null,
    currency: row.currency || "KRW",
    url: row.url,
    image_url: row.image_url || null,
    location: row.location || null,
    description: row.description || null,
    posted_at: row.posted_at || null,
    price_suspect: row.query_price_suspect === 1,
    quality_suspect: row.query_quality_suspect === 1,
    noise_filtered: row.query_noise_filtered === 1,
    noise_filter_reason: row.query_noise_filter_reason || null,
    fraud_risk: typeof row.query_fraud_risk === "number" ? row.query_fraud_risk : null,
    indexed_first_seen_at: row.first_seen_at,
    indexed_last_seen_at: row.last_seen_at,
    indexed_last_checked_at: row.last_checked_at,
    canonical_product_id: pc.canonical_product_id || null,
    canonical_display_name: pc.canonical_display_name || null,
    canonical_manufacturer: pc.canonical_manufacturer || null,
    chip_manufacturer: pc.chip_manufacturer || null,
    board_manufacturer: pc.board_manufacturer || null,
    listing_kind: pc.listing_kind || "UNKNOWN",
    category_code: pc.category_code || null,
    market_segment: pc.market_segment || "UNKNOWN",
    listing_type: pc.listing_type || "UNKNOWN",
    condition_group: pc.condition_group || "UNKNOWN",
    spec_group_id: pc.spec_group_id || null,
    classification_confidence: pc.classification_confidence || 0,
    model_confidence: pc.model_confidence || 0,
    quantity_confidence: pc.quantity_confidence || 0,
    price_scope_confidence: pc.price_scope_confidence || 0,
    statistics_eligible: pc.statistics_eligible === true,
    statistics_exclusion_reasons: Array.isArray(pc.statistics_exclusion_reasons) ? pc.statistics_exclusion_reasons : [],
    quantity: Number.isInteger(pc.quantity) ? pc.quantity : null,
    price_scope: pc.price_scope || "UNKNOWN",
    condition_code: pc.condition_code || "UNKNOWN",
    lifecycle_status: pc.lifecycle_status || "ACTIVE",
    market_pool: pc.market_pool || null,
    confidence: pc.confidence && typeof pc.confidence === "object" ? pc.confidence : {},
    evidence: pc.evidence && typeof pc.evidence === "object" ? pc.evidence : {},
    price_eligible: pc.price_eligible === true,
    exclusion_reasons: Array.isArray(pc.exclusion_reasons) ? pc.exclusion_reasons : [],
    good_listing_eligible: pc.good_listing_eligible === true,
    reference_price: pc.reference_price !== null && pc.reference_price !== undefined && pc.reference_price !== ""
      && Number.isFinite(Number(pc.reference_price)) ? Number(pc.reference_price) : null
  };
}

export class SearchIndex {
  constructor(options = {}) {
    this.now = typeof options.now === "function" ? options.now : () => Date.now();
    this.filePath = options.filePath || path.join(process.cwd(), "search-index.sqlite");
    this.backupDir = options.backupDir || (this.filePath === ":memory:" ? "" : path.join(path.dirname(this.filePath), "backups"));
    this.limits = { ...DEFAULT_LIMITS, ...(options.limits || {}) };
    const existingFileNeedsInspection = this.filePath !== ":memory:" && existsSync(this.filePath) && statSync(this.filePath).size > 0;
    if (this.filePath !== ":memory:") mkdirSync(path.dirname(this.filePath), { recursive: true });
    this.db = new DatabaseSync(this.filePath);
    try {
      this.configure();
      const currentVersion = Number(this.db.prepare("PRAGMA user_version").get()?.user_version || 0);
      if (existingFileNeedsInspection && currentVersion < SEARCH_INDEX_SCHEMA_VERSION) {
        this.createMigrationBackup(currentVersion);
      }
      this.migrate();
    } catch (error) {
      this.db.close();
      throw error;
    }
  }

  configure() {
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA synchronous = NORMAL;
      PRAGMA foreign_keys = ON;
      PRAGMA busy_timeout = 5000;
      PRAGMA cache_size = -65536;
      PRAGMA journal_size_limit = 134217728;
      PRAGMA wal_autocheckpoint = 1000;
    `);
  }

  migrate() {
    const initialUserVersion = Number(this.db.prepare("PRAGMA user_version").get()?.user_version || 0);
    this.db.exec("BEGIN IMMEDIATE");
    try {
      this.db.exec(`
      CREATE TABLE IF NOT EXISTS listings (
        item_id TEXT PRIMARY KEY,
        site TEXT NOT NULL,
        category_id TEXT NOT NULL DEFAULT 'all',
        title TEXT NOT NULL,
        search_text TEXT NOT NULL,
        normalized_text TEXT NOT NULL,
        compact_text TEXT NOT NULL,
        price_value REAL,
        currency TEXT NOT NULL DEFAULT 'KRW',
        url TEXT NOT NULL,
        image_url TEXT,
        location TEXT,
        description TEXT,
        posted_at TEXT,
        first_seen_at TEXT NOT NULL,
        last_seen_at TEXT NOT NULL,
        last_checked_at TEXT NOT NULL,
        inactive_at TEXT,
        active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0, 1)),
        content_hash TEXT NOT NULL,
        pc_metadata_json TEXT NOT NULL DEFAULT '{}'
      ) STRICT;

      CREATE INDEX IF NOT EXISTS idx_listings_active_seen
        ON listings(active, last_seen_at DESC);
      CREATE INDEX IF NOT EXISTS idx_listings_site_price
        ON listings(active, site, price_value);

      CREATE VIRTUAL TABLE IF NOT EXISTS listing_fts USING fts5(
        item_id UNINDEXED,
        normalized_text,
        compact_text,
        tokenize = 'unicode61 remove_diacritics 2'
      );

      CREATE TABLE IF NOT EXISTS query_index (
        query_key TEXT PRIMARY KEY,
        collection_namespace TEXT NOT NULL DEFAULT 'legacy_general' CHECK(collection_namespace IN ('legacy_general', 'pc_parts_v1')),
        canonical_query TEXT NOT NULL,
        keyword TEXT NOT NULL,
        category_ids_json TEXT NOT NULL,
        sites_json TEXT NOT NULL,
        first_requested_at TEXT NOT NULL,
        last_requested_at TEXT NOT NULL,
        request_window_started_at TEXT NOT NULL,
        request_count_24h INTEGER NOT NULL DEFAULT 1,
        total_request_count INTEGER NOT NULL DEFAULT 1,
        last_refreshed_at TEXT,
        last_deep_refreshed_at TEXT,
        result_count INTEGER NOT NULL DEFAULT 0,
        last_error TEXT,
        snapshot_version INTEGER NOT NULL DEFAULT 0,
        site_window INTEGER NOT NULL DEFAULT 160,
        refresh_failure_count INTEGER NOT NULL DEFAULT 0,
        next_refresh_attempt_at TEXT,
        refresh_disabled_reason TEXT
      ) STRICT;

      CREATE INDEX IF NOT EXISTS idx_query_refresh
        ON query_index(last_requested_at DESC, last_refreshed_at);

      CREATE TABLE IF NOT EXISTS query_listings (
        query_key TEXT NOT NULL REFERENCES query_index(query_key) ON DELETE CASCADE,
        item_id TEXT NOT NULL REFERENCES listings(item_id) ON DELETE CASCADE,
        site TEXT NOT NULL,
        last_seen_at TEXT NOT NULL,
        missing_count INTEGER NOT NULL DEFAULT 0,
        quality_evaluated INTEGER NOT NULL DEFAULT 0 CHECK(quality_evaluated IN (0, 1)),
        price_suspect INTEGER NOT NULL DEFAULT 0 CHECK(price_suspect IN (0, 1)),
        quality_suspect INTEGER NOT NULL DEFAULT 0 CHECK(quality_suspect IN (0, 1)),
        noise_filtered INTEGER NOT NULL DEFAULT 0 CHECK(noise_filtered IN (0, 1)),
        noise_filter_reason TEXT,
        fraud_risk REAL CHECK(fraud_risk IS NULL OR (fraud_risk >= 0 AND fraud_risk <= 1)),
        PRIMARY KEY(query_key, item_id)
      ) STRICT;

      CREATE INDEX IF NOT EXISTS idx_query_listings_site
        ON query_listings(query_key, site, missing_count, last_seen_at DESC);

      CREATE INDEX IF NOT EXISTS idx_query_listings_snapshot_recent
        ON query_listings(query_key, last_seen_at DESC, item_id, missing_count);

      CREATE INDEX IF NOT EXISTS idx_query_listings_item_active
        ON query_listings(item_id, missing_count);

      CREATE TABLE IF NOT EXISTS query_snapshots (
        query_key TEXT NOT NULL REFERENCES query_index(query_key) ON DELETE CASCADE,
        snapshot_version INTEGER NOT NULL,
        created_at TEXT NOT NULL,
        expires_at TEXT NOT NULL,
        total_count INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY(query_key, snapshot_version)
      ) STRICT;

      CREATE INDEX IF NOT EXISTS idx_query_snapshots_expiry
        ON query_snapshots(expires_at);

      CREATE TABLE IF NOT EXISTS query_snapshot_items (
        query_key TEXT NOT NULL,
        snapshot_version INTEGER NOT NULL,
        item_id TEXT NOT NULL,
        site TEXT NOT NULL,
        item_json TEXT NOT NULL,
        price_rank INTEGER NOT NULL,
        price_value REAL,
        price_sort REAL NOT NULL,
        posted_sort_at TEXT NOT NULL,
        image_rank INTEGER NOT NULL,
        PRIMARY KEY(query_key, snapshot_version, item_id),
        FOREIGN KEY(query_key, snapshot_version)
          REFERENCES query_snapshots(query_key, snapshot_version) ON DELETE CASCADE
      ) STRICT;

      CREATE INDEX IF NOT EXISTS idx_snapshot_price
        ON query_snapshot_items(query_key, snapshot_version, price_rank, price_sort, item_id);
      CREATE INDEX IF NOT EXISTS idx_snapshot_price_value
        ON query_snapshot_items(query_key, snapshot_version, price_sort, price_rank, item_id);
      CREATE INDEX IF NOT EXISTS idx_snapshot_recent
        ON query_snapshot_items(query_key, snapshot_version, posted_sort_at DESC, item_id);
      CREATE INDEX IF NOT EXISTS idx_snapshot_recommended
        ON query_snapshot_items(query_key, snapshot_version, image_rank, posted_sort_at DESC, price_sort, item_id);
      CREATE INDEX IF NOT EXISTS idx_snapshot_site
        ON query_snapshot_items(query_key, snapshot_version, site);

      CREATE TABLE IF NOT EXISTS price_history (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        item_id TEXT NOT NULL REFERENCES listings(item_id) ON DELETE CASCADE,
        price_value REAL NOT NULL,
        observed_at TEXT NOT NULL
      ) STRICT;

      CREATE INDEX IF NOT EXISTS idx_price_history_item
        ON price_history(item_id, observed_at DESC);

      CREATE TABLE IF NOT EXISTS refresh_jobs (
        token TEXT PRIMARY KEY,
        query_key TEXT NOT NULL,
        request_json TEXT NOT NULL,
        state TEXT NOT NULL,
        created_at TEXT NOT NULL,
        expires_at TEXT NOT NULL,
        completed_at TEXT,
        added_count INTEGER NOT NULL DEFAULT 0,
        error_message TEXT
      ) STRICT;

      CREATE INDEX IF NOT EXISTS idx_refresh_jobs_query
        ON refresh_jobs(query_key, state, created_at DESC);

      CREATE TABLE IF NOT EXISTS comparison_runs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        query_key TEXT NOT NULL,
        created_at TEXT NOT NULL,
        live_count INTEGER NOT NULL,
        index_count INTEGER NOT NULL,
        missing_count INTEGER NOT NULL,
        stale_count INTEGER NOT NULL
      ) STRICT;

      CREATE INDEX IF NOT EXISTS idx_comparison_runs_created
        ON comparison_runs(created_at DESC);
      `);
      const queryColumns = new Set(this.db.prepare("PRAGMA table_info(query_index)").all().map((row) => row.name));
      const listingColumns = new Set(this.db.prepare("PRAGMA table_info(listings)").all().map((row) => row.name));
      if (!listingColumns.has("pc_metadata_json")) {
        this.db.exec("ALTER TABLE listings ADD COLUMN pc_metadata_json TEXT NOT NULL DEFAULT '{}'");
        listingColumns.add("pc_metadata_json");
      }
      const pcListingColumnMigrations = [
        ["pc_canonical_product_id", "TEXT"],
        ["pc_category_code", "TEXT"],
        ["pc_listing_kind", "TEXT"],
        ["pc_lifecycle_status", "TEXT"],
        ["pc_price_eligible", "INTEGER"],
        ["pc_condition_code", "TEXT"],
        ["pc_quantity", "INTEGER"],
        ["pc_price_scope", "TEXT"],
        ["pc_market_pool", "TEXT"],
        ["pc_canonical_manufacturer", "TEXT"],
        ["pc_board_manufacturer", "TEXT"]
      ];
      let addedPcListingColumn = false;
      for (const [name, definition] of pcListingColumnMigrations) {
        if (!listingColumns.has(name)) {
          this.db.exec(`ALTER TABLE listings ADD COLUMN ${name} ${definition}`);
          listingColumns.add(name);
          addedPcListingColumn = true;
        }
      }
      if (addedPcListingColumn || initialUserVersion < 9) {
        this.db.exec(`
          UPDATE listings
             SET pc_canonical_product_id = json_extract(pc_metadata_json, '$.canonical_product_id'),
                 pc_category_code = json_extract(pc_metadata_json, '$.category_code'),
                 pc_listing_kind = COALESCE(json_extract(pc_metadata_json, '$.listing_kind'), 'UNKNOWN'),
                 pc_lifecycle_status = COALESCE(json_extract(pc_metadata_json, '$.lifecycle_status'), 'ACTIVE'),
                 pc_price_eligible = CASE WHEN json_extract(pc_metadata_json, '$.price_eligible') = 1 THEN 1 ELSE 0 END,
                 pc_condition_code = COALESCE(json_extract(pc_metadata_json, '$.condition_code'), 'UNKNOWN'),
                 pc_quantity = CAST(json_extract(pc_metadata_json, '$.quantity') AS INTEGER),
                 pc_price_scope = COALESCE(json_extract(pc_metadata_json, '$.price_scope'), 'UNKNOWN'),
                 pc_market_pool = json_extract(pc_metadata_json, '$.market_pool'),
                 pc_canonical_manufacturer = json_extract(pc_metadata_json, '$.canonical_manufacturer'),
                 pc_board_manufacturer = json_extract(pc_metadata_json, '$.board_manufacturer')
           WHERE pc_metadata_json IS NOT NULL
             AND pc_metadata_json <> '{}'
        `);
      }
      this.db.exec(`
        CREATE INDEX IF NOT EXISTS idx_listings_pc_product_recent
          ON listings(active, pc_canonical_product_id, pc_market_pool, currency, site, last_checked_at DESC, item_id);
        CREATE INDEX IF NOT EXISTS idx_listings_pc_product_price
          ON listings(active, pc_canonical_product_id, pc_market_pool, currency, site, price_value, last_checked_at DESC, item_id);
        CREATE INDEX IF NOT EXISTS idx_listings_pc_scope_recent
          ON listings(active, pc_category_code, pc_market_pool, currency, site, last_checked_at DESC, item_id);
        CREATE INDEX IF NOT EXISTS idx_listings_pc_site_recent
          ON listings(active, site, currency, last_checked_at DESC, item_id);
      `);
      if (initialUserVersion < 8) {
        this.db.prepare(`UPDATE listings
          SET active = 0, inactive_at = COALESCE(inactive_at, ?)
          WHERE site = 'ebay' AND item_id LIKE 'ebay:http%'`).run(iso(this.now()));
      }
      if (!queryColumns.has("snapshot_version")) {
        this.db.exec("ALTER TABLE query_index ADD COLUMN snapshot_version INTEGER NOT NULL DEFAULT 0");
      }
      if (!queryColumns.has("site_window")) {
        this.db.exec("ALTER TABLE query_index ADD COLUMN site_window INTEGER NOT NULL DEFAULT 160");
      }
      if (!queryColumns.has("refresh_failure_count")) {
        this.db.exec("ALTER TABLE query_index ADD COLUMN refresh_failure_count INTEGER NOT NULL DEFAULT 0");
      }
      if (!queryColumns.has("next_refresh_attempt_at")) {
        this.db.exec("ALTER TABLE query_index ADD COLUMN next_refresh_attempt_at TEXT");
      }
      if (!queryColumns.has("refresh_disabled_reason")) {
        this.db.exec("ALTER TABLE query_index ADD COLUMN refresh_disabled_reason TEXT");
      }
      if (!queryColumns.has("collection_namespace")) {
        this.db.exec("ALTER TABLE query_index ADD COLUMN collection_namespace TEXT NOT NULL DEFAULT 'legacy_general'");
        this.db.exec(`UPDATE query_index SET collection_namespace = 'pc_parts_v1'
          WHERE category_ids_json LIKE '%"pc"%'`);
      }
      const querySiteRows = this.db.prepare("SELECT query_key, sites_json FROM query_index").all();
      const quarantineQuery = this.db.prepare(`
        UPDATE query_index
           SET refresh_disabled_reason = 'no_target_sites',
               next_refresh_attempt_at = NULL,
               last_error = COALESCE(last_error, 'at least one target site is required')
         WHERE query_key = ?
      `);
      for (const row of querySiteRows) {
        if (jsonArray(row.sites_json).length === 0) quarantineQuery.run(row.query_key);
      }
      const queryListingColumns = new Set(this.db.prepare("PRAGMA table_info(query_listings)").all().map((row) => row.name));
      const queryListingColumnMigrations = [
        ["quality_evaluated", "INTEGER NOT NULL DEFAULT 0 CHECK(quality_evaluated IN (0, 1))"],
        ["price_suspect", "INTEGER NOT NULL DEFAULT 0 CHECK(price_suspect IN (0, 1))"],
        ["quality_suspect", "INTEGER NOT NULL DEFAULT 0 CHECK(quality_suspect IN (0, 1))"],
        ["noise_filtered", "INTEGER NOT NULL DEFAULT 0 CHECK(noise_filtered IN (0, 1))"],
        ["noise_filter_reason", "TEXT"],
        ["fraud_risk", "REAL CHECK(fraud_risk IS NULL OR (fraud_risk >= 0 AND fraud_risk <= 1))"]
      ];
      for (const [name, definition] of queryListingColumnMigrations) {
        if (!queryListingColumns.has(name)) this.db.exec(`ALTER TABLE query_listings ADD COLUMN ${name} ${definition}`);
      }
      const snapshotColumns = new Set(this.db.prepare("PRAGMA table_info(query_snapshot_items)").all().map((row) => row.name));
      const snapshotForeignKeys = this.db.prepare("PRAGMA foreign_key_list(query_snapshot_items)").all();
      if (!snapshotColumns.has("item_json") || snapshotForeignKeys.some((row) => row.table === "listings")) {
        const oldSnapshotRows = this.db.prepare("SELECT * FROM query_snapshot_items").all();
        const listingById = this.db.prepare("SELECT * FROM listings WHERE item_id = ?");
        this.db.exec(`
        DROP TABLE IF EXISTS query_snapshot_items_v2;
        CREATE TABLE query_snapshot_items_v2 (
          query_key TEXT NOT NULL,
          snapshot_version INTEGER NOT NULL,
          item_id TEXT NOT NULL,
          site TEXT NOT NULL,
          item_json TEXT NOT NULL,
          price_rank INTEGER NOT NULL,
          price_value REAL,
          price_sort REAL NOT NULL,
          posted_sort_at TEXT NOT NULL,
          image_rank INTEGER NOT NULL,
          PRIMARY KEY(query_key, snapshot_version, item_id),
          FOREIGN KEY(query_key, snapshot_version)
            REFERENCES query_snapshots(query_key, snapshot_version) ON DELETE CASCADE
        ) STRICT;
        `);
        const insertMigratedSnapshot = this.db.prepare(`
          INSERT INTO query_snapshot_items_v2(
            query_key, snapshot_version, item_id, site, item_json, price_rank,
            price_value, price_sort, posted_sort_at, image_rank
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `);
        for (const row of oldSnapshotRows) {
          const listing = listingById.get(row.item_id);
          const priceValue = typeof row.price_value === "number"
            ? row.price_value
            : typeof listing?.price_value === "number"
              ? listing.price_value
              : null;
          const priceMissing = priceValue === null || priceValue <= 100;
          const itemJson = typeof row.item_json === "string" && row.item_json
            ? row.item_json
            : JSON.stringify(listing
              ? publicItem(listing)
              : { id: row.item_id, item_id: row.item_id, site: row.site, title: "", price: priceValue, url: "" });
          insertMigratedSnapshot.run(
            row.query_key,
            Number(row.snapshot_version),
            row.item_id,
            row.site || listing?.site || "unknown",
            itemJson,
            Number.isInteger(row.price_rank) ? row.price_rank : priceMissing ? 3 : 1,
            priceValue,
            Number.isFinite(Number(row.price_sort)) ? Number(row.price_sort) : priceMissing ? MISSING_PRICE_SORT_VALUE : priceValue,
            row.posted_sort_at || listing?.posted_at || listing?.last_seen_at || iso(this.now()),
            Number.isInteger(row.image_rank) ? row.image_rank : listing?.image_url ? 0 : 1
          );
        }
        this.db.exec(`
          DROP TABLE query_snapshot_items;
          ALTER TABLE query_snapshot_items_v2 RENAME TO query_snapshot_items;
          CREATE INDEX idx_snapshot_price
            ON query_snapshot_items(query_key, snapshot_version, price_rank, price_sort, item_id);
          CREATE INDEX idx_snapshot_price_value
            ON query_snapshot_items(query_key, snapshot_version, price_sort, price_rank, item_id);
          CREATE INDEX idx_snapshot_recent
            ON query_snapshot_items(query_key, snapshot_version, posted_sort_at DESC, item_id);
          CREATE INDEX idx_snapshot_recommended
            ON query_snapshot_items(query_key, snapshot_version, image_rank, posted_sort_at DESC, price_sort, item_id);
          CREATE INDEX idx_snapshot_site
            ON query_snapshot_items(query_key, snapshot_version, site);
        `);
      }
      // Full database checks are migration gates. Running them on every service
      // restart keeps the HTTP port closed for minutes once the index grows.
      if (initialUserVersion < SEARCH_INDEX_SCHEMA_VERSION) {
        const foreignKeyFailures = this.db.prepare("PRAGMA foreign_key_check").all();
        if (foreignKeyFailures.length > 0) throw new Error("SQLite migration failed foreign_key_check");
        const integrity = this.db.prepare("PRAGMA integrity_check").get()?.integrity_check;
        if (integrity !== "ok") throw new Error(`SQLite migration failed integrity_check: ${integrity || "unknown"}`);
      }
      this.db.exec(`PRAGMA user_version = ${SEARCH_INDEX_SCHEMA_VERSION}; COMMIT`);
    } catch (error) {
      try {
        this.db.exec("ROLLBACK");
      } catch {
        // Preserve the original migration error.
      }
      throw error;
    }
  }

  materializeSnapshot(queryKey, snapshotVersion, createdAt = iso(this.now())) {
    const expiresAt = iso(parseTime(createdAt) + SEARCH_SNAPSHOT_RETENTION_MS);
    this.db.prepare(`
      INSERT OR REPLACE INTO query_snapshots(query_key, snapshot_version, created_at, expires_at, total_count)
      VALUES (?, ?, ?, ?, 0)
    `).run(queryKey, snapshotVersion, createdAt, expiresAt);
    this.db.prepare("DELETE FROM query_snapshot_items WHERE query_key = ? AND snapshot_version = ?")
      .run(queryKey, snapshotVersion);
    const rows = this.db.prepare(`
      SELECT l.*,
             ql.quality_evaluated AS query_quality_evaluated,
             ql.price_suspect AS query_price_suspect,
             ql.quality_suspect AS query_quality_suspect,
             ql.noise_filtered AS query_noise_filtered,
             ql.noise_filter_reason AS query_noise_filter_reason,
             ql.fraud_risk AS query_fraud_risk
        FROM query_listings ql INDEXED BY idx_query_listings_snapshot_recent
        JOIN listings l ON l.item_id = ql.item_id
       WHERE ql.query_key = ?
         AND ql.missing_count < 2
         AND l.active = 1
       ORDER BY ql.last_seen_at DESC, ql.item_id ASC
       LIMIT ?
    `).all(queryKey, MAX_SNAPSHOT_ITEMS);
    const insertSnapshotItem = this.db.prepare(`
      INSERT INTO query_snapshot_items(
        query_key, snapshot_version, item_id, site, item_json, price_rank,
        price_value, price_sort, posted_sort_at, image_rank
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    for (const row of rows) {
      const priceMissing = row.price_value === null || row.price_value <= 100;
      const hardRisk = row.query_noise_filtered === 1
        || (typeof row.query_fraud_risk === "number" && row.query_fraud_risk > 0.45);
      const softRisk = row.query_quality_evaluated !== 1
        || row.query_price_suspect === 1
        || row.query_quality_suspect === 1;
      const priceRank = priceMissing ? 3 : hardRisk ? 2 : softRisk ? 1 : 0;
      insertSnapshotItem.run(
        queryKey,
        snapshotVersion,
        row.item_id,
        row.site,
        JSON.stringify(publicItem(row)),
        priceRank,
        row.price_value,
        priceMissing ? MISSING_PRICE_SORT_VALUE : row.price_value,
        row.posted_at || row.last_seen_at,
        row.image_url ? 0 : 1
      );
    }
    const total = rows.length;
    this.db.prepare(`
      UPDATE query_snapshots SET total_count = ?
       WHERE query_key = ? AND snapshot_version = ?
    `).run(total, queryKey, snapshotVersion);
    return { queryKey, snapshotVersion, createdAt, expiresAt, total };
  }

  ensureLatestSnapshot(queryKey) {
    let query = this.getQuery(queryKey);
    if (!query) return null;
    const currentVersion = Number(query.snapshot_version || 0);
    if (currentVersion > 0) {
      const current = this.db.prepare(`
        SELECT * FROM query_snapshots WHERE query_key = ? AND snapshot_version = ?
      `).get(queryKey, currentVersion);
      if (current && parseTime(current.expires_at) > this.now()) return current;
    }
    return this.transaction(() => {
      this.db.prepare("UPDATE query_index SET snapshot_version = snapshot_version + 1 WHERE query_key = ?")
        .run(queryKey);
      query = this.getQuery(queryKey);
      return this.materializeSnapshot(queryKey, Number(query.snapshot_version), iso(this.now()));
    });
  }

  transaction(callback) {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const result = callback();
      this.db.exec("COMMIT");
      return result;
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  registerQuery(body) {
    const identity = requireTargetSites(collectionIdentity(body));
    const siteWindow = requestedSiteWindow(body);
    const now = this.now();
    const nowText = iso(now);
    const existing = this.db.prepare("SELECT * FROM query_index WHERE query_key = ?").get(identity.key);
    if (!existing) {
      this.db.prepare(`
        INSERT INTO query_index (
          query_key, collection_namespace, canonical_query, keyword, category_ids_json, sites_json,
          first_requested_at, last_requested_at, request_window_started_at, site_window
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        identity.key,
        identity.namespace,
        identity.canonicalQuery,
        identity.collectionQuery,
        JSON.stringify(identity.categoryIds),
        JSON.stringify(identity.sites),
        nowText,
        nowText,
        nowText,
        siteWindow
      );
    } else {
      const windowStarted = parseTime(existing.request_window_started_at);
      const resetWindow = now - windowStarted >= DAY_MS;
      this.db.prepare(`
        UPDATE query_index
           SET canonical_query = ?,
               collection_namespace = ?,
               keyword = ?,
               category_ids_json = ?,
               sites_json = ?,
               last_requested_at = ?,
                request_window_started_at = ?,
               request_count_24h = ?,
               total_request_count = total_request_count + 1,
               site_window = MAX(site_window, ?),
               refresh_disabled_reason = NULL
         WHERE query_key = ?
      `).run(
        identity.canonicalQuery,
        identity.namespace,
        identity.collectionQuery,
        JSON.stringify(identity.categoryIds),
        JSON.stringify(identity.sites),
        nowText,
        resetWindow ? nowText : existing.request_window_started_at,
        resetWindow ? 1 : Number(existing.request_count_24h || 0) + 1,
        siteWindow,
        identity.key
      );
    }
    const queryCount = Number(this.db.prepare("SELECT COUNT(*) AS count FROM query_index").get()?.count || 0);
    if (queryCount > this.limits.maxQueries) {
      this.db.prepare(`
        DELETE FROM query_index WHERE query_key IN (
          SELECT query_key FROM query_index WHERE collection_namespace = 'pc_parts_v1'
          ORDER BY last_requested_at ASC LIMIT ?
        )
      `).run(queryCount - this.limits.maxQueries);
    }
    return this.getQuery(identity.key);
  }

  getQuery(queryKey) {
    const row = this.db.prepare("SELECT * FROM query_index WHERE query_key = ?").get(queryKey);
    if (!row) return null;
    return {
      ...row,
      category_ids: jsonArray(row.category_ids_json),
      sites: jsonArray(row.sites_json),
      tier: this.queryTier(row)
    };
  }

  restrictTargetSites(allowedSites) {
    const allowed = new Set(sortedStrings(allowedSites));
    if (allowed.size === 0) throw new Error("at least one target site is required");
    const rows = this.db.prepare("SELECT query_key, sites_json FROM query_index WHERE refresh_disabled_reason IS NULL").all();
    const disableQuery = this.db.prepare(`
      UPDATE query_index
         SET refresh_disabled_reason = 'unsupported_target_site',
             next_refresh_attempt_at = NULL,
             last_error = 'query contains a retired target site'
       WHERE query_key = ?
    `);
    const failQueuedJobs = this.db.prepare(`
      UPDATE refresh_jobs
         SET state = 'failed',
             completed_at = ?,
             error_message = 'query contains a retired target site'
       WHERE query_key = ? AND state IN ('queued', 'running')
    `);
    let quarantined = 0;
    for (const row of rows) {
      const sites = jsonArray(row.sites_json);
      if (sites.length > 0 && sites.every((site) => allowed.has(site))) continue;
      disableQuery.run(row.query_key);
      failQueuedJobs.run(iso(this.now()), row.query_key);
      quarantined += 1;
    }
    return quarantined;
  }

  purgeUnsupportedSites(allowedSites) {
    const allowed = sortedStrings(allowedSites);
    if (allowed.length === 0) throw new Error("at least one target site is required");
    const allowedSet = new Set(allowed);
    const storedSites = [
      ...this.db.prepare("SELECT DISTINCT site FROM listings").all(),
      ...this.db.prepare("SELECT DISTINCT site FROM query_snapshot_items").all()
    ];
    if (storedSites.every((row) => allowedSet.has(row.site))) {
      return { listings: 0, snapshotItems: 0, ftsItems: 0 };
    }
    const placeholders = allowed.map(() => "?").join(", ");
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const snapshotItems = this.db.prepare(
        `DELETE FROM query_snapshot_items WHERE site NOT IN (${placeholders})`
      ).run(...allowed).changes;
      const ftsItems = this.db.prepare(
        `DELETE FROM listing_fts WHERE item_id IN (SELECT item_id FROM listings WHERE site NOT IN (${placeholders}))`
      ).run(...allowed).changes;
      const listings = this.db.prepare(
        `DELETE FROM listings WHERE site NOT IN (${placeholders})`
      ).run(...allowed).changes;
      this.db.exec("COMMIT");
      return { listings, snapshotItems, ftsItems };
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  queryTier(row) {
    const count = Number(row?.request_count_24h || 0);
    if (count >= 10) return "hot";
    if (count >= 2) return "warm";
    return "cold";
  }

  applyLifecycleProjection(item) {
    const itemId = cleanText(item?.item_id || item?.id, 700);
    if (!itemId) return 0;
    const row = this.db.prepare("SELECT pc_metadata_json FROM listings WHERE item_id = ?").get(itemId);
    if (!row) return 0;
    const metadata = { ...jsonObject(row.pc_metadata_json), ...pcProjection(item) };
    const pcColumns = pcListingColumnValues(metadata);
    const active = String(item.lifecycle_status || "ACTIVE").toUpperCase() === "ACTIVE" ? 1 : 0;
    const timestamp = cleanText(item.updated_at, 80) || iso(this.now());
    return this.db.prepare(`UPDATE listings SET active = ?, inactive_at = ?, last_checked_at = ?,
      pc_metadata_json = ?, pc_canonical_product_id = ?, pc_category_code = ?, pc_listing_kind = ?,
      pc_lifecycle_status = ?, pc_price_eligible = ?, pc_condition_code = ?, pc_quantity = ?,
      pc_price_scope = ?, pc_market_pool = ?, pc_canonical_manufacturer = ?,
      pc_board_manufacturer = ? WHERE item_id = ?`)
      .run(active, active ? null : timestamp, timestamp, JSON.stringify(metadata), ...pcColumns, itemId).changes;
  }

  upsertPublicProjections(items, options = {}) {
    const observedAt = cleanText(options.observedAt, 80) || iso(this.now());
    const normalizedItems = (Array.isArray(items) ? items : [])
      .filter((item) => item && cleanText(item.title) && cleanText(item.url) && cleanText(item.site))
      .map((item) => {
        const site = cleanText(item.site, 40);
        const sourceListingId = cleanText(item.source_listing_id || item.item_id || item.id || item.url, 700);
        return {
          ...item,
          item_id: cleanText(item.item_id || item.id || `${site}:${sourceListingId}`, 700),
          site,
          category_id: cleanText(item.category_id || "pc", 120),
          title: redactStoredText(item.title, 500),
          search_text: redactStoredText(item.search_text || `${item.title} ${item.description || ""}`, 1_000),
          description: redactStoredText(item.description, 2_000),
          location: redactStoredText(item.location, 300),
          url: cleanText(item.url, 2_000)
        };
      });
    let inserted = 0;
    let updated = 0;
    const changedItemIds = [];
    this.transaction(() => {
      const selectListing = this.db.prepare("SELECT content_hash FROM listings WHERE item_id = ?");
      const upsertListing = this.db.prepare(`INSERT INTO listings(
        item_id, site, category_id, title, search_text, normalized_text, compact_text,
        price_value, currency, url, image_url, location, description, posted_at,
        first_seen_at, last_seen_at, last_checked_at, inactive_at, active, content_hash, pc_metadata_json,
        pc_canonical_product_id, pc_category_code, pc_listing_kind, pc_lifecycle_status,
        pc_price_eligible, pc_condition_code, pc_quantity, pc_price_scope, pc_market_pool,
        pc_canonical_manufacturer, pc_board_manufacturer
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(item_id) DO UPDATE SET
        site = excluded.site,
        category_id = excluded.category_id,
        title = excluded.title,
        search_text = excluded.search_text,
        normalized_text = excluded.normalized_text,
        compact_text = excluded.compact_text,
        price_value = excluded.price_value,
        currency = excluded.currency,
        url = excluded.url,
        image_url = excluded.image_url,
        location = excluded.location,
        description = excluded.description,
        posted_at = COALESCE(excluded.posted_at, listings.posted_at),
        last_seen_at = excluded.last_seen_at,
        last_checked_at = excluded.last_checked_at,
        inactive_at = excluded.inactive_at,
        active = excluded.active,
        content_hash = excluded.content_hash,
        pc_metadata_json = excluded.pc_metadata_json,
        pc_canonical_product_id = excluded.pc_canonical_product_id,
        pc_category_code = excluded.pc_category_code,
        pc_listing_kind = excluded.pc_listing_kind,
        pc_lifecycle_status = excluded.pc_lifecycle_status,
        pc_price_eligible = excluded.pc_price_eligible,
        pc_condition_code = excluded.pc_condition_code,
        pc_quantity = excluded.pc_quantity,
        pc_price_scope = excluded.pc_price_scope,
        pc_market_pool = excluded.pc_market_pool,
        pc_canonical_manufacturer = excluded.pc_canonical_manufacturer,
        pc_board_manufacturer = excluded.pc_board_manufacturer`);
      const deleteFts = this.db.prepare("DELETE FROM listing_fts WHERE item_id = ?");
      const insertFts = this.db.prepare("INSERT INTO listing_fts(item_id, normalized_text, compact_text) VALUES (?, ?, ?)");
      for (const item of normalizedItems) {
        const normalizedText = cleanText(`${item.title} ${item.search_text} ${item.description || ""}`, 4_000).normalize("NFKC").toLowerCase();
        const compactText = normalizeSearchQuery(normalizedText);
        const hash = contentHash(item);
        const previous = selectListing.get(item.item_id);
        if (!previous) inserted += 1;
        else if (previous.content_hash !== hash) updated += 1;
        if (!previous || previous.content_hash !== hash) changedItemIds.push(item.item_id);
        const status = cleanText(item.lifecycle_status || "ACTIVE", 80).toUpperCase();
        const active = status === "ACTIVE" || status === "RESERVED" ? 1 : 0;
        const price = Number.isFinite(Number(item.price)) ? Number(item.price) : null;
        const metadata = pcProjection(item);
        upsertListing.run(
          item.item_id, item.site, item.category_id, item.title, item.search_text, normalizedText, compactText,
          price, cleanText(item.currency || "KRW", 12), item.url, cleanText(item.image_url, 2_000) || null,
          item.location || null, item.description || null, cleanText(item.posted_at, 80) || null,
          observedAt, observedAt, observedAt, active ? null : observedAt, active, hash, JSON.stringify(metadata),
          ...pcListingColumnValues(metadata)
        );
        if (!previous || previous.content_hash !== hash) {
          deleteFts.run(item.item_id);
          insertFts.run(item.item_id, normalizedText, compactText);
        }
      }
    });
    return { inserted, updated, changedItemIds };
  }

  browsePcListings(options = {}) {
    const canonicalProductId = cleanText(options.canonicalProductId, 300);
    const canonicalProductIds = Array.isArray(options.canonicalProductIds)
      ? [...new Set(options.canonicalProductIds.map((value) => cleanText(value, 300)).filter(Boolean))]
      : null;
    const manufacturer = cleanText(options.manufacturer, 120);
    const boardManufacturer = cleanText(options.boardManufacturer, 120);
    const marketPool = cleanText(options.marketPool, 80);
    const currency = cleanText(options.currency, 12).toUpperCase();
    const sites = sortedStrings(options.sites);
    const minPrice = options.minPrice !== null && options.minPrice !== undefined && options.minPrice !== ""
      && Number.isFinite(Number(options.minPrice)) ? Number(options.minPrice) : null;
    const maxPrice = options.maxPrice !== null && options.maxPrice !== undefined && options.maxPrice !== ""
      && Number.isFinite(Number(options.maxPrice)) ? Number(options.maxPrice) : null;
    const sort = new Set(["recent", "price_asc", "price_desc"]).has(options.sort) ? options.sort : "recent";
    const limit = Math.min(100, Math.max(1, Number(options.limit) || 30));
    const asOf = cleanText(options.asOf, 80) || iso(this.now());
    const where = [
      "active = 1",
      "last_checked_at <= ?",
      "price_value IS NOT NULL",
      "price_value > 0",
      "pc_canonical_product_id IS NOT NULL",
      "(pc_category_code IN ('CPU', 'GPU', 'RAM', 'MOTHERBOARD', 'SSD', 'HDD', 'PSU') OR pc_category_code IS NULL)",
      "pc_listing_kind IN ('SINGLE_COMPONENT', 'SAME_PRODUCT_LOT')",
      "pc_lifecycle_status = 'ACTIVE'",
      "pc_price_eligible = 1",
      "pc_condition_code = 'USED_WORKING'",
      "pc_quantity >= 1",
      "pc_price_scope IN ('TOTAL', 'UNIT')",
      "((pc_market_pool IN ('KR_C2C_USED', 'KR_DEALER_USED', 'KR_REFURB_RETAIL') AND currency = 'KRW') OR (pc_market_pool = 'OVERSEAS_USED' AND currency = 'USD'))"
    ];
    const params = [asOf];
    if (canonicalProductId) {
      where.push("pc_canonical_product_id = ?");
      params.push(canonicalProductId);
    } else if (canonicalProductIds?.length === 1) {
      where.push("pc_canonical_product_id = ?");
      params.push(canonicalProductIds[0]);
    } else if (canonicalProductIds) {
      where.push("pc_canonical_product_id IN (SELECT value FROM json_each(?))");
      params.push(JSON.stringify(canonicalProductIds));
    }
    if (manufacturer) {
      where.push("(pc_canonical_manufacturer = ? OR pc_board_manufacturer = ?)");
      params.push(manufacturer, manufacturer);
    }
    if (boardManufacturer) {
      where.push("pc_category_code = 'GPU'");
      where.push("pc_board_manufacturer = ?");
      params.push(boardManufacturer);
    }
    if (sites.length > 0) {
      where.push(`site IN (${sqlPlaceholders(sites)})`);
      params.push(...sites);
    }
    if (minPrice !== null) {
      where.push("price_value >= ?");
      params.push(minPrice);
    }
    if (maxPrice !== null) {
      where.push("price_value <= ?");
      params.push(maxPrice);
    }
    if (marketPool) {
      where.push("pc_market_pool = ?");
      params.push(marketPool);
    }
    if (currency) {
      where.push("currency = ?");
      params.push(currency);
    }
    const after = options.after && typeof options.after === "object" ? options.after : null;
    let cursorFound = true;
    if (after?.item_id) {
      const afterRow = this.db.prepare("SELECT item_id, price_value, last_checked_at FROM listings WHERE item_id = ?").get(after.item_id);
      if (!afterRow) {
        cursorFound = false;
      } else {
        const keyset = pcListingKeysetPredicate(sort, afterRow);
        where.push(keyset.clause);
        params.push(...keyset.params);
      }
    }
    const fetchLimit = Math.min(500, Math.max(limit + 1, (limit + 1) * 4));
    const candidateRows = cursorFound
      ? this.db.prepare(`SELECT * FROM listings WHERE ${where.join(" AND ")} ORDER BY ${pcListingOrderClause(sort)} LIMIT ?`).all(...params, fetchLimit)
      : [];
    const rows = dedupePcListingRows(candidateRows);
    const page = rows.slice(0, limit);
    const hasMore = page.length > 0 && (rows.length > limit || candidateRows.length >= fetchLimit);
    const last = page.at(-1);
    const latestObservedAt = candidateRows.reduce((latest, row) => String(row.last_checked_at) > latest ? String(row.last_checked_at) : latest, "");
    return {
      items: page.map(publicItem),
      total: !after?.item_id && candidateRows.length < fetchLimit ? rows.length : null,
      asOf,
      latestObservedAt: latestObservedAt || null,
      cursorFound,
      nextAfter: hasMore && last ? { item_id: last.item_id } : null
    };
  }

  queryFreshness(queryKey) {
    const query = this.getQuery(queryKey);
    if (!query?.last_refreshed_at) return { query, ageMs: Infinity, fresh: false, due: true };
    const ageMs = Math.max(0, this.now() - parseTime(query.last_refreshed_at));
    const refreshMs = query.tier === "hot" ? HOT_REFRESH_MS : query.tier === "warm" ? WARM_REFRESH_MS : Infinity;
    return { query, ageMs, fresh: ageMs <= FRESH_MAX_AGE_MS, due: ageMs >= refreshMs };
  }

  ingest(body, items, options = {}) {
    const profileStarted = performance.now();
    const profile = {};
    const identity = requireTargetSites(collectionIdentity(body));
    if (!this.getQuery(identity.key)) this.registerQuery(body);
    const nowText = iso(this.now());
    const deep = options.deep === true;
    const complete = options.complete === true;
    const successfulSites = new Set(sortedStrings(options.successfulSites || identity.sites));
    if (successfulSites.size === 0) {
      return { skipped: true, reason: "all_sources_failed", inserted: 0, updated: 0, priceChanges: 0, changedItemIds: [] };
    }
    const normalizedItems = (Array.isArray(items) ? items : [])
      .filter((item) => item && cleanText(item.title) && cleanText(item.url) && cleanText(item.site))
      .map((item) => ({
        ...item,
        item_id: cleanText(item.item_id || item.id || `${item.site}:${item.url}`, 700),
        site: cleanText(item.site, 40),
        category_id: cleanText(item.category_id || identity.categoryIds[0] || "all", 120),
        title: redactStoredText(item.title, 500),
        search_text: redactStoredText(item.search_text || `${item.title} ${item.description || ""}`, 1_000),
        description: redactStoredText(item.description, 2_000),
        location: redactStoredText(item.location, 300),
        url: cleanText(item.url, 2_000)
      }));
    const seenBySite = new Map();
    let inserted = 0;
    let updated = 0;
    let priceChanges = 0;
    const changedItemIds = [];

    this.transaction(() => {
      const selectListing = this.db.prepare("SELECT price_value, content_hash FROM listings WHERE item_id = ?");
      const upsertListing = this.db.prepare(`
        INSERT INTO listings (
          item_id, site, category_id, title, search_text, normalized_text, compact_text,
          price_value, currency, url, image_url, location, description, posted_at,
          first_seen_at, last_seen_at, last_checked_at, inactive_at, active, content_hash, pc_metadata_json,
          pc_canonical_product_id, pc_category_code, pc_listing_kind, pc_lifecycle_status,
          pc_price_eligible, pc_condition_code, pc_quantity, pc_price_scope, pc_market_pool,
          pc_canonical_manufacturer, pc_board_manufacturer
        ) VALUES (
          ?, ?, ?, ?, ?, ?, ?,
          ?, ?, ?, ?, ?, ?, ?,
          ?, ?, ?, ?, ?, ?, ?,
          ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
        )
        ON CONFLICT(item_id) DO UPDATE SET
          site = excluded.site,
          category_id = excluded.category_id,
          title = excluded.title,
          search_text = excluded.search_text,
          normalized_text = excluded.normalized_text,
          compact_text = excluded.compact_text,
          price_value = excluded.price_value,
          currency = excluded.currency,
          url = excluded.url,
          image_url = excluded.image_url,
          location = excluded.location,
          description = excluded.description,
          posted_at = COALESCE(excluded.posted_at, listings.posted_at),
          last_seen_at = excluded.last_seen_at,
          last_checked_at = excluded.last_checked_at,
          inactive_at = excluded.inactive_at,
          active = excluded.active,
          content_hash = excluded.content_hash,
          pc_metadata_json = excluded.pc_metadata_json,
          pc_canonical_product_id = excluded.pc_canonical_product_id,
          pc_category_code = excluded.pc_category_code,
          pc_listing_kind = excluded.pc_listing_kind,
          pc_lifecycle_status = excluded.pc_lifecycle_status,
          pc_price_eligible = excluded.pc_price_eligible,
          pc_condition_code = excluded.pc_condition_code,
          pc_quantity = excluded.pc_quantity,
          pc_price_scope = excluded.pc_price_scope,
          pc_market_pool = excluded.pc_market_pool,
          pc_canonical_manufacturer = excluded.pc_canonical_manufacturer,
          pc_board_manufacturer = excluded.pc_board_manufacturer
      `);
      const upsertMapping = this.db.prepare(`
        INSERT INTO query_listings(
          query_key, item_id, site, last_seen_at, missing_count,
          quality_evaluated, price_suspect, quality_suspect, noise_filtered, noise_filter_reason, fraud_risk
        ) VALUES (?, ?, ?, ?, 0, 1, ?, ?, ?, ?, ?)
        ON CONFLICT(query_key, item_id) DO UPDATE SET
          site = excluded.site,
          last_seen_at = excluded.last_seen_at,
          missing_count = 0,
          quality_evaluated = 1,
          price_suspect = excluded.price_suspect,
          quality_suspect = excluded.quality_suspect,
          noise_filtered = excluded.noise_filtered,
          noise_filter_reason = excluded.noise_filter_reason,
          fraud_risk = excluded.fraud_risk
      `);
      const deleteFts = this.db.prepare("DELETE FROM listing_fts WHERE item_id = ?");
      const insertFts = this.db.prepare("INSERT INTO listing_fts(item_id, normalized_text, compact_text) VALUES (?, ?, ?)");
      const insertPrice = this.db.prepare("INSERT INTO price_history(item_id, price_value, observed_at) VALUES (?, ?, ?)");

      for (const item of normalizedItems) {
        const price = Number.isFinite(Number(item.price)) ? Number(item.price) : null;
        const listingActive = String(item.lifecycle_status || "ACTIVE").toUpperCase() === "ACTIVE" ? 1 : 0;
        const rawFraudRisk = Number(item.fraud_risk);
        const fraudRisk = Number.isFinite(rawFraudRisk) && rawFraudRisk >= 0 && rawFraudRisk <= 1 ? rawFraudRisk : null;
        const normalizedText = cleanText(`${item.title} ${item.search_text} ${item.description || ""}`, 4_000).normalize("NFKC").toLowerCase();
        const compactText = normalizeSearchQuery(normalizedText);
        const hash = contentHash(item);
        const metadata = pcProjection(item);
        const previous = selectListing.get(item.item_id);
        if (!previous) inserted += 1;
        else if (previous.content_hash !== hash) updated += 1;
        if (!previous || previous.content_hash !== hash) changedItemIds.push(item.item_id);
        if (identity.namespace !== PC_COLLECTION_NAMESPACE
          && previous && Number.isFinite(previous.price_value) && Number.isFinite(price) && previous.price_value !== price) {
          insertPrice.run(item.item_id, price, nowText);
          priceChanges += 1;
        }
        upsertListing.run(
          item.item_id, item.site, item.category_id, item.title, item.search_text, normalizedText, compactText,
          price, cleanText(item.currency || "KRW", 12), item.url, cleanText(item.image_url, 2_000) || null,
          cleanText(item.location, 300) || null, cleanText(item.description, 2_000) || null,
          cleanText(item.posted_at, 80) || null,
          nowText, nowText, nowText, listingActive ? null : nowText, listingActive,
          hash, JSON.stringify(metadata), ...pcListingColumnValues(metadata)
        );
        upsertMapping.run(
          identity.key,
          item.item_id,
          item.site,
          nowText,
          item.price_suspect === true ? 1 : 0,
          item.quality_suspect === true ? 1 : 0,
          item.noise_filtered === true ? 1 : 0,
          cleanText(item.noise_filter_reason, 120) || null,
          fraudRisk
        );
        if (!previous || previous.content_hash !== hash) {
          deleteFts.run(item.item_id);
          insertFts.run(item.item_id, normalizedText, compactText);
        }
        const siteSet = seenBySite.get(item.site) || new Set();
        siteSet.add(item.item_id);
        seenBySite.set(item.site, siteSet);
      }

      if (complete) {
        const prior = this.db.prepare("SELECT item_id, site FROM query_listings WHERE query_key = ?").all(identity.key);
        const markMissing = this.db.prepare(`
          UPDATE query_listings
             SET missing_count = missing_count + 1
           WHERE query_key = ? AND item_id = ?
        `);
        for (const row of prior) {
          if (!successfulSites.has(row.site)) continue;
          if (!seenBySite.get(row.site)?.has(row.item_id)) markMissing.run(identity.key, row.item_id);
        }
      }

      const queryUpdateStarted = performance.now();
      this.db.prepare(`
        UPDATE query_index
           SET last_refreshed_at = ?,
               last_deep_refreshed_at = CASE WHEN ? = 1 THEN ? ELSE last_deep_refreshed_at END,
               result_count = (SELECT COUNT(*) FROM query_listings WHERE query_key = ? AND missing_count < 2),
               last_error = NULL,
               refresh_failure_count = 0,
               next_refresh_attempt_at = NULL,
               refresh_disabled_reason = NULL,
               snapshot_version = snapshot_version + 1
         WHERE query_key = ?
      `).run(nowText, deep ? 1 : 0, nowText, identity.key, identity.key);
      profile.queryUpdateMs = performance.now() - queryUpdateStarted;
      const snapshotVersion = Number(this.db.prepare(
        "SELECT snapshot_version FROM query_index WHERE query_key = ?"
      ).get(identity.key)?.snapshot_version || 1);
      const snapshotStarted = performance.now();
      this.materializeSnapshot(identity.key, snapshotVersion, nowText);
      profile.snapshotMs = performance.now() - snapshotStarted;

      const staleCutoff = iso(this.now() - FRESH_MAX_AGE_MS);
      const staleCleanupStarted = performance.now();
      this.db.prepare(`
        UPDATE listings
           SET active = 0, inactive_at = COALESCE(inactive_at, ?)
         WHERE active = 1
           AND last_seen_at < ?
           AND NOT EXISTS (
             SELECT 1 FROM query_listings ql
              WHERE ql.item_id = listings.item_id AND ql.missing_count < 2
           )
      `).run(nowText, staleCutoff);
      profile.staleCleanupMs = performance.now() - staleCleanupStarted;

      const cleanupStarted = performance.now();
      const activeCount = Number(this.db.prepare("SELECT COUNT(*) AS count FROM listings WHERE active = 1").get()?.count || 0);
      if (activeCount > this.limits.maxActiveListings) {
        this.db.prepare(`
          DELETE FROM listings WHERE item_id IN (
            SELECT l.item_id FROM listings l
             WHERE l.active = 1
               AND NOT EXISTS (
                 SELECT 1
                   FROM query_listings ql
                   JOIN query_index qi ON qi.query_key = ql.query_key
                  WHERE ql.item_id = l.item_id
                    AND ql.missing_count < 2
                    AND qi.collection_namespace = 'legacy_general'
               )
             ORDER BY l.last_seen_at ASC LIMIT ?
          )
        `).run(activeCount - this.limits.maxActiveListings);
      }
      profile.cleanupMs = performance.now() - cleanupStarted;
    });

    if (this.databaseSizeBytes() >= this.limits.softBytes) this.maintenance({ pressure: true });

    return {
      queryKey: identity.key,
      inserted,
      updated,
      priceChanges,
      changedItemIds,
      total: normalizedItems.length,
      snapshotVersion: Number(this.getQuery(identity.key)?.snapshot_version || 0),
      ...(options.profile === true ? {
        profile: {
          query_update_ms: Number((profile.queryUpdateMs || 0).toFixed(2)),
          snapshot_ms: Number((profile.snapshotMs || 0).toFixed(2)),
          cleanup_ms: Number((profile.cleanupMs || 0).toFixed(2)),
          stale_cleanup_ms: Number((profile.staleCleanupMs || 0).toFixed(2)),
          total_ms: Number((performance.now() - profileStarted).toFixed(2))
        }
      } : {})
    };
  }

  searchPage(body, options = {}) {
    const identity = collectionIdentity(body);
    const freshness = this.queryFreshness(identity.key);
    if (!freshness.query) return null;
    const allowStale = options.allowStale === true || body?.allow_stale === true;
    if (!freshness.fresh && !allowStale) {
      return {
        queryKey: identity.key,
        items: [],
        total: 0,
        hasMore: false,
        nextKey: null,
        snapshotVersion: Number(freshness.query.snapshot_version || 0),
        sourceTotals: {},
        freshness: { ...freshness, mode: "expired" }
      };
    }
    const requestedSnapshotVersion = Number(options.snapshotVersion || 0);
    const latestSnapshot = requestedSnapshotVersion > 0
      ? null
      : this.ensureLatestSnapshot(identity.key);
    const snapshotVersion = requestedSnapshotVersion || Number(latestSnapshot?.snapshot_version || latestSnapshot?.snapshotVersion || 0);
    const snapshot = this.db.prepare(`
      SELECT * FROM query_snapshots WHERE query_key = ? AND snapshot_version = ?
    `).get(identity.key, snapshotVersion);
    if (!snapshot || parseTime(snapshot.expires_at) <= this.now()) {
      const error = new Error("CURSOR_EXPIRED: search snapshot expired; start a new search");
      error.statusCode = 410;
      throw error;
    }

    const conditions = ["si.query_key = ?", "si.snapshot_version = ?"];
    const bindings = [identity.key, snapshotVersion];
    const requestedViewSites = sortedStrings(body?.view_sites);
    const invalidViewSites = requestedViewSites.filter((site) => !identity.sites.includes(site));
    if (invalidViewSites.length > 0) {
      const error = new Error("CURSOR_INVALID: view sites must belong to the search collection");
      error.statusCode = 400;
      throw error;
    }
    if (requestedViewSites.length > 0) {
      const placeholders = requestedViewSites.map(() => "?").join(", ");
      conditions.push(`si.site IN (${placeholders})`);
      bindings.push(...requestedViewSites);
    }
    if (identity.pcCategoryCode) {
      conditions.push("json_extract(si.item_json, '$.category_code') = ?");
      bindings.push(identity.pcCategoryCode);
    }
    if (identity.manufacturer) {
      conditions.push("json_extract(si.item_json, '$.canonical_manufacturer') = ?");
      bindings.push(identity.manufacturer);
    }
    const minPrice = body?.min_price === undefined || body?.min_price === null || body?.min_price === "" ? null : Number(body.min_price);
    const maxPrice = body?.max_price === undefined || body?.max_price === null || body?.max_price === "" ? null : Number(body.max_price);
    if (Number.isFinite(minPrice)) {
      conditions.push("si.price_value >= ?");
      bindings.push(minPrice);
    }
    if (Number.isFinite(maxPrice)) {
      conditions.push("si.price_value <= ?");
      bindings.push(maxPrice);
    }
    const sort = cleanText(body?.sort, 30) || "recommended";
    const countConditions = [...conditions];
    const countBindings = [...bindings];
    const after = options.after && typeof options.after === "object" ? options.after : null;
    let orderBy;
    if (sort === "price_asc") {
      orderBy = "si.price_sort ASC, si.price_rank ASC, si.item_id ASC";
      if (after) {
        const priceRank = Number(after.priceRank);
        const priceValue = Number(after.priceValue);
        const itemId = cleanText(after.itemId, 700);
        if (![priceRank, priceValue].every(Number.isFinite) || !itemId) {
          throw new Error("CURSOR_INVALID: price continuation key is invalid");
        }
        conditions.push(`(
          si.price_sort > ?
          OR (si.price_sort = ? AND si.price_rank > ?)
          OR (si.price_sort = ? AND si.price_rank = ? AND si.item_id > ?)
        )`);
        bindings.push(priceValue, priceValue, priceRank, priceValue, priceRank, itemId);
      }
    } else if (sort === "price_desc") {
      const missingExpression = "CASE WHEN si.price_value IS NULL OR si.price_value <= 100 THEN 1 ELSE 0 END";
      orderBy = `${missingExpression} ASC, si.price_sort DESC, si.price_rank ASC, si.item_id ASC`;
      if (after) {
        const priceMissing = Number(after.priceMissing);
        const priceRank = Number(after.priceRank);
        const priceValue = Number(after.priceValue);
        const itemId = cleanText(after.itemId, 700);
        if (![priceMissing, priceRank, priceValue].every(Number.isFinite) || ![0, 1].includes(priceMissing) || !itemId) {
          throw new Error("CURSOR_INVALID: descending price continuation key is invalid");
        }
        conditions.push(`(
          ${missingExpression} > ?
          OR (${missingExpression} = ? AND si.price_sort < ?)
          OR (${missingExpression} = ? AND si.price_sort = ? AND si.price_rank > ?)
          OR (${missingExpression} = ? AND si.price_sort = ? AND si.price_rank = ? AND si.item_id > ?)
        )`);
        bindings.push(
          priceMissing,
          priceMissing, priceValue,
          priceMissing, priceValue, priceRank,
          priceMissing, priceValue, priceRank, itemId
        );
      }
    } else if (sort === "recent") {
      orderBy = "si.posted_sort_at DESC, si.item_id ASC";
      if (after) {
        const postedSortAt = cleanText(after.postedSortAt, 80);
        const itemId = cleanText(after.itemId, 700);
        if (!postedSortAt || !itemId) throw new Error("CURSOR_INVALID: recent continuation key is invalid");
        conditions.push(`(
          si.posted_sort_at < ?
          OR (si.posted_sort_at = ? AND si.item_id > ?)
        )`);
        bindings.push(postedSortAt, postedSortAt, itemId);
      }
    } else {
      orderBy = "si.image_rank ASC, si.posted_sort_at DESC, si.price_sort ASC, si.item_id ASC";
      if (after) {
        const imageRank = Number(after.imageRank);
        const postedSortAt = cleanText(after.postedSortAt, 80);
        const priceSort = Number(after.priceSort);
        const itemId = cleanText(after.itemId, 700);
        if (![imageRank, priceSort].every(Number.isFinite) || !postedSortAt || !itemId) {
          throw new Error("CURSOR_INVALID: recommended continuation key is invalid");
        }
        conditions.push(`(
          si.image_rank > ?
          OR (si.image_rank = ? AND si.posted_sort_at < ?)
          OR (si.image_rank = ? AND si.posted_sort_at = ? AND si.price_sort > ?)
          OR (si.image_rank = ? AND si.posted_sort_at = ? AND si.price_sort = ? AND si.item_id > ?)
        )`);
        bindings.push(
          imageRank,
          imageRank, postedSortAt,
          imageRank, postedSortAt, priceSort,
          imageRank, postedSortAt, priceSort, itemId
        );
      }
    }
    const limit = Math.min(Math.max(Number(options.limit) || 40, 1), 1_000);
    const total = Number(this.db.prepare(`
      SELECT COUNT(*) AS count
        FROM query_snapshot_items si
       WHERE ${countConditions.join(" AND ")}
    `).get(...countBindings)?.count || 0);
    const sourceRows = this.db.prepare(`
      SELECT si.site, COUNT(*) AS count
        FROM query_snapshot_items si
       WHERE ${countConditions.join(" AND ")}
       GROUP BY si.site
    `).all(...countBindings);
    const rows = this.db.prepare(`
      SELECT si.item_json,
             si.item_id,
              si.price_rank AS snapshot_price_rank,
              si.price_value AS snapshot_price_value,
              si.price_sort AS snapshot_price_sort,
             si.posted_sort_at AS snapshot_posted_sort_at,
             si.image_rank AS snapshot_image_rank
        FROM query_snapshot_items si
       WHERE ${conditions.join(" AND ")}
       ORDER BY ${orderBy}
       LIMIT ?
    `).all(...bindings, limit + 1);
    const hasMore = rows.length > limit;
    const visibleRows = rows.slice(0, limit);
    const last = hasMore ? visibleRows.at(-1) : null;
    const nextKey = !last
      ? null
      : sort === "price_asc"
        ? {
            priceRank: Number(last.snapshot_price_rank),
            priceValue: Number(last.snapshot_price_sort),
            itemId: last.item_id
          }
        : sort === "price_desc"
          ? {
              priceMissing: last.snapshot_price_value === null || Number(last.snapshot_price_value) <= 100 ? 1 : 0,
              priceRank: Number(last.snapshot_price_rank),
              priceValue: Number(last.snapshot_price_sort),
              itemId: last.item_id
            }
        : sort === "recent"
          ? { postedSortAt: last.snapshot_posted_sort_at, itemId: last.item_id }
          : {
              imageRank: Number(last.snapshot_image_rank),
              postedSortAt: last.snapshot_posted_sort_at,
              priceSort: Number(last.snapshot_price_sort),
              itemId: last.item_id
            };
    return {
      queryKey: identity.key,
      items: visibleRows.map((row) => JSON.parse(row.item_json)),
      total,
      hasMore,
      nextKey,
      snapshotVersion,
      sourceTotals: Object.fromEntries(sourceRows.map((row) => [row.site, Number(row.count || 0)])),
      freshness: {
        mode: freshness.fresh ? "index" : "stale",
        ageMs: freshness.ageMs,
        fresh: freshness.fresh,
        due: freshness.due,
        refreshedAt: freshness.query.last_refreshed_at,
        tier: freshness.query.tier
      }
    };
  }

  search(body, options = {}) {
    const maxRows = Math.min(Math.max(Number(options.maxRows) || 200, 1), 1_000);
    const page = this.searchPage(body, { limit: maxRows, allowStale: options.allowStale });
    if (!page) return null;
    return {
      queryKey: page.queryKey,
      items: page.items,
      total: page.total,
      freshness: page.freshness
    };
  }

  createRefreshJob(body) {
    const identity = requireTargetSites(collectionIdentity(body));
    const query = this.getQuery(identity.key);
    if (query?.refresh_disabled_reason) return null;
    if (query?.next_refresh_attempt_at && parseTime(query.next_refresh_attempt_at) > this.now()) return null;
    const pending = this.db.prepare(`
      SELECT * FROM refresh_jobs
       WHERE query_key = ? AND state IN ('queued', 'running') AND expires_at > ?
       ORDER BY created_at DESC LIMIT 1
    `).get(identity.key, iso(this.now()));
    if (pending) return pending;
    const token = randomUUID();
    const createdAt = iso(this.now());
    const expiresAt = iso(this.now() + REFRESH_JOB_TTL_MS);
    this.db.prepare(`
      INSERT INTO refresh_jobs(token, query_key, request_json, state, created_at, expires_at)
      VALUES (?, ?, ?, 'queued', ?, ?)
    `).run(token, identity.key, JSON.stringify(body), createdAt, expiresAt);
    return this.getRefreshJob(token);
  }

  startRefreshJob(token) {
    this.db.prepare("UPDATE refresh_jobs SET state = 'running' WHERE token = ? AND state = 'queued'").run(token);
    return this.getRefreshJob(token);
  }

  completeRefreshJob(token, addedCount = 0) {
    this.db.prepare(`
      UPDATE refresh_jobs
         SET state = 'completed', completed_at = ?, added_count = ?, error_message = NULL
       WHERE token = ?
    `).run(iso(this.now()), Math.max(0, Number(addedCount) || 0), token);
    return this.getRefreshJob(token);
  }

  recordRefreshFailure(queryKey, error, options = {}) {
    const query = this.getQuery(queryKey);
    if (!query) return null;
    const message = cleanText(error instanceof Error ? error.message : error, 1_000);
    const noTargetSites = options.disableQuery === true || query.sites.length === 0;
    const failureCount = Number(query.refresh_failure_count || 0) + 1;
    const retryDelayMs = Math.min(REFRESH_RETRY_MAX_MS, REFRESH_RETRY_BASE_MS * (2 ** Math.min(failureCount - 1, 10)));
    this.db.prepare(`
      UPDATE query_index
         SET refresh_failure_count = ?,
             next_refresh_attempt_at = ?,
             refresh_disabled_reason = ?,
             last_error = ?
       WHERE query_key = ?
    `).run(
      failureCount,
      noTargetSites ? null : iso(this.now() + retryDelayMs),
      noTargetSites ? "no_target_sites" : null,
      message || null,
      queryKey
    );
    return this.getQuery(queryKey);
  }

  failRefreshJob(token, error, options = {}) {
    const job = this.getRefreshJob(token);
    this.db.prepare(`
      UPDATE refresh_jobs
         SET state = 'failed', completed_at = ?, error_message = ?
       WHERE token = ?
    `).run(iso(this.now()), cleanText(error instanceof Error ? error.message : error, 1_000), token);
    if (job?.query_key && options.recordQueryFailure !== false) this.recordRefreshFailure(job.query_key, error, options);
    return this.getRefreshJob(token);
  }

  getRefreshJob(token) {
    const row = this.db.prepare("SELECT * FROM refresh_jobs WHERE token = ?").get(cleanText(token, 100));
    if (!row) return null;
    try {
      return { ...row, request: JSON.parse(row.request_json), request_error: null };
    } catch {
      return { ...row, request: null, request_error: "invalid_request_json" };
    }
  }

  nextQueuedRefreshJob(allowedSites = null) {
    const allowed = Array.isArray(allowedSites) ? new Set(sortedStrings(allowedSites)) : null;
    const rows = this.db.prepare(`
      SELECT token FROM refresh_jobs
       WHERE state = 'queued' AND expires_at > ?
       ORDER BY created_at ASC LIMIT 50
    `).all(iso(this.now()));
    for (const row of rows) {
      const job = this.getRefreshJob(row.token);
      const identity = job?.request ? collectionIdentity(job.request) : null;
      const hasSearch = Boolean(identity?.collectionQuery || identity?.categoryIds.length);
      const isPcCollection = identity?.namespace === PC_COLLECTION_NAMESPACE;
      const sitesSupported = Boolean(identity?.sites.length)
        && (!allowed || identity.sites.every((site) => allowed.has(site)));
      if (hasSearch && isPcCollection && sitesSupported) return job;
      const error = job?.request_error === "invalid_request_json"
        ? new Error("refresh job request JSON is invalid")
        : !hasSearch
          ? new Error("keyword or category_id is required")
          : new Error("at least one supported target site is required");
      this.failRefreshJob(row.token, error, { recordQueryFailure: false });
    }
    return null;
  }

  recordComparison(body, liveItems, indexedItems, options = {}) {
    const identity = collectionIdentity(body);
    const allowedSites = new Set(sortedStrings(options.sites || []));
    const inScope = (item) => allowedSites.size === 0 || allowedSites.has(cleanText(item?.site, 40));
    const liveIds = new Set((Array.isArray(liveItems) ? liveItems : []).filter(inScope).map((item) => cleanText(item?.item_id || item?.id || item?.url, 2_000)).filter(Boolean));
    const indexedById = new Map((Array.isArray(indexedItems) ? indexedItems : []).filter(inScope).map((item) => [
      cleanText(item?.item_id || item?.id || item?.url, 2_000),
      item
    ]).filter(([itemId]) => Boolean(itemId)));
    const indexIds = new Set(indexedById.keys());
    const missingCount = [...liveIds].filter((itemId) => !indexIds.has(itemId)).length;
    const staleCutoff = this.now() - FRESH_MAX_AGE_MS;
    const staleCount = [...indexIds].filter((itemId) => {
      if (liveIds.has(itemId)) return false;
      const item = indexedById.get(itemId);
      const lastSeenAt = Date.parse(item?.indexed_last_seen_at || item?.last_seen_at || "");
      return Number.isFinite(lastSeenAt) && lastSeenAt < staleCutoff;
    }).length;
    this.db.prepare(`
      INSERT INTO comparison_runs(query_key, created_at, live_count, index_count, missing_count, stale_count)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(identity.key, iso(this.now()), liveIds.size, indexIds.size, missingCount, staleCount);
    this.db.exec(`
      DELETE FROM comparison_runs WHERE id NOT IN (
        SELECT id FROM comparison_runs ORDER BY created_at DESC LIMIT 1000
      );
    `);
    return { live_count: liveIds.size, index_count: indexIds.size, missing_count: missingCount, stale_count: staleCount };
  }

  comparisonStatus() {
    const row = this.db.prepare(`
      SELECT COUNT(*) AS runs,
             COALESCE(SUM(live_count), 0) AS live_count,
             COALESCE(SUM(index_count), 0) AS index_count,
             COALESCE(SUM(missing_count), 0) AS missing_count,
             COALESCE(SUM(stale_count), 0) AS stale_count,
             MAX(created_at) AS last_compared_at
        FROM comparison_runs
       WHERE created_at >= ?
    `).get(iso(this.now() - DAY_MS));
    const liveCount = Number(row?.live_count || 0);
    const indexCount = Number(row?.index_count || 0);
    const dimensions = this.db.prepare(`
      SELECT DISTINCT cr.query_key, qi.category_ids_json, qi.sites_json
        FROM comparison_runs cr
        JOIN query_index qi ON qi.query_key = cr.query_key
       WHERE cr.created_at >= ?
    `).all(iso(this.now() - DAY_MS));
    const coveredSites = new Set();
    const coveredCategories = new Set();
    for (const dimension of dimensions) {
      for (const site of jsonArray(dimension.sites_json)) coveredSites.add(site);
      const categoryIds = jsonArray(dimension.category_ids_json);
      for (const categoryId of categoryIds.length ? categoryIds : ["all"]) coveredCategories.add(categoryId);
    }
    return {
      runs_24h: Number(row?.runs || 0),
      distinct_queries_24h: dimensions.length,
      covered_sites_24h: [...coveredSites].sort(),
      covered_categories_24h: [...coveredCategories].sort(),
      live_count_24h: liveCount,
      index_count_24h: indexCount,
      missing_count_24h: Number(row?.missing_count || 0),
      stale_count_24h: Number(row?.stale_count || 0),
      missing_rate_24h: liveCount > 0 ? Number(row.missing_count || 0) / liveCount : null,
      stale_rate_24h: indexCount > 0 ? Number(row.stale_count || 0) / indexCount : null,
      last_compared_at: row?.last_compared_at || null
    };
  }

  dueQueries(limit = 1, options = {}) {
    const now = this.now();
    const cutoff = iso(now - QUERY_ACTIVE_MS);
    const includeBackoff = options.includeBackoff === true;
    return this.db.prepare(`
      SELECT * FROM query_index
       WHERE last_requested_at >= ?
         AND request_count_24h >= 2
         AND last_refreshed_at IS NOT NULL
         AND refresh_disabled_reason IS NULL
       ORDER BY last_requested_at DESC
       LIMIT 200
    `).all(cutoff)
      .filter((row) => jsonArray(row.sites_json).length > 0)
      .filter((row) => options.includeLegacy === true || jsonArray(row.category_ids_json).includes("pc"))
      .filter((row) => includeBackoff || !row.next_refresh_attempt_at || parseTime(row.next_refresh_attempt_at) <= now)
      .map((row) => {
      const tier = this.queryTier(row);
      const ageMs = now - parseTime(row.last_refreshed_at);
      const refreshMs = tier === "hot" ? HOT_REFRESH_MS : WARM_REFRESH_MS;
      const deepDue = !row.last_deep_refreshed_at || now - parseTime(row.last_deep_refreshed_at) >= DAY_MS;
      return { ...row, tier, ageMs, deepDue, due: ageMs >= refreshMs };
    }).filter((row) => row.due).slice(0, Math.max(0, Number(limit) || 0));
  }

  canBackgroundWrite() {
    if (this.databaseSizeBytes() >= this.limits.softBytes) this.maintenance({ pressure: true });
    return this.databaseSizeBytes() < this.limits.hardBytes;
  }

  databaseSizeBytes() {
    const pageSize = Number(this.db.prepare("PRAGMA page_size").get()?.page_size || 0);
    const pageCount = Number(this.db.prepare("PRAGMA page_count").get()?.page_count || 0);
    return pageSize * pageCount;
  }

  maintenance(options = {}) {
    const now = this.now();
    const inactiveCutoff = iso(now - INACTIVE_RETENTION_MS);
    const queryCutoff = iso(now - QUERY_RETENTION_MS);
    const jobCutoff = iso(now);
    this.transaction(() => {
      this.db.prepare("DELETE FROM refresh_jobs WHERE expires_at < ?").run(jobCutoff);
      this.db.prepare("DELETE FROM query_snapshots WHERE expires_at < ?").run(jobCutoff);
      this.db.prepare("DELETE FROM comparison_runs WHERE created_at < ?").run(iso(now - 7 * DAY_MS));
      this.db.prepare(`DELETE FROM query_index
        WHERE collection_namespace = 'pc_parts_v1' AND last_requested_at < ?`).run(queryCutoff);
      // Legacy price_history is a rollback-only, read-only dataset. PC price
      // changes are recorded in listing_snapshots and this table is not mutated.
      this.db.prepare("DELETE FROM listings WHERE active = 0 AND inactive_at < ?").run(inactiveCutoff);
      if (options.pressure === true) {
        this.db.prepare("DELETE FROM listings WHERE active = 0").run();
        this.db.prepare(`DELETE FROM query_index
          WHERE collection_namespace = 'pc_parts_v1' AND last_requested_at < ?`).run(iso(now - QUERY_ACTIVE_MS));
      }
      const activeCount = Number(this.db.prepare("SELECT COUNT(*) AS count FROM listings WHERE active = 1").get()?.count || 0);
      if (activeCount > this.limits.maxActiveListings) {
        const overflow = activeCount - this.limits.maxActiveListings;
        this.db.prepare(`
          DELETE FROM listings WHERE item_id IN (
            SELECT l.item_id FROM listings l
             WHERE l.active = 1
               AND NOT EXISTS (
                 SELECT 1
                   FROM query_listings ql
                   JOIN query_index qi ON qi.query_key = ql.query_key
                  WHERE ql.item_id = l.item_id
                    AND ql.missing_count < 2
                    AND qi.collection_namespace = 'legacy_general'
               )
             ORDER BY l.last_seen_at ASC LIMIT ?
          )
        `).run(overflow);
      }
      const queryCount = Number(this.db.prepare("SELECT COUNT(*) AS count FROM query_index").get()?.count || 0);
      if (queryCount > this.limits.maxQueries) {
        this.db.prepare(`
          DELETE FROM query_index WHERE query_key IN (
            SELECT query_key FROM query_index WHERE collection_namespace = 'pc_parts_v1'
            ORDER BY last_requested_at ASC LIMIT ?
          )
        `).run(queryCount - this.limits.maxQueries);
      }
    });
    this.db.exec("PRAGMA wal_checkpoint(TRUNCATE)");
    if (options.pressure === true) this.db.exec("VACUUM");
    return this.status();
  }

  createBackup() {
    if (!this.backupDir || this.filePath === ":memory:") return null;
    mkdirSync(this.backupDir, { recursive: true });
    const destination = path.join(this.backupDir, `search-index-${iso(this.now()).slice(0, 10)}.sqlite`);
    if (!existsSync(destination)) {
      const escaped = destination.replaceAll("'", "''");
      this.db.exec(`VACUUM INTO '${escaped}'`);
    }
    const backups = readdirSync(this.backupDir)
      .filter((name) => /^search-index-\d{4}-\d{2}-\d{2}\.sqlite$/.test(name))
      .map((name) => ({ name, path: path.join(this.backupDir, name), modified: statSync(path.join(this.backupDir, name)).mtimeMs }))
      .sort((left, right) => right.modified - left.modified);
    for (const backup of backups.slice(3)) unlinkSync(backup.path);
    return destination;
  }

  createMigrationBackup(fromVersion) {
    if (!this.backupDir || this.filePath === ":memory:") return null;
    mkdirSync(this.backupDir, { recursive: true });
    const timestamp = iso(this.now()).replace(/[:.]/gu, "-");
    const destination = path.join(this.backupDir, `search-index-pre-migration-v${Number(fromVersion) || 0}-${timestamp}.sqlite`);
    const escaped = destination.replaceAll("'", "''");
    this.db.exec("PRAGMA wal_checkpoint(TRUNCATE)");
    this.db.exec(`VACUUM INTO '${escaped}'`);
    const backups = readdirSync(this.backupDir)
      .filter((name) => /^search-index-pre-migration-v\d+-.*\.sqlite$/u.test(name))
      .map((name) => ({ path: path.join(this.backupDir, name), modified: statSync(path.join(this.backupDir, name)).mtimeMs }))
      .sort((left, right) => right.modified - left.modified);
    for (const backup of backups.slice(3)) unlinkSync(backup.path);
    return destination;
  }

  status() {
    const activeListings = Number(this.db.prepare("SELECT COUNT(*) AS count FROM listings WHERE active = 1").get()?.count || 0);
    const inactiveListings = Number(this.db.prepare("SELECT COUNT(*) AS count FROM listings WHERE active = 0").get()?.count || 0);
    const queryCount = Number(this.db.prepare("SELECT COUNT(*) AS count FROM query_index").get()?.count || 0);
    const activeSnapshots = Number(this.db.prepare("SELECT COUNT(*) AS count FROM query_snapshots WHERE expires_at > ?").get(iso(this.now()))?.count || 0);
    const snapshotItems = Number(this.db.prepare("SELECT COUNT(*) AS count FROM query_snapshot_items").get()?.count || 0);
    const pendingJobs = Number(this.db.prepare("SELECT COUNT(*) AS count FROM refresh_jobs WHERE state IN ('queued', 'running')").get()?.count || 0);
    const dueQueries = this.dueQueries(200, { includeBackoff: true });
    const refreshLagSeconds = dueQueries.reduce((largest, query) => {
      const interval = query.tier === "hot" ? HOT_REFRESH_MS : WARM_REFRESH_MS;
      return Math.max(largest, Math.floor(Math.max(0, query.ageMs - interval) / 1000));
    }, 0);
    const refreshOverdue2xQueries = dueQueries.filter((query) => {
      const interval = query.tier === "hot" ? HOT_REFRESH_MS : WARM_REFRESH_MS;
      return query.ageMs >= interval * 2;
    }).length;
    const size = this.databaseSizeBytes();
    return {
      enabled: true,
      file_path: this.filePath,
      database_size_bytes: size,
      soft_limit_bytes: this.limits.softBytes,
      hard_limit_bytes: this.limits.hardBytes,
      soft_limit_reached: size >= this.limits.softBytes,
      hard_limit_reached: size >= this.limits.hardBytes,
      active_listings: activeListings,
      inactive_listings: inactiveListings,
      query_count: queryCount,
      active_search_snapshots: activeSnapshots,
      search_snapshot_items: snapshotItems,
      pending_refresh_jobs: pendingJobs,
      due_refresh_queries: dueQueries.length,
      refresh_lag_seconds: refreshLagSeconds,
      refresh_overdue_2x_queries: refreshOverdue2xQueries,
      comparison: this.comparisonStatus(),
      process_memory: process.memoryUsage()
    };
  }

  close() {
    this.db.close();
  }
}

export const SEARCH_INDEX_POLICY = Object.freeze({
  freshMaxAgeMs: FRESH_MAX_AGE_MS,
  hotRefreshMs: HOT_REFRESH_MS,
  warmRefreshMs: WARM_REFRESH_MS,
  queryActiveMs: QUERY_ACTIVE_MS,
  inactiveRetentionMs: INACTIVE_RETENTION_MS,
  priceHistoryRetentionMs: PRICE_HISTORY_RETENTION_MS,
  refreshJobTtlMs: REFRESH_JOB_TTL_MS,
  searchSnapshotRetentionMs: SEARCH_SNAPSHOT_RETENTION_MS,
  maxSnapshotItems: MAX_SNAPSHOT_ITEMS,
  ...DEFAULT_LIMITS
});
