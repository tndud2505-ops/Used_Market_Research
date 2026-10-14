import assert from 'node:assert/strict';
import { SearchIndex } from '../aws-runner/search-index.mjs';
import { PcPartsLedger } from '../aws-runner/pc-parts-ledger.mjs';
import { PcShadowPipeline } from '../aws-runner/pc-shadow-pipeline.mjs';
import { buildUnknownIdentityRepair, applyUnknownIdentityRepair, identityPromotion } from '../aws-runner/repair-pc-unknown-identities.mjs';

const index = new SearchIndex({ filePath: ':memory:' });
const db = index.db, ledger = new PcPartsLedger({ db });
ledger.migrate();
const pipeline = new PcShadowPipeline({ ledger }); await pipeline.initialize();
const observedAt = '2026-10-04T12:00:00.000Z';
for (const [i, title, unknown] of [
  [1, 'Micron SSD 512GB', 'ssd:other-unclassified:capacity-bucket:257-512-gb'],
  [2, 'ASUS PRIME B460M-A 메인보드', 'motherboard:platform:intel:asus'],
  [3, 'Samsung SSD 1TB', null]
]) {
  const item = pipeline.recordItem({ item_id: `bunjang:${i}`, source_listing_id: String(i), site: 'bunjang',
    title, price: 50000, currency: 'KRW', lifecycle_status: 'ACTIVE', url: `https://m.bunjang.co.kr/products/${i}` }, observedAt);
  index.upsertPublicProjections([item], { observedAt });
  if (unknown) {
    const n = db.prepare('SELECT id FROM normalized_listings ORDER BY id DESC LIMIT 1').get();
    db.prepare('UPDATE normalized_listings SET canonical_product_id=? WHERE id=?').run(unknown, n.id);
    db.prepare('UPDATE listing_items SET canonical_product_id=? WHERE normalized_listing_id=?').run(unknown, n.id);
    const row = db.prepare('SELECT * FROM listings WHERE item_id=?').get(`bunjang:${i}`);
    const metadata = { ...JSON.parse(row.pc_metadata_json), canonical_product_id: unknown };
    if (i === 2) {
      db.prepare("UPDATE normalized_listings SET exact_product=0, statistics_eligible=0, statistics_exclusion_reasons_json='[\"EXACT_MODEL_REQUIRED\"]' WHERE id=?").run(n.id);
      metadata.statistics_eligible = false;
      metadata.statistics_exclusion_reasons = ['EXACT_MODEL_REQUIRED'];
    }
    db.prepare('UPDATE listings SET pc_canonical_product_id=?, pc_metadata_json=? WHERE item_id=?').run(unknown, JSON.stringify(metadata), row.item_id);
  }
}
const dump = table => JSON.stringify(db.prepare(`SELECT * FROM ${table}`).all());
const before = dump('listings'), raw = dump('raw_listings'), snapshots = dump('listing_snapshots'), fts = dump('listing_fts');
const plan = buildUnknownIdentityRepair(db, { asOf: '2026-10-05T00:00:00.000Z' });
assert.equal(plan.normalizations.length, 2); assert.equal(plan.listings.length, 2);
assert.equal(dump('listings'), before, 'preview does not write');
const altered = structuredClone(plan); altered.listings[0].after.pc_price_eligible = 0;
assert.throws(() => applyUnknownIdentityRepair(db, altered), /CHECKSUM/);
db.prepare('UPDATE listings SET last_checked_at=? WHERE item_id=?').run('changed', plan.listings[1].before.item_id);
assert.throws(() => applyUnknownIdentityRepair(db, plan), /INDEX_CHANGED/);
assert.equal(db.prepare('SELECT canonical_product_id FROM normalized_listings WHERE id=?').get(plan.normalizations[0].before.id).canonical_product_id,
  plan.normalizations[0].before.canonical_product_id, 'stale evidence rolls back every preceding update');
db.prepare('UPDATE listings SET last_checked_at=? WHERE item_id=?').run(plan.listings[1].before.last_checked_at, plan.listings[1].before.item_id);
applyUnknownIdentityRepair(db, plan);
const exact = JSON.parse(db.prepare("SELECT pc_metadata_json FROM listings WHERE item_id='bunjang:2'").get().pc_metadata_json);
assert.equal(exact.statistics_eligible, true, 'confirmed exact identity clears its obsolete exclusion');
assert.deepEqual(exact.statistics_exclusion_reasons, []);
assert.equal(plan.normalizations.find(entry=>entry.after.category_code==='MOTHERBOARD').after.exact_product, 1);
assert.equal(dump('raw_listings'), raw); assert.equal(dump('listing_snapshots'), snapshots); assert.equal(dump('listing_fts'), fts);
for (const { before: old, after } of plan.listings) {
  assert.deepEqual({ ...db.prepare('SELECT * FROM listings WHERE item_id=?').get(old.item_id) }, after);
  for (const key of ['first_seen_at','last_seen_at','last_checked_at','inactive_at','active','content_hash','pc_price_eligible']) assert.equal(after[key], old[key]);
}
assert.equal(buildUnknownIdentityRepair(db, { asOf: plan.as_of }).normalizations.length, 0, 'identity repair is idempotent');
const old = plan.normalizations[0].before;
assert.equal(identityPromotion(old, { title: 'Micron SSD 2TB', price: 50000 }), null, 'capacity may not change');
assert.equal(identityPromotion(old, { title: 'Micron Samsung SSD 512GB', price: 50000 }), null, 'conflicting identity stays unknown');
assert.equal(identityPromotion(old, { title: 'Micron SSD 512GB 고장 부품용', price: 50000 }), null, 'condition may not change');
index.close();
console.log('PC unknown identity repair contract passed');
