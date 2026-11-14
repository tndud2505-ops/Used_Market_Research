import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { PcPartsLedger } from './pc-parts-ledger.mjs';
import { latestCompletedPricePublication } from './pc-stored-price-publication.mjs';
import { PcShadowPipeline } from './pc-shadow-pipeline.mjs';
import { toPcProjectionImportItem } from './republish-pc-projections.mjs';
import { reconcileExactModelStatistics } from './pc-classification-consistency.mjs';
import { PUBLIC_PC_PART_CATEGORIES, isNetworkCardTitle, isTammuzRx550SsdTitle, isWholeCamcorderTitle, ramSingleSetQuantity } from '../market/logic/pc-parts-classifier.mjs';

const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const json = value => JSON.parse(value || '{}');
const merge = (old, next) => [...new Set([...old, ...next])];
const fields = {
  canonical_product_id: 'canonicalProductId', canonical_display_name: 'canonicalDisplayName',
  listing_kind: 'listingKind', listing_type: 'listingType', spec_group_id: 'specGroupId',
  model_confidence: 'modelConfidence', category_code: 'categoryCode', market_segment: 'marketSegment'
};
const facets = { product_kind: 'productKind', placement: 'placement', form_factor: 'formFactor' };

function correction(previous, item, pipeline, child) {
  const next = pipeline.normalizeItem(item, item.observed_at, null, { reclassification: true }).normalized;
  const statistics=reconcileExactModelStatistics(previous,next,item.currency);
  let facetOnly = false;
  if (previous.canonical_product_id === next.canonicalProductId && previous.listing_kind === next.listingKind
    && previous.quantity === next.quantity && previous.price_scope === next.priceScope
    && previous.statistics_eligible===statistics.statistics_eligible
    && previous.exact_product===statistics.exact_product
    && previous.statistics_exclusion_reasons_json===statistics.statistics_exclusion_reasons_json) {
    const addedCpu = next.listingKind === 'COMPONENT_BUNDLE' && Array.isArray(previous.components)
      ? next.searchComponents.filter(component => component.search_only === true
        && component.association_type === 'TITLE_CPU_MODEL_FAMILY'
        && !previous.components.includes(component.canonical_product_id)) : [];
    const priorFacets = child ? json(child.spec_json) : previous;
    facetOnly = Object.entries(facets).some(([column, key]) =>
      (priorFacets[child ? `listing_${column}` : column] ?? null) !== next[key]);
    if (!facetOnly && !addedCpu.length) return null;
    // Search metadata only; unchanged normalized rows and monetary fields do
    // not need another classification or price repair.
    if (!facetOnly) return { next, after: { ...previous, evidence_json: JSON.stringify([
      ...json(previous.evidence_json || '[]'), ...addedCpu.map(component => ({
        field: 'components', source: 'SCOPED_TITLE_CPU_ASSOCIATION', search_only: true,
        value: component.canonical_product_id, matched_text: component.matched_text
      }))
    ]) } };
  }
  // A positively identified complete PC may lose its false component identity,
  // never the reverse. Raw observations and sale units remain untouched.
  const fullSystemCorrection = next.listingKind === 'FULL_SYSTEM' && next.categoryCode === 'SYSTEM'
    && !next.canonicalProductId && !next.priceEligible && !next.statisticsEligible
    && next.exclusionReasons.includes('FULL_SYSTEM');
  const accessoryCorrection = ['ACCESSORY_ONLY', 'BOX_ONLY'].includes(next.listingKind) && next.categoryCode === 'ACCESSORY'
    && !next.canonicalProductId && !next.priceEligible && !next.statisticsEligible
    && next.exclusionReasons.includes(next.listingKind);
  const bundleCorrection = next.listingKind === 'COMPONENT_BUNDLE' && next.categoryCode === 'BUNDLE'
    && !next.canonicalProductId && !next.priceEligible && !next.statisticsEligible
    && next.exclusionReasons.includes('COMPONENT_BUNDLE')
    && previous.price_scope === 'TOTAL' && next.priceScope === 'BUNDLE'
    && previous.quantity === next.quantity;
  const clearsComponentIdentity = fullSystemCorrection || accessoryCorrection || bundleCorrection;
  const networkCardCorrection = previous.category_code === 'PSU'
    && previous.canonical_product_id?.startsWith('psu:corsair:watts-bucket:')
    && isNetworkCardTitle(item.title) && next.categoryCode === 'EXPANSION_CARD'
    && next.listingKind === previous.listing_kind
    && ((!next.canonicalProductId && !next.priceEligible)
      || (next.canonicalProductId?.startsWith('expansion:facet:network:')
        && next.spec?.directory_node_type === 'BROWSE_FACET' && next.spec?.subtype === 'NETWORK'))
    && !next.statisticsEligible;
  const camcorderCorrection = previous.category_code === 'HDD' && isWholeCamcorderTitle(item.title)
    && next.listingKind === 'NON_PC_ITEM' && next.categoryCode === 'UNKNOWN' && !next.canonicalProductId
    && !next.priceEligible && !next.statisticsEligible;
  const storageModelCollision = previous.category_code === 'GPU'
    && previous.canonical_product_id === 'gpu:amd:rx-550'
    && isTammuzRx550SsdTitle(item.title) && next.categoryCode === 'SSD'
    && next.canonicalProductId?.startsWith('ssd:')
    && next.listingKind === previous.listing_kind;
  const ramSetCorrection = previous.category_code === 'RAM' && next.categoryCode === 'RAM'
    && previous.canonical_product_id === next.canonicalProductId && Boolean(next.canonicalProductId)
    && previous.quantity === 1 && previous.price_scope === 'TOTAL' && next.priceScope === 'TOTAL'
    && next.quantity === ramSingleSetQuantity(item.title) && next.quantity > 1
    && next.listingKind === 'SAME_PRODUCT_LOT';
  if (!['SINGLE_COMPONENT', 'SAME_PRODUCT_LOT'].includes(previous.listing_kind)
    || (!clearsComponentIdentity && !networkCardCorrection && !camcorderCorrection && !storageModelCollision && (!['SINGLE_COMPONENT', 'SAME_PRODUCT_LOT', 'WANTED'].includes(next.listingKind)
      || !next.canonicalProductId || previous.category_code !== next.categoryCode))
    || (!ramSetCorrection && !bundleCorrection && (previous.quantity !== next.quantity || previous.price_scope !== next.priceScope))
    || previous.condition_code !== next.conditionCode || previous.market_pool !== next.marketPool)
    throw new Error('CLASSIFICATION_REPAIR_SEMANTICS_CHANGED');
  if (facetOnly) return { next, after: { ...previous }, facetOnly };
  const after = { ...previous };
  for (const [column, key] of Object.entries(fields)) after[column] = next[key];
  // Re-label the same observed total as a bundle price. Never split the price
  // among inferred components or change the original observed amount/quantity.
  if (bundleCorrection) after.price_scope = next.priceScope;
  if (ramSetCorrection) {
    after.quantity = next.quantity;
    after.quantity_confidence = next.quantityConfidence;
    after.price_scope_confidence = next.priceScopeConfidence;
  }
  after.price_eligible = previous.price_eligible && next.priceEligible ? 1 : 0;
  Object.assign(after,statistics);
  if ((clearsComponentIdentity || networkCardCorrection || camcorderCorrection) && Object.hasOwn(after,'exact_product')) after.exact_product=0;
  after.exclusion_reasons_json = JSON.stringify(merge(json(previous.exclusion_reasons_json || '[]'), next.exclusionReasons));
  after.evidence_json = JSON.stringify([...json(previous.evidence_json || '[]'),
    { field: 'classification', source: 'SCOPED_CLASSIFICATION_REPAIR',
      previous_product_id: previous.canonical_product_id, value: next.canonicalProductId,
      previous_kind: previous.listing_kind, listing_kind: next.listingKind }, ...next.evidence]);
  return { after, next };
}

