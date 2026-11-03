import assert from "node:assert/strict";
import { readFileSync } from 'node:fs';
import { DatabaseSync } from "node:sqlite";
import { PcPartsLedger } from "../aws-runner/pc-parts-ledger.mjs";
import { bunjangLifecycleStatus, bunjangProductIdFromListing, parseBunjangDetailLifecycle, bunjangDetailObservationItem } from "../market/logic/bunjang-lifecycle.mjs";
import { PcShadowPipeline } from '../aws-runner/pc-shadow-pipeline.mjs';
import { classifyPcPartListingPublic } from '../market/logic/pc-parts-classifier.mjs';
import { runLifecycleBatch, pacedLifecycleFetch, lifecycleRecheckEnabled } from '../aws-runner/lifecycle-batch.mjs';
import { recordBunjangSearchWindows } from '../aws-runner/lifecycle-queue.mjs';
import './lifecycle-batch-contract.mjs';
import './search-status-observations-contract.mjs';

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
const isolatedFactory = new Function('pcLedger','pcPipeline','searchIndex','fetch','throwIfAborted','boundedFetchSignal',
  'bunjangProductIdFromListing','parseBunjangDetailLifecycle','bunjangDetailObservationItem','yieldToEventLoop',
  'stabilizeIncrementalPcProjections','importToD1BestEffort','runLifecycleBatch','pacedLifecycleFetch','lifecycleRecheckEnabled = () => true',
  `return (${recheckSource.slice(0,recheckSource.indexOf('function pcSourceAdapter(')).trim()})`);
// The real production policy must return before touching any queue or I/O.
const disabledLoop=isolatedFactory(...Array(14).fill(undefined),lifecycleRecheckEnabled);
assert.deepEqual(await disabledLoop('bunjang',new Date().toISOString(),new AbortController().signal),[]);
// Retain the old parser/write-integrity scenarios with an isolated test-only
// admission function; this does not enable Bunjang requests in production.
const isolatedLoop = isolatedFactory(
  {getLifecycleRun:()=>null,dueRechecks:()=>[1,2].map(id=>({source_listing_id:String(id),raw_json:JSON.stringify({url:`https://m.bunjang.co.kr/products/${id}`}),title:'CPU',price_value:10000,currency:'KRW'})),
    deferLifecycleAttempt:()=>{},getPublicProjection:()=>({status:'SOLD'}),recordLifecycleRun:(_source,receipt)=>receipts.push(receipt)},
  {recordItem:()=>({_pc_snapshot_created:true})},{applyLifecycleProjection:p=>applied.push(p)},
  async()=>{if(++detailCalls===1)return new Response(JSON.stringify({data:{product:{pid:1,saleStatus:'SOLD_OUT',price:10000}}}));aborter.abort(new Error('fixture abort'));throw aborter.signal.reason;},
  signal=>signal?.throwIfAborted(), signal=>signal,
  bunjangProductIdFromListing,parseBunjangDetailLifecycle,bunjangDetailObservationItem,async()=>{},rows=>rows,async rows=>mirrored.push(...rows),
  runLifecycleBatch,pacedLifecycleFetch);
await assert.rejects(isolatedLoop('bunjang',new Date().toISOString(),aborter.signal),/fixture abort/);
assert.equal(applied.length,1);assert.equal(mirrored.length,1);
assert.equal(receipts[0].stop_reason,'ABORTED');assert.equal(receipts[0].sold,1);
assert.equal(receipts[0].verified_statuses.SOLD,1);
// One listing's success must not turn another listing's unknown response into verification.
const rowOutcomes = new Map(), parallelReceipts = [], observationTimes = [];
const parallelLoop = isolatedFactory(
  { getLifecycleRun:()=>null,
    dueRechecks:()=>[1,2].map(id=>({source_listing_id:String(id),raw_json:'{}',title:'CPU',price_value:10000,currency:'KRW'})),
    deferLifecycleAttempt:(_source,id,result)=>rowOutcomes.set(id,result.outcome),
    getPublicProjection:()=>({status:'ACTIVE'}),
    recordLifecycleRun:(_source,receipt)=>parallelReceipts.push(receipt) },
  { recordItem:(_item,at)=>{observationTimes.push(at);return {_pc_snapshot_created:true};} },
  { applyLifecycleProjection:()=>{} },
  async url=>{
    const pid=url.includes('/1/')?1:2;
    return new Response(JSON.stringify({data:{product:{pid,saleStatus:pid===1?'unrecognized':'SELLING',price:10000}}}));
  }, signal=>signal?.throwIfAborted(), signal=>signal,
  bunjangProductIdFromListing,parseBunjangDetailLifecycle,bunjangDetailObservationItem,async()=>{},rows=>rows,async()=>{},
  runLifecycleBatch,fetchImpl=>fetchImpl);
