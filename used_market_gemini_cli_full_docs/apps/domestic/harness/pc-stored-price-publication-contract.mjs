import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { PcPartsLedger } from '../aws-runner/pc-parts-ledger.mjs';
import { PcShadowPipeline } from '../aws-runner/pc-shadow-pipeline.mjs';
import { storeCompletedPricePublication, storedPricePublicationKey, readCompletedPricePublication } from '../aws-runner/pc-stored-price-publication.mjs';
import { coherentStats, metricValue, buildTotals } from '../web-backend/public/pc-tools-core.mjs';
import { priceStatsResponse, parsePriceStatsRequest } from '../aws-runner/pc-price-stats-http.mjs';
import { pcStatsTraceability } from '../aws-runner/pc-stats-traceability.mjs';

const db = new DatabaseSync(':memory:');
const ledger = new PcPartsLedger({ db }); ledger.migrate(); ledger.migrate();
const pipeline = new PcShadowPipeline({ ledger }); await pipeline.initialize();
const id = 'ram:g-skill:ddr5:16gb', asOf = '2026-09-16T12:00:00.000Z';
const versions = { normalizationVersion: 1, parserVersion: 'pc-parser-v1', ruleVersion: 'pc-rules-v1', filterVersion: 'pc-filter-v1' };
const options = { canonicalProductId: id, marketPool: 'KR_C2C_USED', condition: 'USED_WORKING', currency: 'KRW', days: 30, asOf, ...versions };
try {
  // A non-latest observation is still a member of a published daily series.
  // One-day detail pruning used to delete it immediately after publication.
  pipeline.recordItem({site:'bunjang',source_listing_id:'stored-0',title:'지스킬 DDR5 32GB (16GBx2) KIT 정상 작동',
    price:110_000,currency:'KRW',status:'ACTIVE'},'2026-09-09T12:00:00.000Z');
  // Four different-day Bunjang listings and two Joonggonara listings reproduce
  // the live G.Skill path. No day's minimum/median may substitute for a mean.
  for (const [i, price] of [50_000, 60_000, 80_000, 200_000, 100_000, 110_000].entries()) {
    pipeline.recordItem({ site: i < 4 ? 'bunjang' : 'joonggonara', source_listing_id: `stored-${i}`,
      title: '지스킬 DDR5 32GB (16GBx2) KIT 정상 작동', price: price * 2, currency: 'KRW', status: 'ACTIVE' },
    `2026-09-${String(10 + i).padStart(2, '0')}T12:00:00.000Z`);
  }
  const exact = ledger.rebuildAndGetPriceStats(options);
  const memberTrace = pcStatsTraceability(ledger, options);
  assert.ok(memberTrace.member_count >= 7, 'the earlier changed-price snapshot belongs to the historical daily member trace');
  assert.equal(exact.active.sample_count, 6);
  assert.equal(exact.active.mean, 100_000);
  assert.equal(exact.by_source.find(r => r.source_id === 'bunjang').active.median, 70_000);
  const before = ledger.getStoredDailyPriceStats(options);
  assert.equal(before.active.average, null, 'incomplete daily means cannot become an invented weighted average');
  assert.equal(before.by_source.find(r => r.source_id === 'bunjang').active.average, null);
  const row = { canonical_product_id: id, market_pool: 'KR_C2C_USED', condition_code: 'USED_WORKING', currency: 'KRW', days: 30, as_of: asOf, stats_json: exact };
  const publication = { publicationId: 'gskill-regression', rows: [row], expectedRowCount: 1,
    expectedKeys: [storedPricePublicationKey(row)], allowedSourceIds: ['bunjang', 'joonggonara'], publishedAt: asOf };
  assert.throws(() => storeCompletedPricePublication(db, { ...publication, expectedRowCount: 2 }), /INCOMPLETE/);
  assert.equal(db.prepare('SELECT count(*) AS n FROM pc_stored_price_publications').get().n, 0);
  storeCompletedPricePublication(db, { ...publication, validateOnly: true });
  assert.equal(db.prepare('SELECT count(*) AS n FROM pc_stored_price_publications').get().n, 0, 'preflight is read-only');
  storeCompletedPricePublication(db, publication);
  assert.equal(storeCompletedPricePublication(db, publication).unchanged, true);
  const persisted = ledger.getStoredDailyPriceStats(options);
  assert.deepEqual(persisted.active, exact.active, 'published read keeps the actual cohort, not the sum of daily counts');
  assert.deepEqual(persisted.by_source, exact.by_source);
  assert.equal(coherentStats(persisted).integrity_filtered_source_count, undefined, 'four valid samples no longer disappear');
  assert.equal(metricValue(persisted.active), 100_000);
  assert.equal(buildTotals([{ id, quantity: 2 }], () => persisted).active.amount, 200_000);
  assert.equal(readCompletedPricePublication(db, { ...options, asOf: '2026-09-15T23:59:59.999Z', requireAsOfCoverage: true }), null);
  assert.equal(readCompletedPricePublication(db, { ...options, days: 14 }), null, 'a 14-day query never borrows a 30-day headline');
  assert.equal(readCompletedPricePublication(db, { ...options, ruleVersion: 'pc-rules-v2' }), null);
  assert.equal(readCompletedPricePublication(db, { ...options, currency: 'USD' }), null);
  const invalid = structuredClone(publication); invalid.publicationId = 'bad'; invalid.rows[0].stats_json.by_source[0].active.median = null;
  assert.throws(() => storeCompletedPricePublication(db, invalid), /MEDIAN_MISSING/);
  assert.equal(db.prepare('SELECT count(*) AS n FROM pc_stored_price_publications').get().n, 1);
  const altered = structuredClone(publication); altered.rows[0].stats_json.active.mean = 101_000;
  assert.throws(() => storeCompletedPricePublication(db, altered), /ID_CONFLICT/);
  // Prove reads are bounded to the stored publication even when the raw read
  // implementation is unavailable (as it is after historical detail compaction).
  ledger.eligibleRows = () => { throw new Error('raw scan forbidden'); };
  assert.equal(ledger.getStoredDailyPriceStats(options).active.mean, 100_000);
  const request = parsePriceStatsRequest(new URL(`https://example.test/api/products/${encodeURIComponent(id)}/price-stats`), asOf);
  assert.equal(priceStatsResponse(request, { sold: { sample_count: 4, median: null } }).reference_price.amount, null, 'missing median is never a zero-won price');
  ledger.compactStorage({ asOf: '2026-09-17T12:00:00.000Z', statsRetentionDays: 30,
    pruneObservationDetails: true, observationRetentionDays: 30 });
  assert.equal(ledger.getStoredDailyPriceStats(options).active.mean, 100_000, 'compaction preserves the exact summary');
  assert.deepEqual(pcStatsTraceability(ledger, options), memberTrace, 'post-publication compaction preserves the complete member count AND checksum');
  console.log(JSON.stringify({ status: 'passed', contract: 'pc-stored-price-publication', gskill_samples: 6, bunjang_median: 70_000, mean: 100_000 }));
} finally { db.close(); }
