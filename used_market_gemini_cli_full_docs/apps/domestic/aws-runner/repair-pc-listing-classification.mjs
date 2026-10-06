import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { PcPartsLedger } from './pc-parts-ledger.mjs';
import { PcShadowPipeline } from './pc-shadow-pipeline.mjs';
import { toPcProjectionImportItem } from './republish-pc-projections.mjs';

const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const json = value => JSON.parse(value || '{}');
const merge = (old, next) => [...new Set([...old, ...next])];
const fields = {
  canonical_product_id: 'canonicalProductId', canonical_display_name: 'canonicalDisplayName',
  listing_kind: 'listingKind', listing_type: 'listingType', spec_group_id: 'specGroupId',
  model_confidence: 'modelConfidence'
};

function correction(previous, item, pipeline) {
  const next = pipeline.normalizeItem(item, item.observed_at, null, { reclassification: true }).normalized;
  if (previous.canonical_product_id === next.canonicalProductId && previous.listing_kind === next.listingKind) return null;
  // This tool only repairs an explicit identity or purchase intent. It cannot
  // turn a bundle/unknown into a valid price sample or change sale units.
  if (!['SINGLE_COMPONENT', 'SAME_PRODUCT_LOT'].includes(previous.listing_kind)
    || !['SINGLE_COMPONENT', 'SAME_PRODUCT_LOT', 'WANTED'].includes(next.listingKind)
    || !next.canonicalProductId || previous.category_code !== next.categoryCode
    || previous.quantity !== next.quantity || previous.price_scope !== next.priceScope
    || previous.condition_code !== next.conditionCode || previous.market_pool !== next.marketPool)
    throw new Error('CLASSIFICATION_REPAIR_SEMANTICS_CHANGED');
  const after = { ...previous };
  for (const [column, key] of Object.entries(fields)) after[column] = next[key];
  after.price_eligible = previous.price_eligible && next.priceEligible ? 1 : 0;
  after.statistics_eligible = previous.statistics_eligible && next.statisticsEligible ? 1 : 0;
  after.exclusion_reasons_json = JSON.stringify(merge(json(previous.exclusion_reasons_json || '[]'), next.exclusionReasons));
  after.statistics_exclusion_reasons_json = JSON.stringify(merge(json(previous.statistics_exclusion_reasons_json || '[]'), next.statisticsExclusionReasons));
  after.evidence_json = JSON.stringify([...json(previous.evidence_json || '[]'),
    { field: 'classification', source: 'SCOPED_CLASSIFICATION_REPAIR',
      previous_product_id: previous.canonical_product_id, value: next.canonicalProductId,
      previous_kind: previous.listing_kind, listing_kind: next.listingKind }, ...next.evidence]);
  return { after, next };
}

