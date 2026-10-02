import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseDanawaSearchHtml, collectDanawaSearchListings, collectDanawaSearchTargetBatch, createDanawaPacedFetch } from '../collector/logic/danawa-search.mjs';
import { getSourceRuntimeDefaults, operatorAttestedSourceGovernance, runSourceCollection } from '../collector/logic/pc-source-registry.mjs';
import { PcPartsLedger } from '../aws-runner/pc-parts-ledger.mjs';
import { PcShadowPipeline } from '../aws-runner/pc-shadow-pipeline.mjs';
import { withDomesticStatsScopes } from '../market/logic/pc-market-pools.mjs';
import { canonicalSourceListingToken } from '../aws-runner/pc-source-listing-identity.mjs';
import { pcCollectionTargetSetV2 } from '../cloudflare/pc-directory-http.mjs';

const card = (title, price, code, specs = '', category = 'RAM', catalogue = true, variant = '16GB') => `<li class="prod_item" id="productItem${code}">
  <p class="prod_name"><a href="https://prod.danawa.com/${catalogue ? `info/?pcode=${code}` : `bridge/go_link_goods.php?cmpny_c=TEST&link_prod_c=${code}`}">${title}</a></p>
  <div class="spec_list">${specs}</div><dl class="prod_category_location"><dd><a href="https://prod.danawa.com/list/?cate=112752">${category}</a></dd></dl>
  <dl class="rel_special"><dd>혜택 최저가 1,000원</dd></dl><div class="prod_pricelist"><ul><li>
    <p class="price_sect"><a><strong>${price.toLocaleString('en-US')}</strong>원</a></p><p class="memory_sect">${variant}</p>
  </li></ul></div></li>`;
const desktop = '데스크탑용 / DDR5 / 5600MHz / 램개수: 1개';
const used = card('삼성전자 DDR5-5600 중고', 50000, '101', desktop);
const html = `<div id="productListArea"><ul>${used}
  ${card('삼성전자 [중고] DDR5 16GB 5600MHz 데스크탑메모리', 55000, '102', '', 'RAM', false)}
  ${card('삼성전자 DDR5-4800 중고', 90000, '103', desktop.replace('5600', '4800'))}
  ${card('삼성전자 DDR5-5600 신품', 70000, '104', desktop)}
  ${card('삼성전자 노트북 DDR5-5600 중고', 60000, '105', '노트북용 / DDR5')}
  ${card('[중고] 삼성 DDR5 16GB ECC/REG 서버용 메모리', 65000, '106')}
  ${card('[중고] HP 노트북 i5-13400 DDR5 16GB SSD 512GB', 600000, '107')}
  ${card('[중고] 삼성 DDR5 16GB 5600MHz 불량 부품용', 5000, '108')}
  <li class="adSmartArea">${card('삼성 DDR5-5600 신품 광고', 1000, '109')}</li>
</ul></div>`;
const parsed = parseDanawaSearchHtml(html, { categoryCode: 'RAM', query: 'DDR5 16GB 중고' });
assert.equal(parsed.length, 2, 'one catalog offer per variant; exclude new/laptop/server/system/broken/ads');
assert.deepEqual(parsed.map(row => row.price), [50000, 90000], 'use normal price, never card discount');
assert.ok(parsed.every(row => row.seller_type === 'DEALER' && row.status === 'ACTIVE'));
assert.equal(canonicalSourceListingToken('danawa', parsed[0].source_listing_id), parsed[0].source_listing_id);
assert.equal(parseDanawaSearchHtml(used, { categoryCode: 'CPU' }).length, 0);
for (const host of ['user:pass@prod.danawa.com', 'prod.danawa.com:8443']) {
  assert.equal(parseDanawaSearchHtml(used.replace('prod.danawa.com', host), {categoryCode:'RAM'}).length, 0);
}
assert.equal(parseDanawaSearchHtml(used.replace('>RAM<', '>CPU<'), { categoryCode: 'RAM' }).length, 1,
  'source category error must not override product specifications');
