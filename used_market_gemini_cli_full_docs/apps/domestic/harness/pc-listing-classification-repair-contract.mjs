import assert from 'node:assert/strict';
import { SearchIndex } from '../aws-runner/search-index.mjs';
import { PcPartsLedger } from '../aws-runner/pc-parts-ledger.mjs';
import { PcShadowPipeline } from '../aws-runner/pc-shadow-pipeline.mjs';
import { buildListingClassificationRepair, applyListingClassificationRepair } from '../aws-runner/repair-pc-listing-classification.mjs';
import { reconcileExactModelStatistics } from '../aws-runner/pc-classification-consistency.mjs';

const index = new SearchIndex({ filePath: ':memory:' });
const hpSourceId = 'search_7b233f42d4f77df6e5f56430';
// Scoped recovery of reported accessories, systems, a bundle and an explicit
// manufacturer conflict. The source observations and monetary units are sealed.
{
  const recoveryIndex = new SearchIndex({filePath:':memory:'});
  try {
    const db = recoveryIndex.db, ledger = new PcPartsLedger({db}); ledger.migrate();
    const pipeline = new PcShadowPipeline({ledger}); await pipeline.initialize();
    const observedAt = '2026-10-23T00:00:00.000Z';
    const cases = [
      ['minipc','ASUS PB63 i7-13700 미니PC','CPU','cpu:intel:i7-13700','FULL_SYSTEM'],
      ['grampro','A급 엘지 그램프로 17zd90tr-ex79k rtx5050 급처','GPU','gpu:nvidia:rtx-5050','FULL_SYSTEM'],
      ['lightbar','기가바이트 AORUS GeForce RTX 3080 3080TI 3090 그래픽 카드한 중고 교체용 액세서리 라이트 바','GPU','gpu:nvidia:rtx-3080','ACCESSORY_ONLY'],
      ['nvlink','GeForce rtx 3090 호환 nvlink 4 slot 팝니다.','GPU','gpu:nvidia:rtx-3090','ACCESSORY_ONLY'],
      ['wanted','[구매/개인] RTX 3090 BLOWER 24GB','GPU','gpu:nvidia:rtx-3090','WANTED'],
      ['gram','LG그램 17인치 i7 17ZD90N-VX70K 인텔 SSD 512GB','SSD','ssd:intel:capacity-bucket:257-512-gb','FULL_SYSTEM'],
      ['pc','라이젠 7600X PC팝니다.','GPU','gpu:nvidia:rtx-3060-ti','FULL_SYSTEM'],
      ['allinone','32인치 고사양 올인원PC (rtx3060ti 배그가능)','GPU','gpu:nvidia:rtx-3060-ti','FULL_SYSTEM'],
      ['psu','썬루트 TX750 750W 브론즈 파워 서플라이','PSU','psu:corsair:watts-bucket:651-750','SINGLE_COMPONENT'],
      ['bundle','중고 12세대 인텔 코어 i7-12700K CPU와 QXZR M-ATX 마더보드 콤보 8코어12스레드 PCIe 2.0x8 통합 그래픽','CPU','cpu:intel:i7-12700k','COMPONENT_BUNDLE'],
      ['rx550-ssd','타무즈 RX550 SSD 240GB','GPU','gpu:amd:rx-550','SINGLE_COMPONENT'],
      ['rx550-ssd-480','컴퓨터 저장장치 2.5인치 SSD TAMMUZ RX550 480GB','GPU','gpu:amd:rx-550','SINGLE_COMPONENT']
    ];
    for (const [id,title,category,product] of cases) {
      const projection=pipeline.recordItem({site:'bunjang',item_id:`bunjang:${id}`,source_listing_id:id,
        url:`https://m.bunjang.co.kr/products/${id}`,title,price:350000,currency:'KRW',lifecycle_status:'ACTIVE'},observedAt);
      recoveryIndex.upsertPublicProjections([projection],{observedAt});
      const n=db.prepare('SELECT id FROM normalized_listings ORDER BY id DESC LIMIT 1').get();
      db.prepare("UPDATE normalized_listings SET category_code=?,canonical_product_id=?,listing_kind='SINGLE_COMPONENT',listing_type='SINGLE',price_scope='TOTAL',price_eligible=1,statistics_eligible=1,exact_product=1,exclusion_reasons_json='[]',statistics_exclusion_reasons_json='[]' WHERE id=?").run(category,product,n.id);
      db.prepare('DELETE FROM listing_items WHERE normalized_listing_id=? AND item_index<>0').run(n.id);
      db.prepare('UPDATE listing_items SET canonical_product_id=? WHERE normalized_listing_id=?').run(product,n.id);
      const row=db.prepare('SELECT * FROM listings WHERE item_id=?').get(`bunjang:${id}`);
      const meta={...JSON.parse(row.pc_metadata_json),category_code:category,canonical_product_id:product,
        listing_kind:'SINGLE_COMPONENT',listing_type:'SINGLE',price_scope:'TOTAL',price_eligible:true,
        statistics_eligible:true,statistics_exclusion_reasons:[],exclusion_reasons:[],
        components:[product,'psu:corsair:watts-bucket:le-500']};
      db.prepare("UPDATE listings SET pc_category_code=?,pc_canonical_product_id=?,pc_listing_kind='SINGLE_COMPONENT',pc_price_scope='TOTAL',pc_price_eligible=1,pc_metadata_json=? WHERE item_id=?").run(category,product,JSON.stringify(meta),row.item_id);
    }
    const raw=JSON.stringify(db.prepare('SELECT * FROM raw_listings').all());
    const snapshots=JSON.stringify(db.prepare('SELECT * FROM listing_snapshots').all());
    const plan=buildListingClassificationRepair(db,cases.map(([id])=>`bunjang:${id}`),{asOf:'2026-10-24T00:00:00.000Z'});
    assert.equal(plan.listings.length,cases.length);
    assert.equal(plan.normalizations.length,cases.length);
    for(const n of plan.normalizations) for(const key of ['unit_price','total_price'])
      assert.equal(n.afterChild[key],n.beforeChild[key],`classification correction preserves child ${key}`);
    applyListingClassificationRepair(db,plan);
    assert.equal(JSON.stringify(db.prepare('SELECT * FROM raw_listings').all()),raw);
    assert.equal(JSON.stringify(db.prepare('SELECT * FROM listing_snapshots').all()),snapshots);
    for(const [id,,category,product,kind] of cases){
      const entry=plan.listings.find(e=>e.after.item_id===`bunjang:${id}`);
      assert.equal(entry.after.pc_listing_kind,kind,id);
      for(const key of ['price_value','currency','pc_quantity','first_seen_at','last_seen_at','last_checked_at'])
        assert.equal(entry.after[key],entry.before[key],`${id} preserves ${key}`);
      if(id.startsWith('rx550-ssd')){
        const bucket=id==='rx550-ssd'?'le-256-gb':'257-512-gb';
        assert.equal(entry.after.pc_category_code,'SSD');
        assert.equal(entry.after.pc_canonical_product_id,`ssd:other-unclassified:capacity-bucket:${bucket}`);
        assert.equal(entry.after.pc_price_eligible,1,'SSD samples survive the scoped model correction');
        assert.equal(JSON.parse(entry.after.pc_metadata_json).statistics_eligible,true);
        const normalization=plan.normalizations.find(n=>n.before.canonical_product_id===product
          && n.after.canonical_product_id===entry.after.pc_canonical_product_id);
        assert.equal(normalization.after.statistics_eligible,1);
        assert.ok(plan.scopes.some(scope=>scope.canonical_product_id===product));
        assert.ok(plan.scopes.some(scope=>scope.canonical_product_id===entry.after.pc_canonical_product_id));
      }else if(id==='psu'){
        assert.equal(entry.after.pc_canonical_product_id,'psu:other-unclassified:watts-bucket:651-750');
        assert.equal(entry.after.pc_price_eligible,1,'the genuine PSU remains searchable in its unknown maker group');
        assert.equal(JSON.parse(entry.after.pc_metadata_json).statistics_eligible,true);
      }else{
        assert.equal(entry.after.pc_price_eligible,0,id);
        assert.equal(JSON.parse(entry.after.pc_metadata_json).statistics_eligible,false,id);
        if(kind!=='WANTED') assert.equal(entry.after.pc_canonical_product_id,null,id);
      }
      const components=JSON.parse(entry.after.pc_metadata_json).components;
      assert.ok(!components.includes('psu:corsair:watts-bucket:le-500'),'stale search associations are not copied from metadata');
      if(id==='minipc') assert.ok(components.includes('cpu:intel:i7-13700'),'the CPU named in the complete PC remains searchable');
      if(id==='pc') {
        assert.ok(components.includes('cpu:amd:ryzen-5-7600x'),'a corrected false GPU identity keeps the actual named CPU association');
        assert.ok(!components.some(id=>['gpu:nvidia:rtx-3060-ti','cpu:intel:i5-7600','cpu:amd:ryzen-5-7600'].includes(id)),
          'old identity, conflicting vendor and model substrings are not source-validated associations');
      }
      if(id==='bundle') assert.equal(entry.after.pc_price_scope,'BUNDLE');
    }
    const again=buildListingClassificationRepair(db,plan.item_ids,{asOf:plan.as_of});
    assert.equal(again.listings.length,0); assert.equal(again.normalizations.length,0);
  } finally { recoveryIndex.close(); }
}
// The same proven RX550 collision can survive in SOLD projections and affect
// the current statistics window. Never reactivate it or rewrite older evidence.
{
  const soldIndex = new SearchIndex({filePath:':memory:'});
  try {
    const db = soldIndex.db, ledger = new PcPartsLedger({db}); ledger.migrate();
    const pipeline = new PcShadowPipeline({ledger}); await pipeline.initialize();
    const oldProduct = 'gpu:amd:rx-550', asOf = '2026-10-30T00:00:00.000Z';
    const cases = [
      ['joonggonara','232325511','타무즈 RX550 PRO 1TB SSD','2026-09-22T00:00:00.000Z',false,'513-gb-1-tb'],
      ['bunjang','414934187','탐뮤즈(Tammuz) RX550 PRO 1TB SATA SSD 판매합니다','2026-09-16T00:00:00.000Z',true,'513-gb-1-tb'],
      ['bunjang','425549370','컴퓨터 저장장치 2.5인치 SSD TAMMUZ RX550 480GB','2026-10-04T00:00:00.000Z',true,'257-512-gb']
    ];
    const seed = (site, id, title, observedAt, statisticsEligible, {status='SOLD', product=oldProduct}={}) => {
      const projection = pipeline.recordItem({site,item_id:`${site}:${id}`,source_listing_id:id,
        url:site==='bunjang'?`https://m.bunjang.co.kr/products/${id}`:`https://web.joongna.com/product/${id}`,
        title,price:30000,currency:'KRW',lifecycle_status:status},observedAt);
      soldIndex.upsertPublicProjections([projection],{observedAt});
      const n = db.prepare('SELECT id FROM normalized_listings ORDER BY id DESC LIMIT 1').get();
      const reasons = statisticsEligible ? [] : ['ANOMALOUS_PRICE'];
      db.prepare(`UPDATE normalized_listings SET category_code='GPU',canonical_product_id=?,
        listing_kind='SINGLE_COMPONENT',listing_type='SINGLE',price_eligible=1,statistics_eligible=?,
        exact_product=1,exclusion_reasons_json='[]',statistics_exclusion_reasons_json=? WHERE id=?`)
        .run(product,statisticsEligible?1:0,JSON.stringify(reasons),n.id);
      db.prepare('UPDATE listing_items SET canonical_product_id=? WHERE normalized_listing_id=?').run(product,n.id);
      const row = db.prepare('SELECT * FROM listings WHERE item_id=?').get(projection.item_id);
      const metadata = {...JSON.parse(row.pc_metadata_json),category_code:'GPU',canonical_product_id:product,
        listing_kind:'SINGLE_COMPONENT',listing_type:'SINGLE',price_eligible:true,statistics_eligible:statisticsEligible,
        exclusion_reasons:[],statistics_exclusion_reasons:reasons};
      db.prepare(`UPDATE listings SET pc_category_code='GPU',pc_canonical_product_id=?,
        pc_listing_kind='SINGLE_COMPONENT',pc_price_eligible=1,pc_metadata_json=? WHERE item_id=?`)
        .run(product,JSON.stringify(metadata),row.item_id);
      return {itemId:row.item_id,normalizedId:n.id};
    };
    const targets = cases.map(([site,id,title,observedAt,eligible])=>seed(site,id,title,observedAt,eligible));
    for (const [id,title,options] of [
      ['actual-gpu','RX550 2GB',{}],
      ['other-product','타무즈 RX550 SSD 240GB',{product:'gpu:amd:rx-560'}],
      ['removed-ssd','타무즈 RX550 SSD 240GB',{status:'REMOVED'}]
    ]) {
      const target = seed('bunjang',id,title,'2026-10-04T00:00:00.000Z',true,options);
      assert.throws(()=>buildListingClassificationRepair(db,[target.itemId],{asOf}),
        /REPAIR_REQUIRES_CURRENT_ACTIVE_LISTING/, 'terminal permission remains RX550 SSD collision only');
    }
    const dump = table => JSON.stringify(db.prepare(`SELECT * FROM ${table}`).all());
    const sealed = Object.fromEntries(['raw_listings','listing_snapshots','listing_fts'].map(table=>[table,dump(table)]));
    const outsideWindow = targets.slice(0,2).map(({normalizedId})=>({
      normalization:{...db.prepare('SELECT * FROM normalized_listings WHERE id=?').get(normalizedId)},
      children:db.prepare('SELECT * FROM listing_items WHERE normalized_listing_id=?').all(normalizedId)
    }));
    const plan = buildListingClassificationRepair(db,targets.map(target=>target.itemId),{asOf});
    assert.equal(plan.listings.length,3);
    assert.equal(plan.normalizations.length,1,'only the SOLD observation inside the 30-day window changes');
    assert.equal(plan.normalizations[0].before.id,targets[2].normalizedId);
    assert.deepEqual([...new Set(plan.scopes.map(scope=>scope.canonical_product_id))].sort(),[
      oldProduct,'ssd:other-unclassified:capacity-bucket:257-512-gb',
      'ssd:other-unclassified:capacity-bucket:513-gb-1-tb'
    ].sort());
    assert.equal(plan.scopes.length,6);
    assert.ok(plan.scopes.every(scope=>scope.days===30 && scope.currency==='KRW'
      && scope.condition_code==='USED_WORKING' && ['KR_C2C_USED','KR_DOMESTIC_USED'].includes(scope.market_pool)));
    applyListingClassificationRepair(db,plan);
    for (const [table,before] of Object.entries(sealed)) assert.equal(dump(table),before,`${table} is unchanged`);
    for (let index=0;index<cases.length;index++) {
      const [,,,,eligible,bucket] = cases[index];
      const entry = plan.listings.find(entry=>entry.after.item_id===targets[index].itemId);
      const after = db.prepare('SELECT * FROM listings WHERE item_id=?').get(entry.after.item_id);
      assert.equal(after.active,0); assert.equal(after.pc_lifecycle_status,'SOLD');
      assert.equal(after.pc_category_code,'SSD');
      assert.equal(after.pc_canonical_product_id,`ssd:other-unclassified:capacity-bucket:${bucket}`);
      assert.equal(JSON.parse(after.pc_metadata_json).statistics_eligible,eligible);
      for (const key of ['active','inactive_at','pc_lifecycle_status','price_value','currency','pc_quantity',
        'pc_price_scope','first_seen_at','last_seen_at','last_checked_at'])
        assert.equal(after[key],entry.before[key],`SOLD correction preserves ${key}`);
    }
    for (const {normalization,children} of outsideWindow) {
      assert.deepEqual({...db.prepare('SELECT * FROM normalized_listings WHERE id=?').get(normalization.id)},normalization);
      assert.deepEqual(db.prepare('SELECT * FROM listing_items WHERE normalized_listing_id=?').all(normalization.id),children);
    }
    const again = buildListingClassificationRepair(db,plan.item_ids,{asOf});
    assert.equal(again.listings.length,0); assert.equal(again.normalizations.length,0);
    assert.equal(again.scopes.length,0,'a repeat SOLD preview is a no-op');
    const repaired = db.prepare('SELECT pc_metadata_json FROM listings WHERE item_id=?').get(targets[2].itemId);
    const unproven = {...JSON.parse(repaired.pc_metadata_json),evidence:[]};
    db.prepare('UPDATE listings SET pc_metadata_json=? WHERE item_id=?').run(JSON.stringify(unproven),targets[2].itemId);
    assert.throws(()=>buildListingClassificationRepair(db,[targets[2].itemId],{asOf}),
      /REPAIR_REQUIRES_CURRENT_ACTIVE_LISTING/, 'an arbitrary SOLD SSD does not acquire repair permission');
    console.log('SOLD RX550 SSD scoped repair passed; lifecycle, prices and older observations preserved');
  } finally { soldIndex.close(); }
}
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
    ['6', 'MSI H110M PRO-VD PLUS 메인보드', 'bunjang'],
    ['7', 'MSI H110M PRO-D 메인보드', 'bunjang'],
    ['8', 'MSI H110M PRO-D 메인보드', 'bunjang'],
    ['9', '[중고] [리퍼] 삼성전자 DB400S7B 슬림PC i3-6100 듀얼스토리지 Win11', 'danawa'],
    ['10', 'HP [중고] [리퍼] HP 마이크로타워 데스크탑 280 Pro G8 (i5-11400/8G/S256/윈11P)', 'danawa']
  ]) {
    const sourceId = id === '10' ? hpSourceId : id;
    const url = id === '10' ? 'https://prod.danawa.com/bridge/go_link_goods.php?cmpny_c=ED907&link_prod_c=2250624794'
      : site === 'danawa' ? `https://prod.danawa.com/info/?pcode=${id}`
      : site === 'joonggonara' ? `https://web.joongna.com/product/${id}` : `https://m.bunjang.co.kr/products/${id}`;
    const item = pipeline.recordItem({ item_id: `${site}:${sourceId}`, source_listing_id: id === '4' ? `${site}:${url}` : site === 'joonggonara' ? url : sourceId, site,
      title, price: id === '10' ? 569000 : 250000, currency: 'KRW', lifecycle_status: 'ACTIVE',
      seller_type: site === 'danawa' ? 'DEALER' : undefined,
      url }, observedAt);
    index.upsertPublicProjections([item], { observedAt });
    if (!['3', '6'].includes(id)) {
      const previousId = id === '4' ? 'hdd:hgst:capacity-bucket:gt-1-tb-le-2-tb'
        : id === '9' ? 'cpu:intel:i3-6100'
        : id === '10' ? 'cpu:intel:i5-11400'
        : id === '5' ? 'motherboard:platform:intel:msi'
        : ['7', '8'].includes(id) ? 'motherboard:msi:h110m-pro-d' : 'gpu:nvidia:rtx-3060';
      const statisticsEligible = ['1', '2', '9', '10'].includes(id);
      const statisticsReasons = id === '4' ? ['MARKET_SEGMENT_OUT_OF_SCOPE']
        : id === '8' ? ['EXACT_MODEL_REQUIRED', 'ANOMALOUS_PRICE']
        : ['5', '7'].includes(id) ? ['EXACT_MODEL_REQUIRED'] : [];
      const n = db.prepare('SELECT id FROM normalized_listings ORDER BY id DESC LIMIT 1').get();
      if (['9', '10'].includes(id)) db.prepare("UPDATE normalized_listings SET category_code='CPU', exact_product=1 WHERE id=?").run(n.id);
      if (['5','7','8'].includes(id)) db.prepare('UPDATE normalized_listings SET exact_product=0 WHERE id=?').run(n.id);
      db.prepare(`UPDATE normalized_listings SET canonical_product_id=?,
        listing_kind='SINGLE_COMPONENT', listing_type='SINGLE', price_eligible=1,
        statistics_eligible=?, exclusion_reasons_json='[]', statistics_exclusion_reasons_json=? WHERE id=?`)
        .run(previousId, statisticsEligible ? 1 : 0, JSON.stringify(statisticsReasons), n.id);
      db.prepare('UPDATE listing_items SET canonical_product_id=? WHERE normalized_listing_id=?').run(previousId, n.id);
      // Recreate the old CPU-only normalization, before the corrected system
      // classifier splits a desktop's recognized parts into separate children.
      if (id === '10') db.prepare('DELETE FROM listing_items WHERE normalized_listing_id=? AND item_index<>0').run(n.id);
      const row = db.prepare('SELECT * FROM listings WHERE item_id=?').get(item.item_id);
      const metadata = { ...JSON.parse(row.pc_metadata_json), canonical_product_id: previousId,
        listing_kind: 'SINGLE_COMPONENT', listing_type: 'SINGLE', price_eligible: true, statistics_eligible: statisticsEligible,
        exclusion_reasons: [], statistics_exclusion_reasons: statisticsReasons };
      db.prepare(`UPDATE listings SET pc_canonical_product_id=?,
        pc_listing_kind='SINGLE_COMPONENT', pc_price_eligible=1, pc_metadata_json=? WHERE item_id=?`)
        .run(previousId, JSON.stringify(metadata), item.item_id);
      if (['9', '10'].includes(id)) db.prepare("UPDATE listings SET pc_category_code='CPU' WHERE item_id=?").run(item.item_id);
    }
  }
  const dump = table => JSON.stringify(db.prepare(`SELECT * FROM ${table}`).all());
  const raw = dump('raw_listings'), snapshots = dump('listing_snapshots'), fts = dump('listing_fts');
  const unchanged = db.prepare("SELECT * FROM listings WHERE item_id='bunjang:3'").get();
  const sibling = db.prepare("SELECT * FROM listings WHERE item_id='bunjang:6'").get();
  const before = dump('listings');
  const ids = ['joonggonara:1', 'danawa:2', 'joonggonara:4', 'bunjang:5', 'bunjang:7', 'bunjang:8', 'danawa:9', `danawa:${hpSourceId}`];
  const plan = buildListingClassificationRepair(db, ids, { asOf: '2026-10-06T00:00:00.000Z' });
  assert.equal(plan.listings.length, 8); assert.equal(plan.normalizations.length, 8);
  assert.equal(dump('listings'), before, 'preview writes nothing');
  const tampered = structuredClone(plan); tampered.listings[0].after.pc_price_eligible = 1;
  assert.throws(() => applyListingClassificationRepair(db, tampered), /CHECKSUM/);
  db.prepare("UPDATE listings SET last_checked_at='changed' WHERE item_id='danawa:2'").run();
  assert.throws(() => applyListingClassificationRepair(db, plan), /EVIDENCE_CHANGED/);
  assert.equal(db.prepare('SELECT listing_kind FROM normalized_listings WHERE id=?').get(plan.normalizations[0].before.id).listing_kind,
    'SINGLE_COMPONENT', 'drift cancels the entire transaction');
  db.prepare('UPDATE listings SET last_checked_at=? WHERE item_id=?').run(plan.listings[1].before.last_checked_at, 'danawa:2');
  applyListingClassificationRepair(db, plan);
  assert.ok(plan.normalizations.filter(entry=>entry.after.category_code==='MOTHERBOARD').every(entry=>entry.after.exact_product===1), 'full exact proof updates the ledger aggregation identity flag');
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
    ['joonggonara:4', 'hdd:hgst:capacity-bucket:gt-1-tb-le-2-tb', 'HGST', []],
    ['bunjang:5', 'motherboard:msi:h110m-pro-d', 'MSI', []],
    ['bunjang:7', 'motherboard:msi:h110m-pro-d', 'MSI', []],
    ['bunjang:8', 'motherboard:msi:h110m-pro-d', 'MSI', ['ANOMALOUS_PRICE']]
  ]) {
    const row = db.prepare('SELECT * FROM listings WHERE item_id=?').get(id);
    const metadata = JSON.parse(row.pc_metadata_json);
    assert.equal(row.pc_canonical_product_id, product);
    assert.equal(row.pc_canonical_manufacturer, manufacturer);
    assert.equal(row.pc_price_eligible, 1, 'identity repair preserves search visibility');
    assert.equal(metadata.statistics_eligible, reasons.length === 0, 'only resolved exact-model exclusions are reinstated');
    assert.deepEqual(metadata.statistics_exclusion_reasons, reasons);
  }
  const pc = db.prepare("SELECT * FROM listings WHERE item_id='danawa:9'").get();
  assert.equal(pc.pc_listing_kind,'FULL_SYSTEM');
  assert.equal(pc.pc_canonical_product_id,null,'whole PC loses incorrect CPU identity');
  assert.equal(pc.pc_price_eligible,0);
  assert.equal(JSON.parse(pc.pc_metadata_json).statistics_eligible,false);
  const hp = db.prepare('SELECT * FROM listings WHERE item_id=?').get(`danawa:${hpSourceId}`);
  assert.equal(hp.pc_listing_kind, 'FULL_SYSTEM');
  assert.equal(hp.pc_canonical_product_id, null);
  assert.equal(hp.price_value, 569000, 'preserve whole-PC asking price as source evidence');
  assert.equal(JSON.parse(hp.pc_metadata_json).statistics_eligible, false);
  assert.deepEqual(plan.scopes.filter(scope => scope.canonical_product_id === 'cpu:intel:i5-11400')
    .map(scope => scope.market_pool).sort(), ['KR_DEALER_USED', 'KR_DOMESTIC_USED']);
  assert.equal(buildListingClassificationRepair(db, ids, { asOf: plan.as_of }).listings.length, 0, 'fresh plan after apply is a no-op');
  const previous = plan.normalizations.find(entry => entry.before.canonical_product_id === 'motherboard:msi:h110m-pro-d').before;
  const next = pipeline.normalizeItem({ site: 'bunjang', title: 'MSI H110M PRO-D 메인보드', price: 250000, currency: 'KRW' }, observedAt, null, { reclassification: true }).normalized;
  assert.equal(reconcileExactModelStatistics(previous, next, 'USD').statistics_eligible, 0, 'wrong currency cannot reinstate a sample');
  assert.equal(reconcileExactModelStatistics({...previous, canonical_product_id: 'motherboard:platform:amd:msi'}, next, 'KRW').statistics_eligible, 0, 'conflicting platform cannot reinstate a sample');
  index.limits.maxActiveListings = 1;
  db.prepare("UPDATE listings SET pc_category_code=NULL WHERE item_id='bunjang:7'").run();
  const visibleBeforeMaintenance = dump('listings');
  const execute = db.exec.bind(db);
  db.exec = sql => { assert.doesNotMatch(sql, /^\s*VACUUM\b/i, 'cache maintenance cannot compact the shared operational database'); return execute(sql); };
  index.maintenance({ pressure: true });
  assert.equal(dump('listings'), visibleBeforeMaintenance, 'cache pressure must not evict authoritative PC listings');
  assert.equal(dump('raw_listings'), raw, 'cache maintenance preserves raw identity evidence');
  console.log('PC scoped listing classification repair contract passed');
} finally { index.close(); }

