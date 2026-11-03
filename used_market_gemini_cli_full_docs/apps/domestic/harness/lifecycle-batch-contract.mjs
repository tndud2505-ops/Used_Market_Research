import assert from 'node:assert/strict';
import { runLifecycleBatch, pacedLifecycleFetch, lifecycleRecheckEnabled } from '../aws-runner/lifecycle-batch.mjs';
import { joongnaStatusStructureTokens, statusFieldToken, joongnaReservedEvidenceFromHtml, joongnaReservationBinding, ebayItemLifecycle, joongnaProductUnavailableReason } from '../market/logic/listing-lifecycle.mjs';
import { readFile } from 'node:fs/promises';

assert.equal(lifecycleRecheckEnabled('joonggonara'),true);
const shape=joongnaStatusStructureTokens('<script id="__NEXT_DATA__">{"product":{"productStatus":1,"title":"RAM 예약중 010-1234","sellerName":"seller","saleStatus":"RESERVED","price":45000,"productSeq":233700884,"tradeSellerName":"alice","reservedListingId":2337,"saleTitle":"RTX3080"}}</script>'
  +'<script>self.__next_f.push([1,"{\\"productState\\":2}"])</script><script type="application/ld+json">{"offers":{"availability":"https://schema.org/InStock"}}</script>');
assert.deepEqual(shape.tokens,['availability=InStock','productState=2','productStatus=1','reservedListingId','saleStatus=RESERVED','saleTitle','tradeSellerName'],
  'only genuine status codes keep values; other sale-related fields keep names only');