await parallelLoop('bunjang','2026-01-01T00:00:00.000Z',new AbortController().signal);
assert.equal(rowOutcomes.get('1'),'UNKNOWN_STATUS');
assert.equal(rowOutcomes.get('2'),'VERIFIED');
assert.equal(parallelReceipts[0].verified,1);
assert.equal(parallelReceipts[0].unverified_outcomes.UNKNOWN_STATUS,1);
assert.ok(Date.parse(observationTimes[0])>Date.parse('2026-01-01'),'record actual verification time, not delayed scheduled event time');

let releaseInFlight;
const inFlightWait = new Promise(resolve=>{releaseInFlight=resolve;});
const blockCalls=[], blockApplied=[], blockReceipts=[];
const blockedLoop=isolatedFactory(
  {getLifecycleRun:()=>null,dueRechecks:()=>[1,2,3].map(id=>({source_listing_id:String(id),raw_json:'{}',title:'CPU',price_value:10000,currency:'KRW'})),
    deferLifecycleAttempt:(_source,_id,result)=>{if(result.outcome==='HTTP_429')releaseInFlight();},
    getPublicProjection:()=>({status:'SOLD'}),
    recordLifecycleRun:(_source,receipt,backoff)=>blockReceipts.push({receipt,backoff})},
  {recordItem:()=>({_pc_snapshot_created:true})},{applyLifecycleProjection:p=>blockApplied.push(p)},
  async url=>{const pid=Number(url.match(/products\/(\d+)/u)[1]);blockCalls.push(pid);
    if(pid===1)return new Response(JSON.stringify({errorCode:'ERR_PRODUCT_NOT_FOUND'}),{status:429});
    await inFlightWait;return new Response(JSON.stringify({data:{product:{pid,saleStatus:'SOLD_OUT',price:10000}}}));},
  signal=>signal?.throwIfAborted(),signal=>signal,
  bunjangProductIdFromListing,parseBunjangDetailLifecycle,bunjangDetailObservationItem,async()=>{},rows=>rows,async()=>{},
  runLifecycleBatch,fetchImpl=>fetchImpl);
