import { createHash } from 'node:crypto';

const METRICS = ['active', 'reserved', 'sold', 'confirmed_transactions'];
const keyOf = row => JSON.stringify([row.canonical_product_id, row.market_pool, row.condition_code, row.currency, row.days]);
const dateKey = value => new Date(value).toISOString().slice(0, 10);

// Full, already-computed cohorts are committed together, after the external
// publication acknowledgement. Public reads never scan raw marketplace rows.
export function migrateStoredPricePublications(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS pc_stored_price_publications (
      publication_id TEXT PRIMARY KEY,
      checksum TEXT NOT NULL,
      row_count INTEGER NOT NULL CHECK(row_count > 0),
      normalization_version INTEGER NOT NULL,
      parser_version TEXT NOT NULL,
      rule_version TEXT NOT NULL,
      filter_version TEXT NOT NULL,
      as_of TEXT NOT NULL,
      published_at TEXT NOT NULL
    ) STRICT;
    CREATE TABLE IF NOT EXISTS pc_stored_price_publication_rows (
      publication_id TEXT NOT NULL REFERENCES pc_stored_price_publications(publication_id) ON DELETE CASCADE,
      canonical_product_id TEXT NOT NULL,
      market_pool TEXT NOT NULL,
      condition_code TEXT NOT NULL,
      currency TEXT NOT NULL,
      days INTEGER NOT NULL,
      through_date TEXT NOT NULL,
      stats_json TEXT NOT NULL CHECK(json_valid(stats_json)),
      PRIMARY KEY(publication_id, canonical_product_id, market_pool, condition_code, currency, days)
    ) STRICT;
    CREATE INDEX IF NOT EXISTS idx_pc_stored_price_read ON pc_stored_price_publication_rows
      (canonical_product_id, market_pool, condition_code, currency, days, through_date DESC);
  `);
}

function validateMetric(metric) {
  if (!metric || !Number.isInteger(metric.sample_count) || metric.sample_count < 0) throw new Error('PUBLISHED_METRIC_COUNT_INVALID');
  const n = metric.sample_count;
  for (const field of ['mean', 'median', 'average', 'trimmed_mean', 'min', 'max', 'p25', 'p75']) {
    const value = metric[field];
    if (value == null) continue;
    if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0 || n === 0) throw new Error(`PUBLISHED_METRIC_INVALID:${field}`);
    if (metric.min != null && value < metric.min || metric.max != null && value > metric.max) throw new Error(`PUBLISHED_METRIC_BOUNDS:${field}`);
  }
  if (n < 3 && (metric.mean != null || metric.median != null || metric.average != null)) throw new Error('PUBLISHED_LOW_SAMPLE_REPRESENTATIVE');
  if (n >= 3 && metric.median == null) throw new Error('PUBLISHED_MEDIAN_MISSING');
  if (n >= 5 && metric.mean == null) throw new Error('PUBLISHED_MEAN_MISSING');
  if (n > 0 && (metric.min == null || metric.max == null)) throw new Error('PUBLISHED_PRICE_RANGE_MISSING');
}

export function storeCompletedPricePublication(db, { publicationId, rows, expectedRowCount, expectedKeys, publishedAt, allowedSourceIds, validateOnly = false }) {
  if (!publicationId || !Array.isArray(rows) || rows.length === 0 || rows.length !== expectedRowCount) throw new Error('LOCAL_PUBLICATION_INCOMPLETE');
  const keys = rows.map(keyOf).sort();
  if (new Set(keys).size !== keys.length || !Array.isArray(expectedKeys)
    || JSON.stringify(keys) !== JSON.stringify([...expectedKeys].sort())) throw new Error('LOCAL_PUBLICATION_SCOPE_MISMATCH');
  if (!Array.isArray(allowedSourceIds) || !allowedSourceIds.length) throw new Error('LOCAL_PUBLICATION_SOURCE_SCOPE_REQUIRED');
  const allowed = new Set(allowedSourceIds);
  let versions, asOf;
  const prepared = rows.map(row => {
    if (!row.canonical_product_id || !row.market_pool || !row.condition_code || !row.currency
      || !Number.isInteger(row.days) || row.days < 1 || row.days > 730) throw new Error('LOCAL_PUBLICATION_ROW_INVALID');
    const stats = typeof row.stats_json === 'string' ? JSON.parse(row.stats_json) : structuredClone(row.stats_json);
    const currentVersions = stats?.versions;
    if (!Number.isInteger(currentVersions?.normalization) || !currentVersions.parser || !currentVersions.rule || !currentVersions.filter) throw new Error('LOCAL_PUBLICATION_VERSION_REQUIRED');
    const signature = JSON.stringify([currentVersions.normalization, currentVersions.parser, currentVersions.rule, currentVersions.filter]);
    if (versions && versions.signature !== signature) throw new Error('LOCAL_PUBLICATION_MIXED_VERSIONS');
    versions = { ...currentVersions, signature };
    const rowAsOf = new Date(row.as_of).toISOString();
    if (asOf && asOf !== rowAsOf) throw new Error('LOCAL_PUBLICATION_MIXED_TIMESTAMPS');
    asOf = rowAsOf;
    if (stats.canonical_product_id && stats.canonical_product_id !== row.canonical_product_id) throw new Error('LOCAL_PUBLICATION_PRODUCT_MISMATCH');
    for (const [field, value] of [['market_pool', row.market_pool], ['condition', row.condition_code], ['currency', row.currency], ['days', row.days]]) {
      if (stats.methodology?.[field] != null && stats.methodology[field] !== value) throw new Error(`LOCAL_PUBLICATION_SCOPE_MISMATCH:${field}`);
    }
    for (const metric of METRICS) validateMetric(stats[metric]);
    for (const source of stats.by_source || []) {
      if (!allowed.has(source.source_id)) throw new Error('LOCAL_PUBLICATION_UNAPPROVED_SOURCE');
      for (const metric of METRICS) validateMetric(source[metric]);
    }
    const through = dateKey(asOf);
    const from = dateKey(Date.parse(`${through}T00:00:00Z`) - (row.days - 1) * 86400000);
    for (const parent of [stats, ...(stats.by_source || [])]) {
      const dates = new Set();
      for (const day of parent.daily || []) {
        if (day.date < from || day.date > through || dateKey(day.date) !== day.date || dates.has(day.date)) throw new Error('LOCAL_PUBLICATION_DAILY_WINDOW_INVALID');
        dates.add(day.date);
        for (const metric of METRICS) validateMetric(day[metric]);
      }
    }
    stats.canonical_product_id = row.canonical_product_id;
    stats.as_of = asOf;
    stats.published_window = { from, to: through, days: row.days };
    stats.publication_id = publicationId;
    return { ...row, through_date: through, stats_json: JSON.stringify(stats) };
  });
  const checksum = createHash('sha256').update(JSON.stringify([...prepared].sort((a, b) => keyOf(a).localeCompare(keyOf(b))))).digest('hex');
  const timestamp = new Date(publishedAt || asOf).toISOString();
  if (validateOnly) return { checksum, row_count: rows.length };
  db.exec('BEGIN IMMEDIATE');
  try {
    const previous = db.prepare('SELECT checksum FROM pc_stored_price_publications WHERE publication_id = ?').get(publicationId);
    if (previous) {
      if (previous.checksum !== checksum) throw new Error('LOCAL_PUBLICATION_ID_CONFLICT');
      db.exec('COMMIT');
      return { publication_id: publicationId, checksum, row_count: rows.length, unchanged: true };
    }
    db.prepare(`INSERT INTO pc_stored_price_publications VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(publicationId, checksum, rows.length, versions.normalization, versions.parser, versions.rule, versions.filter, asOf, timestamp);
    const insert = db.prepare(`INSERT INTO pc_stored_price_publication_rows VALUES (?, ?, ?, ?, ?, ?, ?, ?)`);
    for (const row of prepared) insert.run(publicationId, row.canonical_product_id, row.market_pool, row.condition_code,
      row.currency, row.days, row.through_date, row.stats_json);
    const actual = db.prepare('SELECT COUNT(*) AS n FROM pc_stored_price_publication_rows WHERE publication_id = ?').get(publicationId).n;
    if (actual !== rows.length) throw new Error('LOCAL_PUBLICATION_ROW_COUNT_MISMATCH');
    db.exec('COMMIT');
    return { publication_id: publicationId, checksum, row_count: rows.length, unchanged: false };
  } catch (error) {
    try { db.exec('ROLLBACK'); } catch {}
    throw error;
  }
}

