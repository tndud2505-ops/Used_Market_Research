import { randomUUID } from 'node:crypto';
import { compactStatsForPublication, statsChecksum, statsPublicationKey } from '../cloudflare/public-product-stats.mjs';
import { pcStatsTraceability } from './pc-stats-traceability.mjs';
import { explicitSoldText } from '../market/logic/listing-lifecycle.mjs';

export const DEFAULT_REPAIR_THRESHOLD_KRW = 3000;
const IMMEDIATE_REASONS = new Set(['PRODUCT_IDENTITY', 'CURRENCY_OR_UNIT', 'CORRUPT_DATA']);
const METRICS = ['active', 'reserved', 'sold', 'confirmed_transactions'];
const PRICES = ['mean', 'median', 'average', 'trimmed_mean', 'arithmetic_mean'];
const parse = row => typeof row.stats_json === 'string' ? JSON.parse(row.stats_json) : row.stats_json;

export function assertScopedRepairMembers(ledger, o) {
  const members = ledger.db.prepare(`SELECT d.metric_scope, d.canonical_product_id, d.market_pool, d.condition_code, d.currency,
    n.canonical_product_id AS model, n.market_pool AS pool, n.condition_code AS condition,
    n.snapshot_id AS normalized_snapshot, s.id AS snapshot_id, s.currency AS snapshot_currency,
    s.raw_listing_id, m.raw_listing_id AS member_raw, s.source_id, s.source_listing_id,
    s.sold_last_ask_price, s.status_evidence_json, m.price_value
    FROM daily_price_stats d JOIN daily_price_stat_members m ON m.daily_price_stat_id=d.id
    JOIN listing_snapshots s ON s.id=m.snapshot_id JOIN listing_items i ON i.id=m.listing_item_id
    JOIN normalized_listings n ON n.id=i.normalized_listing_id
    WHERE d.canonical_product_id=? AND d.market_pool=? AND d.condition_code=? AND d.currency=?
      AND d.normalization_version=? AND d.parser_version=? AND d.rule_version=? AND d.filter_version=?
      AND d.stat_date BETWEEN date(?,'-29 days') AND date(?)`).all(o.canonicalProductId,o.marketPool,o.condition,o.currency,
      o.normalizationVersion,o.parserVersion,o.ruleVersion,o.filterVersion,o.asOf,o.asOf);
  const firstSold = ledger.db.prepare(`SELECT id FROM listing_snapshots WHERE source_id=? AND source_listing_id=?
    AND lifecycle_status='SOLD' ORDER BY observed_at,id LIMIT 1`);
  for (const m of members) {
    const poolMatches = m.market_pool === m.pool || m.market_pool === 'KR_DOMESTIC_USED'
      && ['KR_C2C_USED','KR_DEALER_USED'].includes(m.pool) && m.currency === 'KRW';
    if (m.model !== m.canonical_product_id || !poolMatches || m.condition !== m.condition_code
      || m.currency !== m.snapshot_currency || m.normalized_snapshot !== m.snapshot_id || m.member_raw !== m.raw_listing_id
      || !(m.price_value > 0) || o.sourceIds?.length && !o.sourceIds.includes(m.source_id)) throw new Error('REPAIR_MEMBER_IDENTITY_INVALID');
    if (m.metric_scope === 'SOLD') {
      const evidence = JSON.parse(m.status_evidence_json || '{}');
      if (!['STRUCTURED_STATUS','OFFICIAL_API','EXPLICIT_TEXT'].includes(String(evidence.type).toUpperCase())
        || !explicitSoldText(String(evidence.value || '').replace(/[_-]+/gu,' ')) || !(m.sold_last_ask_price > 0)
        || firstSold.get(m.source_id,m.source_listing_id)?.id !== m.snapshot_id) throw new Error('REPAIR_SOLD_EVIDENCE_INVALID');
    }
  }
}

export function calculateScopedReplacements(ledger, scopes, optionsFor) {
  if (!scopes?.length) throw new Error('EXPLICIT_REPAIR_SCOPES_REQUIRED');
  const preview = Object.create(ledger);
  preview.transaction = fn => fn();
  return scopes.map(scope => {
    const options = optionsFor(scope);
    ledger.db.exec('BEGIN IMMEDIATE');
    try {
      const stats = compactStatsForPublication(preview.rebuildAndGetPriceStats(options));
      assertScopedRepairMembers(preview, options);
      return { ...scope, as_of: options.asOf,
        stats_json: { ...stats, traceability: pcStatsTraceability(preview, options) } };
    } finally { ledger.db.exec('ROLLBACK'); }
  });
}

function representatives(stats) {
  const prices = new Map();
  const add = (prefix, value) => {
    for (const metric of METRICS) for (const field of PRICES) {
      const price = value?.[metric]?.[field];
      if (price != null && (!Number.isFinite(price) || price <= 0)) throw new Error('INVALID_REPAIR_PRICE');
      prices.set(`${prefix}/${metric}/${field}`, price ?? null);
    }
  };
  const scope = (prefix, value) => {
    add(prefix, value);
    for (const day of value.daily || []) add(`${prefix}/${day.date}`, day);
  };
  scope('all', stats);
  for (const source of stats.by_source || []) scope(`source:${source.source_id}`, source);
  for (const maker of stats.by_manufacturer || []) {
    scope(`manufacturer:${maker.manufacturer}`,maker);
    for (const source of maker.by_source || []) scope(`manufacturer:${maker.manufacturer}/source:${source.source_id}`,source);
  }
  return prices;
}