await blockedLoop('bunjang',new Date().toISOString(),new AbortController().signal);
assert.deepEqual(blockCalls,[1],'serial recheck stops before the next request on a source block');
assert.equal(blockApplied.length,0,'blocked evidence must not become a confirmed SOLD projection');
assert.equal(blockReceipts[0].receipt.stop_reason,'HTTP_429');
assert.ok(Date.parse(blockReceipts[0].backoff)>Date.now()+5*60*60*1000,'source block keeps six-hour cooldown');
const db = new DatabaseSync(":memory:");
{
  const policyDb = new DatabaseSync(':memory:');
  const now = Date.parse('2026-10-23T12:00:00.000Z');
  const policyLedger = new PcPartsLedger({ db: policyDb, now: () => now });
  policyLedger.migrate();
  policyLedger.upsertSource({ sourceId: 'bunjang', displayName: 'Bunjang', marketPool: 'KR_C2C_USED', policyStatus: 'APPROVED', runtimeStatus: 'ENABLED' });
  const observe = (id, at) => policyLedger.recordObservation({ sourceId: 'bunjang', sourceListingId: id,
    title: 'RTX 3080', currency: 'KRW', price: 30000, status: 'ACTIVE',
    rawPayload: { url: `https://m.bunjang.co.kr/products/${id}` },
    statusEvidence: { type: 'STRUCTURED_STATUS', value: 'ACTIVE' }, observedAt: at });
  observe('70001', '2026-10-20T12:00:00Z');
  observe('70002', '2026-10-21T12:00:00Z');
  observe('70003', '2026-10-23T11:00:00Z');
  policyLedger.deferLifecycleAttempt('bunjang', '70001', { at: '2026-10-23T10:00:00.000Z', delayMs: 0, outcome: 'NETWORK_ERROR' });
  const due = () => policyLedger.dueRechecks({ sourceId: 'bunjang', asOf: new Date(now).toISOString() }).map(x => x.source_listing_id);
  assert.deepEqual(due(), [], 'legacy age-only backlog is excluded, not relabeled as checked or sold');
  const rows = [
    { id: '70001', updated_at: '2026-10-22T12:00:00Z' },
    { id: '70002', updated_at: '2026-10-21T12:00:00Z' },
    { id: '70004', updated_at: '2026-10-19T12:00:00Z' }
  ];
  const compare = windows => recordBunjangSearchWindows(policyDb, { windows, now, observedAfter: now-7200000 });
  const initial = compare([{ scope: 'same-query-and-pages', observed_at: '2026-10-23T10:01:00Z', rows }]);
  assert.equal(initial.added, 0, 'first scan only establishes a baseline');
  const missing = compare([{ scope: 'same-query-and-pages', observed_at: '2026-10-23T11:00:00Z',
    rows: [{ id: '70005', updated_at: '2026-10-23T10:30:00Z' }, rows[2]] }]);
  assert.equal(missing.added, 2);
  assert.deepEqual(due(), ['70001', '70002'], 'oldest unconfirmed listing first; fresh search confirmation skips detail');
  const fresh = observe('70001', '2026-10-23T11:30:00Z');
  assert.equal(fresh.snapshotCreated, false, 'unchanged search evidence still refreshes actual confirmation');
  assert.deepEqual(due(), ['70002'], 'freshly seen identical listing no longer needs a detail request');
  const countSnapshots = () => policyDb.prepare('SELECT count(*) n FROM listing_snapshots').get().n;
  const historyBefore = countSnapshots();
  recordBunjangSearchWindows(policyDb, { windows: [], observations: [{ item: { site: 'bunjang', source_listing_id: '70002',
    url: 'https://m.bunjang.co.kr/products/70002' }, observed_at: '2026-10-23T11:50:00Z' }], now });
  assert.deepEqual(due(), [], 'any fresh raw search appearance removes an old candidate even outside the displayed result limit');
  const reset = () => policyDb.exec('DELETE FROM pc_bunjang_search_windows; DELETE FROM pc_bunjang_missing_candidates');
  const window = (scope, at, data) => ({ scope, observed_at: at, rows: data });
  reset();
  compare([window('scope-a', '2026-10-23T10:01:00Z', rows)]);
  assert.equal(compare([window('scope-b', '2026-10-23T11:01:00Z', [rows[0], rows[2]])]).added, 0,
    'changed query/page range cannot create a missing candidate');
  assert.equal(compare([window('scope-a', '2026-10-23T11:02:00Z', [
    { id: '70006', updated_at: '2026-10-23T09:00:00Z' }, rows[0]
  ])]).added, 0, 'items pushed below the current fetched floor are not disappearance evidence');
  reset();
  compare([window('scope-a', '2026-10-23T10:01:00Z', rows)]);
  assert.equal(compare([window('scope-a', '2026-10-23T11:02:00Z', [rows[2], rows[0]])]).rejected_windows, 1,
    'nonmonotonic results cannot assert a comparable latest-sort range');
  assert.equal(compare([window('scope-a', '2026-10-23T11:03:00Z', [])]).rejected_windows, 1,
    'empty response cannot turn every previous result into a detail candidate');
  assert.equal(compare([window('scope-a', '2026-10-23T11:04:00Z', [{ ...rows[0], updated_at: null }, rows[2]])]).rejected_windows, 1);
  const candidate = compare([window('scope-a', '2026-10-23T11:05:00Z', [rows[0], rows[2]])]);
  assert.equal(candidate.added, 1);
  assert.equal(policyLedger.latestSnapshot('bunjang', '70002').lifecycle_status, 'ACTIVE', 'disappearance never becomes SOLD');
  assert.equal(countSnapshots(), historyBefore, 'candidate reduction preserves observation and price history');
  assert.deepEqual(policyLedger.dueRechecks({ sourceId: 'bunjang', asOf: '2026-10-24T12:00:00Z' }), [],
    'expired disappearance evidence does not fuel unbounded retries');
  const hiddenRows = () => policyDb.prepare("SELECT count(*) n FROM pc_bunjang_missing_candidates WHERE source_listing_id='70002'").get().n;
  recordBunjangSearchWindows(policyDb, { now: Date.parse('2026-10-25T12:00:00Z') });
  assert.equal(hiddenRows(), 1, 'listing-visibility evidence outlives the 24-hour detail window');
  recordBunjangSearchWindows(policyDb, { now: Date.parse('2026-10-30T11:06:00Z') });
  assert.equal(hiddenRows(), 0, 'after seven days the ordinary unconfirmed-listing rule takes over');
  reset();
  policyLedger.recordObservation({ sourceId: 'bunjang', sourceListingId: 'bunjang:https://m.bunjang.co.kr/products/70008',
    title: 'RTX 3080', currency: 'KRW', price: 30000, status: 'ACTIVE', rawPayload: { url: 'https://m.bunjang.co.kr/products/70008' },
    statusEvidence: { type: 'STRUCTURED_STATUS', value: 'ACTIVE' }, observedAt: '2026-10-21T12:00:00Z' });
  compare([window('legacy-id', '2026-10-23T10:01:00Z', [{ id: '70008', updated_at: '2026-10-22T12:00:00Z' }, rows[2]])]);
  assert.equal(compare([window('legacy-id', '2026-10-23T11:06:00Z', [{ id: '70009', updated_at: '2026-10-23T10:40:00Z' }, rows[2]])]).added, 1,
    'older URL-keyed ledger rows are matched by the same product ID');
  reset();
  // A complete window (no next page) judges every prior row, including ones
  // older than its last row, and may hold one row or none.
  compare([window('complete', '2026-10-23T10:01:00Z', rows)]);
  const completeOne = compare([{ ...window('complete', '2026-10-23T11:06:00Z', [rows[0]]), complete: true }]);
  assert.equal(completeOne.rejected_windows, 0);
  assert.equal(completeOne.added, 1, 'an older row missing from a complete result set is judged');
  assert.equal(compare([window('partial-one', '2026-10-23T11:07:00Z', [rows[0]])]).rejected_reasons.size, 1,
    'an incomplete one-row window still cannot assert a range');
  reset();
  compare([window('empty', '2026-10-23T10:01:00Z', [{ id: '70008', updated_at: '2026-10-22T12:00:00Z' }, rows[1]])]);
  const emptied = compare([{ ...window('empty', '2026-10-23T11:06:00Z', []), complete: true }]);
  assert.equal(emptied.added, 2, 'a query whose complete results became empty hides its prior listings');
  reset();
  const scopes = Array.from({ length: 7 }, (_, i) => `burst-${i}`);
  compare(scopes.map(scope => window(scope, '2026-10-23T10:01:00Z', [rows[0], rows[1]])));
  const burst = compare(scopes.map(scope => ({ ...window(scope, '2026-10-23T11:06:00Z', []), complete: true })));
  assert.equal(burst.added, 0, 'many queries emptying at once is treated as a source anomaly');
  assert.equal(burst.rejected_reasons.empty_anomaly, 7);
  reset();
  // Scopes that were already empty are not evidence that the source answers normally.
  const newlyEmpty = Array.from({ length: 6 }, (_, i) => `emptied-${i}`), idle = Array.from({ length: 6 }, (_, i) => `idle-${i}`);
  compare([...newlyEmpty.map(scope => window(scope, '2026-10-23T10:01:00Z', [rows[0], rows[1]])),
    ...idle.map(scope => ({ ...window(scope, '2026-10-23T10:01:00Z', []), complete: true }))]);
  const mixed = compare([...newlyEmpty, ...idle].map(scope => ({ ...window(scope, '2026-10-23T11:06:00Z', []), complete: true })));
  assert.equal(mixed.added, 0, 'already-empty scopes cannot outvote a burst of newly emptied ones');
  assert.equal(mixed.rejected_reasons.empty_anomaly, 6);
  reset();
  recordBunjangSearchWindows(policyDb, { windows: [window('daily', '2026-10-22T11:59:00Z',
    [{ ...rows[0], updated_at: '2026-10-22T11:00:00Z' }, ...rows.slice(1)])],
    now: Date.parse('2026-10-22T12:00:00Z') });
  assert.equal(compare([window('daily', '2026-10-23T12:00:00Z', [rows[0], rows[2]])]).added, 1,
    'daily recurrence plus scheduler jitter must retain the previous comparable window');
  const stale = recordBunjangSearchWindows(policyDb, { observations: [{ item: { site: 'bunjang', source_listing_id: '70002',
    url: 'https://m.bunjang.co.kr/products/70002' }, observed_at: '2026-10-22T11:50:00Z' }], now });
  assert.equal(stale.reappeared, 0, 'stale positive evidence cannot clear a disappearance candidate');
  const partialSighting = recordBunjangSearchWindows(policyDb, { windows: [], observations: [{ item: { site: 'bunjang',
    source_listing_id: '70002', url: 'https://m.bunjang.co.kr/products/70002', status: 'ACTIVE' },
    observed_at: '2026-10-23T12:00:00Z' }], now });
  assert.equal(partialSighting.reappeared, 1, 'a fresh positive sighting clears a candidate without any comparable complete windows');
  assert.equal(partialSighting.search_status_counts.ACTIVE, 1);
  policyDb.close();
}
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
const proof = (id, at='2026-09-14T00:00:00.000Z') => db.prepare('INSERT OR REPLACE INTO pc_bunjang_missing_candidates VALUES (?,?,?,?)')
  .run(id, 'fixture-comparable-search', at, '2026-09-18T00:00:00.000Z');
