import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { classifyPcPartListingPublic } from '../market/logic/pc-parts-classifier.mjs';
import { PC_PRODUCT_MASTER_V2 } from '../market/data/pc-product-master-v2.mjs';
import { PcPartsLedger } from './pc-parts-ledger.mjs';
import { latestCompletedPricePublication } from './pc-stored-price-publication.mjs';
import { PcShadowPipeline } from './pc-shadow-pipeline.mjs';
import { reconcileExactModelStatistics } from './pc-classification-consistency.mjs';
import { toPcProjectionImportItem } from './republish-pc-projections.mjs';

const products = new Map(PC_PRODUCT_MASTER_V2.map(p => [p.id, p]));
const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const json = value => JSON.parse(value || '{}');
const evidenceFields = row => Object.fromEntries(['raw_json','title','description','source_id','source_listing_id',
  'price_value','currency','observed_at','lifecycle_status'].map(k => [k, row[k]]));
const projectionKey = (site, url, title, price, currency, oldId, newId) =>
  JSON.stringify([site, url, title, price, currency, oldId, newId]);
const unknown = id => /^(?:ssd|hdd):other-unclassified:capacity-bucket:/.test(id || '')
  || /^motherboard:platform:/.test(id || '');

// Only promote an unknown identity when all sale/price semantics are unchanged.
// Independent exclusions remain intact. Only a disproved exact-model reason
// can be reconciled from the full pipeline below, never from an ID alone.
export function identityPromotion(previous, item) {
  if (!unknown(previous.canonical_product_id)) return null;
  const next = classifyPcPartListingPublic(item);
  const product = products.get(next.canonical_product_id);
  if (!product || unknown(product.id) || product.category !== previous.category_code
    || next.listing_kind !== previous.listing_kind || next.condition !== previous.condition_code
    || next.quantity !== previous.quantity || next.price_scope !== previous.price_scope
    || (previous.price_eligible && !next.price_eligible)) return null;
  if (product.category === 'MOTHERBOARD') {
    if (product.spec.directory_node_type !== 'PRODUCT') return null;
    const oldProduct = products.get(previous.canonical_product_id);
    if (!oldProduct || oldProduct.manufacturer !== product.manufacturer
      || oldProduct.spec.platform_vendor !== product.spec.platform_vendor) return null;
  } else if (product.id.split(':capacity-bucket:')[1] !== previous.canonical_product_id.split(':capacity-bucket:')[1]) return null;
  return { product, next };
}

function metadataPromotion(old, promotion, statistics = null) {
  const { product, next } = promotion;
  return { ...old, ...(statistics?{statistics_eligible:Boolean(statistics.statistics_eligible),
    statistics_exclusion_reasons:json(statistics.statistics_exclusion_reasons_json)}:{}),
    canonical_product_id: product.id, canonical_display_name: product.name,
    canonical_manufacturer: product.manufacturer, spec_group_id: next.spec_group_id,
    model_confidence: next.model_confidence,
    // A price reference belongs to the old identity and must never follow it.
    reference_price: null, good_listing_eligible: false,
    evidence: [...(Array.isArray(old.evidence) ? old.evidence : []),
      { field: 'canonical_product_id', value: product.id, source: 'SCOPED_UNKNOWN_IDENTITY_REPAIR',
        previous_value: old.canonical_product_id }, ...next.evidence.filter(e => ['manufacturer', 'canonical_model'].includes(e.field))] };
}

