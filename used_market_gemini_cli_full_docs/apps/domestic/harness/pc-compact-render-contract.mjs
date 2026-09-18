// Execute the shipped UI's real functions and event handlers with a small DOM
// double and synthetic catalog/price responses. This is NOT browser evidence.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import * as core from '../web-backend/public/pc-tools-core.mjs';
import * as catalog from '../web-backend/public/pc-tools-catalog.mjs';
const read = name => readFileSync(new URL(`../web-backend/public/${name}`, import.meta.url), 'utf8');
const script = read('pc-tools.js').replace(/^import .*;\r?\n/gm, '').replace(/^void start\(\);\r?$/m, '');

class Node {
  constructor(tag = 'div', owner) {
    this.tagName = tag.toUpperCase(); this.owner = owner; this.children = []; this.attributes = {}; this.ownText = '';
    this.dataset = new Proxy({}, { set: (target, key, value) => { target[key] = String(value); return true; } });
    this.events = new Map(); this.className = ''; this.open = false; this.scrollTop = 0;
    this.classList = { add: name => { this.className += ` ${name}`; }, toggle: (name, yes) => {
      this.className = this.className.split(' ').filter(item => item !== name).concat(yes ? [name] : []).join(' ');
    } };
  }
  set value(value) { this._value = String(value); } get value() { return this._value || ''; }
  set textContent(value) { this.ownText = String(value); for (const child of this.children) child.parent = null; this.children = []; }
  get textContent() { return this.ownText + this.children.map(node => node.textContent).join(''); }
  append(...items) {
    for (let node of items) {
      if (!(node instanceof Node)) node = Object.assign(new Node('#text', this.owner), { textContent: node });
      if (node.parent) node.parent.children = node.parent.children.filter(child => child !== node);
      node.parent = this; this.children.push(node);
    }
  }
  prepend(...items) { const rest = [...this.children]; this.children = []; this.append(...items, ...rest); }
  replaceChildren(...items) { this.textContent = ''; this.append(...items); }
  setAttribute(key, value) { this.attributes[key] = String(value); }
  contains(node) { return this === node || this.children.some(child => child.contains(node)); }
  matches(selector) {
    const tag = selector.match(/^[a-z]+/i)?.[0];
    if (tag && this.tagName !== tag.toUpperCase()) return false;
    const id = selector.match(/#([\w-]+)/)?.[1]; if (id && this.id !== id) return false;
    const cls = selector.match(/\.([\w-]+)/)?.[1]; if (cls && !this.className.split(' ').includes(cls)) return false;
    for (const [, key, quoted, plain] of selector.matchAll(/\[([\w-]+)(?:=(?:"([^"]*)"|([^\]]+)))?\]/g)) {
      const actual = key.startsWith('data-') ? this.dataset[key.slice(5).replace(/-([a-z])/g, (_, c) => c.toUpperCase())] : this.attributes[key] ?? this[key];
      if (actual == null || (quoted ?? plain) != null && String(actual) !== (quoted ?? plain)) return false;
    }
    return true;
  }
  querySelectorAll(selector) {
    const parts = selector.trim().split(/\s+/), last = parts.pop(), result = [];
    const walk = node => { for (const child of node.children) {
      if (child.matches(last)) {
        let cursor = child.parent, index = parts.length - 1;
        while (cursor && index >= 0) { if (cursor.matches(parts[index])) index--; cursor = cursor.parent; }
        if (index < 0) result.push(child);
      }
      walk(child);
    } }; walk(this); return result;
  }
  querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
  closest(selector) { return this.matches(selector) ? this : this.parent?.closest(selector) || null; }
  focus() { this.owner.activeElement = this; } select() { this.selected = true; }
  scrollIntoView() { this.scrolled = true; }
  addEventListener(type, callback) { const handlers = this.events.get(type) || []; handlers.push(callback); this.events.set(type, handlers); }
  showModal() { assert.equal(this.open, false); this.open = true; }
  close() { this.open = false; for (const callback of this.events.get('close') || []) callback(); }
}
const categories = ['CPU', 'GPU', 'RAM', 'MOTHERBOARD', 'SSD', 'HDD', 'PSU', 'CASE', 'COOLING'].map(code => ({ code, label: code }));
const products = categories.map(({ code }) => ({ category_code: code, canonical_product_id: `synthetic:${code}`, brand: 'Synthetic',
  canonical_display_name: code === 'RAM' ? `Synthetic DDR4 16GB ${'Long model name '.repeat(16)}` : `Synthetic ${code}`,
  key_specs: { directory_node_type: 'PRODUCT', ...(code === 'RAM' ? { module_capacity_gb: 16, memory_generation: 'DDR4' } : {}) } }));
const metric = (price, count = 5) => ({ sample_count: count, min: price, max: price, mean: price, median: price });
function setup({ builder = true, saved = new Map(), href, extraProducts = [] } = {}) {
  const doc = { events: new Map(), createElement(tag) { return new Node(tag, doc); },
    createTextNode(text) { return Object.assign(new Node('#text', doc), { textContent: text }); },
    addEventListener(type, callback) { const handlers = this.events.get(type) || []; handlers.push(callback); this.events.set(type, handlers); },
    querySelector(selector) { return this.body.querySelector(selector); }, querySelectorAll(selector) { return this.body.querySelectorAll(selector); } };
  doc.body = new Node('body', doc); doc.body.dataset.page = builder ? 'builder' : 'analysis'; doc.activeElement = doc.body;
  for (const [, tag, id] of read(builder ? 'computer-builder.html' : 'price-analysis.html').matchAll(/<([\w-]+)[^>]*\bid="([^"]+)"/g)) {
    const node = new Node(tag, doc); node.id = id; doc.body.append(node);
  }
  for (const [, action, label] of read(builder ? 'computer-builder.html' : 'price-analysis.html').matchAll(/<button[^>]*data-action="([^"]+)"[^>]*>([^<]*)<\/button>/g)) {
    const node = new Node('button', doc); node.dataset.action = action; node.textContent = label; doc.body.append(node);
  }
  if (builder) doc.querySelector('#build-detail-dialog').append(doc.querySelector('#build-detail-content'));
  const env = { storageFails: false, historyFails: false, clipboardFails: false, stored: saved, writes: 0, copied: '', printCalls: 0, historyCalls: [], draws: [], loads: [], stores: [] };
  const location = new URL(href || `https://example.test/${builder ? 'computer-builder' : 'price-analysis'}.html`);
  const allProducts = [...products, ...extraProducts], timers = new Map(); let nextTimer = 0;
  const context = vm.createContext({ ...core, ...catalog, document: doc, location, URL, URLSearchParams, Intl, Date, Number, Map, Set, AbortController,
    setTimeout: (callback, delay) => { timers.set(++nextTimer, { callback, delay }); return nextTimer; }, clearTimeout: id => timers.delete(id),
    requestAnimationFrame: () => 1, cancelAnimationFrame() {},
    window: { addEventListener() {}, print() { env.printCalls++; } },
    history: { replaceState(...args) { if (env.historyFails) throw new Error('synthetic history failure'); env.historyCalls.push(args); location.href = String(args[2]); } },
    navigator: { clipboard: { async writeText(value) { if (env.clipboardFails) throw new Error('synthetic permission failure'); env.copied = value; } } },
    localStorage: { setItem(key, value) { if (env.storageFails) throw new Error('synthetic quota failure'); env.writes++; saved.set(key, value); }, getItem(key) { return saved.get(key) || null; } },
    createAdfitSlot: () => ({ setEligible() {} }), createContextualAffiliate: () => ({ update() {} }),
    readJson: async () => ({ tools_catalog: { products: allProducts, categories }, sources: [] }),
    drawChart: (container, series, options) => { env.draws.push({ series, options, model: container.dataset.modelId }); },
    createDatePicker: (field, { id }) => { const input = new Node('input', doc); input.id = id; field.append(input); return input; },
    createPriceStore(onChange, options = {}) {
      const records = new Map(), key = (id, days, asOf) => `${id}|${days}|${asOf}`;
      const store = { records, options, get: (id, days = 30, asOf = '') => records.get(key(id, days, asOf)),
        async load(targets, days = 30, asOf = '') { env.loads.push({ targets, days, asOf, currency: options.currency || 'KRW' }); },
        clear() { records.clear(); }, set(id, record, days = 30, asOf = '') { records.set(key(id, days, asOf), record); } };
      env.stores.push(store); return store;
    },
  });
  vm.runInContext(script, context);
  const state = vm.runInContext('state', context);
  Object.assign(state, { products: allProducts, byId: new Map(allProducts.map(p => [p.canonical_product_id, p])), categories, ready: true,
    entries: [{ id: 'synthetic:RAM', quantity: 2, category: 'RAM', manufacturer: '' }], category: 'RAM', selectedId: 'synthetic:RAM' });
  function record(id, active = 100.335, currency = 'KRW') {
    return { state: 'ready', data: { canonical_product_id: id, publication_id: 'synthetic-pub', window: { from: state.range.from, to: state.range.to },
      as_of: `${state.range.to}T05:00:00Z`, active: metric(active), sold: metric(90.5),
      methodology: { currency, market_pool: currency === 'USD' ? 'OVERSEAS_USED' : 'KR_C2C_USED', condition: 'USED_WORKING', days: 30 },
      daily: [{ date: state.range.to, active: metric(active), sold: metric(90.5) }], by_source: [] } };
  }
  for (const p of allProducts) env.stores[0].set(p.canonical_product_id, record(p.canonical_product_id), 30, builder ? '' : state.range.to);
  return { context, state, doc, env, location, record,
    fire(type, target) { for (const callback of doc.events.get(type) || []) callback({ target }); },
    click(node) { assert.ok(node, 'real rendered action must exist'); node.focus(); for (const callback of doc.events.get('click') || []) callback({ target: node }); },
  };
}
const norm = value => JSON.parse(JSON.stringify(value));
const findAction = (root, action) => root.querySelector(`button[data-action="${action}"]`);

test('actual builder renderer emits nine native rows with seven cells, independent quantity and both unit prices', () => {
  const t = setup(); t.context.renderBuild();
  const table = t.doc.querySelector('#build-table table'), rows = table.querySelectorAll('tbody tr');
  assert.equal(rows.length, 9); assert.equal(table.querySelectorAll('th').length, 7);
  for (const row of rows) assert.equal(row.children.length, 7);
  const ram = rows.find(row => row.dataset.category === 'RAM');
  assert.equal(ram.children[0].querySelectorAll('input').length, 0);
  assert.equal(ram.children[2].querySelector('input').value, '2');
  assert.equal(ram.children[3].textContent, '100.34원'); assert.equal(ram.children[4].textContent, '90.5원');
  assert.equal(ram.children[5].textContent, '변경'); assert.equal(ram.children[6].textContent, '×');
  assert.equal(ram.querySelectorAll('[data-build-price]').length, 0, 'calculations must not stretch the default row');
  assert.match(rows[0].textContent, /미선택 \/ 부품 선택/);
});
test('full long name and RAM 16 GB × 2 precision remain in the optional dialog', () => {
  const t = setup(); t.context.renderBuild();
  t.click(findAction(t.doc.querySelector('tr[data-category="RAM"]'), 'build-detail'));
  assert.equal(t.doc.querySelector('#build-detail-dialog').open, true);
  assert.equal(t.doc.querySelector('#build-detail-title').textContent, products[2].canonical_display_name);
  const text = t.doc.querySelector('#build-detail-content').textContent;
  assert.match(text, /16GB × 2개 = 총 32GB/);
  assert.match(text, /단가 100\.34원 × 2 ≈ 200\.67원/);
  assert.match(text, /단가 90\.5원 × 2 = 181원/);
  findAction(t.doc.querySelector('#build-detail-content'), 'retry').focus();
  t.context.renderBuildDetail(); assert.equal(t.doc.activeElement.dataset.action, 'retry');
  assert.ok(t.doc.querySelector('#build-detail-content').contains(t.doc.activeElement), 'a refreshed detail must restore its live retry button focus');
  t.doc.querySelector('#build-detail-dialog').close();
  assert.equal(t.doc.activeElement.dataset.action, 'build-detail');
});
test('one active-only total uses unrounded unit arithmetic and explicitly shows partial/no coverage', () => {
  const t = setup(); t.context.renderSummary(); const summary = t.doc.querySelector('#tools-summary');
  assert.equal(summary.querySelectorAll('strong').length, 1); assert.match(summary.textContent, /합계\(판매중\)201원/);
  assert.doesNotMatch(summary.textContent, /181원|382원|판매완료/);
  t.state.entries.push({ id: 'synthetic:GPU', category: 'GPU', quantity: 1, manufacturer: '' });
  t.env.stores[0].set('synthetic:GPU', { state: 'error', error: '자료 요청 실패 (502)', httpStatus: 502 });
  t.context.renderSummary(); assert.match(summary.textContent, /부분 합계201원가격 확인 2\/3개/);
  t.env.stores[0].set('synthetic:RAM', { state: 'error', errorCode: 'EXACT_STATS_NOT_READY', error: '정확 통계 게시가 준비되지 않았습니다.', httpStatus: 503 });
  t.context.renderSummary(); assert.match(summary.textContent, /합계 계산 불가가격 확인 0\/3개/);
  assert.match(summary.textContent, /집계 미완료/); assert.doesNotMatch(summary.textContent, /0원/);
  t.state.entries = []; t.context.renderSummary(); assert.match(summary.textContent, /선택 없음/); assert.doesNotMatch(summary.textContent, /0원/);
});
test('different publication IDs cannot be silently added into one total', () => {
  const t = setup(); t.state.entries.push({ id: 'synthetic:GPU', category: 'GPU', quantity: 1 });
  const other = t.record('synthetic:GPU'); other.data.publication_id = 'synthetic-new'; t.env.stores[0].set('synthetic:GPU', other);
  t.context.renderSummary(); assert.match(t.doc.querySelector('#tools-summary').textContent, /합계 계산 불가/);
  assert.match(t.doc.querySelector('#tools-summary').textContent, /게시 기준 불일치/);
  assert.equal(t.context.buildEntryData(t.state.entries[0]), null);
});
test('failure, incomplete publication, unavailable period and low sample remain distinct', () => {
  const t = setup();
  assert.equal(t.context.pricePresentation(null, 'active', 'KRW', { state: 'error', errorCode: 'UPSTREAM_ERROR' }).text, '조회 실패');
  assert.equal(t.context.pricePresentation(null, 'active', 'KRW', { state: 'error', errorCode: 'EXACT_STATS_NOT_READY' }).text, '집계 미완료');
  assert.equal(t.context.pricePresentation(null, 'active', 'KRW', { state: 'error', errorCode: 'HISTORICAL_PRICE_STATS_UNAVAILABLE' }).text, '기간 미제공');
  assert.equal(t.context.pricePresentation({ sample_count: 2 }, 'active', 'KRW', { state: 'ready', data: {} }).state, 'insufficient');
  assert.equal(t.context.pricePresentation(null, 'active', 'KRW', null).state, 'loading');
});
test('real input/change handlers reject 0, negative, fractional, empty and oversized quantities without saving them', () => {
  for (const value of ['0', '-1', '1.5', '', '17', '999999']) {
    const t = setup(); t.context.renderBuild(); const input = t.doc.querySelector('input[data-quantity]'); input.value = value;
    t.fire('input', input); t.fire('change', input);
    assert.equal(t.state.entries[0].quantity, 2, value); assert.equal(input.value, '2', value); assert.equal(t.env.writes, 0, value);
    assert.match(t.doc.querySelector('#tools-status').textContent, /1~16개/);
  }
  const t = setup(); t.context.renderBuild(); const input = t.doc.querySelector('input[data-quantity]'); input.value = '16'; t.fire('input', input);
  assert.equal(t.state.entries[0].quantity, 16); assert.equal(t.env.writes, 1);
  assert.match(t.doc.querySelector('#tools-summary').textContent, /1,605원/);
});
test('all nine categories choose through their actual rendered actions and preserve a quantity when changing a model', () => {
  const alternateRam = { ...products[2], canonical_product_id: 'synthetic:RAM-alternate', canonical_display_name: 'Synthetic DDR4 16GB Alternate' };
  const t = setup({ extraProducts: [alternateRam] }); t.state.entries = []; t.context.render();
  for (const category of categories) {
    t.click(findAction(t.doc.querySelector(`tr[data-category="${category.code}"]`), 'category'));
    assert.equal(t.doc.querySelector('#builder-model-dialog').open, true);
    t.click(findAction(t.doc.querySelector('#model-table'), 'choose'));
    assert.equal(t.doc.querySelector('#builder-model-dialog').open, false);
    assert.ok(t.state.entries.some(entry => entry.category === category.code));
  }
  assert.equal(t.state.entries.length, 9);
  const ramId = t.state.entries.find(entry => entry.category === 'RAM').id;
  const input = t.doc.querySelector('tr[data-category="RAM"] input'); input.value = '2'; t.fire('change', input);
  t.click(findAction(t.doc.querySelector('tr[data-category="RAM"]'), 'category'));
  const replacement = t.doc.querySelectorAll('#model-table button[data-action="choose"]').find(button => button.dataset.id !== ramId);
  t.click(replacement); assert.equal(t.state.entries.find(entry => entry.category === 'RAM').quantity, 2);
});
test('generated share URL restores, summary navigation retains hash, deletion survives a reload, and print remains wired', async () => {
  const t = setup(); t.context.render(); t.context.shareBuild();
  const href = t.doc.querySelector('#share-output').value; assert.equal(href, t.location.href);
  const restored = setup({ href, saved: t.env.stored }); await restored.context.start();
  assert.deepEqual(norm(restored.state.entries), norm(t.state.entries));
  const hash = t.location.hash; t.click(t.doc.querySelector('button[data-action="show-summary"]'));
  assert.equal(t.location.hash, hash); assert.equal(t.doc.querySelector('#build-summary').scrolled, true);
  t.click(t.doc.querySelector('button[data-action="print-build"]')); assert.equal(t.env.printCalls, 1);
  t.click(findAction(t.doc.querySelector('tr[data-category="RAM"]'), 'remove'));
  const afterDelete = setup({ href: t.location.href, saved: t.env.stored }); await afterDelete.context.start(); assert.equal(afterDelete.state.entries.length, 0);
});
test('storage/URL and clipboard failures have honest feedback rather than false success', async () => {
  const t = setup(); t.env.storageFails = true; t.env.historyFails = true; t.context.shareBuild();
  assert.match(t.doc.querySelector('#build-save-status').textContent, /저장과 주소 갱신을 사용할 수 없습니다/);
  assert.doesNotMatch(t.doc.querySelector('#build-save-status').textContent, /저장되었습니다/);
  assert.ok(new URL(t.doc.querySelector('#share-output').value).hash.includes('build='));
  t.env.clipboardFails = true; await t.context.copyBuildLink(); assert.match(t.doc.querySelector('#build-share-status').textContent, /자동 복사에 실패/);
  t.env.clipboardFails = false; await t.context.copyBuildLink(); assert.equal(t.env.copied, t.doc.querySelector('#share-output').value);
});
test('model pagination exposes and changes pages 2 and 3 without changing the saved build', () => {
  const extraProducts = Array.from({ length: 27 }, (_, i) => ({ ...products[2], canonical_product_id: `synthetic:RAM-extra-${i}`, canonical_display_name: `Synthetic RAM ${i}` }));
  const t = setup({ extraProducts }); t.context.render(); const before = JSON.stringify(t.state.entries);
  for (const page of ['2', '3']) {
    t.click(t.doc.querySelector(`#model-pages button[data-page="${page}"]`)); assert.equal(t.state.page, Number(page));
  }
  assert.equal(JSON.stringify(t.state.entries), before);
});
test('analysis currency/date changes clear previous data and use the selected request scope', () => {
  const t = setup({ builder: false }); t.context.render();
  const usd = t.record('synthetic:RAM', 123.45, 'USD'); usd.data.by_source = [{ source_id: 'ebay', active: metric(123.45), sold: metric(90.5), daily: usd.data.daily }];
  t.env.stores[1].set('synthetic:RAM', usd, 30, t.state.range.to);
  t.click(t.doc.querySelector('#chart-sources button[data-source="ebay"]'));
  assert.match(t.doc.querySelector('#tools-summary').textContent, /\$123\.45/); assert.equal(t.env.draws.at(-1).options.currency, 'USD');
  assert.equal(t.env.loads.at(-1).currency, 'USD');
  t.doc.querySelector('#chart-from').value = t.state.range.to;
  t.click(findAction(t.doc.querySelector('#chart-navigation'), 'range-apply'));
  assert.equal(t.state.days, 1); assert.doesNotMatch(t.doc.querySelector('#tools-summary').textContent, /\$123\.45/);
  assert.equal(t.env.loads.at(-1).days, 1); assert.equal(t.env.loads.at(-1).asOf, t.state.range.to);
  assert.ok(t.env.draws.at(-1).series.every(series => series.points.every(point => point.value == null)));
});
