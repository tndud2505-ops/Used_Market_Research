// Deterministic source/function checks only. No browser, network or production data.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import * as core from '../web-backend/public/pc-tools-core.mjs';
import * as catalog from '../web-backend/public/pc-tools-catalog.mjs';

const read = name => readFileSync(new URL(`../web-backend/public/${name}`, import.meta.url), 'utf8');
const script = read('pc-tools.js'), app = read('app.js'), css = read('ui-concept-a.css');
const pages = ['index.html', 'computer-builder.html', 'price-analysis.html', 'guide.html', 'privacy.html', 'terms.html', 'used-market-categories.html'];
test('all seven pages use one compact theme, unique IDs and common navigation', () => {
  for (const name of pages) {
    const html = read(name), ids = [...html.matchAll(/\bid="([^"]+)"/g)].map(m => m[1]);
    assert.equal(ids.length, new Set(ids).size, `${name}: duplicate IDs`);
    assert.match(html, /ui-concept-a\.css\?v=compact-ui-v1/);
    assert.match(html, /data-ui-release="compact-ui-v1"/);
    assert.doesNotMatch(html, /ui-refinement\.css/);
    assert.match(html, /class="skip-link" href="#main"/);
    assert.equal([...html.matchAll(/<h1\b/g)].length, 1);
    for (const href of ['/', '/computer-builder.html', '/price-analysis.html', '/guide.html']) assert.ok(html.includes(`href="${href}"`));
    for (const [, refs] of html.matchAll(/\baria-(?:controls|labelledby)="([^"]+)"/g)) {
      for (const id of refs.split(/\s+/)) assert.ok(ids.includes(id), `${name}: missing ${id}`);
    }
  }
});
test('only changed assets receive new cache identities; calculation/catalog/chart versions remain unchanged', () => {
  for (const name of ['core', 'catalog']) assert.ok(script.includes(`pc-tools-${name}.mjs?v=parts-ux-v4`));
  assert.match(script, /pc-tools-data\.mjs\?v=parts-data-v5/);
  assert.match(script, /pc-tools-chart\.mjs\?v=ui-a-v1/);
  assert.match(read('index.html'), /app\.js\?v=compact-ui-v1/);
});
test('native dialogs are wired without destructive hash navigation or inline handlers', () => {
  assert.match(read('computer-builder.html'), /<dialog id="builder-model-dialog"/);
  assert.match(read('index.html'), /<dialog id="up-filter-dialog"/);
  assert.match(script, /if \(type === 'show-summary'\)/);
  assert.doesNotMatch(read('computer-builder.html'), /href="#build-summary"/);
  assert.match(app, /home\.after\(dom\.modelFilters\)/);
  assert.match(app, /dialog\.showModal\(\)/);
  assert.match(app, /event\.preventDefault\(\); applyCatalogSearch\(query\.value, true\)/);
  for (const page of pages) assert.doesNotMatch(read(page), /\bon(?:click|change|input|submit)\s*=/i);
});
test('responsive theme does not hide whole-page overflow and preserves focus/reduced motion', () => {
  assert.doesNotMatch(css, /(?:html|body)[^{]*\{[^}]*overflow-x\s*:\s*(?:hidden|clip)/);
  for (const token of ['max-width:760px', 'max-width:359px', 'prefers-reduced-motion:reduce', ':focus-visible', '.up-dialog::backdrop']) assert.ok(css.includes(token));
  assert.match(read('pc-tools-chart.mjs'), /Math\.max\(220, container\.clientWidth\)/);
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
test('analysis details are visible and preserve mean label, sample and date scope', () => {
  const t = setup(); t.context.renderSummary(); const text = t.nodes.get('#tools-summary').textContent;
  assert.match(text, /평균 · 표본 5건 · KRW · 2026-08-19 ~ 2026-09-17/);
  assert.equal(t.nodes.get('#tools-summary').children[0].children.at(-1).className, 'tools-summary-detail');
});
test('missing/error publication does not display an invented zero-sample count', () => {
  for (const record of [{ state: 'loading' }, { state: 'error', error: 'HTTP 503' }, { state: 'ready', data: { availability: { status: 'UNAVAILABLE' } } }]) {
    const t = setup({ record }); t.context.renderSummary(); const text = t.nodes.get('#tools-summary').textContent;
    assert.match(text, /표본 미확인/); assert.doesNotMatch(text, /표본 0건/);
  }
});
test('source comparison uses individual source values rather than repeating aggregate prices', () => {
  const t = setup(); t.context.renderAnalysisContext(t.record, t.record.data, 'KRW');
  const text = t.nodes.get('#analysis-source-comparison').textContent;
  assert.match(text, /번개장터102원/); assert.match(text, /중고나라100원/);
  assert.doesNotMatch(text, /101원/); assert.match(text, /평균 · 5건/);
});
test('selected source and missing manufacturer cannot fall back to aggregate prices', () => {
  const t = setup({ source: 'bunjang' }); t.context.renderAnalysisContext(t.record, core.sourceStats(t.record.data, 'bunjang'), 'KRW');
  assert.doesNotMatch(t.nodes.get('#analysis-source-comparison').textContent, /중고나라/);
  t.state.selectedManufacturer = 'not-published'; t.context.renderAnalysisContext(t.record, null, 'KRW');
  assert.match(t.nodes.get('#analysis-source-comparison').textContent, /통계가 제공되지/);
  assert.doesNotMatch(t.nodes.get('#analysis-source-comparison').textContent, /102원|101원/);
});
test('reference buckets are labelled and models outside public listings have no false link', () => {
  const t = setup(); const p = { ...product, category_code: 'CASE', key_specs: { directory_node_type: 'FACET' } };
  t.state.byId.set(product.canonical_product_id, p);
  t.context.renderAnalysisContext(t.record, t.record.data, 'KRW');
  assert.match(t.nodes.get('#analysis-scope').textContent, /제조사·규격 구간 참고/);
  assert.equal(t.nodes.get('#analysis-listing-link').hidden, true);
});
test('empty model selection clears the context instead of retaining another model price', () => {
  const t = setup(); t.state.selectedId = ''; t.context.renderAnalysisContext(null, null, 'KRW');
  assert.match(t.nodes.get('#analysis-scope').textContent, /선택 모델 없음/);
  assert.match(t.nodes.get('#analysis-source-comparison').textContent, /조건에 맞는 모델이 없습니다/);
  assert.equal(t.nodes.get('#analysis-listing-link').hidden, true);
});
