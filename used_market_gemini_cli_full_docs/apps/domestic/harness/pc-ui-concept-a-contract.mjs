// Deterministic source/function checks only. No browser, network or production data.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import * as core from '../web-backend/public/pc-tools-core.mjs';
import * as catalog from '../web-backend/public/pc-tools-catalog.mjs';

const read = name => readFileSync(new URL(`../web-backend/public/${name}`, import.meta.url), 'utf8');
const script = read('pc-tools.js'), app = read('app.js'), css = read('ui-concept-a.css');
const pages = ['index.html', 'computer-builder.html', 'price-analysis.html', 'guide.html', 'privacy.html', 'terms.html'];
test('all six pages use search-first v2 assets, unique IDs and common navigation', () => {
  for (const name of pages) {
    const html = read(name), ids = [...html.matchAll(/\bid="([^"]+)"/g)].map(m => m[1]);
    assert.equal(ids.length, new Set(ids).size, `${name}: duplicate IDs`);
    assert.match(html, /ui-concept-a\.css\?v=[\w-]+/);
    assert.ok(html.includes(`data-ui-release="${name === 'index.html' ? 'search-modal-v4' : 'search-first-v2'}"`));
    assert.doesNotMatch(html, /ui-refinement\.css/);
    assert.match(html, /class="skip-link" href="#main"/);
    assert.equal([...html.matchAll(/<h1\b/g)].length, 1);
    for (const href of ['/', '/computer-builder.html', '/price-analysis.html', '/guide.html']) assert.ok(html.includes(`href="${href}"`));
    for (const [, refs] of html.matchAll(/\baria-(?:controls|labelledby)="([^"]+)"/g)) {
      for (const id of refs.split(/\s+/)) assert.ok(ids.includes(id), `${name}: missing ${id}`);
    }
  }
});
test('restored UI assets use a fresh cache identity while data and calculation versions remain current', () => {
  assert.match(script,/pc-tools-core\.mjs\?v=[\w-]+/);
  assert.ok(script.includes('pc-tools-catalog.mjs?v=parts-ux-v4'));
  assert.match(script, /pc-tools-data\.mjs\?v=[\w-]+/);
  assert.match(script, /pc-market-chart\.mjs\?v=[\w-]+/);
  assert.match(read('index.html'), /app\.js\?v=[\w-]+/);
  assert.match(read('index.html'), /search-controls\.css\?v=search-modal-v4/);
  assert.match(read('computer-builder.html'), /pc-tools\.js\?v=[\w-]+/);
  assert.match(read('price-analysis.html'), /pc-tools\.js\?v=[\w-]+/);
});
test('analysis shows recent prices and separates the two price kinds in one chart', () => {
  const html=read('price-analysis.html');
  assert.match(html,/id="analysis-chart-pane"/);
  assert.doesNotMatch(html,/id="analysis-table-pane"|data-action="analysis-pane"|id="chart-metric"/);
  assert.doesNotMatch(html,/market-navigation|id="chart-window-status"|data-action="chart-(recent|pan|zoom)"/);
  assert.doesNotMatch(html,/id="chart-(indicators|average-enabled|average-period|samples-enabled)"/);
  assert.doesNotMatch(html,/data-action="chart-period"|id="chart-custom-range"|data-days=/);
  assert.ok(html.includes('id="analysis-prices"'));assert.ok(html.includes('id="chart-price-kind"'));
  assert.match(script,/line\.metricKey===state\.priceKind/);
  assert.match(script,/sourceLabels: SOURCE_LABELS,includeSparse:false/);
  assert.doesNotMatch(script,/line\.priceBasis!=='listed-minimum'\|\|state\.source==='danawa'/);
  assert.match(read('pc-market-chart.mjs'),/'data-price-basis','listed-minimum'/);
  assert.match(script,/showLegend:false/);
});

