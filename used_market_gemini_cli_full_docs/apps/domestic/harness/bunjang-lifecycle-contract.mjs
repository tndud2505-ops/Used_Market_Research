import assert from "node:assert/strict";
import { readFileSync } from 'node:fs';
import { DatabaseSync } from "node:sqlite";
import { PcPartsLedger } from "../aws-runner/pc-parts-ledger.mjs";
import { bunjangLifecycleStatus, bunjangProductIdFromListing, parseBunjangDetailLifecycle, bunjangDetailObservationItem } from "../market/logic/bunjang-lifecycle.mjs";
import { PcShadowPipeline } from '../aws-runner/pc-shadow-pipeline.mjs';
import { classifyPcPartListingPublic } from '../market/logic/pc-parts-classifier.mjs';

for (const [input, expected] of [[0, "ACTIVE"], [1, "RESERVED"], [2, "DELETED"],
  [3, "SOLD"], ["SOLD_OUT", "SOLD"], ["SELLING", "ACTIVE"], [undefined, "UNAVAILABLE_UNKNOWN"]]) {
  assert.equal(bunjangLifecycleStatus(input), expected);
}
assert.throws(() => parseBunjangDetailLifecycle({ data: { product: { pid: 2, saleStatus: "SOLD_OUT" } } }, "1"), /IDENTITY_MISMATCH/);
assert.throws(() => parseBunjangDetailLifecycle({ data: { shopProducts: [{ pid: 1, saleStatus: "SOLD_OUT" }] } }, "1"), /IDENTITY_MISMATCH/);
const sold = parseBunjangDetailLifecycle({ data: { product: { pid: 1, saleStatus: "SOLD_OUT", price: 30000 } } }, "1");
assert.equal(sold.status, "SOLD");
assert.equal(sold.price, 30000);
assert.deepEqual(sold.evidence, { type: "STRUCTURED_STATUS", value: "SOLD" });
assert.equal(bunjangProductIdFromListing({ url: "https://m.bunjang.co.kr/products/123456789" }), "123456789");
assert.equal(bunjangProductIdFromListing({
  url: "https://m.bunjang.co.kr/products/[PHONE]",
  sourceListingId: "bunjang:https://m.bunjang.co.kr/products/162044325"
}), "162044325", "legacy redaction must not strand a recoverable Bunjang listing");
assert.equal(bunjangProductIdFromListing({
  url: "https://m.bunjang.co.kr/products/[PHONE]", sourceListingId: "173480704"
}), "173480704", "a masked URL must use the stable numeric ledger ID without unmasking personal data");
assert.equal(bunjangProductIdFromListing({
  url: "https://m.bunjang.co.kr/products/[PHONE]", sourceListingId: "[PHONE]"
}), null, "masked or arbitrary text is not product identity");
assert.equal(bunjangProductIdFromListing({ url: "https://example.test/products/invalid" }), null);
assert.equal(bunjangProductIdFromListing({ url: '', sourceListingId: '173480704' }), '173480704');
const runnerSource = readFileSync(new URL('../aws-runner/runner.mjs', import.meta.url), 'utf8');
const recheckSource = runnerSource.slice(runnerSource.indexOf('async function recheckKnownListings('));
assert.match(recheckSource,/applyLifecycleProjection\(projection\);\s*\/\/[^\n]*\n\s*await yieldToEventLoop\(\)/u,
  'Completed lifecycle projection batches must yield to HTTP requests');
assert.ok(recheckSource.indexOf('const pid = bunjangProductIdFromListing') < recheckSource.indexOf('if (!/^https?:'),
  'numeric Bunjang identity recovery must run before the generic HTML URL gate');
