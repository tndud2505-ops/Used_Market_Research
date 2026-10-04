import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { PcPartsLedger } from '../aws-runner/pc-parts-ledger.mjs';
import { PcShadowPipeline } from '../aws-runner/pc-shadow-pipeline.mjs';
import { PC_PRODUCT_MASTER_V2 } from '../market/data/pc-product-master-v2.mjs';
const db = new DatabaseSync(':memory:');
try {
  const ledger = new PcPartsLedger({ db }); ledger.migrate();
  const pipeline = new PcShadowPipeline({ ledger }); await pipeline.initialize();
  const fixtures = JSON.parse(readFileSync(new URL('./fixtures/pc-parts-cases.json', import.meta.url), 'utf8'));
  const inputs = [...fixtures.map(f => f.input), ...PC_PRODUCT_MASTER_V2.map(p => ({ title: p.name, price: 100_000 }))];
  const normalize = item => pipeline.normalizeItem({ site: 'joonggonara', currency: 'KRW', status: 'ACTIVE', ...item },
    '2026-09-16T12:00:00.000Z', null, { reclassification: true }).normalized;
  for (const item of [
    { title: '기가바이트 AORUS GTX 1080 Ti 11GB 그래픽카드 판매합니다.', description: 'RTX 3060급 전후의 게이밍 성능입니다.', expected: 'gpu:nvidia:gtx-1080-ti' },
    { title: 'RTX3060 12g', description: 'GTX 1080 Ti와 성능 비교 가능합니다.', expected: 'gpu:nvidia:rtx-3060' },
    { title: '3060 12g', expected: 'gpu:nvidia:rtx-3060' },
    { title: '그래픽카드 판매합니다', description: '갤럭시 RTX 3060 12GB 단품 정상작동', expected: 'gpu:nvidia:rtx-3060' },
    { title: 'ASUS TUF RTX 3060 그래픽카드', expected: 'gpu:nvidia:rtx-3060' },
  ]) {
    const row = normalize({ ...item, price: 230000 });
    assert.equal(row.canonicalProductId, item.expected, item.title);
    assert.equal(row.statisticsEligible, true, `preserve valid component: ${item.title}`);
  }
  for (const item of [
    { title: 'Asus tuf dash f15 fx516pm i7 rtx 3060', search_text: '게이밍노트북 에이수스tuf 노트북' },
    { title: 'S급>DELL XPS 17 9720 4K UHD SSD1TB RTX3060', description: 'DELL XPS 17 9720 노트북 판매합니다.' },
    { title: 'RTX3060 탑재 기기', description: '노트북 판매합니다.' },
    { title: 'ASUS TUF Dash F15 RTX 3060 GPU 탈거 부품 정상 작동' },
    { title: 'DELL XPS 17 RTX 3060 GPU 탈거 부품' },
  ]) {
    const row = normalize({ ...item, price: 680000 });
    assert.notEqual(row.canonicalProductId, 'gpu:nvidia:rtx-3060', item.title);
    assert.equal(row.statisticsEligible, false, item.title);
  }
  const expected = inputs.map(normalize);
  const actual = ledger.withReclassificationAliasSnapshot(() => inputs.map(normalize));
  assert.deepEqual(actual, expected, 'frozen catalogue has exactly the same matching/ambiguity/forbidden semantics');
  assert.equal(ledger.reclassificationAliases, null, 'live operations cannot retain a stale alias catalogue');
  assert.throws(() => ledger.withReclassificationAliasSnapshot(() => { throw new Error('fixture'); }), /fixture/);
  assert.equal(ledger.reclassificationAliases, null, 'exception restores the ordinary live lookup path');
  const id = 'cpu:intel:i5-12400f', alias = 'QZXNVBRQZX';
  assert.equal(ledger.matchAliasInText('CPU', alias), null);
  ledger.addAlias({ canonicalProductId: id, masterVersion: 5, aliasText: alias, validationStatus: 'APPROVED' });
  assert.equal(ledger.matchAliasInText('CPU', alias).canonical_product_id, id, 'later approved catalogue changes are immediately visible');
  console.log(JSON.stringify({ status: 'passed', contract: 'pc-reclassification-alias', identical_normalizations: inputs.length }));
} finally { db.close(); }
