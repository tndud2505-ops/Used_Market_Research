import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, writeFileSync, rmSync, existsSync, readFileSync, readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseDanawaSearchHtml, collectDanawaSearchListings, collectDanawaSearchTargetBatch, createDanawaPacedFetch, danawaPublicCardEvidence, danawaPartialItems, modernSearchCards } from '../collector/logic/danawa-search.mjs';
import { DANAWA_COLLECTION_LIMITS, getSourceRuntimeDefaults, operatorAttestedSourceGovernance, runSourceCollection } from '../collector/logic/pc-source-registry.mjs';
import { PcPartsLedger } from '../aws-runner/pc-parts-ledger.mjs';
import { PcShadowPipeline } from '../aws-runner/pc-shadow-pipeline.mjs';
import { withDomesticStatsScopes } from '../market/logic/pc-market-pools.mjs';
import { canonicalSourceListingToken } from '../aws-runner/pc-source-listing-identity.mjs';
import { collectDanawaCategoryListings } from '../collector/logic/pc-source-adapters.mjs';
import { pcCollectionTargetSetV2 } from '../cloudflare/pc-directory-http.mjs';
import { danawaResponseOutline, saveDanawaResponseEvidence } from '../aws-runner/danawa-response-evidence.mjs';

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
const desktopCpu = parseDanawaSearchHtml(
  card('HP [중고] [리퍼] HP 마이크로타워 데스크탑 280 Pro G8 (i5-11400/8G/S256/윈11P)', 569000, '503', '', 'CPU', false, '')
  + card('인텔 코어 i5-11400 CPU 단품 중고', 150000, '504', 'DDR4 / 지원 메모리 128GB', 'CPU', true, ''), {categoryCode:'CPU'});
assert.deepEqual(desktopCpu.map(item => item.price), [150000], 'complete desktop price never replaces a valid CPU offer');
const brands = parseDanawaSearchHtml(used + card('마이크론 Crucial DDR5-5600 중고', 115000, '601', `${desktop}/모듈제조사: 마이크론`)
  + card('마이크론 Crucial DDR5-5600 16GB 중고', 120000, '602', '', 'RAM', false), {categoryCode:'RAM'});
assert.equal(brands.length, 2, 'preserve different module manufacturers and deduplicate the shop offer');
const collected = await collectDanawaSearchListings({ query: 'DDR5 16GB', categoryCode: 'RAM', fetchImpl: async url => {
  assert.equal(new URL(url).searchParams.get('query'), 'DDR5 16GB 중고');
  return new Response(html);
} });
assert.equal(collected.items.length, 2);
const modernHtml = readFileSync(new URL('./fixtures/source-pages/danawa-search-modern.html', import.meta.url),'utf8');
const modernRam = parseDanawaSearchHtml(modernHtml,{categoryCode:'RAM'});
assert.deepEqual(modernRam.map(item=>[item.source_variant,item.price,new URL(item.url).searchParams.get('pcode')]),[
  ['8GB',185320,'122623097'],['8GB',220000,'68686664'],['16GB',349590,'122621367'],
  ['32GB',768880,'123799337'],['32GB',848990,'124413575']
], 'bind every desktop capacity to its own displayed price and pcode; exclude laptop RAM');
assert.deepEqual(parseDanawaSearchHtml(modernHtml,{categoryCode:'SSD'}).map(item=>[item.source_variant,item.price]),
  [['120GB',18600],['120GB',22900],['120GB',23990]],'retain distinct SSD models without treating unit prices, transfer rates or weight as capacity');
assert.deepEqual(parseDanawaSearchHtml(modernHtml,{categoryCode:'PSU'}).map(item=>item.price),[31913,51000],
  'shop price excludes shipping and equivalent shop offers deduplicate');
const modernCollected = await collectDanawaSearchListings({query:'DDR5',categoryCode:'RAM',fetchImpl:async()=>new Response(modernHtml)});
assert.equal(modernCollected.items.length,5,'one modern search can collect several manufacturers and capacities');
const statusHtml=readFileSync(new URL('./fixtures/source-pages/danawa-search-modern-status.html',import.meta.url),'utf8');
const statusCollected=await collectDanawaSearchListings({query:'CPU',categoryCode:'CPU',fetchImpl:async()=>new Response(statusHtml)});
assert.deepEqual(statusCollected.items.map(item=>[item.price,new URL(item.url).searchParams.get('pcode')]),
  [[13940,'4143852'],[49130,'1678801'],[308750,'54323792']],
  'used marker on the same option preserves CPU offers while discontinued zero-mall siblings are non-offers');