export function buildListingClassificationRepair(db, itemIds, { asOf = new Date().toISOString() } = {}) {
  if (!Array.isArray(itemIds) || !itemIds.length || new Set(itemIds).size !== itemIds.length
    || itemIds.some(id => !/^(bunjang|joonggonara|danawa|ebay):[^\s]+$/u.test(id)))
    throw new Error('EXPLICIT_UNIQUE_LISTING_IDS_REQUIRED');
  const ledger = new PcPartsLedger({ db });
  const active = ledger.getActivePipelineVersion();
  if (!active) throw new Error('ACTIVE_PIPELINE_REQUIRED');
  const pipeline = new PcShadowPipeline({ ledger });
  const cohort = db.prepare('SELECT as_of FROM pc_stored_price_publications ORDER BY published_at DESC LIMIT 1').get();
  const cutoff = new Date(Math.min(Date.parse(asOf), Date.parse(cohort?.as_of || asOf)) - 30 * 86400000).toISOString();
  const normalizations = [], listings = [], scopes = new Map();
  const addScopes = (before, after, currency) => {
    for (const canonical_product_id of new Set([before.canonical_product_id, after.canonical_product_id])) {
      const pools = currency === 'KRW' && ['KR_C2C_USED', 'KR_DEALER_USED'].includes(before.market_pool)
        ? [before.market_pool, 'KR_DOMESTIC_USED'] : [before.market_pool];
      for (const market_pool of pools) {
        const scope = { canonical_product_id, market_pool,
          condition_code: before.condition_code, currency, days: 30 };
        scopes.set(JSON.stringify(scope), scope);
      }
    }
  };
  for (const itemId of itemIds) {
    const before = db.prepare('SELECT * FROM listings WHERE item_id=?').get(itemId);
    if (!before || `${before.site}:` !== itemId.slice(0, before.site.length + 1)) throw new Error('REPAIR_LISTING_TARGET_MISMATCH');
    if (before.active !== 1 || before.pc_lifecycle_status !== 'ACTIVE') throw new Error('REPAIR_REQUIRES_CURRENT_ACTIVE_LISTING');
    const metadata = json(before.pc_metadata_json);
    const current = { ...metadata, category_code: before.pc_category_code,
      canonical_product_id: before.pc_canonical_product_id, listing_kind: before.pc_listing_kind,
      quantity: before.pc_quantity, price_scope: before.pc_price_scope, condition_code: before.pc_condition_code,
      market_pool: before.pc_market_pool, price_eligible: before.pc_price_eligible,
      statistics_eligible: metadata.statistics_eligible ? 1 : 0,
      exclusion_reasons_json: JSON.stringify(metadata.exclusion_reasons || []),
      statistics_exclusion_reasons_json: JSON.stringify(metadata.statistics_exclusion_reasons || []),
      evidence_json: JSON.stringify(metadata.evidence || []) };
    const changed = correction(current, { ...before, price: before.price_value,
      status: before.pc_lifecycle_status, seller_type: before.pc_market_pool === 'KR_DEALER_USED' ? 'DEALER' : undefined }, pipeline);
    if (!changed) continue;
    const updated = { ...metadata };
    for (const column of Object.keys(fields)) updated[column] = changed.after[column];
    updated.canonical_manufacturer = changed.next.canonicalManufacturer;
    updated.chip_manufacturer = changed.next.spec?.chip_manufacturer || null;
    updated.board_manufacturer = changed.next.spec?.board_manufacturer || null;
    updated.statistics_eligible = Boolean(changed.after.statistics_eligible);
    updated.price_eligible = Boolean(changed.after.price_eligible);
    updated.statistics_exclusion_reasons = json(changed.after.statistics_exclusion_reasons_json);
    updated.exclusion_reasons = json(changed.after.exclusion_reasons_json);
    updated.evidence = json(changed.after.evidence_json);
    updated.good_listing_eligible = false;
    updated.reference_price = null;
    const after = { ...before, pc_metadata_json: JSON.stringify(updated),
      pc_canonical_product_id: updated.canonical_product_id,
      pc_canonical_manufacturer: updated.canonical_manufacturer,
      pc_board_manufacturer: updated.board_manufacturer,
      pc_listing_kind: updated.listing_kind, pc_price_eligible: updated.price_eligible ? 1 : 0 };
    listings.push({ before, after });
    addScopes(current, changed.after, before.currency);

    const sourceListingId = itemId.slice(before.site.length + 1);
    const rows = db.prepare(`SELECT n.*, s.source_id, s.source_listing_id, s.price_value, s.currency,
        s.observed_at, s.lifecycle_status, r.raw_json, r.title, r.description
      FROM listing_snapshots s JOIN raw_listings r ON r.id=s.raw_listing_id
      JOIN normalized_listings n ON n.snapshot_id=s.id
      WHERE s.source_id=? AND s.source_listing_id IN (?,?) AND s.observed_at>=?
        AND n.normalization_version=? AND n.parser_version=? AND n.rule_version=? AND n.filter_version=?
      ORDER BY n.id`).all(before.site, sourceListingId, before.url, cutoff, active.normalization_version,
        active.parser_version, active.rule_version, active.filter_version);
    for (const row of rows) {
      const original = db.prepare('SELECT * FROM normalized_listings WHERE id=?').get(row.id);
      const item = { ...json(row.raw_json), site: row.source_id, title: row.title, description: row.description,
        price: row.price_value, currency: row.currency, observed_at: row.observed_at,
        status: row.lifecycle_status, seller_type: original.market_pool === 'KR_DEALER_USED' ? 'DEALER' : undefined };
      const repaired = correction(original, item, pipeline);
      if (!repaired) continue;
      const children = db.prepare('SELECT * FROM listing_items WHERE normalized_listing_id=? ORDER BY item_index').all(row.id);
      if (children.length !== 1 || children[0].canonical_product_id !== original.canonical_product_id)
        throw new Error('REPAIR_COMPONENT_TARGET_MISMATCH');
      const child = children[0];
      normalizations.push({ before: original, after: repaired.after, beforeChild: child,
        afterChild: { ...child, canonical_product_id: repaired.next.canonicalProductId,
          spec_json: JSON.stringify({ ...json(child.spec_json), ...repaired.next.spec }) },
        evidence_hash: digest(row) });
      addScopes(original, repaired.after, row.currency);
    }
  }
  const plan = { format: 1, as_of: asOf, cutoff, active, item_ids: itemIds,
    listings, normalizations, scopes: [...scopes.values()] };
  return { ...plan, checksum: digest(plan) };
}

function update(db, table, key, row) {
  const columns = Object.keys(row).filter(column => column !== key);
  db.prepare(`UPDATE ${table} SET ${columns.map(column => `${column}=?`).join(',')} WHERE ${key}=?`)
    .run(...columns.map(column => row[column]), row[key]);
}

