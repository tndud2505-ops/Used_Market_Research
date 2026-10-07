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
    ['3', 'RTX3060 12GB 판매합니다', 'bunjang'],
    ['4', 'HGST 2TB 기업용 SATA HDD HUS724020ALA640', 'joonggonara'],
    ['5', 'H110M PRO-D(소켓:1151,스카이,카비레이크,6~7세대)MSI 메인보드', 'bunjang'],
    ['6', 'MSI H110M PRO-VD PLUS 메인보드', 'bunjang']
  ]) {
    const url = site === 'danawa' ? 'https://prod.danawa.com/info/?pcode=2'
      : site === 'joonggonara' ? `https://web.joongna.com/product/${id}` : `https://m.bunjang.co.kr/products/${id}`;
    const item = pipeline.recordItem({ item_id: `${site}:${id}`, source_listing_id: site === 'joonggonara' ? url : id, site,
      title, price: 250000, currency: 'KRW', lifecycle_status: 'ACTIVE',
      seller_type: site === 'danawa' ? 'DEALER' : undefined,
      url }, observedAt);
    index.upsertPublicProjections([item], { observedAt });
    if (!['3', '6'].includes(id)) {
      const previousId = id === '4' ? 'hdd:other-unclassified:capacity-bucket:gt-1-tb-le-2-tb'
        : id === '5' ? 'motherboard:platform:intel:msi' : 'gpu:nvidia:rtx-3060';
      const statisticsEligible = ['1', '2'].includes(id);
      const statisticsReasons = id === '4' ? ['MARKET_SEGMENT_OUT_OF_SCOPE']
        : id === '5' ? ['EXACT_MODEL_REQUIRED'] : [];
      const n = db.prepare('SELECT id FROM normalized_listings ORDER BY id DESC LIMIT 1').get();
      db.prepare(`UPDATE normalized_listings SET canonical_product_id=?,
        listing_kind='SINGLE_COMPONENT', listing_type='SINGLE', price_eligible=1,
        statistics_eligible=?, exclusion_reasons_json='[]', statistics_exclusion_reasons_json=? WHERE id=?`)
        .run(previousId, statisticsEligible ? 1 : 0, JSON.stringify(statisticsReasons), n.id);
      db.prepare('UPDATE listing_items SET canonical_product_id=? WHERE normalized_listing_id=?').run(previousId, n.id);
      const row = db.prepare('SELECT * FROM listings WHERE item_id=?').get(item.item_id);
      const metadata = { ...JSON.parse(row.pc_metadata_json), canonical_product_id: previousId,
        listing_kind: 'SINGLE_COMPONENT', listing_type: 'SINGLE', price_eligible: true, statistics_eligible: statisticsEligible,
        exclusion_reasons: [], statistics_exclusion_reasons: statisticsReasons };
      db.prepare(`UPDATE listings SET pc_canonical_product_id=?,
        pc_listing_kind='SINGLE_COMPONENT', pc_price_eligible=1, pc_metadata_json=? WHERE item_id=?`)
        .run(previousId, JSON.stringify(metadata), item.item_id);
    }
  }
  const dump = table => JSON.stringify(db.prepare(`SELECT * FROM ${table}`).all());
  const raw = dump('raw_listings'), snapshots = dump('listing_snapshots'), fts = dump('listing_fts');
  const unchanged = db.prepare("SELECT * FROM listings WHERE item_id='bunjang:3'").get();
  const sibling = db.prepare("SELECT * FROM listings WHERE item_id='bunjang:6'").get();
  const before = dump('listings');
  const ids = ['joonggonara:1', 'danawa:2', 'joonggonara:4', 'bunjang:5'];
  const plan = buildListingClassificationRepair(db, ids, { asOf: '2026-10-06T00:00:00.000Z' });
  assert.equal(plan.listings.length, 4); assert.equal(plan.normalizations.length, 4);
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
  assert.deepEqual(db.prepare("SELECT * FROM listings WHERE item_id='bunjang:6'").get(), sibling, 'PRO-VD PLUS remains its own unresolved model');
  for (const { before: old, after } of plan.listings) {
    assert.deepEqual({ ...db.prepare('SELECT * FROM listings WHERE item_id=?').get(old.item_id) }, after);
    for (const key of ['first_seen_at', 'last_seen_at', 'last_checked_at', 'active', 'price_value', 'currency']) assert.equal(after[key], old[key]);
  }
  const wanted = db.prepare("SELECT * FROM listings WHERE item_id='joonggonara:1'").get();
  assert.equal(wanted.pc_listing_kind, 'WANTED'); assert.equal(wanted.pc_price_eligible, 0);
  const rx = db.prepare("SELECT * FROM listings WHERE item_id='danawa:2'").get();
  assert.equal(rx.pc_canonical_product_id, 'gpu:amd:rx-560'); assert.equal(rx.pc_price_eligible, 1, 'valid RX sample retained');
  for (const [id, product, manufacturer, reasons] of [
    ['joonggonara:4', 'hdd:hgst:capacity-bucket:gt-1-tb-le-2-tb', 'HGST', ['MARKET_SEGMENT_OUT_OF_SCOPE']],
    ['bunjang:5', 'motherboard:msi:h110m-pro-d', 'MSI', ['EXACT_MODEL_REQUIRED']]
  ]) {
    const row = db.prepare('SELECT * FROM listings WHERE item_id=?').get(id);
    const metadata = JSON.parse(row.pc_metadata_json);
    assert.equal(row.pc_canonical_product_id, product);
    assert.equal(row.pc_canonical_manufacturer, manufacturer);
    assert.equal(row.pc_price_eligible, 1, 'identity repair preserves search visibility');
    assert.equal(metadata.statistics_eligible, false, 'identity repair does not reinstate excluded samples');
    assert.deepEqual(metadata.statistics_exclusion_reasons, reasons);
  }
  assert.equal(buildListingClassificationRepair(db, ids, { asOf: plan.as_of }).listings.length, 0, 'fresh plan after apply is a no-op');
  console.log('PC scoped listing classification repair contract passed');
} finally { index.close(); }