export function buildUnknownIdentityRepair(db, { asOf = new Date().toISOString(), cohortAsOf = asOf } = {}) {
  const ledger = new PcPartsLedger({ db });
  const active = ledger.getActivePipelineVersion();
  if (!active) throw new Error('ACTIVE_PIPELINE_REQUIRED');
  const pipeline=new PcShadowPipeline({ledger});
  const reconcile=(previous,item,observedAt,promotion)=>{
    if(promotion.product.category!=='MOTHERBOARD')return null;
    const normalized=pipeline.normalizeItem({...item,observed_at:observedAt,
      seller_type:previous.market_pool==='KR_DEALER_USED'?'DEALER':undefined},observedAt,null,{reclassification:true}).normalized;
    return normalized.canonicalProductId===promotion.product.id?reconcileExactModelStatistics(previous,normalized,item.currency):null;
  };
  // Include the active publication's entire observation window as well as newer
  // observations; its as-of can precede the time this repair is performed.
  const cutoff = new Date(Math.min(Date.parse(asOf), Date.parse(cohortAsOf)) - 30 * 86400000).toISOString();
  const rows = db.prepare(`SELECT n.*, s.source_id, s.source_listing_id, s.price_value, s.currency,
      s.observed_at, s.lifecycle_status, r.title, r.description, r.raw_json
    FROM normalized_listings n JOIN listing_snapshots s ON s.id=n.snapshot_id
    JOIN raw_listings r ON r.id=s.raw_listing_id
    WHERE n.normalization_version=? AND n.parser_version=? AND n.rule_version=? AND n.filter_version=?
      AND s.observed_at>=? AND n.category_code IN ('SSD','HDD','MOTHERBOARD')
      AND (n.canonical_product_id LIKE '%:other-unclassified:capacity-bucket:%'
        OR n.canonical_product_id LIKE 'motherboard:platform:%') ORDER BY n.id`)
    .all(active.normalization_version, active.parser_version, active.rule_version, active.filter_version, cutoff);
  const normalizations = [];
  const scopes = new Map();
  const promotedProjections = new Set();
  for (const row of rows) {
    const item = { ...json(row.raw_json), site: row.source_id, title: row.title,
      description: row.description, price: row.price_value, currency: row.currency };
    const promotion = identityPromotion(row, item);
    if (!promotion) continue;
    const before = db.prepare('SELECT * FROM normalized_listings WHERE id=?').get(row.id);
    const children = db.prepare('SELECT * FROM listing_items WHERE normalized_listing_id=? ORDER BY item_index').all(row.id);
    if (children.length !== 1 || children[0].canonical_product_id !== before.canonical_product_id) continue;
    const { product, next } = promotion;
    const statistics=reconcile(before,{...item,status:row.lifecycle_status},row.observed_at,promotion);
    const after = { ...before, ...statistics, canonical_product_id: product.id, canonical_display_name: product.name,
      spec_group_id: next.spec_group_id, model_confidence: next.model_confidence,
      evidence_json: JSON.stringify(metadataPromotion({ canonical_product_id: before.canonical_product_id,
        evidence: json(before.evidence_json) }, promotion).evidence) };
    const child = children[0];
    const oldSpec = json(child.spec_json);
    const afterChild = { ...child, canonical_product_id: product.id,
      spec_json: JSON.stringify({ ...oldSpec, ...product.spec, exact_sku: product.spec.directory_node_type === 'PRODUCT' }) };
    normalizations.push({ before, after, beforeChild: child, afterChild,
      evidence_hash: digest(evidenceFields(row)), source_id: row.source_id, source_listing_id: row.source_listing_id });
    promotedProjections.add(projectionKey(row.source_id, item.url || item.item_url, row.title,
      row.price_value, row.currency, before.canonical_product_id, product.id));
    for (const canonical_product_id of [before.canonical_product_id, after.canonical_product_id]) {
      const scope = { canonical_product_id, market_pool: before.market_pool,
        condition_code: before.condition_code, currency: row.currency, days: 30 };
      scopes.set(JSON.stringify(scope), scope);
    }
  }
  const listings = [];
  for (const before of db.prepare(`SELECT * FROM listings WHERE pc_category_code IN ('SSD','HDD','MOTHERBOARD')
    AND (pc_canonical_product_id LIKE '%:other-unclassified:capacity-bucket:%'
      OR pc_canonical_product_id LIKE 'motherboard:platform:%') ORDER BY item_id`).all()) {
    const old = json(before.pc_metadata_json);
    const promotion = identityPromotion({ ...old, quantity: before.pc_quantity,
      canonical_product_id: before.pc_canonical_product_id, category_code: before.pc_category_code,
      price_eligible: before.pc_price_eligible }, { ...before, price: before.price_value });
    if (!promotion) continue;
    if (!promotedProjections.has(projectionKey(before.site, before.url, before.title,
      before.price_value, before.currency, before.pc_canonical_product_id, promotion.product.id))) continue;
    const statistics=reconcile({...old,category_code:before.pc_category_code,listing_kind:before.pc_listing_kind,
      condition_code:before.pc_condition_code,quantity:before.pc_quantity,price_scope:before.pc_price_scope,
      market_pool:before.pc_market_pool,price_eligible:before.pc_price_eligible,statistics_eligible:old.statistics_eligible?1:0,
      exclusion_reasons_json:JSON.stringify(old.exclusion_reasons||[]),statistics_exclusion_reasons_json:JSON.stringify(old.statistics_exclusion_reasons||[])},
      {...before,price:before.price_value,status:before.pc_lifecycle_status},before.last_checked_at,promotion);
    const after = { ...before, pc_canonical_product_id: promotion.product.id,
      pc_canonical_manufacturer: promotion.product.manufacturer,
      pc_metadata_json: JSON.stringify(metadataPromotion(old, promotion,statistics)) };
    listings.push({ before, after });
  }
  const plan = { format: 1, as_of: asOf, cutoff, active, normalizations, listings, scopes: [...scopes.values()] };
  return { ...plan, checksum: digest(plan) };
}

function updateRow(db, table, key, row) {
  const columns = Object.keys(row).filter(k => k !== key);
  db.prepare(`UPDATE ${table} SET ${columns.map(k => `${k}=?`).join(',')} WHERE ${key}=?`)
    .run(...columns.map(k => row[k]), row[key]);
}

