import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { PcPartsLedger } from '../aws-runner/pc-parts-ledger.mjs';
import { PcShadowPipeline } from '../aws-runner/pc-shadow-pipeline.mjs';
import { reclassifyPcSnapshots } from '../aws-runner/reclassify-pc-snapshots.mjs';
import { evaluatePcQualityDataset } from '../aws-runner/pc-quality-eval.mjs';
import { importStagedNormalizations } from '../aws-runner/pc-staged-normalization-import.mjs';
const dir = mkdtempSync(path.join(tmpdir(), 'used-pick-stage-import-'));
const live = path.join(dir, 'live.sqlite'), stage = path.join(dir, 'stage.sqlite');
const date = '2026-09-16T12:00:00.000Z';
const versions = { normalizationVersion: 18, parserVersion: 'pc-parser-v8', ruleVersion: 'pc-rules-v18', filterVersion: 'pc-filter-v7', modelVersion: 'pc-master-v5' };
const versionKey = 'pc-normalization-v18-parts-prices';
const db = new DatabaseSync(live);
db.exec('PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL');
const ledger = new PcPartsLedger({ db, now: () => new Date(date) }); ledger.migrate();
const pipeline = new PcShadowPipeline({ ledger }); await pipeline.initialize();
const item = (id, title, price = 100_000) => ({ site: 'joonggonara', source_listing_id: id, title, price, currency: 'KRW', status: 'ACTIVE' });
try {
  pipeline.recordItem(item('one', 'G.Skill DDR4 32GB (16GBx2) KIT'), date);
  pipeline.recordItem(item('two', 'Intel Core Ultra 7 265K CPU'), date);
  db.exec(`VACUUM INTO '${stage.replaceAll("'", "''")}'`);
  const stagedDb = new DatabaseSync(stage), stagedLedger = new PcPartsLedger({ db: stagedDb, now: () => new Date(date) });
  try {
    stagedDb.exec('PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL');
    const stagedPipeline = new PcShadowPipeline({ ledger: stagedLedger }); await stagedPipeline.initialize();
    reclassifyPcSnapshots({ ledger: stagedLedger, pipeline: stagedPipeline, versions, versionKey, apply: true });
    const quality = evaluatePcQualityDataset(JSON.parse(readFileSync(new URL('./fixtures/pc-parts-cases.json', import.meta.url), 'utf8')));
    assert.equal(stagedLedger.evaluatePipelineVersion({ versionKey, qualityReport: quality }).status, 'ACTIVE');
  } finally { stagedDb.close(); }
  // A live observation after the staging snapshot must survive, even though its
  // generated normalization/item IDs collide with IDs allocated in the stage.
  pipeline.recordItem(item('three', 'Samsung DDR5 16GB 메모리'), date);
  const before = db.prepare('SELECT * FROM listing_snapshots ORDER BY id').all();
  const call = extra => importStagedNormalizations({ ledger, stagingPath: stage, versions, expectedSnapshotCount: 2, ...extra });
  assert.throws(() => call({ expectedSnapshotCount: 3 }), /COVERAGE_INCOMPLETE/);
  assert.throws(() => call({ versions: { ...versions, modelVersion: 'pc-master-wrong' } }), /QUALITY_NOT_SEALED/);
  // A rollback preserves everything if the staged observation no longer agrees.
  db.exec('BEGIN');
  const oldPrice = db.prepare('SELECT price_value FROM listing_snapshots WHERE id = 1').get().price_value;
  // Test-only DB clone allows changing one snapshot field, not a production row.
  db.prepare('UPDATE listing_snapshots SET price_value = ? WHERE id = 1').run(oldPrice + 1);
  db.exec('COMMIT');
  assert.throws(() => call(), /OBSERVATION_MISMATCH:listing_snapshots/);
  db.prepare('UPDATE listing_snapshots SET price_value = ? WHERE id = 1').run(oldPrice);
  // Operational timestamps change during continued live crawling. Never copy
  // over those fields or weaken equality: defer that observation for catch-up.
  const partialPath = path.join(dir, 'partial.sqlite');
  db.exec(`VACUUM INTO '${partialPath.replaceAll("'", "''")}'`);
  const partialDb = new DatabaseSync(partialPath), partialLedger = new PcPartsLedger({ db: partialDb });
  try {
    partialDb.prepare('UPDATE raw_listings SET last_checked_at = ? WHERE id = 1').run('2026-09-17T12:00:00.000Z');
    const rawBefore = partialDb.prepare('SELECT * FROM raw_listings ORDER BY id').all();
    const snapshotsBefore = partialDb.prepare('SELECT * FROM listing_snapshots ORDER BY id').all();
    const args = { ledger: partialLedger, stagingPath: stage, versions, expectedSnapshotCount: 2 };
    assert.throws(() => importStagedNormalizations(args), /OBSERVATION_MISMATCH:raw_listings/);
    const partial = importStagedNormalizations({ ...args, reuseUnchangedOnly: true });
    assert.equal(partial.imported_snapshots, 1);
    assert.equal(partial.deferred_changed_snapshots, 1);
    assert.equal(partial.comparison_policy, 'ALL_SOURCE_COLUMNS_EXACT');
    const p = new PcShadowPipeline({ ledger: partialLedger }); await p.initialize();
    const caughtUp = reclassifyPcSnapshots({ ledger: partialLedger, pipeline: p, versions, versionKey, apply: true });
    assert.equal(caughtUp.skipped, 1); assert.equal(caughtUp.inserted, 2);
    assert.deepEqual(partialDb.prepare('SELECT * FROM raw_listings ORDER BY id').all(), rawBefore);
    assert.deepEqual(partialDb.prepare('SELECT * FROM listing_snapshots ORDER BY id').all(), snapshotsBefore);
    assert.equal(partialDb.prepare('PRAGMA foreign_key_check').all().length, 0);
  } finally { partialDb.close(); }
  const result = call();
  assert.equal(result.imported_snapshots, 2); assert.equal(result.copied_publications, 0);
  assert.deepEqual(db.prepare('SELECT * FROM listing_snapshots ORDER BY id').all(), before);
  const ram = db.prepare(`SELECT n.canonical_product_id, i.unit_price, n.quantity FROM normalized_listings n
    JOIN listing_snapshots s ON s.id = n.snapshot_id JOIN listing_items i ON i.normalized_listing_id = n.id
    WHERE n.normalization_version = 18 AND s.source_listing_id = 'one'`).get();
  assert.equal(ram.canonical_product_id, 'ram:g-skill:ddr4:16gb');
  assert.equal(ram.quantity, 2); assert.equal(ram.unit_price, 50_000);
  assert.throws(() => call(), /TARGET_ALREADY_EXISTS/);
  const catchup = reclassifyPcSnapshots({ ledger, pipeline, versions, versionKey, apply: true });
  assert.equal(catchup.scanned, 3); assert.equal(catchup.skipped, 2); assert.equal(catchup.inserted, 1);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM normalized_listings WHERE normalization_version = 18').get().n, 3);
  assert.equal(db.prepare('PRAGMA foreign_key_check').all().length, 0);
  console.log(JSON.stringify({ status: 'passed', contract: 'pc-staged-normalization-import', imported: 2, catchup: 1, source_mutations: 0 }));
} finally { db.close(); rmSync(dir, { recursive: true, force: true }); }
