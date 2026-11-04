import assert from 'node:assert/strict';
import { mkdtempSync, existsSync, readdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { once } from 'node:events';
import { DatabaseSync } from 'node:sqlite';
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
  assert.equal(path.dirname(result.backup), path.join(directory, 'backups'), 'recovery copies must enter managed retention');
  assert.match(path.basename(result.backup), /^search-index-pre-local-reconcile-.*\.sqlite$/u);
  assert.ok(readdirSync(path.dirname(result.backup)).every(name => !name.endsWith('.partial')));
  const recoveryDb = new DatabaseSync(result.backup, { readOnly: true });
  try {
    new PcPartsLedger({ db: recoveryDb });
    assert.equal(recoveryDb.prepare('PRAGMA quick_check').get().quick_check, 'ok');
  } finally { recoveryDb.close(); }
  const recoverySummary = localProjectionPlan(result.backup).summary;
  assert.equal(recoverySummary.checksum, first.checksum, 'recovery copy matches the exact pre-apply plan');
  assert.equal(recoverySummary.current_count, first.current_count, 'recovery copy preserves pre-apply listings');
  assert.equal(recoverySummary.stale_count, first.stale_count, 'recovery copy is from before reconciliation');
  const after = localProjectionPlan(file);
  assert.equal(after.summary.current_count, 1); assert.equal(after.summary.stale_count, 0);
  assert.equal(after.state.localPublic[0].canonical_product_id, 'ram:g-skill:ddr5:16gb');
  const unknown = { input: { title: '지스킬 DDR5 32GB KIT', price: 100_000 }, expected: { category_code: 'RAM', quantity_unknown: true } };
  assert.equal(evaluatePcQualityDataset([unknown]).metrics.ram_quantity_price_scope_accuracy, 1);
  const unsafe = { ...unknown, prediction: { category_code: 'RAM', quantity_unknown: true, price_eligible: true } };
  assert.equal(evaluatePcQualityDataset([unsafe]).metrics.ram_quantity_price_scope_accuracy, 0);
  // Exercise the real native HTTP route and publication reader together.
  // Full systems retain search associations while their component identity is null.
  const { createServer } = await import('../dist/web-backend/logic/server.js');
  const { createLocalPcPublicationReader } = await import('../dist/web-backend/logic/pc-local-publication.js');
  const model = 'gpu:nvidia:rtx-5090';
  const fixture = (id, title, price, extra = {}) => ({ item_id: `joonggonara:${id}`, site: 'joonggonara', title,
    url: `https://web.joongna.com/product/${id}`, price_value: price, currency: 'KRW', market_pool: 'KR_C2C_USED',
    canonical_product_id: model, canonical_display_name: 'NVIDIA GeForce RTX 5090', category_code: 'GPU',
    listing_kind: 'SINGLE_COMPONENT', lifecycle_status: 'ACTIVE', statistics_eligible: true, ...extra });
  const publicationPath = path.join(directory, 'pc-listings-publication.json');
  const publication = JSON.stringify({ items: [
    fixture('80001', 'RTX 5090 그래픽카드', 6_000_000),
    fixture('80002', '레노버 LEGION Pro 7 16IAX10 U9 5090 Edition W11 (SSD 1TB)', 7_450_000),
    fixture('80003', 'RTX 5090 단품 판매', 8_000_000),
    fixture('80004', 'RTX 5090 + 라이젠 9950X 묶음 판매', 9_000_000, { canonical_product_id: null,
      listing_kind: 'COMPONENT_BUNDLE', statistics_eligible: false, price_eligible: false,
      components: [{ canonicalProductId: model }, { canonical_product_id: 'cpu:amd:ryzen-9-9950x' }] }),
    fixture('80005', 'RTX 3080 + 라이젠 5600 묶음 판매', 1_000_000, { canonical_product_id: null,
      listing_kind: 'COMPONENT_BUNDLE', statistics_eligible: false, components: ['gpu:nvidia:rtx-3080'] }),
    fixture('378201886', 'rx580 2048sp 8g (판매완료)', 70_000, { canonical_product_id: 'gpu:amd:rx-580' })
  ] });
  writeFileSync(publicationPath, publication);
  const previousPublicationPath = process.env.PC_LISTINGS_PUBLICATION_PATH;
  process.env.PC_LISTINGS_PUBLICATION_PATH = publicationPath;
  let nativeServer;
  try {
    const reader = createLocalPcPublicationReader();
    nativeServer = createServer(0, { initializeStorage: false, publicApiOnly: true, listPcListings: reader.listPcListings });
    if (!nativeServer.listening) await once(nativeServer, 'listening');
    const base = `http://127.0.0.1:${nativeServer.address().port}/api/pc/listings`;
    const requestPage = async (saleComposition, cursor = '', canonicalProductId = model) => {
      const params = new URLSearchParams({ canonical_product_id: canonicalProductId, sale_composition: saleComposition,
        sites: 'joonggonara', sort: 'price_asc', currency: 'KRW', limit: '1' });
      if (cursor) params.set('cursor', cursor);
      const response = await fetch(`${base}?${params}`);
      assert.equal(response.status, 200);
      return (await response.json()).data;
    };
    // Complete PCs are not a public browsing choice; single parts and part bundles are.
    for (const hidden of ['ALL', 'COMPLETE_PC']) {
      const response = await fetch(`${base}?${new URLSearchParams({ canonical_product_id: model, sale_composition: hidden })}`);
      assert.equal(response.status, 400, `${hidden} is not a public sale composition`);
    }
    const single = await requestPage('SINGLE');
    assert.equal(single.total, 2);
    assert.equal(single.model_counts[model], 2);
    assert.equal(single.source_counts.joonggonara, 2);
    assert.equal(single.items[0].item_id, 'joonggonara:80001');
    const next = await requestPage('SINGLE', single.pagination.next_cursor);
    assert.equal(next.items[0].item_id, 'joonggonara:80003');
    assert.equal(next.total, 2);
    assert.equal(next.pagination.has_more, false);
    for (const [composition, id] of [['BUNDLE', '80004']]) {
      const data = await requestPage(composition);
      assert.equal(data.total, 1);
      assert.equal(data.model_counts[model], 1);
      assert.equal(data.items[0].item_id, `joonggonara:${id}`);
      assert.equal(data.items[0].canonical_product_id, null);
      assert.equal(data.items[0].canonical_display_name, null);
      assert.equal(data.items[0].price_eligible, false);
      assert.equal(data.items[0].price_value, id === '80002' ? 7_450_000 : 9_000_000);
      assert.equal(data.items[0].currency, 'KRW');
      assert.equal(data.items[0].statistics_eligible, false);
      assert.equal(data.statistics_coverage.eligible_count, 0);
    }
    const sold = await requestPage('SINGLE', '', 'gpu:amd:rx-580');
    assert.equal(sold.total, 0, 'the actual ACTIVE RX580 sold-title example is removed before HTTP counts and paging');
    assert.deepEqual(sold.items, []);
    assert.equal(readFileSync(publicationPath, 'utf8'), publication, 'presentation reads must not rewrite the publication');
  } finally {
    if (nativeServer) {
      nativeServer.close();
      if (nativeServer.listening) await once(nativeServer, 'close');
    }
    if (previousPublicationPath === undefined) delete process.env.PC_LISTINGS_PUBLICATION_PATH;
    else process.env.PC_LISTINGS_PUBLICATION_PATH = previousPublicationPath;
  }
  console.log(JSON.stringify({ status: 'passed', contract: 'pc-local-projection', backup_verified: true, stale_retired: 1 }));
} finally {
  index?.close();
  if (path.dirname(directory) !== path.resolve(os.tmpdir()) || !path.basename(directory).startsWith('used-pick-local-reconcile-')) throw new Error('UNSAFE_TEST_CLEANUP');
  rmSync(directory, { recursive: true, force: true });
}