ledger.upsertSource({ sourceId: "bunjang", displayName: "Bunjang", marketPool: "KR_C2C_USED", policyStatus: "APPROVED", runtimeStatus: "ENABLED" });
const observation = { sourceId: "bunjang", sourceListingId: "1", title: "RTX 3080",
  currency: "KRW", price: 30000, status: "ACTIVE", rawPayload: { url: "https://m.bunjang.co.kr/products/1" },
  statusEvidence: { type: "STRUCTURED_STATUS", value: "ACTIVE" } };
ledger.recordObservation({ ...observation, observedAt: "2026-09-01T00:00:00Z" });
ledger.recordObservation({ ...observation, price: 29000, observedAt: "2026-09-02T00:00:00Z" });
ledger.compactStorage({ asOf: "2026-09-14T00:00:00Z", observationRetentionDays: 1, pruneObservationDetails: true });
proof('1');
assert.equal(db.prepare("SELECT count(*) n FROM listing_snapshots").get().n, 1);
assert.equal(ledger.dueRechecks({ sourceId: "bunjang", checkedBefore: "2026-09-14T00:00:00Z", asOf: '2026-09-14T00:00:00Z', limit: 1500 }).length, 1);
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
  proof(id, '2026-09-15T00:00:00.000Z');
}
const oldDueIds = db.prepare(`SELECT s.source_listing_id FROM listing_snapshots s
  JOIN raw_listings r ON r.id=s.raw_listing_id WHERE s.source_id='bunjang'
  AND s.lifecycle_status IN ('ACTIVE','RESERVED','UNAVAILABLE_UNKNOWN')
  AND r.last_checked_at <= '2026-09-15T00:00:00.000Z'
  AND NOT EXISTS (SELECT 1 FROM listing_snapshots newer WHERE newer.source_id=s.source_id
    AND newer.source_listing_id=s.source_listing_id AND (newer.observed_at>s.observed_at
      OR (newer.observed_at=s.observed_at AND newer.id>s.id)))
  ORDER BY CASE WHEN r.missing_check_count>0 THEN 0 ELSE 1 END,r.last_checked_at,s.source_listing_id`).all().map(row=>row.source_listing_id);
