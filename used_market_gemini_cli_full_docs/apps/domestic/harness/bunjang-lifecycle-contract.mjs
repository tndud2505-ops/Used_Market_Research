import assert from "node:assert/strict";
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
assert.equal(bunjangProductIdFromListing({ url: "https://example.test/products/invalid" }), null);
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
