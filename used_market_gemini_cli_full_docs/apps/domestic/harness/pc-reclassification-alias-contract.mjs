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