const ssd = parseDanawaSearchHtml(
  card('삼성전자 970 EVO Plus M.2 NVMe 중고', 150000, '301', 'DDR4 1GB / M.2 / NVMe / SLC 42GB / TBW 600TB', 'SSD', true, '1TB 150원/1GB')
  + card('[중고] Samsung 970 EVO Plus SSD 1TB', 155000, '302', '', 'SSD', false, '')
  + card('삼성전자 970 EVO Plus M.2 NVMe 중고', 70000, '303', 'DDR4 512MB / M.2 / NVMe', 'SSD', true, '500GB')
  + card('삼성전자 PM1735 PCIe 중고', 300000, '304', 'PCIe', 'SSD', true, '1.6TB'), {categoryCode: 'SSD'});
assert.equal(ssd.length, 2, 'deduplicate storage catalog/shop models; keep capacities separate; exclude enterprise SSD');
assert.ok(ssd.some(item => item.title.endsWith('1TB') && item.price === 150000));
const gpu = parseDanawaSearchHtml(card('MSI 지포스 RTX 3060 Ti 8GB 중고', 250000, '401', '', 'GPU', true, '')
  + card('[중고] MSI GeForce RTX 3060 Ti 8GB 그래픽카드', 260000, '402', '', 'GPU', false, ''), {categoryCode: 'GPU'});
assert.equal(gpu.length, 1, 'canonical GPU specifications deduplicate different title wording');
const cpu = parseDanawaSearchHtml(card('인텔 코어 i5-<b>12400</b>F 중고', 140000, '501', 'DDR4 / DDR5 / 지원 메모리 128GB', 'CPU', true, '')
  + card('인텔 코어 i5-12400F CPU 중고+쿨러 중고', 160000, '502', '', 'CPU', false, ''), {categoryCode:'CPU'});
assert.equal(cpu.length, 1, 'inline search highlights preserve CPU suffixes; bundled prices are excluded');
assert.ok(cpu[0].title.includes('i5-12400F'));
const brands = parseDanawaSearchHtml(used + card('마이크론 Crucial DDR5-5600 중고', 115000, '601', `${desktop}/모듈제조사: 마이크론`)
  + card('마이크론 Crucial DDR5-5600 16GB 중고', 120000, '602', '', 'RAM', false), {categoryCode:'RAM'});
assert.equal(brands.length, 2, 'preserve different module manufacturers and deduplicate the shop offer');
const collected = await collectDanawaSearchListings({ query: 'DDR5 16GB', categoryCode: 'RAM', fetchImpl: async url => {
  assert.equal(new URL(url).searchParams.get('query'), 'DDR5 16GB 중고');
  return new Response(html);
} });
assert.equal(collected.items.length, 2);
await assert.rejects(collectDanawaSearchListings({ query: 'RAM', fetchImpl: async () => new Response('', {status: 403}) }), /HTTP_403/u);

let fakeNow = 0;
const requestedAt = [];
const pacedFetch = createDanawaPacedFetch({ now: () => fakeNow,
  wait: async ms => { fakeNow += ms; },
  fetchImpl: async () => { requestedAt.push(fakeNow); return new Response(''); }
});
await Promise.all([pacedFetch('first'), pacedFetch('second'), pacedFetch('third')]);
assert.equal(requestedAt.length, 3);
assert.ok(requestedAt.slice(1).every((time, index) => time - requestedAt[index] >= 5_000),
  'even concurrent callers must leave five seconds between Danawa requests');

const batchTargets = Array.from({length:85}, (_, index) => ({target_id:String(index)}));
for (const message of ['DANAWA_SEARCH_HTTP_403', 'DANAWA_SEARCH_HTTP_429', 'DANAWA_SEARCH_BLOCKED']) {
  let calls = 0;
  const blocked = await collectDanawaSearchTargetBatch({ targets:batchTargets,
    collectTarget:async () => { calls += 1; throw new Error(message); }
  });
  assert.equal(calls, 1, 'access denial must stop the batch before the other 84 targets');
  assert.equal(blocked.length, 1, 'unattempted targets must not become failed request records');
}
let partialCalls = 0;
const partialBatch = await collectDanawaSearchTargetBatch({ targets:batchTargets,
  collectTarget:async target => {
    partialCalls += 1;
    if (partialCalls === 3) throw new Error('DANAWA_SEARCH_HTTP_403');
    return {target,items:[parsed[partialCalls-1]]};
  }
});
assert.equal(partialCalls, 3);
assert.deepEqual(partialBatch.filter(result => result.status === 'fulfilled').flatMap(result => result.value.items), parsed,
  'keep valid items collected before access was denied');