assert.deepEqual(parseDanawaSearchHtml(statusHtml.replaceAll('>단종<','>99,000원<'),{categoryCode:'CPU'}).map(item=>item.price),
  [13940,49130,308750],'priced used-plus-cooler options remain excluded from CPU-only prices');
await assert.rejects(collectDanawaSearchListings({query:'CPU',fetchImpl:async()=>new Response(statusHtml.replaceAll('>0몰<','>1몰<'))}),
  /MARKUP_UNRECOGNIZED/u,'discontinued text alone is insufficient evidence of a non-offer');
await assert.rejects(collectDanawaSearchListings({query:'CPU',fetchImpl:async()=>new Response(statusHtml.replaceAll('>단종<','>가격문의<'))}),
  /MARKUP_UNRECOGNIZED/u,'other price states must not become verified empty offers');
const incompleteModern = modernHtml.replace('349,590원','가격문의');
const motherboardHtml=readFileSync(new URL('./fixtures/source-pages/danawa-search-modern-motherboard.html',import.meta.url),'utf8');
assert.equal(modernSearchCards(motherboardHtml).unrecognized,0,'DDR4 motherboard compatibility is not a missing RAM capacity');
assert.equal(parseDanawaSearchHtml(motherboardHtml,{categoryCode:'RAM'}).length,0,'do not manufacture a RAM identity for the motherboard');
await assert.rejects(collectDanawaSearchListings({query:'DDR5',fetchImpl:async()=>new Response(incompleteModern)}),
  /MARKUP_UNRECOGNIZED/u,'one unreadable price cannot silently make the remaining response a clean success');
const incompleteBatch = await collectDanawaSearchTargetBatch({targets:[1,2,3],collectTarget:async()=>
  collectDanawaSearchListings({query:'DDR5',categoryCode:'RAM',fetchImpl:async()=>new Response(incompleteModern)})});
assert.equal(incompleteBatch.length,3,'verified offers prevent treating a partially readable source as a total outage');
assert.ok(incompleteBatch.every(row=>row.status==='rejected'),'incomplete targets remain failed');
assert.equal(danawaPartialItems(incompleteBatch).length,12,'retain four valid RAM offers from each failed target');
assert.ok(!danawaPartialItems(incompleteBatch).some(item=>item.price===349590));
assert.match(danawaPublicCardEvidence(incompleteModern)[0],/가격문의/u,'bounded evidence prioritizes the unreadable card, not just the first products');
const modernShop = (title,price,id) => `<li class="border-b"><div><div class="grow"><p><a class="break-words font-bold" href="https://prod.danawa.com/bridge/go_link_goods.php?cmpny_c=TEST&link_prod_c=${id}">${title}</a></p></div><div><a class="flex flex-col" href="https://prod.danawa.com/bridge/go_link_goods.php?cmpny_c=TEST&link_prod_c=${id}"><div><div><span class="font-bold">${price}원</span></div><div><span>배송비 <span class="font-bold">3,000원</span></span></div></div></a></div></div></li>`;
// Scheduled response-2 (2026-10-20T08:24:54Z) selected an empty SVG g/path
// instead of the price row. Reconstruct only that observed decorative shape.
const iconShop = modernShop('인텔 i5-11400 CPU 단품 중고','150,000','913')
  .replace(/(<a class="flex flex-col"[^>]*>)/u,'$1<svg><g><path></path></g></svg>');
assert.deepEqual((await collectDanawaSearchListings({query:'CPU',categoryCode:'CPU',
  fetchImpl:async()=>new Response(iconShop)})).items.map(item=>item.price),[150000],
  'a leading shop icon must not replace the product amount or select shipping');
await assert.rejects(collectDanawaSearchListings({query:'CPU',categoryCode:'CPU',
  fetchImpl:async()=>new Response(iconShop.replace('150,000원','가격문의'))}),
  /MARKUP_UNRECOGNIZED/u,'skip the icon only; an unknown item price cannot use the shipping amount');
