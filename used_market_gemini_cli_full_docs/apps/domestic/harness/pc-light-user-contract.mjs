import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { PcPartsLedger } from '../aws-runner/pc-parts-ledger.mjs';
import { PcShadowPipeline } from '../aws-runner/pc-shadow-pipeline.mjs';
import { pcCatalogResponse, pcProductsResponse, pcCollectionTargetSetV2, pcCollectionCapacityPlan } from '../cloudflare/pc-directory-http.mjs';
import { PC_PRODUCT_MASTER_V2 } from '../market/data/pc-product-master-v2.mjs';
import { pcProductMatchesQuery } from '../market/logic/pc-product-search.mjs';
import { filterToolProducts, toolBrand, toolFilterSchema, toolFacetValues, toolQueryMatches, visibleSelection } from '../web-backend/public/pc-tools-catalog.mjs';
import { buildTotals, metricValue, dailySeries } from '../web-backend/public/pc-tools-core.mjs';
import { createPriceStore } from '../web-backend/public/pc-tools-data.mjs';

const catalog = pcCatalogResponse(), tools = catalog.tools_catalog.products;
const searchableTools = filterToolProducts(tools);
const publicIds = new Set(catalog.public_catalog.products.map(p => p.canonical_product_id));
for (const p of searchableTools) {
  const facets = Object.fromEntries(toolFilterSchema(p.category_code).map(([key]) => [key, toolFacetValues(p, key)[0] || '']));
  assert.ok(filterToolProducts(tools, { category: p.category_code, manufacturer: toolBrand(p), facets })
    .some(row => row.canonical_product_id === p.canonical_product_id), `${p.canonical_product_id}: reachable through category-specific controls`);
  assert.ok(toolQueryMatches(p, p.canonical_display_name), `${p.canonical_product_id}: searchable by displayed name`);
  const master = PC_PRODUCT_MASTER_V2.find(row => row.id === p.canonical_product_id);
  for (const query of [p.canonical_display_name, p.brand, 'G.Skill', 'gskill', 'G SKILL', '지스킬', '14700k']) {
    assert.equal(toolQueryMatches(p, query), pcProductMatchesQuery(master, query), `${p.canonical_product_id}: browser/API query parity for ${query}`);
  }
  if (publicIds.has(p.canonical_product_id)) {
    const result = pcProductsResponse(`https://example.test/api/pc/products?category_code=${p.category_code}&q=${encodeURIComponent(p.canonical_display_name)}&limit=100`);
    assert.ok(result.products.items.some(row => row.id === p.canonical_product_id), `${p.canonical_product_id}: public product route`);
  }
}
for (const q of ['G.Skill', 'gskill', 'G SKILL', 'G-SKILL', '지스킬']) {
  const result = pcProductsResponse(`https://example.test/api/pc/products?category_code=RAM&q=${encodeURIComponent(q)}`);
  assert.equal(result.products.total, 27, `${q}: all G.Skill DDR/capacity nodes`);
  assert.equal(filterToolProducts(tools, { category: 'RAM', query: q }).length, 27);
}
const gskill16 = filterToolProducts(tools, { category: 'RAM', query: '지스킬', facets: { memory_generation: 'DDR4', module_capacity_gb: '16' } });
assert.deepEqual(gskill16.map(p => p.canonical_product_id), ['ram:g-skill:ddr4:16gb']);
assert.equal(visibleSelection(gskill16, 'ram:samsung:ddr4:16gb'), 'ram:g-skill:ddr4:16gb', 'a manufacturer change must change the selected analysis model');
assert.equal(visibleSelection([], 'ram:g-skill:ddr4:16gb'), '', 'empty search cannot retain a stale chart');
assert.ok(filterToolProducts(tools, { category: 'MOTHERBOARD', manufacturer: 'ASUS' }).length > 0, 'motherboard maker is ASUS, not the platform Intel/AMD');
assert.equal(filterToolProducts(tools, { category: 'CPU', query: '14700k' }).some(p => p.canonical_product_id.endsWith('14700kf')), false, 'CPU suffixes stay distinct');
assert.equal(metricValue({ sample_count: 1, min: 50_000, max: 50_000, average: 50_000 }), null, 'legacy one-row average must not enter a build total');
assert.equal(metricValue({ sample_count: 4, min: 1, max: 10, mean: 4, median: 5 }), 5, '3–4 samples use median only');