export function buildListingClassificationRepair(db, itemIds, { asOf = new Date().toISOString() } = {}) {
  if (!Array.isArray(itemIds) || !itemIds.length || new Set(itemIds).size !== itemIds.length
    || itemIds.some(id => !/^(bunjang|joonggonara|danawa|ebay|daangn):[^\s]+$/u.test(id)))
    throw new Error('EXPLICIT_UNIQUE_LISTING_IDS_REQUIRED');
  const ledger = new PcPartsLedger({ db });
  const active = ledger.getActivePipelineVersion();
  if (!active) throw new Error('ACTIVE_PIPELINE_REQUIRED');
  const pipeline = new PcShadowPipeline({ ledger });
  const cohort = latestCompletedPricePublication(db);
  const cutoff = new Date(Math.min(Date.parse(asOf), Date.parse(cohort?.as_of || asOf)) - 30 * 86400000).toISOString();
  const normalizations = [], listings = [], scopes = new Map();
  const addScopes = (before, after, currency) => {
    // Always repair a previously affected identity, including removal of an
    // invalid sample. Only add new identities in the pipeline's public/tool
    // price-statistics categories; search-only network facets have no scope.
    const products = new Set([before.canonical_product_id]);
    if (PUBLIC_PC_PART_CATEGORIES.includes(after.category_code) || ['CASE', 'COOLING'].includes(after.category_code))
      products.add(after.canonical_product_id);
    for (const canonical_product_id of products) {
      if (!canonical_product_id) continue;
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
    const metadata = json(before.pc_metadata_json);
    const soldStorageTarget = before.active === 0 && before.pc_lifecycle_status === 'SOLD'
      && isTammuzRx550SsdTitle(before.title);
    const soldStorageCollision = soldStorageTarget && before.pc_category_code === 'GPU'
      && before.pc_canonical_product_id === 'gpu:amd:rx-550';
    // Permit a repeat preview of this exact completed repair, without opening
    // arbitrary terminal listings to reclassification.
    const repairedSoldStorage = soldStorageTarget && before.pc_category_code === 'SSD'
      && before.pc_canonical_product_id?.startsWith('ssd:')
      && metadata.evidence?.some(entry => entry.field === 'classification'
        && entry.source === 'SCOPED_CLASSIFICATION_REPAIR'
        && entry.previous_product_id === 'gpu:amd:rx-550'
        && entry.value === before.pc_canonical_product_id);
    if ((before.active !== 1 || before.pc_lifecycle_status !== 'ACTIVE')
      && !soldStorageCollision && !repairedSoldStorage)
      throw new Error('REPAIR_REQUIRES_CURRENT_ACTIVE_LISTING');
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
    if (repairedSoldStorage && changed) throw new Error('CLASSIFICATION_REPAIR_SEMANTICS_CHANGED');
    if (changed) {
    const updated = { ...metadata };
    if (!changed.facetOnly) {
    for (const column of [...Object.keys(fields), 'quantity', 'price_scope', 'quantity_confidence', 'price_scope_confidence']) updated[column] = changed.after[column];
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
    // These are search associations, not part prices. Never retain a previous
    // component ID merely because it was present in the contaminated metadata.
    const searchComponents = changed.next.searchComponents || [];
    updated.components = ['FULL_SYSTEM', 'COMPONENT_BUNDLE'].includes(changed.next.listingKind)
      ? [...new Set(searchComponents.filter(component => component.search_only === true
        && ['TITLE_GPU_MODEL_FAMILY', 'TITLE_CPU_MODEL_FAMILY'].includes(component.association_type))
        .map(component => component.canonical_product_id).filter(Boolean))] : [];
    }
    for (const [column, key] of Object.entries(facets)) updated[column] = changed.next[key];
    const after = changed.facetOnly ? { ...before, pc_metadata_json: JSON.stringify(updated) }
      : { ...before, pc_metadata_json: JSON.stringify(updated),
      pc_canonical_product_id: updated.canonical_product_id,
      pc_category_code: updated.category_code,
      pc_canonical_manufacturer: updated.canonical_manufacturer,
      pc_board_manufacturer: updated.board_manufacturer,
      pc_listing_kind: updated.listing_kind, pc_price_eligible: updated.price_eligible ? 1 : 0,
      pc_quantity: updated.quantity, pc_price_scope: updated.price_scope };
    listings.push({ before, after });
    if (!changed.facetOnly) addScopes(current, changed.after, before.currency);
    }

    const sourceListingId = itemId.slice(before.site.length + 1);
    // eBay Browse's exact raw key represents this numeric listing, not a
    // prefix search that could also select another listing or variation.
    const ebaySourceListingId = before.site === 'ebay' && /^\d+$/u.test(sourceListingId)
      ? `v1|${sourceListingId}|0` : null;
    const rows = db.prepare(`SELECT n.*, s.source_id, s.source_listing_id, s.price_value, s.currency,
        s.observed_at, s.lifecycle_status, r.last_seen_at, r.raw_json, r.title, r.description
      FROM listing_snapshots s JOIN raw_listings r ON r.id=s.raw_listing_id
      JOIN normalized_listings n ON n.snapshot_id=s.id
      WHERE s.source_id=? AND s.source_listing_id IN (?,?,?,?,?)
        AND (s.observed_at>=? OR (s.lifecycle_status IN ('ACTIVE','RESERVED') AND r.last_seen_at>=?))
        AND s.observed_at<=?
        AND n.normalization_version=? AND n.parser_version=? AND n.rule_version=? AND n.filter_version=?
      ORDER BY n.id`).all(before.site, sourceListingId, before.url, itemId, `${before.site}:${before.url}`, ebaySourceListingId, cutoff, cutoff, asOf, active.normalization_version,
        active.parser_version, active.rule_version, active.filter_version);
    for (const row of rows) {
      const original = db.prepare('SELECT * FROM normalized_listings WHERE id=?').get(row.id);
      const item = { ...json(row.raw_json), site: row.source_id, title: row.title, description: row.description,
        price: row.price_value, currency: row.currency, observed_at: row.observed_at,
        status: row.lifecycle_status, seller_type: original.market_pool === 'KR_DEALER_USED' ? 'DEALER' : undefined };
      const children = db.prepare('SELECT * FROM listing_items WHERE normalized_listing_id=? ORDER BY item_index').all(row.id);
      const repaired = correction(original, item, pipeline, children[0]);
      if (!repaired) continue;
      if (soldStorageTarget && (original.category_code !== 'GPU'
        || original.canonical_product_id !== 'gpu:amd:rx-550'
        || !isTammuzRx550SsdTitle(item.title) || repaired.next.categoryCode !== 'SSD'
        || !repaired.next.canonicalProductId?.startsWith('ssd:')))
        throw new Error('CLASSIFICATION_REPAIR_SEMANTICS_CHANGED');
      if (children.length !== 1 || children[0].canonical_product_id !== original.canonical_product_id)
        throw new Error('REPAIR_COMPONENT_TARGET_MISMATCH');
      const child = children[0];
      normalizations.push({ before: original, after: repaired.after, beforeChild: child,
        afterChild: { ...child, canonical_product_id: repaired.next.canonicalProductId,
          ...(original.quantity !== repaired.next.quantity ? {
            quantity: repaired.next.quantity, unit_price: repaired.next.unitPrice, total_price: repaired.next.totalPrice
          } : {}),
          spec_json: JSON.stringify(repaired.facetOnly
            ? { ...json(child.spec_json), ...Object.fromEntries(Object.entries(facets)
              .map(([column, key]) => [`listing_${column}`, repaired.next[key]])) }
            : original.category_code === repaired.next.categoryCode
            ? { ...json(child.spec_json), ...repaired.next.spec } : repaired.next.spec) },
        evidence_hash: digest(row) });
      if (!repaired.facetOnly) addScopes(original, repaired.after, row.currency);
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
      db.prepare(`UPDATE listings SET pc_metadata_json=?, pc_canonical_product_id=?, pc_category_code=?,
        pc_canonical_manufacturer=?, pc_board_manufacturer=?, pc_listing_kind=?, pc_price_eligible=?, pc_quantity=?, pc_price_scope=? WHERE item_id=?`)
        .run(entry.after.pc_metadata_json, entry.after.pc_canonical_product_id, entry.after.pc_category_code,
          entry.after.pc_canonical_manufacturer, entry.after.pc_board_manufacturer, entry.after.pc_listing_kind,
          entry.after.pc_price_eligible, entry.after.pc_quantity, entry.after.pc_price_scope, entry.after.item_id);
    }
    db.exec('COMMIT');
  } catch (error) { db.exec('ROLLBACK'); throw error; }
}

async function main() {
  const [mode, filename, ...itemIds] = process.argv.slice(2);
  if (!['plan', 'apply', 'mirror'].includes(mode) || !filename || !process.env.RUNNER_INDEX_PATH)
    throw new Error('Usage: repair-pc-listing-classification.mjs plan|apply|mirror /protected/plan.json [source:item-id ...]');
  const health = await fetch(`http://127.0.0.1:${process.env.RUNNER_PORT || 8787}/health`).then(r => r.json());
  if (!health.ok || health.active_run || (health.pc_parts?.scheduler_enabled && !health.maintenance)
    || health.draining
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
        const metadata = json(after.pc_metadata_json);
        return { ...toPcProjectionImportItem({ ...after, ...metadata,
          price: after.price_value, updated_at: after.last_seen_at }), components: metadata.components || [] };
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
