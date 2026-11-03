import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { PcPartsLedger } from '../aws-runner/pc-parts-ledger.mjs';
import { PcShadowPipeline } from '../aws-runner/pc-shadow-pipeline.mjs';
import { reconcileSearchStatusObservations } from '../aws-runner/search-status-observations.mjs';

const db = new DatabaseSync(':memory:');
const ledger = new PcPartsLedger({ db });
ledger.migrate();
const pipeline = new PcShadowPipeline({ ledger });
await pipeline.initialize();
const now = Date.now(), iso = ms => new Date(ms).toISOString();
const item = (id, status = 'ACTIVE', source = 'bunjang') => ({
  site: source, source_listing_id: source === 'bunjang' ? String(id) : `joonggonara:https://web.joongna.com/product/${id}`,
  item_id: `${source}:${id}`, id: `${source}:${id}`, title: 'GTX 980 그래픽카드', price: 50000, currency: 'KRW',
  url: source === 'bunjang' ? `https://m.bunjang.co.kr/products/${id}` : `https://web.joongna.com/product/${id}`,
  status
});
for (const id of [101, 102, 103, 104, 105, 106, 107]) {
  pipeline.recordItem({ ...item(id), description: '그래픽카드와 DDR4 16GB 일괄 판매' }, iso(now - 30 * 3600000));
}
const row = (id, status = 'ACTIVE', ago = 1000) => ({ item: item(id, status), observed_at: iso(now - ago) });
ledger.deferLifecycleAttempt('bunjang', '104', { at: iso(now - 500) });
const recorded = [];
const run = options => reconcileSearchStatusObservations({
  source: 'bunjang', db, now, recordItem: (value, at) => {
    recorded.push([value.source_listing_id, at]);
    return pipeline.recordItem(value, at);
  }, ...options
});
const outcome = await run({
  normalItems: [item(102)],
  observations: [row(101, 'SOLD'), row(101, 'ACTIVE', 2000), row(102), row(103, 'ACTIVE', 3 * 3600000),
    row(104), { ...row(105), item: { ...item(105), url: 'https://m.bunjang.co.kr/products/999' } },
    row(106, 'ACTIVE'), row(106, 'SOLD'), row(107, 'DELETED'), row(999)],
});
assert.deepEqual(recorded.map(([id]) => id), ['101', '107']);
assert.equal(outcome.receipt.overdue_24h_checked, 2);
assert.equal(outcome.receipt.sold, 1);
assert.equal(ledger.latestSnapshot('bunjang', '101').lifecycle_status, 'SOLD');
assert.equal(db.prepare("SELECT last_checked_at FROM pc_lifecycle_queue WHERE source_listing_id='101'").get().last_checked_at,
  iso(now - 1000), 'reversed page completion must keep newest timestamp');
assert.equal(ledger.latestSnapshot('bunjang', '107').lifecycle_status, 'DELETED', 'deleted is not sold');
assert.equal(ledger.getPublicProjection('bunjang', '101').statistics_eligible, false,
  'normal pipeline retains verified bundle description and exclusion');
const count = db.prepare('SELECT count(*) n FROM listing_snapshots').get().n;
await run({ observations: [row(101, 'ACTIVE', 2000), row(101, 'SOLD')] });
assert.equal(db.prepare('SELECT count(*) n FROM listing_snapshots').get().n, count, 'no duplicate sale or terminal reactivation');
await run({ observations: [row(103)], deadline: now - 1 });
assert.equal(recorded.length, 2, 'expired shared budget starts no extra work');
await run({ observations: [row(103), { ...row(103), item: { ...item(103), price: 1 } }] });
assert.equal(recorded.length, 2, 'equal-time conflicting prices must not write an arbitrary snapshot');
await run({ observations: [row(103)], observedAfter: now - 500 });
assert.equal(recorded.length, 2, 'evidence predating this collection cannot acknowledge a check');
pipeline.recordItem(item(201, 'ACTIVE', 'joonggonara'), iso(now - 30 * 3600000));
const joongna = await reconcileSearchStatusObservations({
  source: 'joonggonara', db, now,
  observations: [{ item: item(201, 'SOLD', 'joonggonara'), observed_at: iso(now - 1000) }],
  recordItem: (value, at) => pipeline.recordItem(value, at)
});
assert.equal(joongna.receipt.sold, 1);
assert.equal(ledger.latestSnapshot('joonggonara', item(201, 'ACTIVE', 'joonggonara').source_listing_id).lifecycle_status, 'SOLD');
db.close();

// Bound duplicate/variant fan-out before expensive classification.
const capDb = new DatabaseSync(':memory:');
capDb.exec(`CREATE TABLE pc_lifecycle_queue(source_id,source_listing_id,lifecycle_status,last_checked_at,last_attempt_at)`);
const insert = capDb.prepare('INSERT INTO pc_lifecycle_queue VALUES(?,?,?,?,NULL)');
for (let id = 1; id <= 250; id++) insert.run('bunjang', String(id), 'ACTIVE', iso(now - 30 * 3600000));
let calls = 0;
const many = Array.from({ length: 250 }, (_, i) => row(i + 1));
const capped = await reconcileSearchStatusObservations({ source: 'bunjang', db: capDb, now,
  observations: [...many, ...many, ...many], recordItem: () => { calls++; return {}; }, limit: 999 });
assert.equal(capped.receipt.seen, 750);
assert.equal(capped.receipt.eligible, 250);
assert.equal(calls, 200);
capDb.close();
console.log('search-status-observations contract passed');
