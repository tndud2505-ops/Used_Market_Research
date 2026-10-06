import assert from 'node:assert/strict';
import { SearchIndex } from '../aws-runner/search-index.mjs';
import { PcPartsLedger } from '../aws-runner/pc-parts-ledger.mjs';
import { PcShadowPipeline } from '../aws-runner/pc-shadow-pipeline.mjs';
import { buildListingClassificationRepair, applyListingClassificationRepair } from '../aws-runner/repair-pc-listing-classification.mjs';

const index = new SearchIndex({ filePath: ':memory:' });
try {
  const db = index.db, ledger = new PcPartsLedger({ db }); ledger.migrate();
  const pipeline = new PcShadowPipeline({ ledger }); await pipeline.initialize();
  const observedAt = '2026-10-05T00:00:00.000Z';
  for (const [id, title, site] of [
    ['1', 'RTX 3060 12gb 구입합니다. 25만원', 'joonggonara'],
    ['2', '그래픽 카드 RX 560 4GB 128bit gddr5 Rx 560d VGA amd 시리즈 rx560 470 570 460 3060 RTX 중고', 'danawa'],
    ['3', 'RTX3060 12GB 판매합니다', 'bunjang']
  ]) {
    const url = site === 'danawa' ? 'https://prod.danawa.com/info/?pcode=2'
      : site === 'joonggonara' ? `https://web.joongna.com/product/${id}` : `https://m.bunjang.co.kr/products/${id}`;
    const item = pipeline.recordItem({ item_id: `${site}:${id}`, source_listing_id: site === 'joonggonara' ? url : id, site,
      title, price: 250000, currency: 'KRW', lifecycle_status: 'ACTIVE',
      seller_type: site === 'danawa' ? 'DEALER' : undefined,
      url }, observedAt);
    index.upsertPublicProjections([item], { observedAt });
    if (id !== '3') {
      const n = db.prepare('SELECT id FROM normalized_listings ORDER BY id DESC LIMIT 1').get();
      db.prepare(`UPDATE normalized_listings SET canonical_product_id='gpu:nvidia:rtx-3060',
        listing_kind='SINGLE_COMPONENT', listing_type='SINGLE', price_eligible=1,
        statistics_eligible=1, exclusion_reasons_json='[]', statistics_exclusion_reasons_json='[]' WHERE id=?`).run(n.id);
      db.prepare("UPDATE listing_items SET canonical_product_id='gpu:nvidia:rtx-3060' WHERE normalized_listing_id=?").run(n.id);
      const row = db.prepare('SELECT * FROM listings WHERE item_id=?').get(item.item_id);
      const metadata = { ...JSON.parse(row.pc_metadata_json), canonical_product_id: 'gpu:nvidia:rtx-3060',
        listing_kind: 'SINGLE_COMPONENT', listing_type: 'SINGLE', price_eligible: true, statistics_eligible: true,
        exclusion_reasons: [], statistics_exclusion_reasons: [] };
      db.prepare(`UPDATE listings SET pc_canonical_product_id='gpu:nvidia:rtx-3060',
        pc_listing_kind='SINGLE_COMPONENT', pc_price_eligible=1, pc_metadata_json=? WHERE item_id=?`)
        .run(JSON.stringify(metadata), item.item_id);
    }
  }
  const dump = table => JSON.stringify(db.prepare(`SELECT * FROM ${table}`).all());
  const raw = dump('raw_listings'), snapshots = dump('listing_snapshots'), fts = dump('listing_fts');
  const unchanged = db.prepare("SELECT * FROM listings WHERE item_id='bunjang:3'").get();
  const before = dump('listings');
  const ids = ['joonggonara:1', 'danawa:2'];
  const plan = buildListingClassificationRepair(db, ids, { asOf: '2026-10-06T00:00:00.000Z' });
  assert.equal(plan.listings.length, 2); assert.equal(plan.normalizations.length, 2);
  assert.equal(dump('listings'), before, 'preview writes nothing');
  const tampered = structuredClone(plan); tampered.listings[0].after.pc_price_eligible = 1;
  assert.throws(() => applyListingClassificationRepair(db, tampered), /CHECKSUM/);
  db.prepare("UPDATE listings SET last_checked_at='changed' WHERE item_id='danawa:2'").run();
  assert.throws(() => applyListingClassificationRepair(db, plan), /EVIDENCE_CHANGED/);
  assert.equal(db.prepare('SELECT listing_kind FROM normalized_listings WHERE id=?').get(plan.normalizations[0].before.id).listing_kind,
    'SINGLE_COMPONENT', 'drift cancels the entire transaction');
  db.prepare('UPDATE listings SET last_checked_at=? WHERE item_id=?').run(plan.listings[1].before.last_checked_at, 'danawa:2');
  applyListingClassificationRepair(db, plan);
  assert.equal(dump('raw_listings'), raw); assert.equal(dump('listing_snapshots'), snapshots); assert.equal(dump('listing_fts'), fts);
  assert.deepEqual(db.prepare("SELECT * FROM listings WHERE item_id='bunjang:3'").get(), unchanged);
  for (const { before: old, after } of plan.listings) {
    assert.deepEqual({ ...db.prepare('SELECT * FROM listings WHERE item_id=?').get(old.item_id) }, after);
    for (const key of ['first_seen_at', 'last_seen_at', 'last_checked_at', 'active', 'price_value', 'currency']) assert.equal(after[key], old[key]);
  }
  const wanted = db.prepare("SELECT * FROM listings WHERE item_id='joonggonara:1'").get();
  assert.equal(wanted.pc_listing_kind, 'WANTED'); assert.equal(wanted.pc_price_eligible, 0);
  const rx = db.prepare("SELECT * FROM listings WHERE item_id='danawa:2'").get();
  assert.equal(rx.pc_canonical_product_id, 'gpu:amd:rx-560'); assert.equal(rx.pc_price_eligible, 1, 'valid RX sample retained');
  assert.equal(buildListingClassificationRepair(db, ids, { asOf: plan.as_of }).listings.length, 0, 'fresh plan after apply is a no-op');
  console.log('PC scoped listing classification repair contract passed');
} finally { index.close(); }