assert.equal(shape.reservedLabel,true);
assert.equal(joongnaReservedEvidenceFromHtml('<script>self.__next_f.push([1,"{\\"productStatus\\":1,\\"reservation\\":true}"])</script>')?.type,'STRUCTURED_STATUS');
for(const html of ['{"productStatus":0,"reservation":false}','{"productStatus":1,"reservation":false}','{"productStatus":0,"reservation":true}','<p>예약중</p>'])
  assert.equal(joongnaReservedEvidenceFromHtml(html),null,'reservation needs both product fields; free text never decides it');
{
  const target='https://web.joongna.com/product/233700884';
  const rsc=json=>`<script>self.__next_f.push([1,"${json.replace(/"/g,'\\"')}"])</script>`;
  const recommended='{"seq":111111111,"title":"RAM {8GB}","productStatus":1,"reservation":true}';
  const activeTarget='{"seq":233700884,"title":"RAM \\"8GB\\"","productStatus":0,"reservation":false,"store":{"seq":5}}';
  const reservedTarget='{"productSeq":233700884,"productStatus":1,"media":[{"seq":1}],"reservation":true}';
  assert.equal(joongnaReservedEvidenceFromHtml(`{"list":[${recommended}]}${activeTarget}`,target),null,
    'a reserved recommendation ahead of the listing cannot reserve it');
  assert.equal(joongnaReservationBinding(`{"list":[${recommended}]}${activeTarget}`,target).binding,'ID_NOT_RESERVED');
  assert.match(joongnaReservedEvidenceFromHtml(rsc(`{"list":[${recommended.replace('1,"res','0,"res').replace('true','false')}],"product":${reservedTarget}}`),target)?.value||'',
    /binding=ID$/u,'the object carrying the target ID decides, including escaped RSC payloads');
  assert.equal(joongnaReservedEvidenceFromHtml(recommended,target),null,'another product ID alone never reserves this listing');
  assert.equal(joongnaReservationBinding(recommended,target).binding,'OTHER_PRODUCT');
  assert.equal(joongnaReservationBinding('{"productStatus":1,"reservation":true}{"productStatus":0,"reservation":false}',target).binding,'CONFLICT');
  assert.equal(joongnaReservationBinding('{"status":422}{"productStatus":1,"reservation":true}',target).binding,'PRODUCT_MISSING');
  assert.equal(joongnaReservationBinding('{"a":{"productStatus":1,"reservation":true}}{"productStatus":1,"reservation":true}',target).binding,'UNIQUE',
    'repeated identical product data without IDs stays usable');
  const other='https://web.joongna.com/product/30001';
  assert.equal(joongnaReservationBinding('{"product":{"productSeq":30001},"recommendation":{"productSeq":99999,"sale":{"productStatus":1,"reservation":true}}}',other).reserved,false,
    'the nearest enclosing product ID owns the status fields');
  assert.equal(joongnaReservationBinding('{"productSeq":99999,"price":30001,"productStatus":1,"reservation":true}',other).binding,'OTHER_PRODUCT',
    'only product ID fields establish identity, never a price or other scalar');
  assert.equal(joongnaReservationBinding('{"product":{"seq":30001,"state":{"productStatus":1,"reservation":true}}}',other).binding,'ID',
    'an ancestor naming the target product binds nested status fields');
  assert.equal(joongnaReservationBinding('{"list":[{"productNo":88888}]}{"productStatus":1,"reservation":true}',other).reserved,false,
    'without a bound owner, any other product ID on the page blocks the fallback');
  assert.deepEqual(joongnaReservationBinding('{"list":[{"productNo":88888}]}{"productStatus":1,"reservation":true}',other).id_keys,[]);
  for (const key of ['productSeq','productId','productNo','seq','id','no'])
    assert.equal(joongnaReservationBinding('{"other":{"'+key+'":99999},"data":{"productStatus":1,"reservation":true}}',other).reserved,false,
      'the page-wide scan covers every product ID key: '+key);
}
const ebayItem=(availability,extra={})=>({itemId:'v1|123|0',estimatedAvailabilities:[{estimatedAvailabilityStatus:availability}],...extra});
{
  const rscPage=json=>'<script>self.__next_f.push([1,"'+json.replace(/"/g,'\\"')+'"])</script>';
  const viewError=(detail)=>'{"state":{"data":{"meta":{"code":400999,"message":"'+detail+'"},"error":{"code":400999,"detail":"'+detail+'","title":"com.joongna.api.product.core.exception.ProductViewException","status":422}},"status":"success"}}';
  assert.equal(joongnaProductUnavailableReason(rscPage(viewError('탈퇴한 회원의 상품입니다.'))),'WITHDRAWN_MEMBER',
    'a withdrawn seller\'s product page states it can no longer be bought');
  assert.equal(joongnaProductUnavailableReason(rscPage(viewError('삭제된 상품입니다.'))),'DELETED');
  assert.equal(joongnaProductUnavailableReason(rscPage(viewError('일시적인 오류입니다.')+'{"notice":"댓글이 삭제되었습니다"}')),'UNEXPLAINED',
    'deletion text outside the failed product view never ends the listing at once');
  assert.equal(joongnaProductUnavailableReason(rscPage('{"error":{"detail":"탈퇴한 회원의 상품입니다.","title":"OtherException","status":422}}')),'UNEXPLAINED',
    'only the product view failure carries the reason');
  assert.equal(joongnaProductUnavailableReason(rscPage('{"state":{"status":422}}')),'UNEXPLAINED','an unexplained 422 is only a miss');
  assert.equal(joongnaProductUnavailableReason(rscPage('{"a":{"status":422},"product":{"productStatus":0}}')),null,
    'product data on the page means the listing is still readable');
  assert.equal(joongnaProductUnavailableReason('{"status":"success","productStatus":0}'),null);
  // The scheduled Joonggonara recheck ends a stated-unavailable listing at once and
  // treats an unexplained product-query failure as one missing check.
  const runnerSource=await readFile(new URL('../aws-runner/runner.mjs',import.meta.url),'utf8');
  const recheckSource=runnerSource.slice(runnerSource.indexOf('async function recheckKnownListings('),runnerSource.indexOf('function pcSourceAdapter('));
  const observations=[],missing=[],receipts=[];
  const pages={'1':rscPage(viewError('탈퇴한 회원의 상품입니다.')),'2':rscPage('{"state":{"status":422}}')};
  const names=['lifecycleRecheckEnabled','pcLedger','fetch','throwIfAborted','boundedFetchSignal','runLifecycleBatch','pacedLifecycleFetch',
    'joongnaListingUrl','listingIdentityIsPresent','joongnaProductUnavailableReason','recordStatusStructure','structuredSoldEvidenceFromHtml',
    'joongnaReservationBinding','joongnaReservedEvidenceFromBinding','yieldToEventLoop','stabilizeIncrementalPcProjections','searchIndex',
    'importToD1BestEffort','PC_RECHECK_LIMIT_PER_RUN'];
  const loop=new Function(...names,'return ('+recheckSource.trim()+')')(()=>true,
    {getLifecycleRun:()=>null,dueRechecks:()=>['1','2'].map(id=>({source_listing_id:'joonggonara:https://web.joongna.com/product/2330000'+id,raw_json:'{}',title:'RTX 3060',price_value:200000,currency:'KRW',lifecycle_status:'ACTIVE'})),
      deferLifecycleAttempt:()=>{},recordLifecycleRun:(_s,r)=>receipts.push(r),getPublicProjection:()=>null,
      recordObservation:o=>{observations.push(o);return {status:o.status,snapshotCreated:false};},
      recordMissingCheck:o=>{missing.push(o);return {accepted:true,missingCheckCount:1,status:'ACTIVE',snapshotCreated:false};}},
    async url=>new Response(pages[url.slice(-1)]),signal=>signal?.throwIfAborted(),signal=>signal,runLifecycleBatch,pacedLifecycleFetch,
    ({sourceListingId})=>sourceListingId.replace(/^joonggonara:/,''),()=>true,joongnaProductUnavailableReason,()=>{},()=>null,
    joongnaReservationBinding,()=>null,async()=>{},rows=>rows,null,async()=>{},600);
  await loop('joonggonara',new Date().toISOString(),new AbortController().signal);
  assert.deepEqual(observations.map(o=>[o.status,o.statusEvidence.value]),[['UNAVAILABLE_UNKNOWN','PRODUCT_UNAVAILABLE:WITHDRAWN_MEMBER']],
    'a withdrawn seller listing becomes unavailable, never SOLD');
  assert.equal(missing.length,1,'an unexplained 422 is recorded as one missing check');
  assert.deepEqual(receipts[0].unavailable_reasons,{WITHDRAWN_MEMBER:1,UNEXPLAINED:1});
  assert.equal(receipts[0].verified,2);
  assert.deepEqual(receipts[0].verified_statuses,{UNAVAILABLE_UNKNOWN:1},'a page without product data is not counted as a current ACTIVE confirmation');
  assert.equal(receipts[0].missing_response_checks,1);
}
assert.equal(ebayItemLifecycle(ebayItem('IN_STOCK'),'v1|123|0'),'ACTIVE');
assert.equal(ebayItemLifecycle(ebayItem('OUT_OF_STOCK'),'v1|123|0'),'UNAVAILABLE');
assert.equal(ebayItemLifecycle(ebayItem('IN_STOCK',{itemEndDate:'2026-10-01T00:00:00Z'}),'v1|123|0',Date.parse('2026-11-01T00:00:00Z')),'UNAVAILABLE');
assert.equal(ebayItemLifecycle(ebayItem('IN_STOCK'),'v1|999|0'),null,'a response for another item proves nothing');
assert.equal(ebayItemLifecycle({itemId:'v1|123|0'},'v1|123|0'),null,'missing availability is not a confirmation');
for(const [key,value,expected] of [['tradeSellerName','alice','tradeSellerName'],['reservedListingId',233700884,'reservedListingId'],
  ['saleTitle','RTX3080','saleTitle'],['salePrice',45000,'salePrice'],['dealStatus','alice','dealStatus'],['state',0,'state=0'],
  ['saleStatus','SOLD_OUT','saleStatus=SOLD_OUT'],['isReserved',true,'isReserved=true'],['isReserved','yes','isReserved'],['title','RTX',null]])
  assert.equal(statusFieldToken(key,value),expected,`${key} diagnostic token`);
for(const source of ['bunjang','danawa','ebay','daangn',undefined,''])assert.equal(lifecycleRecheckEnabled(source),false);
const runner=await readFile(new URL('../aws-runner/runner.mjs',import.meta.url),'utf8');
const detail=runner.slice(runner.indexOf('async function recheckKnownListings('),runner.indexOf('async function recheckKnownListings(')+300);
assert.match(detail,/if \(!lifecycleRecheckEnabled\(sourceKey\)\) return \[\];/u,'disabled sources exit before reading their queue or making requests');
const manual=runner.slice(runner.indexOf('if (jobName === "bunjang-lifecycle-recheck")'),runner.indexOf('if (jobName === "bunjang-lifecycle-recheck")')+310);
assert.ok(manual.indexOf('BUNJANG_LIFECYCLE_RECHECK_DISABLED')<manual.indexOf('PC_LEDGER_UNAVAILABLE'),'the manual job cannot bypass the operator policy');
assert.match(runner,/if \(result\.source_key === 'bunjang'\) \{\s*const receipt = recordBunjangSearchWindows/u,'already fetched Bunjang search pages keep hiding vanished listings while detail requests stay off');
assert.match(runner,/if \(lifecycleRecheckEnabled\(result\.source_key\)\) \{\s*await phase\('lifecycle_recheck'/u,'scheduled detail work uses the same policy');
assert.match(runner,/async recheck\(input\) \{\s*if \(!lifecycleRecheckEnabled\(sourceKey\)\) throw new Error\(`LIFECYCLE_RECHECK_DISABLED:\$\{sourceKey\}`\);\s*const response = await fetch/u,'adapter-level detail calls cannot bypass the policy');
{
  // eBay item checks: an abort after a committed observation still projects and mirrors it.
  const ebaySource=runner.slice(runner.indexOf('async function recheckEbayListings('),runner.indexOf('async function recheckKnownListings('));
  assert.match(ebaySource,/GLOB 'v1\|\[0-9\]\*\|0'/u,'only base items are checked; visibility reads the |0 queue row');
  const aborter=new AbortController(),applied=[],mirrored=[],receipts=[];
  let calls=0;
  const loop=new Function('pcLedger','getEbayAccessToken','throwIfAborted','fetch','boundedFetchSignal','ebayItemLifecycle',
    'stabilizeIncrementalPcProjections','searchIndex','yieldToEventLoop','importToD1BestEffort','EBAY_STATUS_CHECKS_PER_RUN','EBAY_ACTIVE_RECHECK_MS',
    `return (${ebaySource.trim()})`)(
    {getLifecycleRun:()=>null,db:{prepare:()=>({all:()=>['v1|1|0','v1|2|0'].map(id=>({source_listing_id:id,raw_json:'{}',title:'GPU',price_value:100,currency:'USD'}))})},
      deferLifecycleAttempt:()=>{},recordObservation:()=>({snapshotCreated:true}),getPublicProjection:(_s,id)=>({id}),
      recordLifecycleRun:(_s,receipt)=>receipts.push(receipt)},
    async()=>'token',signal=>signal?.throwIfAborted(),
    async url=>{if(++calls===1)return new Response(JSON.stringify({itemId:'v1|1|0',estimatedAvailabilities:[{estimatedAvailabilityStatus:'OUT_OF_STOCK'}]}));
      aborter.abort(new Error('ebay fixture abort'));throw aborter.signal.reason;},
    signal=>signal,ebayItemLifecycle,rows=>rows,{applyLifecycleProjection:p=>applied.push(p)},async()=>{},
    async(rows,signal)=>{assert.equal(signal.aborted,false,'mirror uses a fresh bounded signal after abort');mirrored.push(...rows);},100,72*3600000);
  await assert.rejects(loop(aborter.signal),/ebay fixture abort/);
  assert.deepEqual(applied,[{id:'v1|1|0'}]);assert.deepEqual(mirrored,[{id:'v1|1|0'}]);
  assert.equal(receipts[0].stop_reason,'ABORTED');assert.equal(receipts[0].unavailable,1);
}

const deferred = () => {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
};
const entered = deferred(), release = deferred();
let running = 0, peak = 0, completed = 0, stop = false;
const batch = runLifecycleBatch([1, 2, 3, 4], {
  concurrency: 2, canStart: () => !stop,
  processItem: async () => {
    running++; peak = Math.max(peak, running);
    if (running === 2) entered.resolve();
    await release.promise;
    running--; completed++;
  }
});
await entered.promise;
stop = true;
release.resolve();
await batch;
assert.equal(peak, 2);
assert.equal(completed, 2, 'stop prevents new work but drains both admitted operations');

const failed = deferred(), remaining = deferred();
let saved = false;
const rejected = runLifecycleBatch([1, 2, 3], {
  concurrency: 2, canStart: () => true,
  processItem: async id => {
    if (id === 1) { await failed.promise; throw new Error('abort fixture'); }
    await remaining.promise; saved = true;
  }
});
failed.resolve();
remaining.resolve();
await assert.rejects(rejected, /abort fixture/);
assert.equal(saved, true, 'failure cannot release the job before an in-flight verified result is saved');

let time = 0, allowed = true;
const starts = [];
const paced = pacedLifecycleFetch(async () => { starts.push(time); return new Response('{}'); }, {
  intervalMs: 200, canStart: () => allowed, now: () => time,
  sleep: async ms => { time += ms; }
});
await Promise.all([paced('one'), paced('two'), paced('three')]);
assert.deepEqual(starts, [0, 200, 400], 'concurrent callers share one source request-start limit');
allowed = false;
await assert.rejects(paced('blocked'), /LIFECYCLE_ADMISSION_STOPPED/);
assert.equal(starts.length, 3, 'no new HTTP request after source block or deadline');

let calls = 0;
time = 400;
const lateGate = pacedLifecycleFetch(async () => { calls++; return new Response('{}'); }, {
  intervalMs: 200, canStart: () => time < 500, now: () => time,
  sleep: async ms => { time += ms; }
});
await lateGate('first');
await assert.rejects(lateGate('past deadline'), /LIFECYCLE_ADMISSION_STOPPED/);
assert.equal(calls, 1, 'deadline is checked again after pacing wait');
console.log('Lifecycle bounded batch contract passed');
