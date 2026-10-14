import assert from 'node:assert/strict';
import { SERIES, money, metricValue, soldMeanValue, metricIsConsistent, listedPriceRange, buildTotals, compactBuild, compatibility, groupProducts, validateBuild, dailySeries, percentChange, overviewIndex, priceDateRange, shiftDate, sourceStats, coherentStats, modelPageItems, buildAnalysisSeries } from '../web-backend/public/pc-tools-core.mjs';
import { movingAverage, marketLinePath, marketGapPath, responsiveDateCount, buildMarketView, drawMarketChart } from '../web-backend/public/pc-market-chart.mjs';
import { createPriceStore } from '../web-backend/public/pc-tools-data.mjs';
import { metricPresentation } from '../web-backend/public/pc-tools-core.mjs';
import { pcCatalogResponse } from '../cloudflare/pc-directory-http.mjs';
const p = (id, category, name, specs = {}) => ({ canonical_product_id: id, category_code: category, canonical_display_name: name, key_specs: specs });
const cpu = p('cpu', 'CPU', 'CPU 5600', { socket: 'AM4' });
const board = p('board', 'MOTHERBOARD', 'B650', { socket: 'AM5', memory_generation: 'DDR5' });
const ram = p('ram', 'RAM', 'DDR4 16GB', { memory_generation: 'DDR4' });
const products = new Map([cpu, board, ram].map(p => [p.canonical_product_id, p]));
const categories = new Set(['CPU', 'MOTHERBOARD', 'RAM']);
const entries = validateBuild([{ id: 'cpu' }, { id: 'board', quantity: 2 }], products, categories);
assert.equal(metricValue({ sample_count: 0, mean: 100 }), null);
assert.equal(metricValue({ sample_count: 5, mean: null }), null);
assert.equal(metricValue({ sample_count: 5, mean: 100, max: 50 }), null);
assert.equal(metricValue({ sample_count: 4, min: 100, max: 200, mean: null, median: 150 }), 150,
  'three or four samples must expose their supported median instead of a blank mean');
assert.equal(metricValue({ sample_count: 1, min: 100, max: 100, mean: null, median: null }), null,
  'one asking price must not be relabelled as an aggregate representative price');
assert.equal(metricIsConsistent({ sample_count: 1, min: 100, max: 100, mean: null, median: null }), true,
  'a valid low-sample asking price must not be treated as an integrity failure');
assert.equal(SERIES.find((series) => series.key === 'active').label, '판매중 가격');
assert.equal(money(1234.5, 'USD'), '$1,234.50');
const totals = buildTotals(entries, e => ({ active: { mean: e.id === 'cpu' ? 100 : 50, sample_count: 5 }, sold: e.id === 'cpu' ? { mean: 80, sample_count: 5 } : null }));
assert.equal(totals.active.amount, 200);
assert.equal(totals.active.covered, 3, 'price coverage must count selected quantities');
assert.equal(totals.active.total, 3, 'total coverage must count selected quantities');
assert.equal(totals.sold.amount, 80);
assert.equal(totals.sold.covered, 1, 'partial sold coverage must count only priced quantities');
assert.equal(totals.sold.total, 3);
assert.equal(totals.sold.complete, false);
assert.equal(totals.confirmed_transactions.amount, null);
assert.equal(soldMeanValue({sample_count:1,min:15000,max:15000,mean:null}),15000);
assert.deepEqual(metricPresentation({sample_count:1,min:15000,max:15000,mean:null},'sold'),
  {text:'15,000원',label:'판매완료 표시가 평균 · 소표본 참고',empty:false,state:'ready'}, 'all price surfaces use the same explicitly qualified sold mean');
assert.equal(soldMeanValue({sample_count:2,min:15000,max:17000,mean:null}),16000);
assert.equal(soldMeanValue({sample_count:3,min:100,max:900,median:100,arithmetic_mean:366.67}),366.67);
assert.equal(soldMeanValue({sample_count:3,min:100,max:900,median:100}),null,'never use the midpoint or median for three sold samples');
assert.equal(soldMeanValue({sample_count:3,min:100,max:900,median:100,arithmetic_mean:1000}),null);
assert.equal(soldMeanValue({sample_count:2,min:100,max:900,aggregate_incomplete:true}),null);
assert.equal(buildTotals([{id:'cpu',quantity:2}],()=>({sold:{sample_count:2,min:15000,max:17000}})).sold.amount,32000);
assert.deepEqual(compactBuild([{ id: 'cpu', quantity: 1, manufacturer: '', category: 'CPU' }, { id: 'board', quantity: 2, manufacturer: ' ASUS ', category: 'MOTHERBOARD' }], products, categories), [{ id: 'cpu' }, { id: 'board', quantity: 2, manufacturer: 'ASUS' }],
  'persisted builds must retain only validated fields needed to restore the selection');