export function applyUnknownIdentityRepair(db, plan) {
  const { checksum, ...contents } = plan;
  if (checksum !== digest(contents)) throw new Error('REPAIR_CHECKSUM_MISMATCH');
  const ledger = new PcPartsLedger({ db });
  db.exec('BEGIN IMMEDIATE');
  try {
    if (digest(ledger.getActivePipelineVersion()) !== digest(plan.active)) throw new Error('REPAIR_PIPELINE_CHANGED');
    for (const entry of plan.normalizations) {
      const current = db.prepare('SELECT * FROM normalized_listings WHERE id=?').get(entry.before.id);
      const child = db.prepare('SELECT * FROM listing_items WHERE id=?').get(entry.beforeChild.id);
      const raw = db.prepare('SELECT s.*, r.raw_json, r.title, r.description FROM listing_snapshots s JOIN raw_listings r ON r.id=s.raw_listing_id WHERE s.id=?').get(entry.before.snapshot_id);
      if (digest(current) !== digest(entry.before) || digest(child) !== digest(entry.beforeChild)
        || digest(evidenceFields(raw || {})) !== entry.evidence_hash) throw new Error('REPAIR_EVIDENCE_CHANGED');
      updateRow(db, 'normalized_listings', 'id', entry.after);
      updateRow(db, 'listing_items', 'id', entry.afterChild);
    }
    for (const entry of plan.listings) {
      if (digest(db.prepare('SELECT * FROM listings WHERE item_id=?').get(entry.before.item_id)) !== digest(entry.before))
        throw new Error('REPAIR_INDEX_CHANGED');
      // Source text, FTS, content hash, lifecycle and every observation timestamp
      // remain byte-for-byte unchanged. Only identity metadata is refreshed.
      db.prepare('UPDATE listings SET pc_canonical_product_id=?, pc_canonical_manufacturer=?, pc_metadata_json=? WHERE item_id=?')
        .run(entry.after.pc_canonical_product_id, entry.after.pc_canonical_manufacturer, entry.after.pc_metadata_json, entry.after.item_id);
    }
    db.exec('COMMIT');
  } catch (error) { db.exec('ROLLBACK'); throw error; }
}

async function idle() {
  const h = await fetch(`http://127.0.0.1:${process.env.RUNNER_PORT || 8787}/health`).then(r => r.json());
  if (!h.ok || h.active_run || h.pc_parts?.scheduler_enabled || h.pc_parts?.scheduler_active || h.pc_parts?.publication_active)
    throw new Error('REPAIR_REQUIRES_IDLE_RUNNER_AND_PAUSED_SCHEDULER');
}

async function main() {
  const mode = process.argv[2];
  const filename = process.argv[3];
  if (!['plan', 'apply', 'mirror'].includes(mode) || !filename || !process.env.RUNNER_INDEX_PATH)
    throw new Error('Usage: repair-pc-unknown-identities.mjs plan|apply|mirror /absolute/recovery-plan.json');
  await idle();
  const db = new DatabaseSync(process.env.RUNNER_INDEX_PATH, { readOnly: mode !== 'apply' });
  try {
    const cohort = mode === 'plan' ? latestCompletedPricePublication(db) : null;
    const plan = mode === 'plan' ? buildUnknownIdentityRepair(db, { cohortAsOf: cohort?.as_of }) : JSON.parse(readFileSync(filename, 'utf8'));
    const { checksum, ...contents } = plan;
    if (checksum !== digest(contents)) throw new Error('REPAIR_CHECKSUM_MISMATCH');
    if (mode === 'plan') writeFileSync(filename, JSON.stringify(plan), { flag: 'wx', mode: 0o600 });
    if (mode === 'apply') applyUnknownIdentityRepair(db, plan);
    if (mode === 'mirror') {
      const url = new URL(process.env.D1_IMPORT_URL);
      if (url.protocol !== 'https:' || url.hostname !== 'used-pick.com' || url.pathname !== '/admin/import-listings')
        throw new Error('REPAIR_MIRROR_TARGET_MISMATCH');
      const items = plan.listings.filter(e => e.after.active === 1).map(({ after }) => {
        if (db.prepare('SELECT pc_metadata_json FROM listings WHERE item_id=?').get(after.item_id)?.pc_metadata_json !== after.pc_metadata_json)
          throw new Error('REPAIR_NOT_APPLIED');
        return toPcProjectionImportItem({ ...after, ...json(after.pc_metadata_json),
          price: after.price_value, updated_at: after.last_seen_at });
      });
      for (let offset = 0; offset < items.length; offset += 200) {
        const batch = items.slice(offset, offset + 200);
        const response = await fetch(url, { method: 'POST', signal: AbortSignal.timeout(30000),
          headers: { authorization: `Bearer ${process.env.CLOUDFLARE_MANUAL_RUN_TOKEN || process.env.IMPORT_TOKEN}`, 'content-type': 'application/json' },
          body: JSON.stringify({ items: batch }) });
        const payload = await response.json(); const result = payload.data || payload;
        if (!response.ok || result.inserted !== batch.length || result.rejected !== 0 || result.retention_policy !== 'NON_DESTRUCTIVE')
          throw new Error('REPAIR_MIRROR_INTEGRITY_FAILURE');
      }
    }
    console.log(JSON.stringify({ mode, checksum: plan.checksum, snapshots: plan.normalizations.length,
      listings: plan.listings.length, scopes: plan.scopes.length,
      categories: Object.fromEntries(['SSD','HDD','MOTHERBOARD'].map(c => [c, plan.listings.filter(e => e.before.pc_category_code === c).length])) }));
  } finally { db.close(); }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