assert.deepEqual(ledger.dueRechecks({sourceId:'bunjang',checkedBefore:'2026-09-15T00:00:00Z',asOf:'2026-09-15T00:00:00Z',limit:1500})
  .map(row=>row.source_listing_id),oldDueIds,'index-first query preserves latest snapshot and equal-time tie-break membership');
assert.equal(ledger.lifecycleRecheckStatus({sourceId:'bunjang',asOf:'2026-09-16T00:00:00Z'}).due_count,oldDueIds.length);
ledger.deferLifecycleAttempt('bunjang','2',{at:'2026-09-16T00:00:00.000Z',delayMs:86400000,outcome:'NETWORK_ERROR'});
assert.ok(!ledger.dueRechecks({sourceId:'bunjang',checkedBefore:'2026-09-16',asOf:'2026-09-16T01:00:00Z'}).some(r=>r.source_listing_id==='2'));
assert.equal(ledger.lifecycleRecheckStatus({sourceId:'bunjang',asOf:'2026-09-16T01:00:00Z'}).deferred_count,1);
ledger.recordObservation({...observation,sourceListingId:'2',price:31000,observedAt:'2026-09-16T02:00:00Z'});
db.prepare("UPDATE pc_lifecycle_queue SET next_attempt_at='2026-09-16T08:00:00.000Z' WHERE source_listing_id='3'").run();
assert.ok(ledger.dueRechecks({sourceId:'bunjang',checkedBefore:'2026-09-16T03:00:00Z',asOf:'2026-09-16T09:00:00Z'}).some(r=>r.source_listing_id==='3'), 'a still-unconfirmed candidate survives a due retry');
assert.ok(!ledger.dueRechecks({sourceId:'bunjang',checkedBefore:'2026-09-16T03:00:00Z',asOf:'2026-09-16T09:00:00Z'}).some(r=>r.source_listing_id==='2'), 'verified observation invalidates old disappearance evidence');
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
assert.throws(() => db.prepare('DELETE FROM listing_snapshots WHERE id=?').run(latestTwo), /FOREIGN KEY/, 'live observation evidence must prevent direct snapshot deletion');
db.prepare('DELETE FROM listing_snapshot_observation_days WHERE snapshot_id=?').run(latestTwo);
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
{
  // Joonggonara search rows only say "selling"; a page-verified reservation
  // holds until the next product-page recheck decides otherwise.
  bodyLedger.upsertSource({ sourceId: 'joonggonara', displayName: 'Joonggonara', marketPool: 'KR_C2C_USED', policyStatus: 'APPROVED', runtimeStatus: 'ENABLED' });
  const jItem = { site: 'joonggonara', title: 'GTX 980', currency: 'KRW', price: 90000, status: 'ACTIVE',
    source_listing_id: 'joonggonara:https://web.joongna.com/product/30001', url: 'https://web.joongna.com/product/30001' };
  const page = (status, value, at) => bodyLedger.recordObservation({ sourceId: 'joonggonara', sourceListingId: jItem.source_listing_id,
    title: jItem.title, price: jItem.price, currency: 'KRW', rawPayload: { url: jItem.url }, status,
    statusEvidence: { type: 'STRUCTURED_STATUS', value }, availability: 'AVAILABLE', observedAt: at });
  pipeline.recordItem(jItem, '2026-09-12T00:00:00Z');
  page('RESERVED', 'productStatus=1;reservation=true', '2026-09-12T01:00:00Z');
  pipeline.recordItem(jItem, '2026-09-12T02:00:00Z');
  assert.equal(bodyLedger.latestSnapshot('joonggonara', jItem.source_listing_id).lifecycle_status, 'RESERVED');
  assert.equal(pipeline.reservedSearchHolds, 1);
  bodyLedger.deferLifecycleAttempt('joonggonara', jItem.source_listing_id, { at: '2026-09-12T01:00:00.000Z', outcome: 'VERIFIED', delayMs: 6 * 3600000 });
  for (let hour = 3; hour <= 23; hour += 1) pipeline.recordItem(jItem, `2026-09-12T${String(hour).padStart(2, '0')}:00:00Z`);
  bodyDb.exec('UPDATE pc_lifecycle_bootstrap SET ready=1 WHERE id=1');
  const jDue = asOf => bodyLedger.dueRechecks({ sourceId: 'joonggonara', checkedBefore: new Date(Date.parse(asOf) - 6 * 3600000).toISOString(), asOf, limit: 600 })
    .map(row => row.source_listing_id);
  assert.equal(bodyLedger.latestSnapshot('joonggonara', jItem.source_listing_id).lifecycle_status, 'RESERVED');
  assert.deepEqual(jDue('2026-09-12T23:30:00.000Z'), [jItem.source_listing_id],
    'hourly search sightings cannot postpone the next product-page check of a held reservation');
  assert.deepEqual(jDue('2026-09-12T05:00:00.000Z'), [], 'the six-hour page recheck interval still applies');
  page('ACTIVE', 'ACTIVE', '2026-09-12T23:45:00Z');
  pipeline.recordItem(jItem, '2026-09-13T00:00:00Z');
  assert.equal(bodyLedger.latestSnapshot('joonggonara', jItem.source_listing_id).lifecycle_status, 'ACTIVE',
    'a later page recheck releases the reservation');
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
