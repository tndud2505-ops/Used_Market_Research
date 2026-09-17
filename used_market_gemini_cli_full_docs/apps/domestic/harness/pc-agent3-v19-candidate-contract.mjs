import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { PcPartsLedger } from '../aws-runner/pc-parts-ledger.mjs';
import { makeV19ClassifierCandidate, rebaseModuleImports } from './lib/pc-agent3-v19-candidate-source.mjs';

const classifierUrl = new URL('../market/logic/pc-parts-classifier.mjs', import.meta.url);
const pipelineUrl = new URL('../aws-runner/pc-shadow-pipeline.mjs', import.meta.url);
const original = await readFile(classifierUrl, 'utf8');
const originalHash = createHash('sha256').update(original).digest('hex');
const candidateSource = makeV19ClassifierCandidate(original);
const temp = new URL(`../tmp/pc-agent3-v19-candidate-${Date.now()}/`, import.meta.url);
await mkdir(temp, { recursive: true });
const candidateUrl = new URL('classifier.mjs', temp), candidatePipelineUrl = new URL('pipeline.mjs', temp);
await writeFile(candidateUrl, rebaseModuleImports(candidateSource, classifierUrl), { flag: 'wx' });
await writeFile(candidatePipelineUrl, rebaseModuleImports(await readFile(pipelineUrl, 'utf8'), pipelineUrl,
  new Map([[classifierUrl.href, candidateUrl.href]])), { flag: 'wx' });
const { PcShadowPipeline } = await import(candidatePipelineUrl.href);
const { classifyPcPartListing } = await import(candidateUrl.href);
const db = new DatabaseSync(':memory:');
const ledger = new PcPartsLedger({ db }); ledger.migrate();
const pipeline = new PcShadowPipeline({ ledger }); await pipeline.initialize();
const cases = [
  ['total-kit', 'G.Skill DDR4 32GB (16GBx2) KIT 정상 작동', true, 2, 145000],
  ['total-no-kit', 'G.Skill DDR4 32GB (16GBx2) 정상 작동', true, 2, 145000],
  ['reverse', 'G.Skill DDR4 32GB (2x16GB) 정상 작동', true, 2, 145000],
  ['korean', '지스킬 DDR4 32GB (16기가×2) 램 정상 작동', true, 2, 145000],
  ['each', 'G.Skill DDR4 32GB (16GBx2) each 정상 작동', true, 2, 290000],
  ['per-module', 'G.Skill DDR4 32GB (16GBx2) per module 정상 작동', true, 2, 290000],
  ['contradictory-kit', 'G.Skill DDR4 64GB (16GBx2) KIT 정상 작동', false],
  ['contradictory-each', 'G.Skill DDR4 64GB (16GBx2) each 정상 작동', false],
  ['contradictory-no-kit', 'G.Skill DDR4 64GB (16GBx2) 정상 작동', false],
  ['contradictory-multipliers', 'G.Skill DDR4 32GB (16GBx2) (4x8GB) KIT 정상 작동', false],
  ['consistent-multipliers', 'G.Skill DDR4 32GB (16GBx2) (2x16GB) KIT 정상 작동', true, 2, 145000],
  ['unknown-unit', 'G.Skill DDR4 16GB 2개 정상 작동', false],
  ['quantity-only', 'G.Skill DDR4 2개 정상 작동', false],
  ['broken', 'G.Skill DDR4 16GB 고장', false],
  ['accessory', 'G.Skill DDR4 16GB 방열판만', false],
  ['sodimm', 'G.Skill DDR4 16GB 노트북용 SODIMM', false],
  ['rdimm', 'G.Skill DDR4 16GB 서버용 ECC RDIMM', false],
  ['chip-only', '삼성 B-die DDR4 16GB 메모리', false],
  ['module-chip', 'G.Skill DDR4 16GB 삼성 B-die 정상 작동', true, 1, 290000],
  ['ssd-128G', 'WD SN520 NVME SSD 128G 정상 작동', true, 1, 290000],
  ['case-maker-ko', '다크플래시 PC 케이스 미들타워 정상 작동', true, 1, 290000],
  ['nic', '인텔 I350-T2 듀얼포트 기가비트 랜카드', false]
];
const results = [];
try {
  for (const [id, title, eligible, quantity, unit] of cases) {
    const input = { site: 'joonggonara', title, price: 290000, currency: 'KRW', status: 'ACTIVE' };
    const row = pipeline.normalizeItem(input, '2026-09-17T05:30:00.000Z').normalized;
    const problems = [];
    if (row.statisticsEligible !== eligible) problems.push('ELIGIBILITY');
    if (quantity != null && row.quantity !== quantity) problems.push('QUANTITY');
    if (unit != null && row.unitPrice !== unit) problems.push('UNIT_PRICE');
    results.push({ id, expected_eligible: eligible, actual_eligible: row.statisticsEligible, canonical_product_id: row.canonicalProductId,
      quantity: row.quantity, unit_price: row.unitPrice, problems });
  }
  for (const title of ['인텔 I350-T2 랜카드', 'Intel X540-T2 랜카드', 'Intel X520-DA2 랜카드']) {
    assert.equal(classifyPcPartListing({ title }).category_code, 'EXPANSION_CARD');
  }
  assert.equal(classifyPcPartListing({ title: 'Intel i5-12400F CPU 랜카드 별도' }).category_code, 'CPU');
  assert.equal(classifyPcPartListing({ title: 'MSI PRO B650M-P 메인보드 랜카드 별도' }).category_code, 'MOTHERBOARD');
  assert.equal(classifyPcPartListing({ title: '리안리 PC-O11 AIR MINI 화이트 케이스' }).category_code, 'CASE');
  assert.equal(classifyPcPartListing({ title: 'WD NVME SSD 128Gbps' }).canonical_model, null, 'network speed is not disk capacity');
  const catalogContractUrl = new URL('./pc-catalog-ingestion-contract.mjs', import.meta.url);
  const isolatedCatalogContract = new URL('catalog-contract.mjs', temp);
  await writeFile(isolatedCatalogContract, rebaseModuleImports(await readFile(catalogContractUrl, 'utf8'), catalogContractUrl,
    new Map([[classifierUrl.href, candidateUrl.href], [pipelineUrl.href, candidatePipelineUrl.href]])), { flag: 'wx' });
  await import(isolatedCatalogContract.href);
  const changed = createHash('sha256').update(await readFile(classifierUrl)).digest('hex') !== originalHash;
  assert.equal(changed, false, 'the deployed v18 source was never modified');
  const failures = results.filter(row => row.problems.length);
  await writeFile(new URL('candidate-unrebased-source.mjs', temp), candidateSource, { flag: 'wx' });
  await writeFile(new URL('report.json', temp), JSON.stringify({ checked_at: new Date().toISOString(), status: failures.length ? 'failed' : 'passed',
    offline_candidate_only: true, production_mutations: false, active_v18_source_unchanged: !changed, original_sha256: originalHash,
    candidate_sha256: createHash('sha256').update(candidateSource).digest('hex'), cases: results, additional_category_guards: 7,
    synthetic_catalog_ingestion_contract: 'PASS (separate 788 identities and 18 negative boundaries, not actual collection)' }, null, 2));
  console.log(JSON.stringify({ status: failures.length ? 'failed' : 'passed', contract: 'agent3-v19-offline-candidate',
    cases: results.length, failures, additional_category_guards: 7, catalog_contract: 'PASS', active_v18_source_unchanged: !changed, evidence: temp.pathname }, null, 2));
  if (failures.length) process.exitCode = 1;
} finally { db.close(); }