// Execute the real loop with isolated I/O: a later abort must not lose an already verified SOLD projection.
const aborter = new AbortController(), applied = [], mirrored = [], receipts = [];
let detailCalls=0;
const isolatedLoop = new Function('pcLedger','pcPipeline','searchIndex','fetch','throwIfAborted','boundedFetchSignal',
  'bunjangProductIdFromListing','parseBunjangDetailLifecycle','bunjangDetailObservationItem','yieldToEventLoop',
  'stabilizeIncrementalPcProjections','importToD1BestEffort',
  `return (${recheckSource.slice(0,recheckSource.indexOf('function pcSourceAdapter(')).trim()})`)(
  {getLifecycleRun:()=>null,dueRechecks:()=>[1,2].map(id=>({source_listing_id:String(id),raw_json:JSON.stringify({url:`https://m.bunjang.co.kr/products/${id}`}),title:'CPU',price_value:10000,currency:'KRW'})),
    deferLifecycleAttempt:()=>{},getPublicProjection:()=>({status:'SOLD'}),recordLifecycleRun:(_source,receipt)=>receipts.push(receipt)},
  {recordItem:()=>({_pc_snapshot_created:true})},{applyLifecycleProjection:p=>applied.push(p)},
  async()=>{if(++detailCalls===1)return new Response(JSON.stringify({data:{product:{pid:1,saleStatus:'SOLD_OUT',price:10000}}}));aborter.abort(new Error('fixture abort'));throw aborter.signal.reason;},
  signal=>signal?.throwIfAborted(), signal=>signal,
  bunjangProductIdFromListing,parseBunjangDetailLifecycle,bunjangDetailObservationItem,async()=>{},rows=>rows,async rows=>mirrored.push(...rows));
await assert.rejects(isolatedLoop('bunjang',new Date().toISOString(),aborter.signal),/fixture abort/);
assert.equal(applied.length,1);assert.equal(mirrored.length,1);
assert.equal(receipts[0].stop_reason,'ABORTED');assert.equal(receipts[0].sold,1);
const db = new DatabaseSync(":memory:");
for (const [description,condition] of [
  ['정상 작동. 택배 거래시 파손면책 동의 간주. 채굴 이력 없어요.','USED_WORKING'],
  ['채굴 이력은 없습니다. 채굴 경험이 없습니다. 채굴한 적은 없어요.','USED_WORKING'],
  ['파손된 고장품. 택배 거래시 파손면책 동의.','DEFECTIVE'],
  ['채굴 이력 있습니다. 택배 거래시 파손면책 동의.','USED_MINING']
]) {
  const item=classifyPcPartListingPublic({site:'bunjang',title:'GTX 980',description,price:50000,currency:'KRW',status:'ACTIVE'});
  assert.equal(item.condition_group,condition);
  assert.equal(item.statistics_eligible,condition==='USED_WORKING');
}
const ledger = new PcPartsLedger({ db });
ledger.migrate();
ledger.upsertSource({ sourceId: "bunjang", displayName: "Bunjang", marketPool: "KR_C2C_USED", policyStatus: "APPROVED", runtimeStatus: "ENABLED" });
const observation = { sourceId: "bunjang", sourceListingId: "1", title: "RTX 3080",
  currency: "KRW", price: 30000, status: "ACTIVE", rawPayload: { url: "https://m.bunjang.co.kr/products/1" },
  statusEvidence: { type: "STRUCTURED_STATUS", value: "ACTIVE" } };
ledger.recordObservation({ ...observation, observedAt: "2026-09-01T00:00:00Z" });
ledger.recordObservation({ ...observation, price: 29000, observedAt: "2026-09-02T00:00:00Z" });
ledger.compactStorage({ asOf: "2026-09-14T00:00:00Z", observationRetentionDays: 1, pruneObservationDetails: true });
assert.equal(db.prepare("SELECT count(*) n FROM listing_snapshots").get().n, 1);
assert.equal(ledger.dueRechecks({ sourceId: "bunjang", checkedBefore: "2026-09-14T00:00:00Z", limit: 1500 }).length, 1);
const dueStatus = ledger.lifecycleRecheckStatus({ sourceId: "bunjang", asOf: "2026-09-14T00:00:00Z" });
assert.equal(dueStatus.due_count, 1);
assert.equal(dueStatus.oldest_last_checked_at, "2026-09-02T00:00:00.000Z");
assert.equal(dueStatus.oldest_age_seconds, 12 * 24 * 60 * 60);
assert.equal(dueStatus.operational_sla_hours, 24);
assert.equal(dueStatus.operational_overdue_count, 1);
assert.equal(dueStatus.oldest_operational_overdue_at, "2026-09-02T00:00:00.000Z");
const result = ledger.recordObservation({ ...observation, price: sold.price, status: sold.status,
  statusEvidence: sold.evidence, observedAt: "2026-09-14T01:00:00Z" });