export function applyListingClassificationRepair(db, plan) {
  const { checksum, ...contents } = plan;
  if (checksum !== digest(contents)) throw new Error('REPAIR_CHECKSUM_MISMATCH');
  db.exec('BEGIN IMMEDIATE');
  try {
    const rebuilt = buildListingClassificationRepair(db, plan.item_ids, { asOf: plan.as_of });
    if (rebuilt.checksum !== checksum) throw new Error('REPAIR_EVIDENCE_CHANGED');
    for (const entry of plan.normalizations) {
      update(db, 'normalized_listings', 'id', entry.after);
      update(db, 'listing_items', 'id', entry.afterChild);
    }
    for (const entry of plan.listings) {
      // Only classification columns change; source text, prices and observation
      // dates are retained, including last_checked_at (no live check occurred).
      db.prepare(`UPDATE listings SET pc_metadata_json=?, pc_canonical_product_id=?,
        pc_canonical_manufacturer=?, pc_board_manufacturer=?, pc_listing_kind=?, pc_price_eligible=? WHERE item_id=?`)
        .run(entry.after.pc_metadata_json, entry.after.pc_canonical_product_id,
          entry.after.pc_canonical_manufacturer, entry.after.pc_board_manufacturer, entry.after.pc_listing_kind,
          entry.after.pc_price_eligible, entry.after.item_id);
    }
    db.exec('COMMIT');
  } catch (error) { db.exec('ROLLBACK'); throw error; }
}

async function main() {
  const [mode, filename, ...itemIds] = process.argv.slice(2);
  if (!['plan', 'apply', 'mirror'].includes(mode) || !filename || !process.env.RUNNER_INDEX_PATH)
    throw new Error('Usage: repair-pc-listing-classification.mjs plan|apply|mirror /protected/plan.json [source:item-id ...]');
  const health = await fetch(`http://127.0.0.1:${process.env.RUNNER_PORT || 8787}/health`).then(r => r.json());
  if (!health.ok || health.active_run || health.pc_parts?.scheduler_enabled
    || health.pc_parts?.scheduler_active || health.pc_parts?.publication_active)
    throw new Error('REPAIR_REQUIRES_IDLE_RUNNER_AND_PAUSED_SCHEDULER');
  const db = new DatabaseSync(process.env.RUNNER_INDEX_PATH, { readOnly: mode !== 'apply' });
  db.exec('PRAGMA busy_timeout=10000');
  try {
    const plan = mode === 'plan' ? buildListingClassificationRepair(db, itemIds) : json(readFileSync(filename, 'utf8'));
    const { checksum, ...contents } = plan;
    if (checksum !== digest(contents)) throw new Error('REPAIR_CHECKSUM_MISMATCH');
    if (mode === 'plan') writeFileSync(filename, JSON.stringify(plan), { flag: 'wx', mode: 0o600 });
    if (mode === 'apply') applyListingClassificationRepair(db, plan);
    if (mode === 'mirror' && plan.listings.length) {
      const url = new URL(process.env.D1_IMPORT_URL);
      if (url.protocol !== 'https:' || url.hostname !== 'used-pick.com' || url.pathname !== '/admin/import-listings')
        throw new Error('REPAIR_MIRROR_TARGET_MISMATCH');
      const items = plan.listings.map(({ after }) => {
        if (db.prepare('SELECT pc_metadata_json FROM listings WHERE item_id=?').get(after.item_id)?.pc_metadata_json !== after.pc_metadata_json)
          throw new Error('REPAIR_NOT_APPLIED');
        return toPcProjectionImportItem({ ...after, ...json(after.pc_metadata_json),
          price: after.price_value, updated_at: after.last_seen_at });
      });
      for (let offset = 0; offset < items.length; offset += 100) {
        const batch = items.slice(offset, offset + 100);
        const response = await fetch(url, { method: 'POST', signal: AbortSignal.timeout(30000),
          headers: { authorization: `Bearer ${process.env.CLOUDFLARE_MANUAL_RUN_TOKEN || process.env.IMPORT_TOKEN}`,
            'content-type': 'application/json' }, body: JSON.stringify({ items: batch }) });
        const payload = await response.json(); const result = payload.data || payload;
        if (!response.ok || result.inserted !== batch.length || result.rejected !== 0 || result.retention_policy !== 'NON_DESTRUCTIVE')
          throw new Error('REPAIR_MIRROR_INTEGRITY_FAILURE');
      }
    }
    console.log(JSON.stringify({ mode, checksum: plan.checksum, listings: plan.listings.length,
      snapshots: plan.normalizations.length, scopes: plan.scopes,
      corrections: plan.listings.map(e => ({ item_id: e.before.item_id,
        previous_product_id: e.before.pc_canonical_product_id, product_id: e.after.pc_canonical_product_id,
        previous_kind: e.before.pc_listing_kind, listing_kind: e.after.pc_listing_kind })) }));
  } finally { db.close(); }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