const cardDiagnostics=[];
danawaPublicCardEvidence(modernShop('인텔 i5-11400 CPU 중고','가격문의 PRIVATE_TOKEN','912'),cardDiagnostics);
assert.equal(cardDiagnostics.length,1);
assert.equal(cardDiagnostics[0].unrecognized_count,1,'diagnostic detail must not inflate failure counts');
assert.ok(cardDiagnostics[0].failures.some(f=>f.reason==='SHOP_AMOUNT'&&f.text_kind==='OTHER'));
assert.ok(!JSON.stringify(cardDiagnostics).includes('PRIVATE_TOKEN'),'pre-sanitization diagnostics retain shape and enums only');
assert.ok(!JSON.stringify(cardDiagnostics).includes('href'));
// Scheduled responses 2026-10-28..11-02 for six DDR3 48/96/128GB targets selected
// the third result tab and listed 1-3 shop cards (then loading skeletons) whose
// links are neither /info/ nor go_link_goods.php. Stored evidence omits that link
// form, so the page stays a failure; evidence must keep its shape, never values.
const shopTabLink = 'https://shop.example.invalid/goods/4410021?item=PRIVATE_ITEM&amp;trk=PRIVATE_TRACK';
const shopTabSkeleton = '<li class="border-b"><div class="flex w-full items-center"><div><div class="animate-pulse rounded-md"></div></div></div></li>';
const shopTabPage = '<div class="dnw-pricecompare-search min-h-screen"><main class="dnw-search-contents"><div class="text-center"><div class="font-bold">검색결과</div></div>'
  + '<div class="border-b"><nav class="flex"><button class="border-x border-t transition-colors"><span>전체</span><span>(1)</span></button>'
  + '<button class="border-x border-t transition-colors"><span>가격비교</span><span>(0)</span></button>'
  + '<button class="border-x border-t transition-colors relative border-b-white bg-white font-bold"><span>쇼핑몰상품</span><span class="font-bold">(1)</span></button></nav></div>'
  + `<div><div class="relative"><ul><li class="border-b"><div><div><a href="${shopTabLink}"><img class="object-contain" src="https://img.example.invalid/PRIVATE_IMAGE.jpg"></a></div>`
  + `<div class="grow"><p><a class="break-words break-all font-bold" href="${shopTabLink}">SK하이닉스 DDR3 16GB PC3-12800R 서버용 중고</a></p>`
  + '<div class="flex items-center text-xs"><span>등록월 2025.04</span><div class="w-px self-center"></div><div class="font-dnw-regular"><button class="transition-colors flex items-center justify-center"><svg><path></path></svg><span class="font-dnw-regular">관심</span></button></div></div><div></div></div>'
  + `<div class="flex items-center"><div class="grow"><a class="flex flex-col" href="${shopTabLink}"><div><div><span><img src="https://img.example.invalid/mall.png"></span><span class="font-bold">19,900원</span></div>`
  + '<div class="relative"><div></div><span><span class="font-bold">무료배송</span></span></div></div></a></div></div></div></li></ul></div></div>'
  + `<div><div><div><ul>${shopTabSkeleton.repeat(3)}</ul></div></div></div><div><div class="border-b"><ul>${shopTabSkeleton.repeat(6)}</ul></div></div></main></div>`;
const shopTabFailure = await collectDanawaSearchListings({query:'SK hynix DDR3 96GB 램',categoryCode:'RAM',
  fetchImpl:async()=>new Response(shopTabPage)}).then(()=>assert.fail('unverified shop-tab links must not succeed'),error=>error);
assert.match(shopTabFailure.message,/^DANAWA_SEARCH_MARKUP_UNRECOGNIZED:.*"product_card_count":0/u,
  'an unsupported shop link is neither product evidence nor an authoritative empty result');
assert.equal(shopTabFailure.partial_items,undefined);
assert.deepEqual(danawaPublicCardEvidence(shopTabPage),[],'without diagnostics the evidence selection is unchanged');
const shopTabDiagnostics=[];
const shopTabEvidence=danawaPublicCardEvidence(shopTabPage,shopTabDiagnostics);
assert.equal(shopTabEvidence.length,1,'diagnostic evidence keeps the unsupported product card and skips loading skeletons');
assert.match(shopTabEvidence[0],/19,900원/u);
assert.equal(shopTabDiagnostics[0].product_count,0);
assert.equal(shopTabDiagnostics[0].unrecognized_count,0,'tracing the link does not change failure counts');
assert.deepEqual(shopTabDiagnostics[0].failures.map(failure=>[failure.reason,failure.link,failure.price_link]),[['TITLE_LINK',
  {attributes:['class','href'],target:'QUOTED',relative:false,scheme:'https',host:'shop.example.invalid',path:null,param_keys:['item','trk']},
  {same_target:true,text_kind:'KRW_AMOUNT'}]]);
assert.deepEqual(shopTabDiagnostics[0].search_tabs,[{label:'전체',count:1,selected:false},
  {label:'가격비교',count:0,selected:false},{label:'쇼핑몰상품',count:1,selected:true}]);
assert.ok(!/PRIVATE_|4410021|example\.invalid\/|https:\/\/shop/u.test(JSON.stringify({shopTabEvidence,shopTabDiagnostics})),
  'link diagnostics keep shape only, never values or external paths');