test('analysis uses KSTOCK window geometry without scrollable plot or separate sliders', () => {
  const html = read('price-analysis.html');
  assert.doesNotMatch(html, /id="chart-scale-/);
  assert.match(read('pc-market-chart.mjs'), /buildMarketView/);
  assert.match(read('pc-market-chart.mjs'), /setPointerCapture/);
});
test('builder toolbar keeps actions while advertising follows the content', () => {
  const html = read('computer-builder.html');
  const toolbar = html.match(/<header class="sf-page-bar sf-builder-bar">([\s\S]*?)<\/header>/)?.[1];
  assert.ok(toolbar);
  assert.equal([...html.matchAll(/id="adfit-banner"/g)].length, 1);
  for (const name of ['save-build', 'print-build']) assert.ok(toolbar.includes(`data-action="${name}"`));
  assert.match(html, /data-placement="bottom" aria-label="카카오 AdFit 광고" hidden/);
  assert.doesNotMatch(script, /cell\.append\(summary\)|const summary = \$\('#build-summary'\)/);
  assert.doesNotMatch(toolbar, /id="(?:build-summary|tools-summary)"/);
  assert.match(script, /const footer = el\('tfoot'\); footer.id = 'tools-summary'/);
  assert.match(html, /builder-toolbar\.css\?v=price-clarity-v1/);
  assert.doesNotMatch(script, /대표가격이 확인된 부품만 합산합니다|수량 반영 금액 · KRW/);
  const toolbarCss = read('builder-toolbar.css');
  assert.match(toolbarCss, /@media \(max-width:760px\)/);
  assert.match(toolbarCss, /@media print/);
  assert.doesNotMatch(toolbarCss, /(?:html|body)[^{]*\{[^}]*overflow-x\s*:\s*(?:hidden|clip)/);
});
test('native dialogs are wired without destructive hash navigation or inline handlers', () => {
  assert.match(read('computer-builder.html'), /<dialog id="builder-model-dialog"/);
  assert.match(read('index.html'), /<dialog id="up-filter-dialog"/);
  assert.match(read('price-analysis.html'), /<dialog id="analysis-model-dialog"/);
  assert.doesNotMatch(read('computer-builder.html'), /href="#build-summary"/);
  assert.match(app, /home\.after\(dom\.modelFilters\)/);
  assert.match(app, /dialog\.showModal\(\)/);
  assert.match(read('index.html'), /<dialog id="listing-price-dialog"/);
  assert.match(read('listing-price-preview.mjs'), /dialog\.showModal\(\)/);
  assert.doesNotMatch(read('index.html'), /id="catalog-query"|id="price-min"|id="price-max"/);
  assert.doesNotMatch(script, /분석중/);
  assert.match(script, /currentAnalysisModel \? '현재 모델' : '보기'/);
  assert.match(script, /if \(type === 'analyze'\) \{\s+\$\('#analysis-model-dialog'\)\?\.close\(\);/);
  for (const page of pages) assert.doesNotMatch(read(page), /\bon(?:click|change|input|submit)\s*=/i);
});
test('responsive theme does not hide whole-page overflow and preserves focus/reduced motion', () => {
  assert.doesNotMatch(css, /(?:html|body)[^{]*\{[^}]*overflow-x\s*:\s*(?:hidden|clip)/);
  for (const token of ['max-width:760px', 'max-width:359px', 'prefers-reduced-motion:reduce', ':focus-visible', '.up-dialog::backdrop']) assert.ok(css.includes(token));
  assert.match(read('pc-tools-chart.mjs'), /Math\.max\(220, container\.clientWidth - \(scrollable \? 18 : 0\)\)/);
  assert.doesNotMatch(read('pc-tools-chart.mjs'), /Math\.max\(320, container\.clientWidth\)/);
});

class Node {
  constructor(tag = '') { this.tagName = tag; this.children = []; this.dataset = {}; this.attributes = {}; this.ownText = ''; this.open = false; this.focused = false; this.showCount = 0; }
  set textContent(value) { this.ownText = String(value); this.children = []; }
  get textContent() { return this.ownText + this.children.map(n => n.textContent ?? String(n)).join(''); }
  append(...items) { this.children.push(...items); }
  prepend(...items) { this.children.unshift(...items); }
  replaceChildren(...items) { this.children = [...items]; this.ownText = ''; }
  setAttribute(key, value) { this.attributes[key] = String(value); }
  contains(node) { return this.children.includes(node); }
  querySelectorAll() { return []; }
  focus() { this.focused = true; }
  showModal() { assert.equal(this.open, false); this.open = true; this.showCount++; }
  close() { this.open = false; }
}
const metric = (price, count = 5) => ({ sample_count: count, mean: price, median: price, min: price, max: price });
const product = { canonical_product_id: 'ram:test-ui-a:ddr4:16gb', canonical_display_name: 'Synthetic RAM', category_code: 'RAM', key_specs: { directory_node_type: 'PRODUCT', module_capacity_gb: 16 } };
function setup({ builder = false, source = '', manufacturer = '', storageFails = false, record } = {}) {
  const root = { canonical_product_id: product.canonical_product_id, active: metric(100.5), sold: metric(90.5),
    methodology: { currency: 'KRW', days: 30, market_pool: 'KR_C2C_USED' }, window: { from: '2026-08-19', to: '2026-09-17' },
    by_source: [{ source_id: 'bunjang', active: metric(101.5), sold: metric(91.5) },
      { source_id: 'joonggonara', active: metric(99.5), sold: metric(89.5) }] };
  const selectedRecord = record === undefined ? { state: 'ready', data: root } : record;
  const nodes = new Map(['#tools-summary', '#analysis-scope', '#analysis-listing-link', '#analysis-source-comparison', '#build-save-status', '#builder-model-dialog', '#picker-title'].map(id => [id, new Node()]));
  const state = { categories: [{ code: 'RAM', label: 'RAM' }], byId: new Map([[product.canonical_product_id, product]]),
    products: [product], entries: [{ id: product.canonical_product_id, category: 'RAM', quantity: 2, manufacturer: '' }],
    sources: root.by_source.map(row => ({ source_id: row.source_id, public_enabled: true })),
    category: 'RAM', selectedId: product.canonical_product_id, selectedManufacturer: manufacturer, source, days: 30,
    range: root.window, ready: true };
  const stored = new Map(), historyCalls = [];
  const context = vm.createContext({ ...core, ...catalog, state, builder, URL, URLSearchParams, Intl, Number, Date, Map, Set,
    STORAGE_KEY: 'used-pick:pc-build:v1', SOURCE_LABELS: { bunjang: '번개장터', joonggonara: '중고나라', ebay: 'eBay' },
    PAGE_SIZE: 12, pickerReturnCategory: '',
    $: selector => nodes.get(selector) || null,
    document: { createElement: tag => new Node(tag), createTextNode: text => Object.assign(new Node(), { textContent: text }) },
    localStorage: { setItem(key, value) { if (storageFails) throw new Error('quota'); stored.set(key, value); } },
    location: { href: 'https://example.test/computer-builder.html' }, history: { replaceState: (...args) => historyCalls.push(args) },
    prices: { get: () => selectedRecord, getAvailable:()=>selectedRecord }, overseasPrices: { get: () => selectedRecord, getAvailable:()=>selectedRecord },
    displayPrice: value => value == null ? '—' : core.money(value), clearTimeout() {},
  });
  const factories = script.slice(script.indexOf('const el = '), script.indexOf('function status('));
  const declarations = [...script.matchAll(/^(?:async )?function \w+\([\s\S]*?^\}/gm)].map(m => m[0]).join('\n');
  vm.runInContext(`${factories}\n${declarations}`, context);
  return { context, nodes, state, record: selectedRecord, stored, historyCalls };
}
test('analysis retains sparse asks with their real dates without inventing a representative mean', () => {
  const t=setup(), container=new Node();t.nodes.set('#analysis-prices',container);
  const data={window:{to:'2026-10-09'},daily:[{date:'2026-10-04',active:{sample_count:1,min:25000,max:25000}}]};
  const options={source:'bunjang',allowedSourceIds:['bunjang'],sourceLabels:{bunjang:'번개장터'},days:120};
  assert.equal(core.buildAnalysisSeries(data,options).length,0);
  const refs=core.buildAnalysisSeries(data,{...options,includeSparse:true}).map(line=>({...line,currency:'KRW'}));
  t.context.renderLatestPrices(refs,t.record);
  assert.match(container.textContent,/25,000원/);assert.match(container.textContent,/등록가 참고 · 대표가격 아님/);
  assert.match(container.textContent,/1건 · 10\.04/);assert.doesNotMatch(container.textContent,/10\.09|평균/);
  data.daily[0].active={sample_count:2,min:25000,max:30000};
  t.context.renderLatestPrices(core.buildAnalysisSeries(data,{...options,includeSparse:true}).map(line=>({...line,currency:'KRW'})),t.record);
  assert.match(container.textContent,/25,000원~30,000원/);assert.doesNotMatch(container.textContent,/27,500/);
});

test('latest source rail retains missing and failed sources without mixing USD values',()=>{
  const t=setup(),container=new Node();t.nodes.set('#analysis-prices',container);
  const sources=[{id:'joonggonara',record:t.record},{id:'bunjang',record:{state:'error'}},{id:'danawa',record:{state:'loading'}},{id:'ebay',record:t.record}];
  t.context.renderLatestPrices([{id:'ebay:active',label:'eBay',currency:'USD',points:[{date:'2026-10-08',value:25.5,sampleCount:4,priceLabel:'평균'}]}],t.record,sources);
  const items=container.children[0].children;
  assert.deepEqual(items.map(item=>item.dataset.source),['joonggonara','bunjang','danawa','ebay']);
  assert.match(items[0].textContent,/자료 없음/);assert.match(items[1].textContent,/조회 실패/);assert.match(items[2].textContent,/확인 중/);
  assert.match(items[3].textContent,/\$25\.50/);assert.match(items[3].textContent,/USD/);assert.doesNotMatch(items[3].textContent,/25.50원/);
});

test('explicit save keeps canonical validated entries, quantity and original storage key', () => {
  const t = setup({ builder: true }); assert.equal(t.context.persistBuild(), true);
  assert.deepEqual(JSON.parse(t.stored.get('used-pick:pc-build:v1')), [{ id: product.canonical_product_id, quantity: 2 }]);
  const url = t.historyCalls[0][2];
  assert.equal(new URLSearchParams(url.hash.slice(1)).get('build'), t.stored.get('used-pick:pc-build:v1'));
  assert.equal(t.nodes.get('#build-save-status').textContent, '');
  assert.equal(t.nodes.get('#build-save-status').hidden, true);
});
test('storage failure is not presented as success and URL configuration is retained', () => {
  const t = setup({ builder: true, storageFails: true }); assert.equal(t.context.persistBuild(), false);
  assert.equal(t.stored.size, 0); assert.equal(t.historyCalls.length, 1);
  assert.match(t.nodes.get('#build-save-status').textContent, /저장을 사용할 수 없습니다/);
  assert.doesNotMatch(t.nodes.get('#build-save-status').textContent, /저장되었습니다/);
});
test('invalid quantity is rejected before persistent state changes', () => {
  const t = setup({ builder: true }); t.state.entries[0].quantity = 0;
  assert.throws(() => t.context.persistBuild(), /수량/); assert.equal(t.stored.size, 0); assert.equal(t.historyCalls.length, 0);
});
test('model picker opens once, closes and does not alter estimates', () => {
  const t = setup({ builder: true }), saved = JSON.stringify(t.state.entries);
  t.context.openModelPicker(); t.context.openModelPicker();
  assert.equal(t.nodes.get('#builder-model-dialog').showCount, 1); assert.equal(t.nodes.get('#picker-title').focused, true);
  t.context.closeModelPicker(); assert.equal(t.nodes.get('#builder-model-dialog').open, false);
  assert.equal(JSON.stringify(t.state.entries), saved);
});
test('picker cannot open before the live catalog is ready', () => {
  const t = setup({ builder: true }); t.state.ready = false; t.context.openModelPicker();
  assert.equal(t.nodes.get('#builder-model-dialog').showCount, 0);
});
test('models outside public listings have no false link', () => {
  const t = setup(); const p = { ...product, category_code: 'CASE', key_specs: { directory_node_type: 'FACET' } };
  t.state.byId.set(product.canonical_product_id, p);
  t.context.renderAnalysisContext(t.record, t.record.data, 'KRW');
  assert.equal(t.nodes.get('#analysis-listing-link').hidden, true);
});
test('empty model selection clears the context instead of retaining another model price', () => {
  const t = setup(); t.state.selectedId = ''; t.context.renderAnalysisContext(null, null, 'KRW');
  assert.equal(t.nodes.get('#analysis-listing-link').hidden, true);
});
test('analysis browsing and category filters do not change the chosen chart or silently narrow its facets',()=>{
  const t=setup(),selected=t.state.selectedId;
  t.state.manufacturer='';t.state.generation='';t.state.capacity='';
  t.context.revealModel(selected);assert.equal(t.state.manufacturer,'');assert.equal(t.state.generation,'');
  t.context.renderControls=()=>{};t.context.renderModelTable=()=>{};t.context.loadPickerPrices=()=>{};
  t.context.selectCategory('CPU');assert.equal(t.state.selectedId,selected);assert.equal(t.state.category,'CPU');
});
test('picker reports genuine sparse history and keeps empty history distinct from a failed lookup',()=>{
  const root={canonical_product_id:product.canonical_product_id,methodology:{days:60,currency:'KRW'},window:{to:'2026-10-07'},daily:[{date:'2026-10-06',active:{sample_count:1,min:45000,max:45000,mean:null,median:null}}]};
  const t=setup({record:{state:'ready',data:root}}),info=t.context.pickerPrice(product.canonical_product_id);
  assert.equal(info.state,'sparse');assert.equal(info.text,'—');assert.equal(info.coverage,'판매중 1건 · 판매완료 미확인');
  const daily=[{date:'2026-10-06',active:metric(45000),sold:{sample_count:7}},{date:'2026-10-07',active:metric(46000),sold:{sample_count:2}}];
  const ready=setup({record:{state:'ready',data:{...root,daily,by_source:[{source_id:'bunjang',daily},{source_id:'joonggonara',daily}]}}});
  const available=ready.context.pickerPrice(product.canonical_product_id);
  assert.equal(available.state,'ready');assert.equal(available.coverage,'판매중 5건 · 판매완료 2건');assert.equal(available.sample,'2026.10.07 기준');
  assert.equal(available.period,'2026.10.06 ~ 2026.10.07');assert.equal(available.detail,undefined);
  assert.equal(ready.context.pickerPrice(product.canonical_product_id),available,'unchanged row summaries are reused');
  const unavailable=setup({record:{state:'ready',data:{...root,availability:{status:'NO_EXACT_PUBLICATION'}}}});
  assert.equal(unavailable.context.pickerPrice(product.canonical_product_id).text,'공개 통계 없음');
  const empty=setup({record:{state:'ready',data:{...root,daily:[]}}});assert.equal(empty.context.pickerPrice(product.canonical_product_id).state,'empty');
  const failed=setup({record:{state:'error',error:'HTTP503'}});assert.equal(failed.context.pickerPrice(product.canonical_product_id).state,'unknown');
});
test('footer totals align price columns and retain quantity-adjusted prices without empty coverage counts', () => {
  const t = setup({ builder: true });
  t.context.renderSummary();
  const summary = t.nodes.get('#tools-summary');
  assert.equal(summary.children[0].tagName, 'tr');
  assert.equal(summary.children[0].children.length, 7);
  assert.equal(summary.children[0].children[0].textContent, '합계');
  assert.match(summary.textContent, /합계판매중 합계201원판매완료 합계181원/);
  assert.doesNotMatch(summary.textContent, /가격 확인/);
  t.state.entries = [];
  t.context.renderSummary();
  assert.match(summary.textContent, /합계판매중 합계—판매완료 합계—/);
  assert.doesNotMatch(summary.textContent, /0\/0|0원/);
});
test('unavailable prices never become a zero-won completed header quote', () => {
  const t = setup({ builder: true, record: { state: 'error', error: '통계 준비 중', errorCode: 'EXACT_STATS_NOT_READY' } });
  t.context.renderSummary();
  const text = t.nodes.get('#tools-summary').textContent;
  assert.doesNotMatch(text, /가격 확인/);
  assert.match(text, /가격 다시 조회/);
  assert.doesNotMatch(text, /0원|201원|181원/);
});