// Wireless AX link-rate names must never contaminate Corsair PSU history.
const networkIndex = new SearchIndex({ filePath: ':memory:' });
try {
  const db = networkIndex.db, ledger = new PcPartsLedger({ db }); ledger.migrate();
  const pipeline = new PcShadowPipeline({ ledger }); await pipeline.initialize();
  const observedAt = '2026-10-05T00:00:00.000Z';
  const networkTitles = [
    'NEXTU AX5400 WiFi 6E USB 무선랜카드', 'NEXTU AX5400 WiFi 6E USB 무선랜카드',
    '티피링크 AX1800 하이 Wi-Fi6 USB 3.0 무선랜카드 판매합니다',
    'Wi-Fi 6 무선랜카드 (TP link AX3000)', 'ax58bt ax3000 무선랜카드', 'AX1800 무선 랜카드 팝니다',
  ];
  const oldId = 'psu:corsair:watts-bucket:gt-1200';
  for (const [offset, title] of networkTitles.entries()) {
    const id = `joonggonara:network-${offset}`;
    const item = pipeline.recordItem({ item_id: id, source_listing_id: id.split(':')[1], site: 'joonggonara', title,
      price: 35000, currency: 'KRW', lifecycle_status: 'ACTIVE', url: `https://web.joongna.com/product/network-${offset}` }, observedAt);
    networkIndex.upsertPublicProjections([item], { observedAt });
    const row = db.prepare('SELECT * FROM listings WHERE item_id=?').get(id);
    const metadata = { ...JSON.parse(row.pc_metadata_json), category_code: 'PSU', canonical_product_id: oldId,
      canonical_manufacturer: 'Corsair', price_eligible: true, statistics_eligible: true,
      exclusion_reasons: [], statistics_exclusion_reasons: [] };
    db.prepare(`UPDATE listings SET pc_category_code='PSU', pc_canonical_product_id=?, pc_canonical_manufacturer='Corsair',
      pc_price_eligible=1, pc_metadata_json=? WHERE item_id=?`).run(oldId, JSON.stringify(metadata), id);
    const n = db.prepare('SELECT id FROM normalized_listings ORDER BY id DESC LIMIT 1').get();
    db.prepare(`UPDATE normalized_listings SET category_code='PSU', canonical_product_id=?, exact_product=1,
      price_eligible=1, statistics_eligible=1, exclusion_reasons_json='[]', statistics_exclusion_reasons_json='[]' WHERE id=?`).run(oldId, n.id);
    db.prepare('UPDATE listing_items SET canonical_product_id=?, spec_json=? WHERE normalized_listing_id=?')
      .run(oldId, JSON.stringify({ rated_watts: 5400 }), n.id);
  }
  for (const title of ['Corsair AX1600i', 'Corsair AX1200i 1200W PSU', 'Corsair RM850x 850W', 'Corsair HX1200',
    'Corsair AX1600i 파워 무선랜카드 별도']) {
    const normalized = pipeline.normalizeItem({ title, site: 'ebay', price: 150, currency: 'USD',
      description: 'AX3000 무선랜카드와 함께 사용했습니다.' }, observedAt, null, { reclassification: true }).normalized;
    assert.equal(normalized.categoryCode, 'PSU', title);
    assert.ok(normalized.canonicalProductId?.startsWith('psu:corsair:'), title);
    assert.equal(normalized.statisticsEligible, true, title);
  }
  const dump = table => JSON.stringify(db.prepare(`SELECT * FROM ${table}`).all());
  const raw = dump('raw_listings'), snapshots = dump('listing_snapshots');
  const ids = networkTitles.map((_, offset) => `joonggonara:network-${offset}`);
  const plan = buildListingClassificationRepair(db, ids, { asOf: '2026-10-06T00:00:00.000Z' });
  assert.equal(plan.listings.length, 6); assert.equal(plan.normalizations.length, 6);
  assert.deepEqual(plan.scopes.map(s => [s.canonical_product_id, s.market_pool]),
    [[oldId, 'KR_C2C_USED'], [oldId, 'KR_DOMESTIC_USED']]);
  for (const entry of plan.normalizations) {
    assert.equal(entry.after.category_code, 'EXPANSION_CARD');
    assert.equal(entry.after.canonical_product_id, null);
    assert.equal(entry.after.statistics_eligible, 0);
    assert.equal(entry.after.exact_product, 0);
    assert.equal(JSON.parse(entry.afterChild.spec_json).rated_watts, undefined);
  }
  applyListingClassificationRepair(db, plan);
  assert.equal(dump('raw_listings'), raw); assert.equal(dump('listing_snapshots'), snapshots);
  for (const { before, after } of plan.listings) {
    assert.equal(after.pc_category_code, 'EXPANSION_CARD');
    assert.equal(after.pc_canonical_product_id, null); assert.equal(after.pc_canonical_manufacturer, null);
    for (const key of ['price_value', 'currency', 'first_seen_at', 'last_seen_at', 'last_checked_at', 'pc_quantity', 'pc_price_scope', 'pc_condition_code']) {
      assert.equal(after[key], before[key], `${before.item_id}: preserve ${key}`);
    }
  }
  assert.equal(buildListingClassificationRepair(db, ids, { asOf: plan.as_of }).normalizations.length, 0);
  console.log('AX wireless-card scoped repair passed; genuine Corsair PSU samples preserved');
} finally { networkIndex.close(); }