assert.deepEqual(parseDanawaSearchHtml(modernShop('HP 마이크로타워 데스크탑 280 Pro G8 (i5-11400/8G/S256/윈11P) 중고','569,000','901')
  + modernShop('인텔 코어 i5-11400 CPU 단품 중고','150,000','902'),{categoryCode:'CPU'}).map(item=>item.price),[150000],
  'new format preserves the CPU versus complete-desktop correction');
await assert.rejects(collectDanawaSearchListings({query:'CPU',fetchImpl:async()=>new Response(
  modernShop('인텔 i5-11400 CPU 중고','90,000','903').replace('class="flex flex-col" href="https://prod.danawa.com/bridge/go_link_goods.php?cmpny_c=TEST&link_prod_c=903',
    'class="flex flex-col" href="https://prod.danawa.com/bridge/go_link_goods.php?cmpny_c=TEST&link_prod_c=904'))}),/MARKUP_UNRECOGNIZED/u,
  'price and title from different shop identities must never be joined');
const differentWrapper = await collectDanawaSearchListings({ query:'DDR5 16GB',categoryCode:'RAM',
  fetchImpl:async()=>new Response(html.replace('productListArea','searchResults')) });
assert.deepEqual(differentWrapper.items,collected.items,'recognized product cards do not depend on an outer wrapper name');
await assert.rejects(collectDanawaSearchListings({ query: 'RAM', fetchImpl: async () => new Response('', {status: 403}) }), /HTTP_403/u);
await assert.rejects(collectDanawaCategoryListings({categoryCode:'RAM'}),/DANAWA_LEGACY_LIVE_DISABLED/);
let legacyCalls=0;
await assert.rejects(collectDanawaCategoryListings({categoryCode:'RAM',fetchImpl:async()=>{legacyCalls++;return new Response('',{status:403});}}),/DANAWA_HTTP_403/);
assert.equal(legacyCalls,1,'retired diagnostic adapter must not retry access denial');

let fakeNow = 0;
const manualSource=readFileSync(new URL('../aws-runner/collect-pc-source-now.mjs',import.meta.url),'utf8');
assert.ok(manualSource.indexOf('DANAWA_MANUAL_REQUIRES_STOPPED_RUNNER')<manualSource.indexOf('new SearchIndex('),'operator service guard runs before any DB open or migration');
const localDenied=spawnSync(process.execPath,[fileURLToPath(new URL('../aws-runner/collect-pc-local.mjs',import.meta.url))],{
  env:{...process.env,PC_LOCAL_SOURCES:'danawa'},encoding:'utf8',timeout:10_000});
assert.equal(localDenied.status,1);assert.match(localDenied.stderr,/DANAWA_LOCAL_LIVE_DISABLED_USE_PRODUCTION_SCHEDULER/);
const requestedAt = [];
const pacedFetch = createDanawaPacedFetch({ now: () => fakeNow,
  wait: async ms => { fakeNow += ms; },
  fetchImpl: async () => { requestedAt.push(fakeNow); return new Response(''); }
});
await Promise.all([pacedFetch('first'), pacedFetch('second'), pacedFetch('third')]);
assert.equal(requestedAt.length, 3);
assert.ok(requestedAt.slice(1).every((time, index) => time - requestedAt[index] >= 10_000),
  'even concurrent callers must leave ten seconds between Danawa requests');
let cappedCalls=0;
await collectDanawaSearchTargetBatch({targets:Array.from({length:200},(_,i)=>i),collectTarget:async()=>{cappedCalls++;}});
assert.equal(cappedCalls,20,'scheduled and manual callers share the same conservative batch ceiling');
let unknownCalls=0;
await collectDanawaSearchTargetBatch({targets:[1,2,3,4],collectTarget:async()=>{unknownCalls++;throw new Error('DANAWA_SEARCH_MARKUP_UNRECOGNIZED');}});
assert.equal(unknownCalls,2,'repeated structural failure stops the batch');
await assert.rejects(collectDanawaSearchListings({query:'RAM',fetchImpl:async()=>new Response('<div id="productListArea"></div>')}),/NO_CARDS_UNVERIFIED.*body_sha256/);
await assert.rejects(collectDanawaSearchListings({query:'RAM',fetchImpl:async()=>new Response('<html>new layout</html>')}),/MARKUP_UNRECOGNIZED.*body_sha256/);

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
assert.equal(lateBlocked.next_runtime.runtime_status,'QUARANTINED');
assert.ok(Date.parse(lateBlocked.next_runtime.quarantine_until)-Date.parse(blockedNow)>=DANAWA_COLLECTION_LIMITS.accessCooldownMs);
const duringCooldown=await runSourceCollection({sourceKey:'danawa',now:'2026-10-03T01:19:00.000Z',
  governance:operatorAttestedSourceGovernance('danawa',{now:'2026-10-03T01:19:00.000Z'}),runtime:lateBlocked.next_runtime,
  adapter:{sourceKey:'danawa',collectIncremental:async()=>assert.fail('quarantine must not make a request')}});