const previousSuccess = '2026-10-01T00:00:00.000Z';
const blockedNow = '2026-10-03T00:19:00.000Z';
const lateBlocked = await runSourceCollection({ sourceKey:'danawa', now:blockedNow,
  governance:operatorAttestedSourceGovernance('danawa', {now:blockedNow}),
  runtime:{...getSourceRuntimeDefaults('danawa'),last_succeeded_at:previousSuccess},
  adapter:{sourceKey:'danawa',collectIncremental:async () => ({items:parsed,next_cursor:'partial',
    metrics:{request_count:41,request_failure_count:1,http_blocked_count:1,captcha_count:0}})}
});
assert.equal(lateBlocked.status, 'partial_success', 'a late block cannot be hidden by a high success rate');
assert.equal(lateBlocked.reason, 'SOURCE_ACCESS_BLOCKED');
assert.deepEqual(lateBlocked.result.items, parsed);
assert.equal(lateBlocked.next_runtime.last_succeeded_at, previousSuccess);
assert.ok(Date.parse(lateBlocked.next_runtime.backoff_until) > Date.parse(blockedNow));

const directTargets = pcCollectionTargetSetV2().targets.filter(target => target.categoryCode === 'RAM'
  && target.cadenceClass === 'HOURLY_CATEGORY' && target.sourceKeys.includes('danawa')).slice(0, 3);
assert.equal(directTargets.length, 3);
for (const partial of [false, true]) {
  const fixtureRoot = mkdtempSync(path.join(os.tmpdir(), 'used-pick-danawa-'));
  try {
    const preload = path.join(fixtureRoot, 'mock-fetch.mjs');
    const output = path.join(fixtureRoot, 'projection.sql');
    if (partial) writeFileSync(output, 'existing export must not be overwritten');
    writeFileSync(preload, `let calls=0;globalThis.fetch=async()=>{
      if (${partial} && ++calls===1) return new Response(${JSON.stringify(html)});
      return new Response('',{status:403});
    };`);
    const run = spawnSync(process.execPath, ['--import', pathToFileURL(preload).href,
      fileURLToPath(new URL('../aws-runner/collect-pc-source-now.mjs', import.meta.url))], {
      env:{...process.env,PC_COLLECT_SOURCE:'danawa',PC_COLLECT_CADENCE_CLASS:'HOURLY_CATEGORY',
        PC_COLLECT_TARGET_IDS:directTargets.map(target => target.targetId).join(','),PC_COLLECT_PRODUCT_IDS:'',
        PC_COLLECT_TARGET_OFFSET:'0',PC_COLLECT_TARGET_LIMIT:'3',RUNNER_INDEX_DIR:fixtureRoot,
        RUNNER_INDEX_PATH:path.join(fixtureRoot,'index.sqlite'),D1_IMPORT_URL:'',
        CLOUDFLARE_MANUAL_RUN_TOKEN:'',IMPORT_TOKEN:'',PC_D1_SQL_OUTPUT:output},
      encoding:'utf8',timeout:20_000
    });
    assert.equal(run.status, 1, `blocked direct collection must report failure: ${run.stderr}`);
    assert.ok(existsSync(path.join(fixtureRoot, 'index.sqlite')), run.stderr);
    const fixtureDb = new DatabaseSync(path.join(fixtureRoot, 'index.sqlite'), {readOnly:true});
    try {
      const audit = fixtureDb.prepare('SELECT request_count,request_failure_count,http_blocked_count FROM crawl_runs').get();
      assert.equal(audit.request_count, partial ? 2 : 1);
      assert.equal(audit.request_failure_count, 1);
      assert.equal(audit.http_blocked_count, 1);
      assert.equal(fixtureDb.prepare("SELECT COUNT(*) AS n FROM pc_source_target_runtime WHERE source_id='danawa'").get().n,
        partial ? 2 : 1, 'unattempted targets retain their previous runtime');
      assert.equal(fixtureDb.prepare("SELECT COUNT(*) AS n FROM pc_source_target_runtime WHERE source_id='danawa' AND last_succeeded_at IS NOT NULL").get().n,
        0, 'failed persistence must not mark fetched targets as successfully stored');
      const runtime = fixtureDb.prepare("SELECT failure_count,backoff_until,last_succeeded_at FROM source_runtime WHERE source_id='danawa'").get();
      assert.equal(runtime.failure_count, 1);
      assert.ok(runtime.backoff_until, 'persist Danawa backoff even if partial SQL export subsequently fails');
      assert.equal(runtime.last_succeeded_at, null);
      if (partial) assert.ok(fixtureDb.prepare("SELECT COUNT(*) AS n FROM raw_listings WHERE source_id='danawa'").get().n > 0,
        'preserve the valid partial collection when export fails');
    } finally { fixtureDb.close(); }
  } finally {
    assert.equal(path.dirname(path.resolve(fixtureRoot)), path.resolve(os.tmpdir()));
    assert.ok(path.basename(fixtureRoot).startsWith('used-pick-danawa-'));
    rmSync(fixtureRoot, {recursive:true,force:true});
  }
}