// Correct only proven sale units and whole-device identities; retain evidence.
const saleIndex = new SearchIndex({ filePath: ':memory:' });
try {
  const db = saleIndex.db, ledger = new PcPartsLedger({ db }); ledger.migrate();
  const pipeline = new PcShadowPipeline({ ledger }); await pipeline.initialize();
  const observedAt = '2026-10-14T00:00:00.000Z';
  const ramId = 'ram:samsung:ddr3:8gb', hddId = 'hdd:other-unclassified:capacity-bucket:le-1-tb';
  const fixtures = [
    ['ram-set', '삼성 DDR3 8GB PC3-12800 2개1세트', 40000, ramId, 'RAM'],
    ['camcorder', 'JVC Victor Everio HDD 빈티지 캠코더 GZ-HD30-S [HDD 80GB]', 270000, hddId, 'HDD']
  ];
  for (const [id,title,price,oldId,category] of fixtures) {
    const input = {site:'bunjang',item_id:`bunjang:${id}`,source_listing_id:id,
      title,price,currency:'KRW',lifecycle_status:'ACTIVE',url:`https://m.bunjang.co.kr/products/${id}`};
    let item = pipeline.recordItem(input, id === 'camcorder' ? '2026-07-01T00:00:00.000Z' : observedAt);
    if (id === 'camcorder') item = pipeline.recordItem(input, observedAt);
    saleIndex.upsertPublicProjections([item],{observedAt});
    const row = db.prepare('SELECT * FROM listings WHERE item_id=?').get(item.item_id);
    const metadata = {...JSON.parse(row.pc_metadata_json), category_code:category, canonical_product_id:oldId,
      listing_kind:'SINGLE_COMPONENT',listing_type:'SINGLE',quantity:1,price_scope:'TOTAL',
      price_eligible:true,statistics_eligible:true,exclusion_reasons:[],statistics_exclusion_reasons:[]};
    db.prepare(`UPDATE listings SET pc_category_code=?,pc_canonical_product_id=?,pc_quantity=1,
      pc_listing_kind='SINGLE_COMPONENT',pc_price_scope='TOTAL',pc_price_eligible=1,pc_metadata_json=? WHERE item_id=?`)
      .run(category,oldId,JSON.stringify(metadata),item.item_id);
    const n = db.prepare('SELECT id FROM normalized_listings ORDER BY id DESC LIMIT 1').get();
    db.prepare(`UPDATE normalized_listings SET category_code=?,canonical_product_id=?,quantity=1,price_scope='TOTAL',
      listing_kind='SINGLE_COMPONENT',listing_type='SINGLE',price_eligible=1,statistics_eligible=1,exact_product=1,
      exclusion_reasons_json='[]',statistics_exclusion_reasons_json='[]' WHERE id=?`).run(category,oldId,n.id);
    db.prepare('UPDATE listing_items SET canonical_product_id=?,quantity=1,unit_price=?,total_price=? WHERE normalized_listing_id=?')
      .run(oldId,price,price,n.id);
  }
  const dump = table => JSON.stringify(db.prepare(`SELECT * FROM ${table}`).all());
  const raw=dump('raw_listings'), snapshots=dump('listing_snapshots'), fts=dump('listing_fts');
  const ids=fixtures.map(f=>`bunjang:${f[0]}`);
  const plan=buildListingClassificationRepair(db,ids,{asOf:'2026-10-15T00:00:00.000Z'});
  assert.equal(plan.listings.length,2); assert.equal(plan.normalizations.length,2); assert.equal(plan.scopes.length,4);
  assert.equal(db.prepare("SELECT MIN(observed_at) date FROM listing_snapshots WHERE source_listing_id='camcorder'").get().date,
    '2026-07-01T00:00:00.000Z', 'recently seen old snapshots must participate in scoped repair');
  const ram=plan.normalizations.find(e=>e.before.category_code==='RAM');
  assert.equal(ram.after.quantity,2); assert.equal(ram.after.statistics_eligible,1);
  assert.equal(ram.afterChild.quantity,2); assert.equal(ram.afterChild.unit_price,20000); assert.equal(ram.afterChild.total_price,40000);
  const cam=plan.normalizations.find(e=>e.before.category_code==='HDD');
  assert.equal(cam.after.canonical_product_id,null); assert.equal(cam.after.statistics_eligible,0); assert.equal(cam.after.exact_product,0);
  applyListingClassificationRepair(db,plan);
  assert.equal(dump('raw_listings'),raw); assert.equal(dump('listing_snapshots'),snapshots); assert.equal(dump('listing_fts'),fts);
  for(const {before,after} of plan.listings) {
    assert.deepEqual({...db.prepare('SELECT * FROM listings WHERE item_id=?').get(after.item_id)},after);
    for(const key of ['price_value','currency','first_seen_at','last_seen_at','last_checked_at','active']) assert.equal(after[key],before[key]);
  }
  assert.equal(buildListingClassificationRepair(db,ids,{asOf:plan.as_of}).normalizations.length,0);
  const storedRam=db.prepare("SELECT * FROM listings WHERE item_id='bunjang:ram-set'").get();
  assert.equal(storedRam.pc_quantity,2); assert.equal(storedRam.pc_price_scope,'TOTAL');
  assert.equal(JSON.parse(storedRam.pc_metadata_json).quantity,2);
  assert.equal(db.prepare('SELECT quantity FROM normalized_listings WHERE id=?').get(ram.after.id).quantity,2);
  const storedItem=db.prepare('SELECT quantity,unit_price,total_price FROM listing_items WHERE id=?').get(ram.afterChild.id);
  assert.deepEqual({...storedItem},{quantity:2,unit_price:20000,total_price:40000});
  for(const title of ['삼성 DDR3 8GB PC3-12800 2개1세트','삼성 DDR3 8GB 2개 1세트','삼성 DDR3 8GB 2장 한세트']) {
    const n=pipeline.normalizeItem({site:'bunjang',title,price:40000,currency:'KRW'},observedAt,null,{reclassification:true}).normalized;
    assert.equal(n.quantity,2,title); assert.equal(n.unitPrice,20000,title); assert.equal(n.statisticsEligible,true,title);
  }
  const unit=pipeline.normalizeItem({site:'bunjang',title:'삼성 DDR3 8GB 2개1세트 개당 20000원',price:20000,currency:'KRW'},observedAt,null,{reclassification:true}).normalized;
  assert.equal(unit.priceScope,'UNIT'); assert.equal(unit.unitPrice,20000);
  const remaining=pipeline.normalizeItem({site:'bunjang',title:'삼성 DDR3 8GB 2개1세트 중 1개 판매완료',price:20000,currency:'KRW'},observedAt,null,{reclassification:true}).normalized;
  assert.equal(remaining.quantity,1); assert.equal(remaining.priceScope,'UNIT'); assert.equal(remaining.unitPrice,20000);
  for(const title of ['WD Blue 1TB HDD SATA 3.5-inch','캠코더에서 분리한 HDD 80GB','캠코더용 HDD 80GB',
    'HDD 80GB 캠코더 호환', '캠코더 호환 HDD 80GB','1TB SATA HDD for JVC GZ-HD30-S camcorder']) {
    const n=pipeline.normalizeItem({site:'bunjang',title,price:30000,currency:'KRW'},observedAt,null,{reclassification:true}).normalized;
    assert.equal(n.categoryCode,'HDD',title); assert.equal(n.statisticsEligible,true,title);
  }
  const camera=pipeline.normalizeItem({site:'danawa',title:fixtures[1][1],price:270000,currency:'KRW',
    requested_category_code:'HDD',source_category_code:'1:5'},observedAt,null,{reclassification:true}).normalized;
  assert.equal(camera.canonicalProductId,null); assert.equal(camera.statisticsEligible,false);
  console.log('RAM set quantity and camcorder scoped repair passed; valid components preserved');
  for (const suffix of ['2개1세트', '2개1세트판매', '2개1세트팝니다', '2개1세트일괄']) {
    const n = pipeline.normalizeItem({site:'bunjang',title:`삼성 DDR3 8GB PC3-12800 ${suffix}`,price:40000,currency:'KRW'},
      observedAt,null,{reclassification:true}).normalized;
    assert.equal(n.quantity,2); assert.equal(n.unitPrice,20000); assert.equal(n.statisticsEligible,true);
  }
} finally { saleIndex.close(); }

