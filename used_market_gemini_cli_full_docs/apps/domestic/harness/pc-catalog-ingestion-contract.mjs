import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { PC_PRODUCT_MASTER_V2 } from '../market/data/pc-product-master-v2.mjs';
import { PcPartsLedger } from '../aws-runner/pc-parts-ledger.mjs';
import { PcShadowPipeline } from '../aws-runner/pc-shadow-pipeline.mjs';
import { pcCatalogResponse } from '../cloudflare/pc-directory-http.mjs';
import { classifyPcPartListingPublic } from '../market/logic/pc-parts-classifier.mjs';

// An API dropdown is not coverage unless a correctly described listing can
// reach that same identity through ingestion. These are synthetic descriptions,
// never marketplace observations or a substitute for human quality review.
const choices = pcCatalogResponse().tools_catalog.products.filter(p =>
  p.category_code !== 'MOTHERBOARD' || p.key_specs?.directory_node_type === 'PRODUCT');
const ids = new Set(choices.map(p => p.canonical_product_id));
const db = new DatabaseSync(':memory:');
const ledger = new PcPartsLedger({ db }); ledger.migrate();
const pipeline = new PcShadowPipeline({ ledger }); await pipeline.initialize();
const date = '2026-09-16T12:00:00.000Z';
const normalize = title => pipeline.normalizeItem({ site: 'joonggonara', title,
  price: 100_000, currency: 'KRW', status: 'ACTIVE' }, date, null, { reclassification: true }).normalized;
const subtype = { AIR_CPU: 'CPU 공랭 쿨러', AIO: 'CPU 수랭 쿨러', CASE_FAN: '케이스 팬' };
const chassis = { MINI_TOWER: '미니타워', MID_TOWER: '미들타워', FULL_TOWER: '빅타워' };
try {
  const products = PC_PRODUCT_MASTER_V2.filter(p => ids.has(p.id));
  assert.equal(products.length, ids.size, 'every selectable identity belongs to the versioned master');
  for (const product of products) {
    const s = product.spec || {};
    let title = product.name;
    if (product.category === 'RAM') title = `${product.manufacturer} ${s.memory_generation} ${s.module_capacity_gb}GB 램`;
    if (['SSD', 'HDD'].includes(product.category)) {
      const gb = s.capacity_examples_gb.at(-1);
      title = `${product.manufacturer} ${product.category === 'SSD' ? 'M.2 NVMe SSD' : 'SATA HDD 하드디스크'} ${gb >= 1000 ? `${gb / 1000}TB` : `${gb}GB`}`;
    }
    if (product.category === 'PSU') title = `${product.manufacturer} ${s.watts_examples.at(-1)}W ATX 파워서플라이`;
    if (product.category === 'COOLING') title = `${product.manufacturer} ${subtype[s.subtype]}`;
    if (product.category === 'CASE') title = `${product.manufacturer} ${chassis[s.chassis_class]} PC 케이스`;
    if (product.category === 'MOTHERBOARD') title += ` 메인보드${s.revision_required ? ` rev ${s.verified_revisions?.[0] || String(s.revision || '1.0').replace(/x/gi, '0')}` : ''}`;
    const result = normalize(`${title} 정상 작동`);
    assert.equal(result.canonicalProductId, product.id, `${title}: ingestion identity equals the selected catalog identity`);
    assert.equal(result.statisticsEligible, true, `${title}: correctly described normal component is comparable (${result.statisticsExclusionReasons})`);
  }
  for (const [title, id] of [
    ['Core Ultra 5 225F', 'cpu:intel:core-ultra-5-225f'],
    ['인텔 코어 울트라 7 265KF', 'cpu:intel:core-ultra-7-265kf'],
    ['울트라9 285K', 'cpu:intel:core-ultra-9-285k'],
    ['Radeon VII', 'gpu:amd:radeon-vii'],
    ['RX Vega 56', 'gpu:amd:rx-vega-56'],
    ['Vega 64', 'gpu:amd:rx-vega-64'],
    ['ASUS ROG CROSSHAIR VIII IMPACT 메인보드', 'motherboard:asus:rog-crosshair-viii-impact']
  ]) {
    assert.equal(normalize(title).canonicalProductId, id);
    assert.equal(classifyPcPartListingPublic({ title, price: 100_000 }).canonical_product_id, id,
      `${title}: the public classifier uses the same product identity`);
  }
  const unsafe = [
    'Intel Core Ultra 9 285KS CPU', 'Intel Core Ultra 7 265HX CPU', 'Intel Core Ultra 5 285K CPU',
    'Intel Core Ultra 9 285K 박스만', 'Intel Core Ultra 7 265K 고장',
    'Intel Core Ultra 7 265K + Core Ultra 9 285K',
    'Intel Core Ultra 7 265K + MSI Z890 메인보드',
    'Intel Core Ultra 7 265K RTX 4070 DDR5 32GB SSD 1TB 컴퓨터 본체',
    'Intel Core Ultra 7 265K 노트북',
    'Radeon VII 박스만', 'RX Vega 56 쿨러만', 'Radeon VII heatsink only',
    'RX Vega 56 + RX Vega 64', 'Radeon VII + RX Vega 64',
    'AMD Ryzen 5 5600 + Radeon VII',
    'Radeon VII Ryzen 5 5600 RAM 16GB SSD 512GB 컴퓨터 본체',
    'ASUS ROG CROSSHAIR VIII IMPACT 박스만', 'ASUS ROG CROSSHAIR VIII IMPACT 메인보드 고장'
  ];
  for (const title of unsafe) assert.equal(normalize(title).statisticsEligible, false, `${title}: not a valid standalone component price`);
  assert.notEqual(normalize('AMD Ryzen 3 3200G CPU Radeon Vega 8').categoryCode, 'GPU', 'an integrated Vega 8 is not Vega 56/64');
  console.log(JSON.stringify({ status: 'passed', contract: 'pc-catalog-ingestion', synthetic_catalog_identities: products.length, negative_boundaries: unsafe.length }));
} finally { db.close(); }