const db = new DatabaseSync(':memory:');
const ledger = new PcPartsLedger({ db }); ledger.migrate();
const pipeline = new PcShadowPipeline({ ledger }); await pipeline.initialize();
assert.equal(pipeline.normalizeItem(brands.find(item => item.title.includes('마이크론'))).normalized.canonicalProductId, 'ram:micron:ddr5:16gb');
const observedAt = '2026-09-30T03:00:00.000Z';
const projections = parsed.map(item => pipeline.recordItem(item, observedAt));
assert.ok(projections.every(row => row.market_pool === 'KR_DEALER_USED' && row.statistics_eligible),
  'retain dealer pool while allowing comparable dealer observations');
assert.ok(projections.every(row => row.good_listing_eligible === false));
const product = projections[0].canonical_product_id;
assert.equal(product, projections[1].canonical_product_id);
for (const [index, price] of [10000, 20000, 30000, 40000].entries()) pipeline.recordItem({
  site: 'bunjang', source_listing_id: String(8000000 + index), title: '삼성전자 DDR5 16GB 데스크탑 램 중고',
  price, currency: 'KRW', status: 'ACTIVE', url: `https://m.bunjang.co.kr/products/${8000000+index}`
}, observedAt);
pipeline.recordItem({ site: 'ebay', source_listing_id: '123456789012', title: 'Samsung DDR5 16GB desktop RAM used',
  price: 999, currency: 'USD', status: 'ACTIVE', url: 'https://www.ebay.com/itm/123456789012' }, observedAt);
const options = { canonicalProductId: product, marketPool: 'KR_DOMESTIC_USED', condition: 'USED_WORKING',
  currency: 'KRW', days: 30, asOf: observedAt };
const stats = ledger.rebuildAndGetPriceStats(options);
assert.equal(stats.active.sample_count, 6);
assert.equal(stats.active.mean, 40000, 'domestic mean weights six actual observations, not source means');
assert.equal(stats.by_source.find(row => row.source_id === 'danawa').active.sample_count, 2);
assert.ok(!stats.by_source.some(row => row.source_id === 'ebay'));
assert.equal(stats.sold.sample_count, 0); assert.equal(stats.confirmed_transactions.sample_count, 0);
assert.equal(ledger.rebuildAndGetPriceStats({...options, marketPool: 'KR_C2C_USED'}).active.sample_count, 4);
assert.equal(ledger.rebuildAndGetPriceStats({...options, marketPool: 'KR_DEALER_USED'}).active.sample_count, 2);
const scopes = withDomesticStatsScopes([{canonical_product_id: product, market_pool:'KR_C2C_USED',condition_code:'USED_WORKING',currency:'KRW'},
  {canonical_product_id: product, market_pool:'KR_DEALER_USED',condition_code:'USED_WORKING',currency:'KRW'}]);
assert.equal(scopes.filter(scope => scope.market_pool === 'KR_DOMESTIC_USED').length, 1);
assert.equal(ledger.runIntegrityAudit(observedAt).ok, true);
db.close();
console.log(JSON.stringify({contract:'danawa-domestic', parser_variants:parsed.length, domestic_samples:stats.active.sample_count,
  domestic_mean:stats.active.mean, danawa_samples:2, ebay_excluded:true, false_sales:0}));