assert.equal(compatibility([...entries, { id: 'ram' }], products).checks.filter(c => c.status === 'conflict').length, 2);
const helpChecks = compatibility([...entries, { id: 'ram' }], products).checks;
assert.match(helpChecks.find(c => c.kind === 'memory').explanation, /DDR5.*DDR4.*함께 사용할 수 없습니다/);
assert.match(helpChecks.find(c => c.kind === 'socket').explanation, /AM5.*AM4.*장착할 수 없습니다/);
const absentSpecs = new Map(products); absentSpecs.set('board', { ...board, key_specs: undefined });
const unknownChecks = compatibility([...entries, { id: 'ram' }], absentSpecs).checks;
assert.equal(unknownChecks.filter(c => c.status === 'unknown').length, 2, 'selected components with missing specs must not silently pass');
assert.ok(unknownChecks.every(c => !/undefined|null/.test(c.explanation)));
const sameSocket = new Map(products); sameSocket.set('board', { ...board, key_specs: { ...board.key_specs, socket: 'AM4' } });
const socketHelp = compatibility(entries, sameSocket).checks.find(c => c.kind === 'socket');
assert.equal(socketHelp.status, 'match');
assert.match(socketHelp.explanation, /소켓이 같아도.*BIOS/);
assert.throws(() => validateBuild([{ id: 'unknown' }], products, categories));
assert.throws(() => validateBuild([{ id: 'cpu', quantity: 0 }], products, categories));
assert.throws(() => validateBuild([{ id: 'cpu' }, { id: 'cpu' }], products, categories));
const groups = groupProducts([p('a', 'GPU', 'ASUS RTX 3070', { gpu_model: 'RTX 3070', vram_gb: 8 }), p('b', 'GPU', 'MSI RTX 3070', { gpu_model: 'RTX 3070', vram_gb: 8 }), p('c', 'GPU', 'RTX 3070 Ti', { gpu_model: 'RTX 3070 Ti', vram_gb: 8 })]);
assert.equal(groups.length, 2);
assert.equal(groups[0].products.length, 2);
const data = { as_of: '2026-09-08', daily: [{ date: '2026-09-06', active: { sample_count: 5, mean: 100 } }, { date: '2026-09-08', active: { sample_count: 5, mean: 110 } }] };
const points = dailySeries(data, 'active', 3);
assert.equal(points[0].sampleCount,5);
assert.equal(points[1].sampleCount,null,'missing daily samples are not zero');
assert.equal(movingAverage(points,3)[2].value,105,'calendar average excludes missing price days');
assert.equal(movingAverage(points,3)[1].value,null,'average does not invent a missing daily observation');
assert.equal(points[1].value, null, 'missing dates must be gaps, never zero or interpolated');
const sparseDaily={window:{to:'2026-10-07'},daily:[{date:'2026-10-06',active:{sample_count:1,min:40000,max:40000,mean:null,median:null}},
  {date:'2026-10-07',active:{sample_count:2,min:40000,max:60000,mean:null,median:null}}]};