const db = new DatabaseSync(':memory:');
const observedAt = '2026-09-16T12:00:00.000Z';
const ledger = new PcPartsLedger({ db, now: () => new Date(observedAt) }); ledger.migrate();
const pipeline = new PcShadowPipeline({ ledger }); await pipeline.initialize();
const normalize = title => pipeline.normalizeItem({ site: 'joonggonara', title, price: 100_000, currency: 'KRW', status: 'ACTIVE' }, observedAt).normalized;
for (const brand of ['G.Skill', 'gskill', 'G SKILL', 'G-SKILL', '지스킬']) {
  const row = normalize(`${brand} DDR4 32GB (16GBx2) KIT 정상 작동`);
  assert.equal(row.canonicalProductId, 'ram:g-skill:ddr4:16gb');
  assert.equal(row.quantity, 2); assert.equal(row.unitPrice, 50_000); assert.equal(row.statisticsEligible, true);
  const implicitKit = normalize(`${brand} DDR4 32GB (16GBx2) 정상 작동`);
  assert.equal(implicitKit.canonicalProductId, 'ram:g-skill:ddr4:16gb');
  assert.equal(implicitKit.quantity, 2); assert.equal(implicitKit.unitPrice, 50_000);
  assert.equal(implicitKit.statisticsEligible, true, 'a fully stated total and module count do not require the word KIT');
}
for (const title of ['지스킬 ddr4 4000 32gb (16기가x2) 램 팝니다.',
  'G.SKILL 트라이던트Z RGB DDR4 32GB (16GBx2) 메모리 램',
  'G.Skill DDR5 램 32GB (16X2) 6400 CL32', 'G.Skill DDR5 (16x2, 32gb)',
  'G.Skill DDR5 5600 16GB x 2 32GB 램 메모리', 'G.SKILL Flare X5 32GB (2x16GB) DDR5-6000 CL36 AMD EXPO Desktop RAM']) {
  const row = normalize(title);
  assert.equal(row.quantity, 2); assert.equal(row.unitPrice, 50_000); assert.equal(row.totalPrice, 100_000);
  assert.equal(row.statisticsEligible, true, `observed complete-kit wording: ${title}`);
}
for (const marker of ['개당', 'each', 'per module']) {
  const unit = normalize(`G.Skill DDR4 32GB (16GBx2) ${marker} 정상 작동`);
  assert.equal(unit.priceScope, 'UNIT'); assert.equal(unit.unitPrice, 100_000); assert.equal(unit.totalPrice, 200_000);
}
for (const title of ['G.Skill DDR4 16GB 2개', 'G.Skill DDR4 64GB (16GBx2)',
  'G.Skill DDR4 32GB/64GB (16GBx2)', 'G.Skill DDR4 32GB (16GBx2) each 일괄']) {
  assert.equal(normalize(title).statisticsEligible, false, `ambiguous or conflicting kit pricing stays excluded: ${title}`);
}
assert.equal(normalize('G.Skill DDR4 16GB 삼성 B-die 정상 작동').canonicalProductId, 'ram:g-skill:ddr4:16gb', 'chip maker does not override module maker');
assert.equal(normalize('G.Skill DDR4 16GB 삼성 DDR4 16GB').statisticsEligible, false, 'conflicting module makers remain ambiguous');
assert.equal(normalize('삼성 B-die DDR4 16GB 메모리').statisticsEligible, false, 'chip-only mention cannot invent a module maker');
for (const title of [
  '지스킬 DDR3 2400 트라이던트 쿼드킷 *16G* 성배급 풀뱅크 램',
  'G.Skill DDR5 32GB KIT', '삼성 DDR4 16GB 2개',
  '지스킬 DDR4 16GB 노트북용 SODIMM', 'G.Skill DDR4 16GB 방열판만',
  'G.Skill DDR4 16GB 고장', 'G.Skill DDR4 16GB 박스만'
]) assert.equal(normalize(title).statisticsEligible, false, `unsafe price sample: ${title}`);