assert.equal(duringCooldown.reason,'SOURCE_QUARANTINED');
const structuralPartial = await runSourceCollection({sourceKey:'danawa',now:blockedNow,
  governance:operatorAttestedSourceGovernance('danawa',{now:blockedNow}),
  runtime:{...getSourceRuntimeDefaults('danawa'),consecutive_failures:2,last_succeeded_at:previousSuccess},
  adapter:{sourceKey:'danawa',collectIncremental:async()=>({items:parsed,metrics:{request_count:20,request_failure_count:1,parse_failure_count:1}})}});
assert.equal(structuralPartial.status,'partial_success','even one structural error is not a clean success');
assert.equal(structuralPartial.next_runtime.last_succeeded_at,previousSuccess);
assert.equal(structuralPartial.next_runtime.backoff_until,null);
assert.equal(structuralPartial.next_runtime.quarantine_until,null,'a target parse error cannot quarantine otherwise working searches');
assert.equal(structuralPartial.next_runtime.consecutive_failures,0);
assert.deepEqual(structuralPartial.result.items,parsed,'valid samples survive partial parse failure');
const incompleteResponse = await runSourceCollection({sourceKey:'danawa',now:blockedNow,
  governance:operatorAttestedSourceGovernance('danawa',{now:blockedNow}),
  runtime:{...getSourceRuntimeDefaults('danawa'),consecutive_failures:2,last_succeeded_at:previousSuccess},
  adapter:{sourceKey:'danawa',collectIncremental:async()=>({items:danawaPartialItems(incompleteBatch),
    metrics:{request_count:3,request_failure_count:3,parse_failure_count:3,parsed_count:12}})}});
assert.equal(incompleteResponse.status,'partial_success');
assert.equal(incompleteResponse.next_runtime.last_succeeded_at,previousSuccess);
assert.equal(incompleteResponse.next_runtime.quarantine_until,null);
assert.equal(incompleteResponse.next_runtime.backoff_until,null);
const structuralOutage = await runSourceCollection({sourceKey:'danawa',now:blockedNow,
  governance:operatorAttestedSourceGovernance('danawa',{now:blockedNow}),
  runtime:{...getSourceRuntimeDefaults('danawa'),consecutive_failures:2,last_succeeded_at:previousSuccess},
  adapter:{sourceKey:'danawa',collectIncremental:async()=>{const error=new Error('DANAWA_SEARCH_MARKUP_UNRECOGNIZED');
    error.collection_metrics={request_count:2,request_failure_count:2,parse_failure_count:2};throw error;}}});
assert.equal(structuralOutage.next_runtime.runtime_status,'QUARANTINED','whole-batch structural failure still backs off');

const evidenceRoot = mkdtempSync(path.join(os.tmpdir(),'used-pick-danawa-evidence-'));
try {
  const productEvidence = danawaPublicCardEvidence('<li class="border-b"><p><a class="break-words" '
    + 'href="https://prod.danawa.com/info/?pcode=123&amp;keyword=SECRET_QUERY">중고 CPU i5-11400</a></p>'
    + '<script>SECRET_SCRIPT</script><form><input value="SECRET_FORM"></form><span>90,000원</span></li>');
  assert.equal(productEvidence.length,1);
  assert.ok(!productEvidence[0].includes('SECRET'));
  assert.match(productEvidence[0],/pcode=123/u);
  assert.match(productEvidence[0],/90,000원/u);
  const privateHtml = '<script>SECRET_SCRIPT</script><style>SECRET_STYLE</style><!--SECRET_COMMENT-->'
    + '<div class="product_list" data-token="SECRET_TOKEN"><a href="https://secret.test/?query=SECRET_QUERY" onclick="SECRET_EVENT">SECRET_TITLE</a>'
    + '<input value="SECRET_FORM"><p class="no_result">검색 결과가 없습니다</p></div>';
  const outline = JSON.stringify(danawaResponseOutline(privateHtml));
  assert.ok(!outline.includes('SECRET_') && !outline.includes('https://'));
  assert.match(outline,/product_list/u); assert.match(outline,/검색 결과가 없습니다/u);
  for(let hour=0;hour<9;hour++) await assert.rejects(collectDanawaSearchListings({query:'SECRET_QUERY',
    fetchImpl:async()=>new Response(privateHtml),
    onUnrecognizedResponse:evidence=>saveDanawaResponseEvidence(path.join(evidenceRoot,'db.sqlite'),evidence,new Date(Date.UTC(2026,9,17,hour)))}),
    /MARKUP_UNRECOGNIZED.*evidence_saved.*true/u);
  const files=readdirSync(path.join(evidenceRoot,'danawa-response-evidence'));
  assert.equal(files.length,6,'evidence storage cannot grow with retries');
  for(const file of files) assert.ok(!readFileSync(path.join(evidenceRoot,'danawa-response-evidence',file),'utf8').includes('SECRET_'));
  await assert.rejects(collectDanawaSearchListings({query:'RAM',fetchImpl:async()=>new Response(privateHtml),
    onUnrecognizedResponse:()=>{throw new Error('SECRET_STORAGE_ERROR');}}),/MARKUP_UNRECOGNIZED.*evidence_saved.*false/u);
  await assert.rejects(collectDanawaSearchListings({query:'RAM',fetchImpl:async()=>new Response(privateHtml,{status:403}),
    onUnrecognizedResponse:()=>assert.fail('blocked responses must not be captured')}),/HTTP_403/u);
  assert.ok(JSON.stringify(danawaResponseOutline('<div class="product_list">text</div>'.repeat(30000))).length<220000);
} finally {
  assert.equal(path.dirname(path.resolve(evidenceRoot)),path.resolve(os.tmpdir()));
  assert.ok(path.basename(evidenceRoot).startsWith('used-pick-danawa-evidence-'));
  rmSync(evidenceRoot,{recursive:true,force:true});
}