const sparsePoints=dailySeries(sparseDaily,'active',2,{includeSparse:true});
assert.equal(sparsePoints[0].value,40000);assert.equal(sparsePoints[0].priceLabel,'등록가 1건');
assert.equal(sparsePoints[1].value,null,'two observed registration prices must not become a fabricated mean');
assert.equal(sparsePoints[1].lower,40000);assert.equal(sparsePoints[1].upper,60000);
assert.ok(buildMarketView([{points:sparsePoints}],sparsePoints.map(point=>point.date),2,0,900,400));
const representativeOnly=dailySeries(sparseDaily,'active',2);
assert.ok(representativeOnly.every(point=>point.value==null&&point.lower==null&&point.upper==null),'price analysis must leave sub-three-sample active dates as gaps');
const medianOnly=dailySeries({window:{to:'2026-10-07'},daily:[{date:'2026-10-07',active:{sample_count:6,min:40000,max:60000,mean:null,median:50000}}]},'active',1,{includeSparse:true})[0];
assert.equal(medianOnly.value,50000);assert.equal(medianOnly.priceLabel,'중앙값','a median fallback must not be presented as an average');
assert.ok(Math.abs(percentChange(points) - 10) < 0.00001);
assert.equal(overviewIndex([data], 'active', 3).points[1].value, null);
assert.equal(overviewIndex([data], 'sold', 3).covered, 0);
const range = priceDateRange('2026-08-01', '2026-08-14', '2026-09-08');
assert.equal(range.days, 14);
assert.equal(range.from, '2026-08-01');
assert.equal(range.to, '2026-08-14');
assert.equal(priceDateRange('', '', '2026-09-08').from, '2026-08-10');
assert.equal(priceDateRange('2026-09-08', '2026-09-08', '2026-09-08').days, 1);
assert.equal(priceDateRange('2024-09-09', '2026-09-08', '2026-09-08').days, 730);
assert.equal(priceDateRange('2025-02-28', '2025-03-01', '2026-09-08').days, 2);
assert.throws(() => priceDateRange('2026-08-20', '2026-08-01', '2026-09-08'));
assert.throws(() => priceDateRange('2024-09-08', '2026-09-08', '2026-09-08'));
assert.throws(() => priceDateRange('2026-09-01', '2026-09-09', '2026-09-08'));
assert.throws(() => priceDateRange('2026-02-30', '2026-03-01', '2026-09-08'));
assert.equal(shiftDate('2026-03-31', -1, 'month'), '2026-02-28');
assert.equal(shiftDate('2024-03-31', -1, 'month'), '2024-02-29');
assert.equal(sourceStats({ active: { mean: 100, sample_count: 10 }, by_source: [] }, 'bunjang'), null, 'missing site must not fall back to overall averages');
const analysisFixture = {
  as_of: '2026-09-08',
  daily: [{ date: '2026-09-08', active: { sample_count: 5, mean: 100 }, sold: { sample_count: 3, median: 80 } }],
  by_source: [
    { source_id: 'joonggonara', daily: [{ date: '2026-09-08', active: { sample_count: 5, mean: 95 }, sold: { sample_count: 1, min: 30000, max: 30000 } }] },
    { source_id: 'bunjang', daily: [{ date: '2026-09-08', active: { sample_count: 5, mean: 105 }, sold: { sample_count: 3, median: 85 } }] },
    { source_id: 'hellomarket', daily: [{ date: '2026-09-08', active: { sample_count: 5, mean: 90 } }] },
  ],
};
const analysisSeries = buildAnalysisSeries(analysisFixture, {
  allowedSourceIds: ['joonggonara', 'bunjang', 'ebay'], days: 30,
  sourceLabels: { joonggonara: '중고나라', bunjang: '번개장터', ebay: 'eBay' },
});
assert.deepEqual(analysisSeries.map(series => series.id), [
  'overall:active', 'overall:sold', 'joonggonara:active', 'joonggonara:sold', 'bunjang:active', 'bunjang:sold'
], 'the domestic chart must show the published aggregate and enabled source series while hiding empty sold and retired sources');
assert.notEqual(analysisSeries.find(series => series.id === 'overall:active').color,
  analysisSeries.find(series => series.id === 'overall:sold').color,
  'active and sold must be distinct by color as well as line style');
assert.equal(analysisSeries.find(series => series.id === 'joonggonara:sold').points.at(-1).value, 30000);
assert.equal(dailySeries({ as_of: '2026-09-08', daily: [{ date: '2026-09-08', sold: { sample_count: 2, min: 100, max: 200 } }] }, 'sold', 1)[0].value, 150);
assert.equal(dailySeries({ as_of: '2026-09-08', daily: [{ date: '2026-09-08', sold: { sample_count: 3, min: 100, max: 200 } }] }, 'sold', 1)[0].value, null, 'do not invent a midpoint for three samples');
assert.equal(new Set(['overall:active', 'joonggonara:active', 'bunjang:active']
  .map(id => analysisSeries.find(series => series.id === id).color)).size, 3,
  'aggregate and marketplace lines must use distinct colors');
assert.equal(analysisSeries.some(series => series.id.startsWith('hellomarket:')), false);
const listed = { sample_count: 1, min: 394000, max: 394000, mean: null, median: null };
const listedFixture = { as_of: '2026-10-02', daily: [{ date: '2026-10-01', active: listed }] };
const danawaSeries = buildAnalysisSeries(listedFixture, { source: 'danawa', allowedSourceIds: ['danawa'], days: 2, sourceLabels: { danawa: '다나와' } });
assert.equal(danawaSeries[0].points[0].value, 394000, 'a verified single Danawa listing is visible as a displayed price');
assert.equal(danawaSeries[0].points[1].value, null, 'missing displayed-price dates remain gaps');
const gapPoints = [{ date: '2026-10-01', value: 100 }, { date: '2026-10-02', value: null },
  { date: '2026-10-03', value: 110 }, { date: '2026-10-04', value: 120 }];