// Exact public originals reported on Nov 3. Raw observations use the published
// version tuple; eBay's raw key differs from its numeric public listing ID.
{
  const reportedIndex = new SearchIndex({filePath:':memory:'});
  try {
    const db = reportedIndex.db, ledger = new PcPartsLedger({db}); ledger.migrate();
    const pipeline = new PcShadowPipeline({ledger}); await pipeline.initialize();
    db.prepare(`UPDATE pc_pipeline_versions SET normalization_version=19,parser_version='pc-parser-v8',
      rule_version='pc-rules-v19',filter_version='pc-filter-v7' WHERE version_status='ACTIVE'`).run();
    const observedAt = '2026-11-03T13:00:00.000Z', asOf = '2026-11-03T14:00:00.000Z';
    const cpu = 'cpu:intel:i7-14700k', psu = 'psu:corsair:watts-bucket:le-500';
    const rtx = 'gpu:nvidia:rtx-3060', arc = 'gpu:intel:arc-a750';
    const network = 'expansion:facet:network:tp-link';
    const cases = [
      ['ebay:287268659686','USED BOX 4 Intel Core i7-14700K NO CPU INCLUDED REPEAT BOX ONLY "SOLO CAJA"',21,'CPU',cpu,'BOX_ONLY',null,
        {currency:'USD',description:'Used',sourceId:'v1|287268659686|0',raw:{requested_category_code:'CPU',source_category_code:'164'}}],
      ['joonggonara:233677071','TP-LINK TX401 10기가비트 랜카드',30000,'PSU',psu,'SINGLE_COMPONENT',network],
      ['joonggonara:232427903','TP-LINK 티피링크 TX401 유선랜카드 PCI-e 10Gbps',40000,'PSU',psu,'SINGLE_COMPONENT',network],
      ['joonggonara:233447966','TPLINK TX201 2.5G 랜카드',10000,'PSU',psu,'SINGLE_COMPONENT',network],
      ['joonggonara:232373121','10기가비트 랜카드 티피링크 TX401',25000,'PSU',psu,'SINGLE_COMPONENT',null],
      ['joonggonara:209638789','[TP-LINK] 티피링크 TX201 [유선랜카드/PCI-E/2.5Gbps] 팝니다. - 2.5G 랜카드',10000,'PSU',psu,'SINGLE_COMPONENT',network],
      ['joonggonara:232178790','ACER (SF314-42) 4500U 16G/120GB 14인치 노트북 (윈도우11정품포함)',230000,'PSU',psu,'FULL_SYSTEM',null,
        {reasons:['MARKET_SEGMENT_OUT_OF_SCOPE']}],
      ['joonggonara:232286629','레노버 LEGION Pro 7 16IAX10 U9 5090 Edition W11 (SSD 1TB)',7450000,'GPU','gpu:nvidia:rtx-5090','FULL_SYSTEM',null],
      ['joonggonara:233105220','인텔 그래픽카드 arc750 3060급',190000,'GPU',rtx,'SINGLE_COMPONENT',arc]
    ];
    const seed = ([itemId,title,price,category,product,,,options={}]) => {
      const [site,publicId] = itemId.split(':'), sourceId = options.sourceId || publicId;
      const input = {site,item_id:itemId,source_listing_id:sourceId,title,description:options.description ?? null,
        price,currency:options.currency || 'KRW',lifecycle_status:'ACTIVE',
        url:site==='ebay'?`https://www.ebay.com/itm/${publicId}`:`https://web.joongna.com/product/${publicId}`,...options.raw};
      const projection = pipeline.recordItem(input,observedAt);
      reportedIndex.upsertPublicProjections([projection],{observedAt});
      const normalization = db.prepare('SELECT id FROM normalized_listings ORDER BY id DESC LIMIT 1').get();
      const reasons = options.reasons || [], eligible = reasons.length===0 ? 1 : 0;
      db.prepare(`UPDATE normalized_listings SET category_code=?,canonical_product_id=?,listing_kind='SINGLE_COMPONENT',
        listing_type='SINGLE',quantity=1,price_scope='TOTAL',price_eligible=1,statistics_eligible=?,exact_product=1,
        exclusion_reasons_json='[]',statistics_exclusion_reasons_json=? WHERE id=?`)
        .run(category,product,eligible,JSON.stringify(reasons),normalization.id);
      db.prepare('DELETE FROM listing_items WHERE normalized_listing_id=? AND item_index<>0').run(normalization.id);
      db.prepare('UPDATE listing_items SET canonical_product_id=?,quantity=1,unit_price=?,total_price=? WHERE normalized_listing_id=?')
        .run(product,price,price,normalization.id);
      const row = db.prepare('SELECT * FROM listings WHERE item_id=?').get(itemId);
      const metadata = {...JSON.parse(row.pc_metadata_json),category_code:category,canonical_product_id:product,
        canonical_manufacturer:category==='PSU'?'Corsair':category==='CPU'?'Intel':null,
        listing_kind:'SINGLE_COMPONENT',listing_type:'SINGLE',quantity:1,price_scope:'TOTAL',price_eligible:true,
        statistics_eligible:Boolean(eligible),statistics_exclusion_reasons:reasons,exclusion_reasons:[],components:[product]};
      db.prepare(`UPDATE listings SET pc_category_code=?,pc_canonical_product_id=?,pc_canonical_manufacturer=?,
        pc_listing_kind='SINGLE_COMPONENT',pc_quantity=1,pc_price_scope='TOTAL',pc_price_eligible=1,pc_metadata_json=? WHERE item_id=?`)
        .run(category,product,metadata.canonical_manufacturer,JSON.stringify(metadata),itemId);
      return {itemId,normalizedId:normalization.id};
    };
    const targets = cases.map(seed);
    const neighbors = [
      ['ebay:820297964192','Intel Core I7-14700K 14th Gen Unlocked Processor LGA1700',290,'CPU',cpu,null,null,{currency:'USD',description:'Used'}],
      ['joonggonara:233757430','RTX 3060 12GB 그래픽카드',330000,'GPU',rtx],
      ['joonggonara:real-corsair','Corsair CX450 450W PSU',45000,'PSU',psu],
      ['ebay:2872686596860',cases[0][1],21,'CPU',cpu,null,null,{currency:'USD',description:'Used',sourceId:'v1|2872686596860|0'}],
      ['ebay:variation-neighbor',cases[0][1],21,'CPU',cpu,null,null,{currency:'USD',description:'Used',sourceId:'v1|287268659686|1'}]
    ].map(seed);
    const dump = table => JSON.stringify(db.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all());
    const sealed = Object.fromEntries(['raw_listings','listing_snapshots','listing_fts'].map(table=>[table,dump(table)]));
    const neighborState = ({itemId,normalizedId}) => ({
      listing:db.prepare('SELECT * FROM listings WHERE item_id=?').get(itemId),
      normalization:db.prepare('SELECT * FROM normalized_listings WHERE id=?').get(normalizedId),
      children:db.prepare('SELECT * FROM listing_items WHERE normalized_listing_id=? ORDER BY item_index').all(normalizedId)
    });
    const untouched = neighbors.map(neighborState), before = dump('listings');
    const ids = targets.map(target=>target.itemId);
    const plan = buildListingClassificationRepair(db,ids,{asOf});
    assert.equal(dump('listings'),before,'reported repair preview writes nothing');
    assert.equal(plan.listings.length,cases.length); assert.equal(plan.normalizations.length,cases.length);
    assert.deepEqual(plan.normalizations.map(entry=>entry.before.id),targets.map(target=>target.normalizedId));
    assert.equal(plan.active.normalization_version,19); assert.equal(plan.active.parser_version,'pc-parser-v8');
    assert.equal(plan.active.rule_version,'pc-rules-v19'); assert.equal(plan.active.filter_version,'pc-filter-v7');
    assert.equal(db.prepare('SELECT source_listing_id FROM listing_snapshots WHERE id=?')
      .get(plan.normalizations[0].before.snapshot_id).source_listing_id,'v1|287268659686|0','exact eBay raw observation participates');
    // Identity-bearing corrections retain the original condition guard.
    db.prepare("UPDATE listings SET pc_condition_code='UNKNOWN' WHERE item_id=?").run(cases.at(-1)[0]);
    assert.throws(()=>buildListingClassificationRepair(db,[cases.at(-1)[0]],{asOf}),/SEMANTICS_CHANGED/);
    db.prepare("UPDATE listings SET pc_condition_code='USED_WORKING' WHERE item_id=?").run(cases.at(-1)[0]);
    db.prepare('UPDATE listings SET pc_canonical_product_id=? WHERE item_id=?').run('psu:seasonic:watts-bucket:le-500',cases[1][0]);
    assert.throws(()=>buildListingClassificationRepair(db,[cases[1][0]],{asOf}),/SEMANTICS_CHANGED/,'network exception remains Corsair-only');
    db.prepare('UPDATE listings SET pc_canonical_product_id=? WHERE item_id=?').run(psu,cases[1][0]);
    applyListingClassificationRepair(db,plan);
    for (const [table,original] of Object.entries(sealed)) assert.equal(dump(table),original,`${table} retains all source evidence and lifecycle`);
    assert.deepEqual(neighbors.map(neighborState),untouched,'genuine parts, adjacent numeric IDs and other eBay variations stay untouched');
    for (const [itemId,,,,,kind,product] of cases) {
      const entry = plan.listings.find(entry=>entry.after.item_id===itemId), after = entry.after;
      const normalization = plan.normalizations.find(entry=>entry.before.id===targets.find(target=>target.itemId===itemId).normalizedId);
      assert.deepEqual({...db.prepare('SELECT * FROM listings WHERE item_id=?').get(itemId)},after);
      assert.equal(after.pc_listing_kind,kind); assert.equal(after.pc_canonical_product_id,product);
      assert.equal(normalization.after.listing_kind,kind); assert.equal(normalization.after.canonical_product_id,product);
      const category = kind==='BOX_ONLY'?'ACCESSORY':kind==='FULL_SYSTEM'?'SYSTEM':itemId===cases.at(-1)[0]?'GPU':'EXPANSION_CARD';
      assert.equal(after.pc_category_code,category); assert.equal(normalization.after.category_code,category);
      const metadata = JSON.parse(after.pc_metadata_json), prior = JSON.parse(entry.before.pc_metadata_json);
      assert.deepEqual(metadata.evidence.slice(0,prior.evidence.length),prior.evidence,'original classification evidence remains intact');
      assert.equal(metadata.statistics_eligible,product===arc); assert.equal(normalization.after.statistics_eligible,product===arc?1:0);
      assert.equal(normalization.after.exact_product,product===arc?1:0);
      if(kind==='FULL_SYSTEM') {
        assert.ok(!metadata.components.includes(psu),'configured systems do not retain a false Corsair component');
        if(itemId==='joonggonara:232178790') assert.ok(!metadata.components.includes('cpu:amd:ryzen-5-4500'),
          'the laptop 4500U does not validate the desktop Ryzen 4500 alias');
        if(itemId==='joonggonara:232286629') assert.ok(metadata.components.includes('gpu:nvidia:rtx-5090'),
          'the GPU named in LEGION Pro 7 remains a search association, never a component price');
      }else assert.deepEqual(metadata.components,[],'single components and packaging do not inherit stale composite associations');
      assert.equal(after.pc_price_eligible,product?1:0,'network facets and the genuine Arc retain search eligibility');
      for (const key of ['title','description','price_value','currency','pc_quantity','pc_price_scope','pc_condition_code',
        'pc_market_pool','active','inactive_at','pc_lifecycle_status','first_seen_at','last_seen_at','last_checked_at'])
        assert.equal(after[key],entry.before[key],`${itemId} preserves ${key}`);
      for (const key of ['quantity','price_scope','condition_code','market_pool','snapshot_id','normalization_version','parser_version','rule_version','filter_version'])
        assert.equal(normalization.after[key],normalization.before[key],`${itemId} preserves normalization ${key}`);
      for (const key of ['quantity','unit_price','total_price']) assert.equal(normalization.afterChild[key],normalization.beforeChild[key]);
      if (product===arc) assert.equal(metadata.chip_manufacturer,'Intel');
    }
    const scopedProducts = new Set([cpu,psu,rtx,arc,network,'gpu:nvidia:rtx-5090']);
    assert.ok(plan.scopes.every(scope=>scopedProducts.has(scope.canonical_product_id)&&scope.days===30));
    assert.deepEqual(new Set(plan.scopes.map(scope=>scope.canonical_product_id)),scopedProducts);
    const again = buildListingClassificationRepair(db,ids,{asOf});
    assert.equal(again.listings.length,0); assert.equal(again.normalizations.length,0); assert.equal(again.scopes.length,0);
    console.log('Nov 3 exact scoped repair passed, including eBay v1 identity; neighbors, raw evidence, amounts and lifecycle preserved');
  } finally { reportedIndex.close(); }
}