// Historical corrections keep one exact existing cohort. They never pretend
// retained rows were recomputed today, expand to other products, or invoke the
// full publisher when the scope/impact is unknown.
export async function planScopedStatsRepair({ base, replacements, reason = 'PRICE_CHANGE', thresholdKrw = DEFAULT_REPAIR_THRESHOLD_KRW }) {
  if (!['PRICE_CHANGE', ...IMMEDIATE_REASONS].includes(reason)) throw new Error('REPAIR_REASON_REQUIRED');
  if (!Number.isFinite(thresholdKrw) || thresholdKrw <= 0) throw new Error('REPAIR_THRESHOLD_REQUIRED');
  if (!Array.isArray(base?.rows) || base.rows.length !== base.expected_row_count
    || await statsChecksum(base.rows) !== base.checksum) throw new Error('REPAIR_BASE_CHECKSUM_MISMATCH');
  if (!Array.isArray(replacements) || !replacements.length) throw new Error('EXPLICIT_REPAIR_SCOPES_REQUIRED');
  const rows = new Map(base.rows.map(row => [statsPublicationKey(row), row]));
  if (rows.size !== base.rows.length) throw new Error('REPAIR_BASE_SCOPE_DUPLICATE');
  const seen = new Set(), decisions = [];
  for (const next of replacements) {
    const key = statsPublicationKey(next), old = rows.get(key);
    if (!old || seen.has(key)) throw new Error('REPAIR_SCOPE_MISSING_OR_DUPLICATE');
    seen.add(key);
    const before = parse(old), after = parse(next);
    const through = base.created_at.slice(0, 10);
    const from = new Date(Date.parse(`${through}T00:00:00Z`) - (next.days - 1) * 86400000).toISOString().slice(0, 10);
    if (old.as_of !== base.created_at || next.as_of !== old.as_of
      || [before, after].some(stats => stats.as_of !== base.created_at
        || stats.published_window && (stats.published_window.from !== from || stats.published_window.to !== through
          || stats.published_window.days !== next.days))
      || JSON.stringify(before.versions) !== JSON.stringify(after.versions)) throw new Error('REPAIR_COHORT_MISMATCH');
    if (next.currency !== 'KRW' && !IMMEDIATE_REASONS.has(reason)) throw new Error('REPAIR_CURRENCY_THRESHOLD_REQUIRED');
    const previous = representatives(before), proposed = representatives(after);
    let maxDelta = 0, availabilityChanged = false;
    for (const name of new Set([...previous.keys(), ...proposed.keys()])) {
      const a = previous.get(name) ?? null, b = proposed.get(name) ?? null;
      if ((a === null) !== (b === null)) availabilityChanged = true;
      if (a !== null && b !== null) maxDelta = Math.max(maxDelta, Math.abs(a - b));
    }
    const changed = JSON.stringify(before) !== JSON.stringify(after);
    const repair = changed && (IMMEDIATE_REASONS.has(reason) || availabilityChanged || maxDelta >= thresholdKrw);
    decisions.push({ canonical_product_id: next.canonical_product_id, market_pool: next.market_pool,
      condition_code: next.condition_code, currency: next.currency, days: next.days,
      action: repair ? 'REPAIR_SCOPE' : 'DEFER_TO_SCHEDULED_REFRESH', max_price_delta: maxDelta,
      availability_changed: availabilityChanged, reason,
      sample_counts_before:Object.fromEntries(METRICS.map(key=>[key,Number(before[key]?.sample_count || 0)])),
      sample_counts_after:Object.fromEntries(METRICS.map(key=>[key,Number(after[key]?.sample_count || 0)])) });
    if (repair) rows.set(key, next);
  }
  const changedScopes = decisions.filter(row => row.action === 'REPAIR_SCOPE').length;
  if (!changedScopes) return { action: 'DEFER', decisions, recalculated_scope_count: replacements.length, publication: null };
  const repairedRows = [...rows.values()];
  const nonEmpty = repairedRows.filter(row => METRICS.some(metric => Number(parse(row)[metric]?.sample_count || 0) > 0)).length;
  return { action: 'SCOPED_REPAIR', decisions, recalculated_scope_count: replacements.length,
    preserved_scope_count: base.rows.length - changedScopes,
    publication: { publication_id: randomUUID(), checksum: await statsChecksum(repairedRows),
      expected_row_count: repairedRows.length, expected_non_empty_scope_count: nonEmpty,
      expected_keys: repairedRows.map(statsPublicationKey).sort(), merge_with_active: false,
      normalization_version: base.normalization_version, parser_version: base.parser_version,
      rule_version: base.rule_version, filter_version: base.filter_version,
      created_at: base.created_at, rows: repairedRows } };
}