const gapPath = points => marketLinePath(points, date => Number(date.slice(-2)), value => value);
assert.equal(gapPath(gapPoints), 'M1,100 M3,110 L4,120', 'SVG paths break across missing days');
assert.equal(gapPath(gapPoints.filter(point => point.value != null)), 'M1,100 M3,110 L4,120', 'omitted days also break the path');
const soldPath = points => marketLinePath(points, date => Number(date.slice(-2)), value => value, { connectObservations: true });
assert.equal(soldPath(gapPoints), 'M1,100 L3,110 L4,120', 'sold lines connect only actual observations across missing days');
assert.equal(gapPoints[1].value, null, 'drawing connections must not interpolate missing daily prices');
assert.equal(marketGapPath(gapPoints,date=>Number(date.slice(-2)),value=>value),'M1,100 L3,110');
assert.equal(marketGapPath(gapPoints.filter(point=>point.value!=null),date=>Number(date.slice(-2)),value=>value),'M1,100 L3,110');
assert.ok(responsiveDateCount(1200)>responsiveDateCount(390),'a wider viewport fits more calendar dates');
assert.equal(soldPath(gapPoints.filter(point => point.value != null)), 'M1,100 L3,110 L4,120');
assert.equal(soldPath([{ date: '2026-10-01', value: null }, { date: '2026-10-02', value: 120 }]), 'M2,120');
assert.match(danawaSeries[0].label, /중고 최저 표시가/);
assert.equal(metricValue(listed), null, 'displaying a listing must not relax the representative-price threshold');
assert.deepEqual(buildAnalysisSeries(listedFixture, { source: 'bunjang', allowedSourceIds: ['bunjang'], days: 2 }), []);
assert.equal(listedPriceRange({ ...listed, aggregate_incomplete: true }), null);
assert.equal(listedPriceRange({ ...listed, min: 500000 }), null, 'contradictory listed prices remain excluded');
assert.equal(listedPriceRange({ sample_count: 0, min: 394000, max: 394000 }), null);
assert.deepEqual(buildAnalysisSeries(sourceStats(analysisFixture, 'bunjang'), {
  source: 'bunjang', allowedSourceIds: ['joonggonara', 'bunjang'], days: 30,
  sourceLabels: { bunjang: '번개장터' },
}).map(series => series.id), ['bunjang:active', 'bunjang:sold'],
'a selected site must show only its own available metrics');
assert.deepEqual(buildAnalysisSeries(sourceStats(analysisFixture, 'bunjang'), {
  source: 'hellomarket', allowedSourceIds: ['joonggonara', 'bunjang'], days: 30,
}), [], 'a retired source must not be revived by stale payload data');
const scoped = coherentStats({ active: { mean: 41862.5, sample_count: 64 }, by_manufacturer: [{ manufacturer: 'Intel' }], by_source: [
  { source_id: 'bunjang', active: { mean: 43269.39, sample_count: 49, min: 9000, max: 200000 }, daily: data.daily },
  { source_id: 'joonggonara', active: { mean: 15866.67, sample_count: 15, min: 20000, max: 45000 }, daily: data.daily },
] });
assert.equal(scoped.active.mean, 43269.39);
assert.equal(scoped.active.sample_count, 49);
assert.equal(scoped.by_source.length, 1);
assert.equal(scoped.by_manufacturer.length, 0);
assert.equal(scoped.daily.length, 2);
assert.equal(scoped.integrity_filtered_source_count, 1);
const lowSample = coherentStats({
  active: { sample_count: 1, min: 50_000, max: 50_000, mean: null, median: null },
  by_source: [{
    source_id: 'bunjang',
    active: { sample_count: 1, min: 50_000, max: 50_000, mean: null, median: null },
    sold: { sample_count: 0, mean: null, median: null },
  }],
});
assert.equal(lowSample.active.sample_count, 1);
assert.equal(lowSample.by_source.length, 1);
const historicalOnlySource = coherentStats({
  active: { sample_count: 1, min: 50_000, max: 50_000, mean: null, median: null },
  by_source: [
    {
      source_id: 'current',
      active: { sample_count: 1, min: 50_000, max: 50_000, mean: null, median: null },
      sold: { sample_count: 0, mean: null, median: null },
      daily: []
    },
    {
      source_id: 'historical-reserved',
      active: { sample_count: 0, mean: null, median: null },
      sold: { sample_count: 0, mean: null, median: null },
      daily: [{ date: '2026-09-01', active: { sample_count: 1, min: 40_000, max: 40_000, mean: null, median: null } }]
    }
  ]
});
assert.equal(historicalOnlySource.integrity_filtered_source_count || 0, 0,
  'a source with only valid historical daily evidence is not internally contradictory');
assert.equal(historicalOnlySource.by_source.length, 2);
const mixedLowSamples = coherentStats({
  active: { sample_count: 9, min: 1, max: 2, mean: 0 },
  by_source: [
    { source_id: 'good-a', active: { sample_count: 4, min: 40_000, max: 60_000, mean: null, median: 50_000 } },
    { source_id: 'good-b', active: { sample_count: 3, min: 55_000, max: 70_000, mean: null, median: 60_000 } },
    { source_id: 'broken', active: { sample_count: 2, min: 80_000, max: 90_000, mean: 10_000 } },
  ],
});
assert.equal(mixedLowSamples.active.sample_count, 7);
assert.equal(mixedLowSamples.active.mean, null,
  'source medians must not be relabelled as a fabricated combined mean');