export function readCompletedPricePublication(db, options) {
  const through = dateKey(options.asOf);
  // Date-specific queries never borrow the latest (different-day) publication.
  const row = db.prepare(`SELECT r.stats_json FROM pc_stored_price_publication_rows r
    JOIN pc_stored_price_publications p ON p.publication_id = r.publication_id
    WHERE r.canonical_product_id = ? AND r.market_pool = ? AND r.condition_code = ? AND r.currency = ? AND r.days = ?
      AND p.normalization_version = ? AND p.parser_version = ? AND p.rule_version = ? AND p.filter_version = ?
      AND r.through_date ${options.requireAsOfCoverage ? '=' : '<='} ? AND p.as_of <= ?
    ORDER BY r.through_date DESC, p.as_of DESC, p.published_at DESC LIMIT 1`).get(
    options.canonicalProductId, options.marketPool, options.condition, options.currency, options.days,
    options.normalizationVersion, options.parserVersion, options.ruleVersion, options.filterVersion, through,
    new Date(options.asOf).toISOString());
  return row ? JSON.parse(row.stats_json) : null;
}

export function pruneCompletedPricePublications(db, throughDate) {
  // Keep every scope from a publication together. Remove only complete
  // publications outside the same retention window as the daily aggregates.
  return db.prepare('DELETE FROM pc_stored_price_publications WHERE substr(as_of, 1, 10) < ?').run(throughDate);
}

export { keyOf as storedPricePublicationKey };