const directTargets = pcCollectionTargetSetV2().targets.filter(target => target.categoryCode === 'RAM'
  && target.cadenceClass === 'HOURLY_CATEGORY' && target.sourceKeys.includes('danawa')).slice(0, 3);
assert.equal(directTargets.length, 3);
const partialRoot=mkdtempSync(path.join(os.tmpdir(),'used-pick-danawa-partial-'));
try {
  const preload=path.join(partialRoot,'mock-fetch.mjs');
  writeFileSync(preload,`globalThis.fetch=async()=>new Response(${JSON.stringify(incompleteModern)});`);
  const run=spawnSync(process.execPath,['--import',pathToFileURL(preload).href,
    fileURLToPath(new URL('../aws-runner/collect-pc-source-now.mjs',import.meta.url))],{
    env:{...process.env,PC_COLLECT_SOURCE:'danawa',PC_COLLECT_CADENCE_CLASS:'HOURLY_CATEGORY',
      PC_COLLECT_TARGET_IDS:directTargets[0].targetId,PC_COLLECT_PRODUCT_IDS:'',PC_COLLECT_TARGET_OFFSET:'0',
      PC_COLLECT_TARGET_LIMIT:'1',RUNNER_INDEX_DIR:partialRoot,RUNNER_INDEX_PATH:path.join(partialRoot,'index.sqlite'),
      D1_IMPORT_URL:'',CLOUDFLARE_MANUAL_RUN_TOKEN:'',IMPORT_TOKEN:'',PC_D1_SQL_OUTPUT:path.join(partialRoot,'projection.sql')},encoding:'utf8',timeout:20000});
  assert.equal(run.status,1,run.stderr);
  assert.ok(existsSync(path.join(partialRoot,'index.sqlite')),run.stderr);
  const partialDb=new DatabaseSync(path.join(partialRoot,'index.sqlite'),{readOnly:true});
  try {
    const audit=partialDb.prepare('SELECT * FROM crawl_runs').get();
    assert.equal(audit.run_status,'FAILED');assert.equal(audit.request_failure_count,1);assert.equal(audit.parse_failure_count,1);
    assert.ok(audit.collected_count>0,'readable offers must be committed despite target failure');
    assert.ok(partialDb.prepare("SELECT COUNT(*) n FROM raw_listings WHERE source_id='danawa'").get().n>0);
    const target=partialDb.prepare("SELECT * FROM pc_source_target_runtime WHERE source_id='danawa'").get();
    assert.equal(target.last_succeeded_at,null);assert.ok(target.last_error);
    const runtime=partialDb.prepare("SELECT * FROM source_runtime WHERE source_id='danawa'").get();
    assert.equal(runtime.last_succeeded_at,null);assert.equal(runtime.quarantine_until,null);assert.ok(runtime.last_error);
  } finally {partialDb.close();}
} finally {
  assert.equal(path.dirname(path.resolve(partialRoot)),path.resolve(os.tmpdir()));
  assert.ok(path.basename(partialRoot).startsWith('used-pick-danawa-partial-'));
  rmSync(partialRoot,{recursive:true,force:true});
}
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
      const runtime = fixtureDb.prepare("SELECT failure_count,quarantine_until,last_succeeded_at FROM source_runtime WHERE source_id='danawa'").get();
      assert.equal(runtime.failure_count, 1);
      assert.ok(runtime.quarantine_until, 'persist immediate Danawa cooldown even if partial SQL export subsequently fails');
      assert.equal(runtime.last_succeeded_at, null);
      if (partial) assert.ok(fixtureDb.prepare("SELECT COUNT(*) AS n FROM raw_listings WHERE source_id='danawa'").get().n > 0,
        'preserve the valid partial collection when export fails');
    } finally { fixtureDb.close(); }
    const retry=spawnSync(process.execPath,['--import',pathToFileURL(preload).href,
      fileURLToPath(new URL('../aws-runner/collect-pc-source-now.mjs',import.meta.url))],{
      env:{...process.env,PC_COLLECT_SOURCE:'danawa',PC_COLLECT_TARGET_LIMIT:'1',RUNNER_INDEX_DIR:fixtureRoot,
        RUNNER_INDEX_PATH:path.join(fixtureRoot,'index.sqlite'),D1_IMPORT_URL:'',CLOUDFLARE_MANUAL_RUN_TOKEN:'',IMPORT_TOKEN:'',PC_D1_SQL_OUTPUT:output},encoding:'utf8',timeout:10_000});
    assert.equal(retry.status,1);assert.match(retry.stderr,/SOURCE_QUARANTINED:danawa/);
    const retryDb=new DatabaseSync(path.join(fixtureRoot,'index.sqlite'),{readOnly:true});
    try{assert.equal(retryDb.prepare('SELECT COUNT(*) AS n FROM crawl_runs').get().n,1,'manual retry cannot open another crawl during cooldown');}finally{retryDb.close();}
  } finally {
    assert.equal(path.dirname(path.resolve(fixtureRoot)), path.resolve(os.tmpdir()));
    assert.ok(path.basename(fixtureRoot).startsWith('used-pick-danawa-'));
    rmSync(fixtureRoot, {recursive:true,force:true});
  }
}

