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
    assert.match(html, name === 'price-analysis.html' ? /ui-concept-a\.css\?v=price-workspace-v1/ : name === 'index.html' ? /ui-concept-a\.css\?v=listing-batch-v1/ : /ui-concept-a\.css\?v=search-first-v2/);
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
  assert.ok(script.includes('pc-tools-core.mjs?v=parts-ux-v10'));
  assert.ok(script.includes('pc-tools-catalog.mjs?v=parts-ux-v4'));
  assert.match(script, /pc-tools-data\.mjs\?v=parts-data-v6/);
  assert.match(script, /pc-tools-chart\.mjs\?v=price-workspace-v5/);
  assert.match(read('index.html'), /app\.js\?v=listing-scope-v6/);
  assert.match(read('index.html'), /search-controls\.css\?v=search-modal-v4/);
  assert.match(read('computer-builder.html'), /pc-tools\.js\?v=price-workspace-v9/);
  assert.match(read('price-analysis.html'), /pc-tools\.js\?v=price-workspace-v11/);
});
test('analysis chart and source table share a responsive, collapsible workspace', () => {
  const html = read('price-analysis.html');
  assert.match(html, /id="analysis-workspace"[\s\S]*?id="analysis-chart-pane"[\s\S]*?id="analysis-table-pane"/);
  for (const pane of ['chart', 'table']) assert.match(html, new RegExp(`data-action="analysis-pane" data-pane="${pane}"`));
  assert.match(html, /id="analysis-source-comparison" class="sf-source-table-scroll" tabindex="0"/);
  assert.match(script, /state\.analysisPanes = \{ chart: pane === 'chart', table: pane === 'table' \}/);
  assert.match(script, /if \(!state\.analysisPanes\[pane\] && !state\.analysisPanes\[other\]\) state\.analysisPanes\[other\] = true/);
  assert.match(script, /analysisIsNarrow && !analysisWasNarrow && state\.analysisPanes\.chart && state\.analysisPanes\.table/);
  assert.match(css, /\.sf-analysis-workspace-grid \{[^}]*grid-template-columns:minmax\(0,1\.35fr\) minmax\(0,1fr\)/);
  assert.match(css, /\.sf-source-table-scroll \{[^}]*overflow-x:auto/);
  assert.match(css, /\.ui-a\.pc-tools \.sf-price-table \{[^}]*min-width:720px/);
});
test('analysis chart uses fixed-axis zoom without separate sliders', () => {
  const html = read('price-analysis.html');
  assert.doesNotMatch(html, /id="chart-scale-/);
  assert.match(read('pc-tools-chart.mjs'), /data-zoom-axis/);
  assert.match(read('pc-tools-chart.mjs'), /tools-chart-fixed-axes/);
});
test('builder toolbar keeps actions and disclosure while totals belong to the table footer', () => {
  const html = read('computer-builder.html');
  const toolbar = html.match(/<header class="sf-page-bar sf-builder-bar">([\s\S]*?)<\/header>/)?.[1];
  assert.ok(toolbar);
  for (const id of ['contextual-offer']) {
    assert.equal([...html.matchAll(new RegExp(`id="${id}"`, 'g'))].length, 1);
    assert.ok(toolbar.includes(`id="${id}"`));
  }
  for (const name of ['open-picker', 'save-build', 'print-build']) assert.ok(toolbar.includes(`data-action="${name}"`));
  assert.match(toolbar, /aria-label="쿠팡 파트너스 광고" hidden/);
  assert.doesNotMatch(script, /cell\.append\(summary\)|const summary = \$\('#build-summary'\)/);
  assert.doesNotMatch(toolbar, /id="(?:build-summary|tools-summary)"/);
  assert.match(script, /const footer = el\('tfoot'\); footer.id = 'tools-summary'/);
  assert.match(html, /builder-toolbar\.css\?v=builder-price-v4/);
  assert.doesNotMatch(script, /대표가격이 확인된 부품만 합산합니다|수량 반영 금액 · KRW/);
  const toolbarCss = read('builder-toolbar.css');
  assert.match(toolbarCss, /@media \(max-width:760px\)/);
  assert.match(toolbarCss, /@media print/);
  assert.doesNotMatch(toolbarCss, /(?:html|body)[^{]*\{[^}]*overflow-x\s*:\s*(?:hidden|clip)/);
  assert.match(read('affiliate.js'), /details\.append\(summary, disclosure\)/, 'moving the ad retains its commission disclosure');
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
    prices: { get: () => selectedRecord }, overseasPrices: { get: () => selectedRecord },
    displayPrice: value => value == null ? '—' : core.money(value), clearTimeout() {},
  });
  const factories = script.slice(script.indexOf('const el = '), script.indexOf('function status('));
  const declarations = [...script.matchAll(/^(?:async )?function \w+\([\s\S]*?^\}/gm)].map(m => m[0]).join('\n');
  vm.runInContext(`${factories}\n${declarations}`, context);
  return { context, nodes, state, record: selectedRecord, stored, historyCalls };
}
test('explicit save keeps canonical validated entries, quantity and original storage key', () => {
  const t = setup({ builder: true }); assert.equal(t.context.persistBuild(), true);
  assert.deepEqual(JSON.parse(t.stored.get('used-pick:pc-build:v1')), [{ id: product.canonical_product_id, quantity: 2 }]);
  const url = t.historyCalls[0][2];
  assert.equal(new URLSearchParams(url.hash.slice(1)).get('build'), t.stored.get('used-pick:pc-build:v1'));
  assert.match(t.nodes.get('#build-save-status').textContent, /이 브라우저에 저장/);
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
test('analysis details move into the source table without duplicate summary cards', () => {
  const t = setup(); t.context.renderSummary(); t.context.renderAnalysisContext(t.record, t.record.data, 'KRW');
  assert.equal(t.nodes.get('#tools-summary').children.length, 0);
  const text = t.nodes.get('#analysis-source-comparison').textContent;
  assert.match(text, /KRW2026-08-19 ~ 2026-09-17/);
  assert.match(text, /102원5/);
});
test('missing/error publication does not display an invented zero-sample count', () => {
  for (const record of [{ state: 'loading' }, { state: 'error', error: 'HTTP 503' }, { state: 'ready', data: { availability: { status: 'UNAVAILABLE' } } }]) {
    const t = setup({ record }); t.context.renderAnalysisContext(t.record, t.record.data, 'KRW');
    const text = t.nodes.get('#analysis-source-comparison').textContent;
    assert.match(text, /확인 중|조회 실패|선택 범위 미제공/); assert.doesNotMatch(text, /표본 0건|0원/);
  }
});
test('source comparison uses individual source values rather than repeating aggregate prices', () => {
  const t = setup(); t.context.renderAnalysisContext(t.record, t.record.data, 'KRW');
  const text = t.nodes.get('#analysis-source-comparison').textContent;
  assert.match(text, /번개장터[\s\S]*102원/); assert.match(text, /중고나라[\s\S]*100원/);
  assert.doesNotMatch(text, /101원/); assert.match(text, /가격 평균/);
});
test('selected source and missing manufacturer cannot fall back to aggregate prices', () => {
  const t = setup({ source: 'bunjang' }); t.context.renderAnalysisContext(t.record, core.sourceStats(t.record.data, 'bunjang'), 'KRW');
  assert.doesNotMatch(t.nodes.get('#analysis-source-comparison').textContent, /중고나라/);
  t.state.selectedManufacturer = 'not-published'; t.context.renderAnalysisContext(t.record, null, 'KRW');
  assert.match(t.nodes.get('#analysis-source-comparison').textContent, /선택 범위 미제공/);
  assert.doesNotMatch(t.nodes.get('#analysis-source-comparison').textContent, /102원|101원/);
});
test('reference buckets are labelled and models outside public listings have no false link', () => {
  const t = setup(); const p = { ...product, category_code: 'CASE', key_specs: { directory_node_type: 'FACET' } };
  t.state.byId.set(product.canonical_product_id, p);
  t.context.renderAnalysisContext(t.record, t.record.data, 'KRW');
  assert.match(t.nodes.get('#analysis-source-comparison').textContent, /제조사·규격 구간 참고/);
  assert.equal(t.nodes.get('#analysis-listing-link').hidden, true);
});
test('empty model selection clears the context instead of retaining another model price', () => {
  const t = setup(); t.state.selectedId = ''; t.context.renderAnalysisContext(null, null, 'KRW');
  assert.match(t.nodes.get('#analysis-source-comparison').textContent, /선택 모델 없음/);
  assert.match(t.nodes.get('#analysis-source-comparison').textContent, /조건에 맞는 모델이 없습니다/);
  assert.equal(t.nodes.get('#analysis-listing-link').hidden, true);
});
test('footer totals align six cells and retain quantity-adjusted prices without empty coverage counts', () => {
  const t = setup({ builder: true });
  t.context.renderSummary();
  const summary = t.nodes.get('#tools-summary');
  assert.equal(summary.children[0].tagName, 'tr');
  assert.equal(summary.children[0].children.length, 6);
  assert.equal(summary.children[0].children[0].textContent, '합계');
  assert.match(summary.textContent, /선택/);
  assert.match(summary.textContent, /1종2개판매중 합계201원판매완료 합계181원/);
  assert.doesNotMatch(summary.textContent, /가격 확인/);
  t.state.entries = [];
  t.context.renderSummary();
  assert.match(summary.textContent, /0종0개판매중 합계—판매완료 합계—/);
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