assert.equal(result.soldLastAskPrice, 29000, "compacted history retains the last asking price for a later sale");
assert.equal(ledger.dueRechecks({ sourceId: "bunjang", checkedBefore: "2026-09-15T00:00:00Z", limit: 1500 }).length, 0);
assert.equal(ledger.lifecycleRecheckStatus({ sourceId: "bunjang", asOf: "2026-09-15T00:00:00Z" }).due_count, 0,
  "terminal sold listings must leave the lifecycle recheck backlog");
assert.equal(ledger.recordObservation({ ...observation, status: sold.status, statusEvidence: sold.evidence,
  observedAt: "2026-09-14T02:00:00Z" }).snapshotCreated, false, "repeat sale observations are not counted twice");
for (const [id, finalStatus] of [['2', 'ACTIVE'], ['3', 'RESERVED'], ['4', 'DELETED'], ['5', 'UNAVAILABLE_UNKNOWN']]) {
  ledger.recordObservation({ ...observation, sourceListingId: id, observedAt: '2026-09-14T00:00:00Z' });
  ledger.recordObservation({ ...observation, sourceListingId: id, price: 31000, status: finalStatus,
    statusEvidence: { type: 'STRUCTURED_STATUS', value: finalStatus }, observedAt: '2026-09-14T00:00:00Z' });
}
const oldDueIds = db.prepare(`SELECT s.source_listing_id FROM listing_snapshots s
  JOIN raw_listings r ON r.id=s.raw_listing_id WHERE s.source_id='bunjang'
  AND s.lifecycle_status IN ('ACTIVE','RESERVED','UNAVAILABLE_UNKNOWN')
  AND r.last_checked_at <= '2026-09-15T00:00:00.000Z'
  AND NOT EXISTS (SELECT 1 FROM listing_snapshots newer WHERE newer.source_id=s.source_id
    AND newer.source_listing_id=s.source_listing_id AND (newer.observed_at>s.observed_at
      OR (newer.observed_at=s.observed_at AND newer.id>s.id)))
  ORDER BY CASE WHEN r.missing_check_count>0 THEN 0 ELSE 1 END,r.last_checked_at,s.source_listing_id`).all().map(row=>row.source_listing_id);
assert.deepEqual(ledger.dueRechecks({sourceId:'bunjang',checkedBefore:'2026-09-15T00:00:00Z',limit:1500})
  .map(row=>row.source_listing_id),oldDueIds,'index-first query preserves latest snapshot and equal-time tie-break membership');
assert.equal(ledger.lifecycleRecheckStatus({sourceId:'bunjang',asOf:'2026-09-16T00:00:00Z'}).due_count,oldDueIds.length);
ledger.deferLifecycleAttempt('bunjang','2',{at:'2026-09-16T00:00:00.000Z',delayMs:86400000,outcome:'NETWORK_ERROR'});
assert.ok(!ledger.dueRechecks({sourceId:'bunjang',checkedBefore:'2026-09-16',asOf:'2026-09-16T01:00:00Z'}).some(r=>r.source_listing_id==='2'));
assert.equal(ledger.lifecycleRecheckStatus({sourceId:'bunjang',asOf:'2026-09-16T01:00:00Z'}).deferred_count,1);
ledger.recordObservation({...observation,sourceListingId:'2',price:31000,observedAt:'2026-09-16T02:00:00Z'});
db.prepare("UPDATE pc_lifecycle_queue SET next_attempt_at='2026-09-16T08:00:00.000Z' WHERE source_listing_id='3'").run();
assert.equal(ledger.dueRechecks({sourceId:'bunjang',checkedBefore:'2026-09-16T03:00:00Z',asOf:'2026-09-16T09:00:00Z'})
  .map(r=>r.source_listing_id).indexOf('3') < ledger.dueRechecks({sourceId:'bunjang',checkedBefore:'2026-09-16T03:00:00Z',asOf:'2026-09-16T09:00:00Z'})
  .map(r=>r.source_listing_id).indexOf('2'),true,'eligible 24h-overdue checks precede ordinary refresh even after an error retry');
