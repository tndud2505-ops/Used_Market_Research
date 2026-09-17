import assert from 'node:assert/strict';
import { mkdtempSync, existsSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { SearchIndex } from '../aws-runner/search-index.mjs';
import { PcPartsLedger } from '../aws-runner/pc-parts-ledger.mjs';
import { PcShadowPipeline } from '../aws-runner/pc-shadow-pipeline.mjs';
import { localProjectionPlan } from '../aws-runner/reconcile-local-pc-projections.mjs';
import { evaluatePcQualityDataset } from '../aws-runner/pc-quality-eval.mjs';

const directory = mkdtempSync(path.join(os.tmpdir(), 'used-pick-local-reconcile-'));
const file = path.join(directory, 'index.sqlite');
const observedAt = '2026-09-16T12:00:00.000Z';
let index;
try {
  index = new SearchIndex({ filePath: file, backupDir: path.join(directory, 'backups') });
  const ledger = new PcPartsLedger({ db: index.db }); ledger.migrate();
  const pipeline = new PcShadowPipeline({ ledger }); await pipeline.initialize();
  const item = pipeline.recordItem({ item_id: 'joonggonara:56789012', site: 'joonggonara',
    source_listing_id: '56789012', title: '지스킬 DDR5 32GB (16GBx2) KIT 정상 작동',
    price: 140_000, currency: 'KRW', status: 'ACTIVE', url: 'https://web.joongna.com/product/56789012' }, observedAt);
  index.upsertPublicProjections([{ ...item, canonical_product_id: 'ram:g-skill:ddr5:32gb' }, {
    ...item, item_id: 'joonggonara:56789013', id: 'joonggonara:56789013', url: 'https://web.joongna.com/product/56789013'
  }], { observedAt });
  index.close(); index = null;
  const first = localProjectionPlan(file).summary;
  assert.equal(first.authoritative_count, 1); assert.equal(first.current_count, 2); assert.equal(first.stale_count, 1);
  assert.equal(localProjectionPlan(file).summary.checksum, first.checksum, 'read-only plan must be deterministic');
  const script = new URL('../aws-runner/reconcile-local-pc-projections.mjs', import.meta.url);
  const { fileURLToPath } = await import('node:url');
  const denied = spawnSync(process.execPath, [fileURLToPath(script), `--db=${file}`, '--apply'], { encoding: 'utf8' });
  assert.notEqual(denied.status, 0, 'applying without a reviewed checksum is forbidden');
  const args = [fileURLToPath(script), `--db=${file}`, '--apply', `--confirm-checksum=${first.checksum}`,
    ...['authoritative_count', 'current_count', 'stale_count', 'missing_count', 'source_pair_count']
      .map(key => `--expect-${key.replaceAll('_', '-')}=${first[key]}`)];
  const applied = spawnSync(process.execPath, args, { encoding: 'utf8' });
  assert.equal(applied.status, 0, applied.stderr);
  const result = JSON.parse(applied.stdout); assert.ok(existsSync(result.backup));
  const after = localProjectionPlan(file);
  assert.equal(after.summary.current_count, 1); assert.equal(after.summary.stale_count, 0);
  assert.equal(after.state.localPublic[0].canonical_product_id, 'ram:g-skill:ddr5:16gb');
  const unknown = { input: { title: '지스킬 DDR5 32GB KIT', price: 100_000 }, expected: { category_code: 'RAM', quantity_unknown: true } };
  assert.equal(evaluatePcQualityDataset([unknown]).metrics.ram_quantity_price_scope_accuracy, 1);
  const unsafe = { ...unknown, prediction: { category_code: 'RAM', quantity_unknown: true, price_eligible: true } };
  assert.equal(evaluatePcQualityDataset([unsafe]).metrics.ram_quantity_price_scope_accuracy, 0);
  console.log(JSON.stringify({ status: 'passed', contract: 'pc-local-projection', backup_verified: true, stale_retired: 1 }));
} finally {
  index?.close();
  if (path.dirname(directory) !== path.resolve(os.tmpdir()) || !path.basename(directory).startsWith('used-pick-local-reconcile-')) throw new Error('UNSAFE_TEST_CLEANUP');
  rmSync(directory, { recursive: true, force: true });
}
