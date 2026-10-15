import assert from 'node:assert/strict';
import { PcPartsLedger } from '../aws-runner/pc-parts-ledger.mjs';
import { PcShadowPipeline } from '../aws-runner/pc-shadow-pipeline.mjs';

const ledger = new PcPartsLedger(); ledger.migrate();
const pipeline = new PcShadowPipeline({ ledger }); await pipeline.initialize();
const date = day => `2026-10-${String(day).padStart(2, '0')}T12:00:00.000Z`;
const item = (id, price = 400_000) => ({ site: 'joonggonara', source_listing_id: id,
  title: 'NVIDIA RTX 3080 10GB 그래픽카드', price, currency: 'KRW', status: 'ACTIVE' });
const options = { canonicalProductId: 'gpu:nvidia:rtx-3080', marketPool: 'KR_C2C_USED', condition: 'USED_WORKING', currency: 'KRW', asOf: date(15), days: 30 };
const daily = () => ledger.db.prepare("SELECT stat_date,sample_count FROM daily_price_stats WHERE canonical_product_id = ? AND metric_scope = 'ACTIVE' AND sample_count > 0 ORDER BY stat_date").all(options.canonicalProductId).map(row => ({ ...row }));
try {
  for (let i = 1; i <= 3; i++) { pipeline.recordItem(item(String(i), 400_000 + i * 1000), date(1)); pipeline.recordItem(item(String(i), 400_000 + i * 1000), date(10)); }
  assert.equal(ledger.db.prepare('SELECT count(*) n FROM listing_snapshots').get().n, 3, 'unchanged observations keep one immutable state');
  assert.equal(ledger.db.prepare('SELECT count(*) n FROM listing_snapshot_observation_days').get().n, 6);
  ledger.rebuildDailyPriceStats(options);
  assert.deepEqual(daily(), [{ stat_date: '2026-10-01', sample_count: 3 }, { stat_date: '2026-10-10', sample_count: 3 }], 'sparse observations must never fill the intervening days');
  assert.equal(ledger.getPriceStats(options).active.sample_count, 3, 'period counts remain unique listings');
  pipeline.recordItem(item('1', 410_000), date(10).replace('12:', '13:'));
  ledger.rebuildDailyPriceStats(options);
  assert.equal(daily().at(-1).sample_count, 3, 'same-day price changes replace a sample');
  pipeline.recordItem({ ...item('1'), title: 'NVIDIA RTX 3090 24GB 그래픽카드', price: 900_000 }, date(10).replace('12:', '14:'));
  ledger.rebuildDailyPriceStats(options);
  assert.equal(daily().at(-1).sample_count, 2, 'a newer product identity must suppress the old same-day product');
  const beforeStats = JSON.stringify(ledger.db.prepare('SELECT * FROM daily_price_stats ORDER BY id').all());
  const legacy = ledger.recordObservation({ sourceId: 'joonggonara', sourceListingId: 'https://web.joongna.com/product/99001',
    title: 'RTX 3080', rawPayload: { legacy: true }, price: 400_000, currency: 'KRW', status: 'ACTIVE', observedAt: date(1) });
  ledger.recordObservation({ sourceId: 'joonggonara', sourceListingId: '99001', title: 'RTX 3080', rawPayload: { stable: true },
    price: 400_000, currency: 'KRW', status: 'SOLD', statusEvidence: { type: 'STRUCTURED_STATUS', value: 'SOLD' }, observedAt: date(10) });
  ledger.db.prepare('UPDATE raw_listings SET last_seen_at = ? WHERE id = ?').run(date(12), legacy.rawListingId);
  ledger.db.exec('DROP TABLE listing_snapshot_observation_days; DELETE FROM pc_parts_schema_migrations WHERE version = 12');
  ledger.migrate();
  assert.equal(ledger.db.prepare("SELECT count(*) n FROM listing_snapshot_observation_days WHERE snapshot_id = ? AND observation_day = '2026-10-12'").get(legacy.snapshotId).n, 0,
    'an old URL alias must not resurrect ACTIVE evidence after its stable identity became SOLD');
  const markers = JSON.stringify(ledger.db.prepare('SELECT * FROM listing_snapshot_observation_days ORDER BY snapshot_id, observation_day').all());
  ledger.migrate();
  assert.equal(JSON.stringify(ledger.db.prepare('SELECT * FROM listing_snapshot_observation_days ORDER BY snapshot_id, observation_day').all()), markers);
  assert.equal(JSON.stringify(ledger.db.prepare('SELECT * FROM daily_price_stats ORDER BY id').all()), beforeStats, 'migration must preserve finalized daily records');
  assert.equal(ledger.db.prepare("SELECT count(*) n FROM listing_snapshot_observation_days WHERE observation_day = '2026-10-05'").get().n, 0);
  const captured = ledger.db.prepare("SELECT id FROM listing_snapshots WHERE source_listing_id = '2'").get().id;
  pipeline.recordItem(item('2', 430_000), date(15));
  ledger.compactStorage({ asOf: date(15), observationRetentionDays: 10, pruneObservationDetails: true });
  assert.ok(ledger.db.prepare('SELECT 1 FROM listing_snapshots WHERE id = ?').get(captured), 'a recent observation protects its older state snapshot');
  assert.equal(ledger.db.prepare("SELECT count(*) n FROM listing_snapshot_observation_days WHERE observation_day < '2026-10-06'").get().n, 0);
} finally { ledger.close(); }
console.log('Actual observation days: sparse capture, same-day identity, migration and retention passed');