assert.ok(ledger.dueRechecks({sourceId:'bunjang',checkedBefore:'2026-09-16T03:00:00Z',asOf:'2026-09-16T09:00:00Z'}).some(r=>r.source_listing_id==='2'), 'verified observation releases old error backoff');
ledger.recordLifecycleRun('bunjang',{status:'PARTIAL',stop_reason:'HTTP_429'},'2026-09-17T00:00:00.000Z');
assert.equal(ledger.dueRechecks({sourceId:'bunjang',checkedBefore:'2026-09-16',asOf:'2026-09-16T09:00:00Z'}).length,0);
assert.equal(ledger.getLifecycleRun('bunjang').stop_reason,'HTTP_429');
// Simulate an old DB upgrade; new observations during bounded bootstrap must win.
const beforeHistory = db.prepare('SELECT count(*) n FROM listing_snapshots').get().n;
db.exec(`DROP TRIGGER pc_lifecycle_snapshot_insert; DROP TRIGGER pc_lifecycle_raw_check; DROP TRIGGER pc_lifecycle_snapshot_delete;
  DROP TABLE pc_lifecycle_queue; DROP TABLE pc_lifecycle_bootstrap; DROP TABLE pc_lifecycle_runs;`);
ledger.migrate();
assert.equal(ledger.lifecycleRecheckStatus({sourceId:'bunjang'}).status,'INITIALIZING');
assert.throws(()=>ledger.dueRechecks({sourceId:'bunjang'}),/INITIALIZING/);
ledger.bootstrapLifecycleQueue(1);
ledger.recordObservation({...observation,sourceListingId:'2',price:32000,observedAt:'2026-09-17T00:00:00Z'});
ledger.recordObservation({...observation,sourceListingId:'z-new-after-fence',observedAt:'2026-09-17T00:00:00Z'});
let pages=0;
while (!ledger.bootstrapLifecycleQueue(1).ready) assert.ok(++pages<20);
assert.equal(db.prepare('SELECT snapshot_id FROM pc_lifecycle_queue WHERE source_listing_id=?').get('2').snapshot_id,ledger.latestSnapshot('bunjang','2').id);
assert.ok(db.prepare("SELECT 1 FROM pc_lifecycle_queue WHERE source_listing_id='z-new-after-fence'").get());
assert.equal(db.prepare('SELECT count(*) n FROM listing_snapshots').get().n,beforeHistory+2,'bootstrap preserves history');
assert.equal(db.prepare('SELECT count(*) n FROM pc_lifecycle_queue').get().n,6);
const latestTwo=ledger.latestSnapshot('bunjang','2').id;
db.prepare('DELETE FROM listing_snapshots WHERE id=?').run(latestTwo);
assert.equal(db.prepare("SELECT snapshot_id FROM pc_lifecycle_queue WHERE source_id='bunjang' AND source_listing_id='2'").get().snapshot_id,
  ledger.latestSnapshot('bunjang','2').id,'removing current snapshot safely falls back instead of losing the identity');
db.close();

const bodyDb = new DatabaseSync(':memory:');
const bodyLedger = new PcPartsLedger({ db: bodyDb });
bodyLedger.migrate();
const pipeline = new PcShadowPipeline({ ledger: bodyLedger });
await pipeline.initialize();
const base = { site: 'bunjang', title: 'GTX 980', currency: 'KRW', price: 90000,
  source_listing_id: '20001', url: 'https://m.bunjang.co.kr/products/20001', status: 'ACTIVE' };
const first = pipeline.recordItem(base, '2026-09-09T00:00:00Z');
assert.equal(first.statistics_eligible, true);
for (const id of ['20002','20003','20004','20005','20006']) {
  pipeline.recordItem({ ...base, source_listing_id: id, url: `https://m.bunjang.co.kr/products/${id}`,
    price: 50000, description: '그래픽카드 단품 판매' }, '2026-09-10T00:00:00Z');
}
const scopes = { canonicalProductId: first.canonical_product_id, marketPool: 'KR_C2C_USED',
  condition: 'USED_WORKING', currency: 'KRW', days: 30, asOf: '2026-09-12T00:00:00Z' };