const db = new DatabaseSync(':memory:');
const ledger = new PcPartsLedger({ db }); ledger.migrate();
ledger.upsertSource({sourceId:'danawa',displayName:'Danawa',marketPool:'KR_DEALER_USED',policyStatus:'APPROVED',runtimeStatus:'ENABLED'});
const actualNow = new Date().toISOString();
db.prepare("UPDATE source_runtime SET runtime_status='QUARANTINED',quarantine_until=? WHERE source_id='danawa'").run(new Date(Date.now()+3600000).toISOString());
assert.throws(()=>ledger.startCrawlRun({sourceId:'danawa',startedAt:'2099-01-01'}),/not enabled/,'future supplied run time cannot bypass quarantine');
db.prepare("UPDATE source_runtime SET quarantine_until=? WHERE source_id='danawa'").run(new Date(Date.now()-3600000).toISOString());
const retried = ledger.startCrawlRun({sourceId:'danawa',startedAt:actualNow});
ledger.finishCrawlRun({crawlRunId:retried,status:'QUARANTINED',requestCount:1,requestFailureCount:1,httpBlockedCount:1,error:'DANAWA_SEARCH_HTTP_403'});
assert.equal(ledger.getSource('danawa').runtime_status,'QUARANTINED','failure audit does not enable access');
assert.equal(ledger.remainingSourceRequestBudget('danawa',20),19);
db.prepare("UPDATE source_runtime SET runtime_status='ENABLED',quarantine_until=NULL WHERE source_id='danawa'").run();
const reserved = ledger.startCrawlRun({sourceId:'danawa',startedAt:actualNow});
assert.equal(ledger.remainingSourceRequestBudget('danawa',20),0,'running work reserves budget');
ledger.finishCrawlRun({crawlRunId:reserved,status:'FAILED',requestCount:0});
db.prepare("UPDATE crawl_runs SET started_at=?,finished_at=? WHERE crawl_run_id=?")
  .run(new Date(Date.now()-61*60000).toISOString(),new Date(Date.now()-54*60000).toISOString(),retried);
assert.equal(ledger.remainingSourceRequestBudget('danawa',20),20,'a run started in the previous hourly slot frees the next slot even if it finished late');
db.prepare("UPDATE crawl_runs SET started_at=?,finished_at=? WHERE crawl_run_id=?")
  .run(new Date(Date.now()-50*60000).toISOString(),new Date(Date.now()-46*60000).toISOString(),retried);
assert.equal(ledger.remainingSourceRequestBudget('danawa',20),19,'a run started within the hourly guard still holds its requests');
assert.equal(ledger.remainingSourceRequestBudget('danawa',20,new Date(Date.now()+6*60000).toISOString()),20,'the next hourly slot releases the budget');
db.prepare("UPDATE crawl_runs SET run_status='RUNNING',started_at=? WHERE crawl_run_id=?")
  .run(new Date(Date.now()-2*3600000).toISOString(),reserved);