assert.equal(mixedLowSamples.active.min, 40_000);
assert.equal(mixedLowSamples.active.max, 70_000);
assert.equal(mixedLowSamples.active.aggregate_incomplete, true);
assert.equal(metricIsConsistent(mixedLowSamples.active), true,
  'a combined low-sample range must stay usable after an invalid source is removed');
assert.deepEqual(modelPageItems(1, 18), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
assert.deepEqual(modelPageItems(10, 18), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
assert.deepEqual(modelPageItems(11, 18), [11, 12, 13, 14, 15, 16, 17, 18]);
assert.deepEqual(modelPageItems(18, 18), [11, 12, 13, 14, 15, 16, 17, 18]);
assert.deepEqual(modelPageItems(3, 4), [1, 2, 3, 4]);
const catalog = pcCatalogResponse();
assert.ok(catalog.tools_catalog.products.some(p => p.category_code === 'CASE'));
assert.ok(catalog.tools_catalog.products.some(p => p.category_code === 'COOLING'));
assert.equal(catalog.categories.some(c => c.code === 'CASE'), false, 'builder extension must not alter current marketplace search scope');

const originalFetch = globalThis.fetch;
let requestedStatsUrl = '';
try {
  globalThis.fetch = async input => {
    requestedStatsUrl = String(input);
    return new Response(JSON.stringify({
      status: 'success',
      data: {
        canonical_product_id: 'cpu',
        methodology: { days: 30, market_pool: 'KR_DOMESTIC_USED', condition: 'USED_WORKING', currency: 'KRW' },
        window: { from: '2026-08-10', to: '2026-09-08' },
        as_of: '2026-09-08',
        active: { sample_count: 5, min: 90, max: 110, mean: 100, median: 100 },
        sold: { sample_count: 3, min: 70, max: 90, mean: 80, median: 80 },
        confirmed_transactions: { sample_count: 0, min: null, max: null, mean: null, median: null },
        daily: [
          { date: '2026-09-07', active: { sample_count: 5, min: 90, max: 100, mean: 95 } },
          { date: '2026-09-08', active: { sample_count: 5, min: 100, max: 110, mean: 105 } }
        ],
        by_source: []
      }
    }), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  const store = createPriceStore(() => {});
  await store.load([cpu], 30);
  const loaded = store.get('cpu', 30);
  assert.equal(loaded.state, 'ready');
  assert.match(requestedStatsUrl, /\/api\/products\/cpu\/price-stats\?days=30&market_pool=KR_DOMESTIC_USED&condition=USED_WORKING&currency=KRW/u);
  assert.equal(buildTotals([{ id: 'cpu', quantity: 2 }], entry => store.get(entry.id, 30).data).active.amount, 200,
    'the builder total must consume the same published price-stat response used by the UI');
  assert.equal(dailySeries(loaded.data, 'active', 30).at(-1).value, 105,
    'price analysis must render the published daily series from the shared price store');
  assert.equal(store.getAvailable('cpu',60).data,loaded.data,'wider-window loading preserves the verified timeline');
  assert.equal(store.getAvailable('ram',60),undefined,'history fallback cannot cross model identities');
  assert.equal(store.getAvailable('cpu',60,'2026-09-07'),undefined,'history fallback cannot cross end dates');
  globalThis.fetch=async()=>new Response(JSON.stringify({status:'error',error:{code:'HISTORICAL_PRICE_STATS_UNAVAILABLE'}}),{status:503});
  await store.load([cpu],60);
  assert.equal(store.getAvailable('cpu',60).data,loaded.data,'failed earlier-history requests retain verified prices');
  assert.equal(store.getAvailable('cpu',60).historyState,'error');
  await store.load([cpu],60,'',{background:true});
  assert.equal(store.getAvailable('cpu',60).data,loaded.data,'retrying failed history preserves the shorter ready window');
} finally {
  globalThis.fetch = originalFetch;
}

// Extending the chart must not cancel prices still loading in the model table.
try {
  const pending=new Map();let calls=0;
  const response=(id,days)=>new Response(JSON.stringify({data:{canonical_product_id:id,
    methodology:{days,market_pool:'KR_DOMESTIC_USED',condition:'USED_WORKING',currency:'KRW'},
    active:{sample_count:5,min:90,max:110,mean:100},daily:[],by_source:[]}}),{status:200});
  globalThis.fetch=(input,{signal})=>new Promise((resolve,reject)=>{
    calls++;
    const url=new URL(input,'https://example.test');
    pending.set(`${decodeURIComponent(url.pathname.split('/')[3])}:${url.searchParams.get('days')}`,{resolve,signal});
    signal.addEventListener('abort',()=>reject(new DOMException('Aborted','AbortError')),{once:true});
  });
  const store=createPriceStore(()=>{});
  const main=store.load([ram],30),history=store.load([cpu],60,'',{background:true});
  await store.load([cpu],60,'',{background:true});assert.equal(calls,2,'a visible-page refresh reuses a pending request instead of duplicating it');
  assert.equal(pending.get('ram:30').signal.aborted,false,'background history leaves the model-table request active');
  pending.get('ram:30').resolve(response('ram',30));pending.get('cpu:60').resolve(response('cpu',60));
  await Promise.all([main,history]);
  assert.equal(store.get('ram',30).state,'ready');assert.equal(store.get('cpu',60).state,'ready');
  const oldPage=store.load([{canonical_product_id:'old-page'}],60,'',{background:true,backgroundKey:'picker'});
  const newPage=store.load([{canonical_product_id:'new-page'}],60,'',{background:true,backgroundKey:'picker'});
  await oldPage;
  assert.equal(pending.get('old-page:60').signal.aborted,true,'changing picker results cancels obsolete requests');
  assert.equal(store.get('old-page',60),undefined);
  assert.equal(store.get('new-page',60).state,'loading','old cancellation cannot erase a new request');
  store.cancelBackground('picker');await newPage;
  assert.equal(pending.get('new-page:60').signal.aborted,true,'closing picker cancels only its remaining work');
  assert.equal(store.get('ram',30).state,'ready','picker cancellation preserves selected-price cache');
  const obsolete=store.load([cpu],120,'',{background:true});
  store.clear();await obsolete;
  assert.equal(pending.get('cpu:120').signal.aborted,true,'clearing a selection cancels background history');
  assert.equal(store.get('cpu',120),undefined,'cancelled history cannot repopulate cleared selection data');
} finally { globalThis.fetch=originalFetch; }

const gapDates=Array.from({length:30},(_,i)=>shiftDate('2026-10-07',i-29));
const emptyWindowPoints=gapDates.map((date,i)=>({date,value:i===0?100:null}));
const gapView=buildMarketView([{points:emptyWindowPoints}],gapDates,10,0,900,400);
assert.equal(gapView.emptyViewport,true,'a viewport without observations remains navigable');
assert.equal(marketLinePath(emptyWindowPoints.slice(-10),gapView.x,gapView.y),'','the empty viewport has no invented price line');

// Exercise the actual renderer's event handlers without browser/network state.
const savedDom=Object.fromEntries(['document','ResizeObserver','requestAnimationFrame','cancelAnimationFrame'].map(key=>[key,globalThis[key]]));
class ChartNode {
  constructor(tag){this.tag=tag;this.children=[];this.dataset={};this.attributes={};this.events={};this.clientWidth=900;this.clientHeight=400;this.offsetWidth=220;this.offsetHeight=120;this.style={setProperty(){}};}
  append(...items){this.children.push(...items);} prepend(item){this.children.unshift(item);} replaceChildren(...items){this.children=items;this.replaceCount=(this.replaceCount||0)+1;}
  setAttribute(key,value){this.attributes[key]=String(value);} addEventListener(key,fn){this.events[key]=fn;} removeEventListener(key){delete this.events[key];}
  setPointerCapture(){} hasPointerCapture(){return true;} releasePointerCapture(){} focus(){} contains(){return true;}
  getBoundingClientRect(){return {left:0,top:0,width:this.clientWidth,height:this.clientHeight};}
  emit(type,props={}){this.events[type]?.({button:0,pointerId:1,pointerType:'touch',clientX:500,clientY:200,preventDefault(){},...props});}
}
try{
  globalThis.document={createElement:tag=>new ChartNode(tag),createElementNS:(_,tag)=>new ChartNode(tag),addEventListener(){},removeEventListener(){}};
  globalThis.ResizeObserver=class{observe(){}disconnect(){}};
  globalThis.requestAnimationFrame=fn=>{fn();return 1;};globalThis.cancelAnimationFrame=()=>{};
  const chart=new ChartNode('div'),timeline=Array.from({length:120},(_,i)=>({date:shiftDate('2026-10-07',i-119),value:100+i,sampleCount:5}));
  let olderRequests=0,lastView;
  const options={identity:'cpu:KRW',canLoadEarlier:true,onLoadEarlier:()=>olderRequests++,onViewChange:range=>{lastView=range;}};
  const line={id:'bunjang:active',metricKey:'active',label:'번개장터 · 판매중',points:timeline};
  const partialChart=new ChartNode('div');
  drawMarketChart(partialChart,[{...line,points:timeline.slice(-15)}],{identity:'partial'});
  drawMarketChart(partialChart,[line],{identity:'partial'});
  assert.equal(Number(partialChart.children[1].children[0].dataset.visibleCount),responsiveDateCount(900),
    'a shorter cached fallback must not overwrite the responsive date spacing when the full window arrives');
  drawMarketChart(chart,[line],options);
  const stage=chart.children[1],svg=stage.children[0],initialCount=Number(svg.dataset.visibleCount);
  assert.ok(initialCount<120,'first view uses readable date density rather than the full loaded period');
  svg.emit('pointerdown');svg.emit('pointermove',{clientX:700});svg.emit('pointerup',{clientX:700});
  assert.ok(Number(svg.dataset.offset)>0,'dragging the plot right reveals earlier dates');
  const offset=Number(svg.dataset.offset);
  svg.emit('wheel',{deltaX:-90,deltaY:0});
  assert.ok(Number(svg.dataset.offset)>offset,'scrolling left reveals earlier dates');
  const anchored={...lastView};
  drawMarketChart(chart,[{...line,points:[...Array.from({length:60},(_,i)=>({date:shiftDate(timeline[0].date,i-60),value:80,sampleCount:5})),...timeline]}],options);
  assert.deepEqual(lastView,anchored,'prepending history preserves the viewed dates');
  const updatedSvg=chart.children[1].children[0],beforePinch=Number(updatedSvg.dataset.visibleCount);
  updatedSvg.emit('pointerdown',{pointerId:1,clientX:350});updatedSvg.emit('pointerdown',{pointerId:2,clientX:450});
  updatedSvg.emit('pointermove',{pointerId:2,clientX:550});
  assert.ok(Number(updatedSvg.dataset.visibleCount)<beforePinch,'spreading two pointers zooms into the time axis');
  updatedSvg.emit('pointerup',{pointerId:2,clientX:550});updatedSvg.emit('pointerup',{pointerId:1,clientX:350});
  chart.emit('chart-reset');assert.equal(Number(updatedSvg.dataset.offset),0);assert.equal(Number(updatedSvg.dataset.visibleCount),initialCount);
  for(let i=0;i<16;i++)updatedSvg.emit('keydown',{key:'-'});
  assert.ok(olderRequests>0,'zooming out to the earliest loaded edge requests earlier history');
  const frames=new Map();let frameId=0;
  globalThis.requestAnimationFrame=fn=>{frames.set(++frameId,fn);return frameId;};globalThis.cancelAnimationFrame=id=>frames.delete(id);
  const longChart=new ChartNode('div'),longTimeline=Array.from({length:730},(_,i)=>({date:shiftDate('2026-10-07',i-729),value:100+i,sampleCount:5}));
  drawMarketChart(longChart,[{...line,points:longTimeline}],{identity:'long'});
  const longSvg=longChart.children[1].children[0],plot=longSvg.children[0],before=plot.replaceCount;
  longSvg.emit('pointerdown');for(let i=0;i<60;i++)longSvg.emit('pointermove',{clientX:510+i*3});
  assert.equal(frames.size,1,'sixty drag events schedule one paint for the next browser frame');
  assert.equal(plot.replaceCount,before,'drag input does not synchronously rebuild SVG nodes');
  [...frames.values()][0]();frames.clear();assert.equal(plot.replaceCount,before+1);
  longSvg.emit('pointerup',{clientX:687});
  const hoverStage=longChart.children[1],readout=hoverStage.children[1],tooltipHeading=readout.children[0];
  for(let i=0;i<60;i++)longSvg.emit('pointermove',{pointerType:'mouse',clientX:100+i*8});
  assert.equal(frames.size,1,'mouse moves coalesce into one hover frame');
  [...frames.values()][0]();frames.clear();
  assert.equal(readout.hidden,false);
  assert.equal(readout.children[0],tooltipHeading,'hover reuses tooltip structure');
  assert.equal(plot.replaceCount,before+1,'hover never rebuilds price plot');
  longSvg.emit('pointermove',{pointerType:'mouse',clientX:200});hoverStage.emit('pointerleave');
  assert.equal(frames.size,0,'leave cancels pending hover');assert.equal(readout.hidden,true);
  longSvg.emit('pointermove',{pointerType:'mouse',clientX:200});longSvg.emit('pointerdown',{clientX:500});
  assert.equal(frames.size,0,'pointer down cancels pending hover');longSvg.emit('pointerup',{clientX:500});
  assert.equal(readout.dataset.pinned,'true','click pins synchronously');
  longSvg.emit('keydown',{key:'Escape'});
  const beforeWheel=Number(longSvg.dataset.visibleCount);let prevented=false;
  longSvg.emit('wheel',{deltaX:0,deltaY:120,preventDefault(){prevented=true;}});
  assert.equal(prevented,false,'ordinary vertical wheel remains available for page scrolling');
  assert.equal(Number(longSvg.dataset.visibleCount),beforeWheel,'ordinary vertical wheel preserves the chart period');
  longSvg.emit('wheel',{deltaX:0,deltaY:-120,ctrlKey:true});
  [...frames.values()].forEach(fn=>fn());frames.clear();assert.ok(Number(longSvg.dataset.visibleCount)<beforeWheel,'Ctrl+wheel still zooms the chart');
  const rangeChart=new ChartNode('div'),rangeTimeline=longTimeline.map(point=>({...point,value:null,lower:point.value,upper:point.value+50,sampleCount:2}));
  drawMarketChart(rangeChart,Array.from({length:6},(_,i)=>({...line,id:`range-${i}`,points:rangeTimeline})),{identity:'dense-ranges'});
  const rangeSvg=rangeChart.children[1].children[0];
  for(let i=0;i<24;i++)rangeSvg.emit('keydown',{key:'-'});
  [...frames.values()].forEach(fn=>fn());frames.clear();
  const rangeGroups=rangeSvg.children[0].children.filter(node=>node.tag==='g'&&node.attributes['data-series']);
  assert.equal(rangeGroups.length,6);
  for(const group of rangeGroups){
    const paths=group.children.filter(node=>node.attributes['data-range-series']);
    assert.equal(paths.length,1,'all daily ranges use one SVG node per series');
    assert.equal((paths[0].attributes.d.match(/M/g)||[]).length,730,'dense rendering preserves every observed range');
    assert.equal(group.children.filter(node=>node.tag==='line').length,0);
  }
  const docked=new ChartNode('div');
  drawMarketChart(docked,[line,{...line,id:'ebay:active',currency:'USD',points:timeline.map(point=>({...point,value:99999}))}],{
    identity:'docked',showLegend:false,showNote:false,dockedReadout:true,axisLeft:true,
    readoutInput:[line,{...line,id:'danawa:active',label:'다나와',points:[]}],
  });
  assert.equal(docked.children.length,2,'only fixed readout and chart, no explanatory footer');
  const dockedReadout=docked.children[0],dockedStage=docked.children[1],dockedSvg=dockedStage.children[0];
  assert.equal(dockedReadout.attributes.role,'region');assert.equal(dockedStage.children.length,1,'no floating tooltip on the plot');
  assert.equal(dockedReadout.hidden,false);
  assert.equal(dockedReadout.children[1].children[1].children[1].hidden,false,'missing source keeps its readout slot');
  assert.equal(dockedSvg.children[0].children.some(node=>node.attributes['data-series']==='ebay:active'),false,'USD must never share the KRW axis');
  dockedSvg.emit('pointermove',{pointerType:'mouse',clientX:500,clientY:180});
  [...frames.values()].forEach(fn=>fn());frames.clear();
  const cursor=dockedSvg.children[1],horizontal=cursor.children[1],badge=cursor.children[2].children[1];
  const priorPrice=badge.textContent;
  assert.match(horizontal.attributes.d,/M90,180H/);
  dockedSvg.emit('pointermove',{pointerType:'mouse',clientX:500,clientY:250});
  [...frames.values()].forEach(fn=>fn());frames.clear();
  assert.notEqual(badge.textContent,priorPrice,'vertical motion within one date updates cursor price');
  dockedStage.emit('pointerleave');assert.equal(dockedReadout.hidden,false,'fixed readout does not collapse on leave');
  const corner=new ChartNode('div');
  drawMarketChart(corner,[line],{identity:'corner',showLegend:false,showNote:false,axisLeft:true,cornerReadout:true});
  const cornerStage=corner.children[0],cornerSvg=cornerStage.children[0],popup=cornerStage.children[1];
  assert.equal(popup.hidden,true,'no permanent readout strip');
  const move=x=>{cornerSvg.emit('pointermove',{pointerType:'mouse',clientX:x});[...frames.values()].forEach(fn=>fn());frames.clear();};
  move(200);assert.equal(popup.dataset.side,'right');move(750);assert.equal(popup.dataset.side,'left');
  cornerSvg.emit('pointerdown',{clientX:750});cornerSvg.emit('pointerup',{clientX:750});
  assert.equal(popup.dataset.pinned,'true');const pinnedDate=popup.children[0].children[0].textContent;
  move(200);assert.equal(popup.children[0].children[0].textContent,pinnedDate,'pinned date does not follow mouse');
  cornerSvg.emit('pointerdown',{clientX:750});cornerSvg.emit('pointerup',{clientX:750});
  assert.equal(popup.hidden,true,'second click releases the pinned popup');
  move(200);cornerSvg.emit('keydown',{key:'Escape'});assert.equal(popup.hidden,true);
}finally{for(const [key,value] of Object.entries(savedDom))if(value===undefined)delete globalThis[key];else globalThis[key]=value;}
console.log('PC tools: grouping, independent prices, partial sums, quantity, compatibility, storage validation and chart gaps passed');