for (const status of ['ACTIVE', 'SOLD']) {
  if (status === 'SOLD') pipeline.recordItem({ ...base, status }, '2026-09-10T01:00:00Z');
  const detail = parseBunjangDetailLifecycle({ data: { product: { pid: 20001, saleStatus: status,
    price: 90000, description: 'GTX 980 그래픽카드와 DDR4 16GB 메모리 일괄 판매. 연락 010-1234-5678' } } }, '20001');
  const item = bunjangDetailObservationItem({ source_listing_id: base.source_listing_id, title: base.title,
    currency: 'KRW', price_value: 90000 }, base, detail, base.url);
  const reviewed = pipeline.recordItem(item, status === 'ACTIVE' ? '2026-09-10T00:30:00Z' : '2026-09-10T02:00:00Z');
  assert.equal(reviewed.statistics_eligible, false, 'Verified body must change statistics eligibility');
  assert.equal(reviewed.price_eligible, true, 'Body-only bundle remains browsable');
  assert.equal(reviewed.price, 90000);
  const projection = bodyLedger.getPublicProjection('bunjang', base.source_listing_id);
  assert.equal(projection.statistics_eligible, false);
  assert.ok(!projection.description.includes('010-1234-5678'), 'Stored detail is redacted');
  const stats = bodyLedger.rebuildAndGetPriceStats(scopes);
  assert.equal(stats.active.sample_count, 5);
  assert.equal(stats.active.mean, 50000);
  assert.equal(stats.sold.sample_count, 0, 'Current body exclusion removes older sold membership');
  assert.ok(stats.daily.every((day) => day.active.max == null || day.active.max === 50000),
    'Verified bundle body also removes earlier daily asking-price membership');
  const repeated = pipeline.recordItem({ ...base, status, description: null }, '2026-09-11T00:00:00Z');
  assert.equal(repeated.statistics_eligible, false, 'Search refresh must retain verified body');
}
// A sold listing can be reviewed after its first sale without counting another sale.
const late = { ...base, source_listing_id: '30001', url: 'https://m.bunjang.co.kr/products/30001', status: 'SOLD' };
pipeline.recordItem(late, '2026-09-10T03:00:00Z');
const lateReview = pipeline.recordItem({ ...late, description: 'GTX 980과 DDR4 16GB 메모리 일괄 판매' }, '2026-09-10T04:00:00Z');
assert.equal(lateReview._pc_snapshot_created, true);
assert.equal(lateReview.statistics_eligible, false);
assert.equal(bodyLedger.rebuildAndGetPriceStats(scopes).sold.sample_count, 0);
const identical = pipeline.recordItem({ ...late, description: 'GTX 980과 DDR4 16GB 메모리 일괄 판매' }, '2026-09-11T04:00:00Z');
assert.equal(identical._pc_snapshot_created, false, 'Identical sold-body checks stay idempotent');
const clearable = { ...base, source_listing_id: '30002', url: 'https://m.bunjang.co.kr/products/30002' };
pipeline.recordItem({ ...clearable, description: 'GTX 980과 DDR4 16GB 메모리 일괄 판매' }, '2026-09-10T05:00:00Z');
const clearedDetail = parseBunjangDetailLifecycle({data:{product:{pid:30002,saleStatus:'ACTIVE',price:90000,description:''}}},'30002');
const cleared = pipeline.recordItem(bunjangDetailObservationItem({source_listing_id:'30002',title:'GTX 980',currency:'KRW',price_value:90000},clearable,clearedDetail,clearable.url),'2026-09-10T06:00:00Z');
assert.equal(cleared.description, '');
assert.equal(cleared.statistics_eligible, true, 'Verified empty detail must clear the old bundle text');
assert.equal(pipeline.recordItem({...clearable,description:null},'2026-09-11T06:00:00Z').statistics_eligible,true);
pipeline.recordItem({ ...base, source_listing_id:'30003',url:'https://m.bunjang.co.kr/products/30003',
  description:'PC 본체 i7-6700 CPU DDR4 16GB RAM SSD 256GB 판매 연락 010-1234-5678' },'2026-09-10T07:00:00Z');
assert.ok(!bodyDb.prepare('SELECT evidence_json FROM normalized_listings WHERE snapshot_id=(SELECT MAX(id) FROM listing_snapshots)').get().evidence_json.includes('010-1234-5678'), 'Detailed classification evidence is redacted too');
const removed = { ...base, source_listing_id:'30004',url:'https://m.bunjang.co.kr/products/30004',
  price:60000,description:'그래픽카드 단품 판매' };
pipeline.recordItem(removed,'2026-09-10T08:00:00Z');
pipeline.recordItem({...removed,status:'DELETED'},'2026-09-11T08:00:00Z');
bodyLedger.rebuildAndGetPriceStats(scopes);
assert.equal(bodyDb.prepare(`SELECT COUNT(*) AS n FROM daily_price_stat_members m
  JOIN listing_snapshots s ON s.id=m.snapshot_id WHERE s.source_listing_id='30004' AND m.member_role='ACTIVE'`).get().n,1,
  'A deleted single-component listing does not remove normal historical asking prices');
bodyDb.close();
console.log("Bunjang lifecycle contract passed");