assert.equal(ledger.remainingSourceRequestBudget('danawa',20),0,'unfinished run cannot age out of reservation');
ledger.finishCrawlRun({crawlRunId:reserved,status:'FAILED',requestCount:0});
const pipeline = new PcShadowPipeline({ ledger }); await pipeline.initialize();
const diagnostic = ledger.startCrawlRun({sourceId:'danawa',startedAt:actualNow,adapterVersion:'operator-http-diagnostic-only-v1'});
ledger.finishCrawlRun({crawlRunId:diagnostic,status:'SUCCEEDED',requestCount:1,parsedCount:8,collectedCount:0});
assert.equal(ledger.getSourceCollectionCoverage('danawa').last_committed_crawl_at,null,'HTTP-only diagnostic is not a committed collection');
assert.equal(ledger.remainingSourceRequestBudget('danawa',20),18,'HTTP diagnostic still consumes request budget');
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
ledger.activateCollectionTargets({targetSetVersion:'danawa-priority-fixture',directoryVersion:'fixture',targets:[
  {targetId:'discover-never',canonicalProductId:'cpu:intel:i5-11400'},
  {targetId:'listed-recent',canonicalProductId:product},
  {targetId:'listed-old',canonicalProductId:product},
  {targetId:'discover-old',canonicalProductId:'cpu:intel:i5-12400'},
  {targetId:'category',cadenceClass:'HOURLY_CATEGORY',minimumIntervalMinutes:55}
].map((target,index)=>({categoryCode:'RAM',queryText:target.targetId,sourceKeys:['danawa'],targetOrder:index,
  cadenceClass:'DAILY_MASTER',minimumIntervalMinutes:1440,...target}))});
for(const [targetId,date] of [['listed-recent','2026-09-30'],['listed-old','2026-09-25'],['discover-old','2026-09-20']])
  ledger.updateSourceTargetRuntime({sourceId:'danawa',targetId,startedAt:`${date}T00:00:00Z`,succeededAt:`${date}T00:00:00Z`});
const priorityAsOf='2026-10-02T12:00:00Z';
assert.deepEqual(ledger.listDueCollectionTargets('danawa',priorityAsOf,undefined,5).map(target=>target.target_id),
  ['listed-old','category','listed-recent','discover-never','discover-old'],
  'listed models get two of three model slots while unseen models and category queries retain capacity');
for(const item of parsed) pipeline.recordItem({...item,status:'SOLD',lifecycle_status:'SOLD'},'2026-10-01T00:00:00Z');
assert.equal(ledger.listDueCollectionTargets('danawa',priorityAsOf,undefined,1)[0].target_id,'discover-never',
  'historical ACTIVE snapshots must not prioritize listings whose latest state is sold');
for(let i=0;i<3;i++) ledger.updateSourceTargetRuntime({sourceId:'danawa',targetId:'category',
  startedAt:'2026-10-02T10:00:00Z',error:'DANAWA_SEARCH_MARKUP_UNRECOGNIZED'});
assert.ok(!ledger.listDueCollectionTargets('danawa',priorityAsOf).some(target=>target.target_id==='category'),
  'repeated structural target failure gets its own backoff');
assert.ok(!ledger.listDueCollectionTargets('danawa','2026-10-02T14:00:00Z').some(target=>target.target_id==='category'),
  'Danawa category queries wait six hours after their last start');
assert.ok(ledger.listDueCollectionTargets('danawa','2026-10-02T16:00:00Z').some(target=>target.target_id==='category'),
  'target can retry after its backoff and the six-hour category interval without resetting runtime');
for(let i=0;i<6;i++) ledger.updateSourceTargetRuntime({sourceId:'danawa',targetId:'discover-old',
  startedAt:'2026-10-02T10:00:00Z',error:'DANAWA_SEARCH_MARKUP_UNRECOGNIZED'});
assert.ok(!ledger.listDueCollectionTargets('danawa','2026-10-03T10:00:00Z').some(target=>target.target_id==='discover-old'),
  'a query rejected six times in a row stops spending the request budget every few hours');
assert.ok(ledger.listDueCollectionTargets('danawa','2026-10-09T10:00:00Z').some(target=>target.target_id==='discover-old'),
  'it is still retried weekly');
db.close();
console.log(JSON.stringify({contract:'danawa-domestic', parser_variants:parsed.length, domestic_samples:stats.active.sample_count,
  domestic_mean:stats.active.mean, danawa_samples:2, ebay_excluded:true, false_sales:0}));