const fixtures = [
  ['CPU', 'Intel i5-12400F CPU 정상 작동', 'cpu:intel:i5-12400f'],
  ['GPU', 'ASUS RTX 3060 Ti 그래픽카드 정상 작동', 'gpu:nvidia:rtx-3060-ti'],
  ['RAM', '지스킬 DDR4 32GB (16GBx2) KIT 정상 작동', 'ram:g-skill:ddr4:16gb'],
  ['MOTHERBOARD', 'MSI PRO B650M-P 메인보드 정상 작동', 'motherboard:msi:pro-b650m-p'],
  ['SSD', '삼성 980 PRO M.2 NVMe SSD 1TB 정상 작동', 'ssd:samsung:capacity-bucket:513-gb-1-tb'],
  ['HDD', 'WD Blue HDD 4TB 하드디스크 정상 작동', 'hdd:western-digital:capacity-bucket:gt-2-tb-le-4-tb'],
  ['PSU', '시소닉 VERTEX GX-850 ATX 3.0 파워 정상 작동', 'psu:seasonic:watts-bucket:751-850'],
  ['CASE', 'Fractal Design North PC 케이스 미들타워 정상 작동', 'case:facet:mid-tower:fractal-design'],
  ['COOLING', '녹투아 NH-D15 CPU 공랭 쿨러 정상 작동', 'cooling:facet:air-cpu:noctua']
];
const published = new Map();
try {
  for (const [category, title, id] of fixtures) {
    assert.ok(tools.some(p => p.canonical_product_id === id), `${id}: fixture uses a real tool catalog identity`);
    assert.equal(publicIds.has(id), !['CASE', 'COOLING'].includes(category), 'tool-only categories do not expand marketplace scope');
    for (let i = 0; i < 5; i++) {
      const result = pipeline.recordItem({ site: 'joonggonara', source_listing_id: `light-${category}-${i}`, title,
        price: (50_000 + i * 10_000) * (category === 'RAM' ? 2 : 1), currency: 'KRW', status: 'ACTIVE' }, observedAt);
      assert.equal(result.canonical_product_id, id, `${category}: classification → catalog identity`);
      assert.equal(result.statistics_eligible, true, `${category}: valid comparison sample`);
    }
    const data = ledger.rebuildAndGetPriceStats({ canonicalProductId: id, days: 30, marketPool: 'KR_C2C_USED', condition: 'USED_WORKING', currency: 'KRW', asOf: observedAt });
    assert.equal(data.active.sample_count, 5, `${category}: 5 sellers count as 5 samples`);
    assert.equal(data.active.mean, 70_000, `${category}: exact per-component mean`);
    published.set(id, { ...data, canonical_product_id: id, window: { from: '2026-08-18', to: '2026-09-16' } });
  }
  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = async input => {
      const url = new URL(input, 'https://example.test');
      const id = decodeURIComponent(url.pathname.match(/^\/api\/products\/(.*)\/price-stats$/u)[1]);
      assert.equal(url.searchParams.get('market_pool'), 'KR_C2C_USED');
      return new Response(JSON.stringify({ status: 'success', data: published.get(id) }), { status: 200 });
    };
    const store = createPriceStore(() => {}), selections = fixtures.map(([category, , id]) => ({ category, id, quantity: category === 'RAM' ? 2 : 1 }));
    await store.load(selections.map(e => tools.find(p => p.canonical_product_id === e.id)), 30);
    for (const entry of selections) {
      const data = store.get(entry.id, 30); assert.equal(data.state, 'ready');
      assert.equal(dailySeries(data.data, 'active', 30).at(-1).value, 70_000, `${entry.category}: published series → price analysis`);
    }
    assert.equal(buildTotals(selections, e => store.get(e.id, 30).data).active.amount, 700_000, 'all 9 parts plus a second RAM module reach the builder sum');
  } finally { globalThis.fetch = originalFetch; }
  for (const title of ['녹투아 NH-D15 CPU 공랭 쿨러 고장', 'Fractal Design North PC 케이스 미개봉', '녹투아 NH-D15 CPU 공랭 쿨러 서버용', 'Fractal Design North PC 케이스 + RTX 3080 본체',
    '녹투아 NH-D15 CPU 공랭 쿨러 브라켓만', 'Fractal Design North PC 케이스 측면패널만']) {
    assert.equal(normalize(title).statisticsEligible, false, `${title}: invalid tool comparison sample stays excluded`);
  }
  assert.ok(filterToolProducts(tools, { category: 'COOLING', query: '녹투아' }).length > 0);
  // Activating against a populated old target set catches reuse bugs that an
  // empty-memory catalog check cannot detect.
  ledger.activateCollectionTargets({ targetSetVersion: 'pc-targets:4:full-master-v12', directoryVersion: 4,
    targets: [{ targetId: 'pc-target:4:market-v12:RAM:2', categoryCode: 'RAM', queryText: 'DDR3 램', sourceKeys: ['joonggonara'] }] });
  const nextSet = pcCollectionTargetSetV2();
  ledger.activateCollectionTargets(nextSet);
  ledger.activateCollectionTargets(nextSet);
  assert.equal(ledger.getActiveCollectionTargetSummary().enabled_target_count, nextSet.targets.length);
} finally { db.close(); }
const targetSet = pcCollectionTargetSetV2();
const capacity = pcCollectionCapacityPlan(85);
assert.equal(capacity.all_sources_sufficient, true, 'collection changes cannot exceed the existing 85-target budget');
console.log(JSON.stringify({ status: 'passed', contract: 'pc-light-user', public_models: publicIds.size, reachable_tool_models: searchableTools.length,
  pipeline_categories: fixtures.length, target_set: targetSet.targetSetVersion || targetSet.target_set_version }, null, 2));
