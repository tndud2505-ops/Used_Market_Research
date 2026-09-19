// Source-function and synthetic-response regressions, NOT a browser/UI pass.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import * as core from '../web-backend/public/pc-tools-core.mjs';
import * as catalog from '../web-backend/public/pc-tools-catalog.mjs';
import { readJson, createPriceStore } from '../web-backend/public/pc-tools-data.mjs';

const script = readFileSync(new URL('../web-backend/public/pc-tools.js', import.meta.url), 'utf8');
const declarations = [...script.matchAll(/^(?:async )?function \w+\([\s\S]*?^\}/gm)].map(match => match[0]).join('\n');
// Run the actual element/action factories too: reset must render its controls,
// rather than failing because the test omitted an arrow-function dependency.
const factories = script.slice(script.indexOf('const el = '), script.indexOf('function status('));
const ram = { canonical_product_id: 'ram:g-skill:ddr4:16gb', canonical_display_name: 'G.Skill DDR4 16GB',
  category_code: 'RAM', brand: 'G.Skill', key_specs: { memory_generation: 'DDR4', module_capacity_gb: 16 } };
const metric = value => ({ sample_count: 5, mean: value, median: value, min: value, max: value });
const raw = () => ({ canonical_product_id: ram.canonical_product_id, active: metric(129500), sold: metric(126237.5),
  methodology: { days: 30, market_pool: 'KR_C2C_USED', condition: 'USED_WORKING', currency: 'KRW' },
  window: { from: '2026-08-19', to: '2026-09-17' }, published_window: { from: '2026-08-19', to: '2026-09-17', days: 30 },
  publication_id: 'synthetic-test', by_source: [], daily: [] });
function node(text = '') {
  return { textContent: text, children: [], dataset: {}, append(...items) { this.children.push(...items); },
    replaceChildren(...items) { this.children = items; this.textContent = ''; },
    prepend(...items) { this.children.unshift(...items); }, contains(value) { return this.children.includes(value); },
    querySelectorAll() { return []; }, scrollIntoView() {}, setAttribute() {},
    classList: { toggle() {}, add() {} } };
}
function allText(value) { return [value.textContent || '', ...(value.children || []).map(allText)].join(''); }
function setup({ builder = true, data = raw() } = {}) {
  const priceNode = node(); priceNode.dataset.buildPrice = ram.canonical_product_id; priceNode.dataset.series = 'sold';
  const memoryNode = node(); memoryNode.dataset.memoryTotal = ram.canonical_product_id;
  const summary = node(), table = Object.assign(node(), { querySelectorAll: selector => selector === '[data-build-price]' ? [priceNode] : selector === '[data-memory-total]' ? [memoryNode] : [] });
  const state = { products: [ram], byId: new Map([[ram.canonical_product_id, ram]]), categories: [{ code: 'RAM', label: 'RAM' }],
    category: 'RAM', manufacturer: 'G.Skill', generation: 'DDR4', capacity: '16', query: '지스킬', sort: 'price', page: 3,
    selectedId: ram.canonical_product_id, selectedManufacturer: '', entries: [{ id: ram.canonical_product_id, quantity: 2, category: 'RAM', manufacturer: '' }],
    source: 'bunjang', days: 30, range: { from: '2026-08-19', to: '2026-09-17' } };
  const sandbox = vm.createContext({ ...core, ...catalog, state, builder, Intl, URL, Number, Date, Map, Set,
    document: { createTextNode: text => node(text), createElement: () => node() },
    $: selector => selector === '#build-table' ? table : selector === '#tools-summary' ? summary : node(),
    prices: { get: () => ({ state: 'ready', data }) }, overseasPrices: null,
    displayPrice: value => value == null ? '—' : core.money(value), PAGE_SIZE: 12, brandOf: catalog.toolBrand,
    clearTimeout() {}, SOURCE_LABELS: { bunjang: '번개장터' },
    location: { href: 'https://example.test/price-analysis.html' }, history: { replaceState() {} } });
  vm.runInContext(`${factories}\n${declarations}`, sandbox);
  vm.runInContext('render = () => {}; refreshPrices = () => {};', sandbox);
  return { sandbox, state, priceNode, summary, memoryNode };
}

test('RAM displayed sold unit × 2 preserves fractional-won arithmetic', () => {
  const { sandbox, priceNode, memoryNode } = setup(); sandbox.refreshBuildPriceDetails();
  assert.match(priceNode.title, /단가 126,237\.5원 × 2 = 252,475원/);
  assert.match(allText(priceNode), /252,475원/);
  assert.match(allText(memoryNode), /16GB × 2개 = 총 32GB/);
});
test('higher precision statistical means use an approximation sign, not a false equality', () => {
  const { sandbox, priceNode } = setup({ data: { ...raw(), sold: metric(100.335) } });
  sandbox.refreshBuildPriceDetails();
  assert.match(priceNode.title, /단가 100\.34원 × 2 ≈ 200\.67원/);
  assert.match(allText(priceNode), /200\.67원/);
});
test('reset clears maker/spec/query/sort but preserves saved build and site', () => {
  const { sandbox, state } = setup();
  const saved = JSON.stringify(state.entries);
  const branch = script.match(/^\s*if \(type === 'reset-filters'\).*$/m)?.[0];
  assert.ok(branch, 'actual click handler is required');
  vm.runInContext(`(() => { const type = 'reset-filters'; ${branch} })()`, sandbox);
  for (const key of ['manufacturer', 'generation', 'capacity', 'query']) assert.equal(state[key], '', key);
  assert.equal(state.sort, 'name'); assert.equal(state.source, 'bunjang'); assert.equal(state.category, 'RAM');
  assert.equal(JSON.stringify(state.entries), saved);
});
test('uppercase UNAVAILABLE suppresses quote even if diagnostic central values exist', () => {
  const data = { ...raw(), availability: { status: 'UNAVAILABLE', code: 'EXACT_STATS_NOT_READY' } };
  const { sandbox, priceNode, summary } = setup({ data });
  assert.equal(sandbox.buildEntryData({ id: ram.canonical_product_id }), null);
  sandbox.refreshBuildPriceDetails(); sandbox.renderSummary();
  assert.doesNotMatch(allText(priceNode), /단가 129,500/);
  assert.match(allText(summary), /가격 확인 0\/2개/);
  assert.match(core.priceRecordIssue({ state: 'ready', data }), /게시|통계|준비/);
});
test('uppercase NO_EXACT_PUBLICATION is not genuine zero market samples', () => {
  const data = { ...raw(), publication_id: undefined, availability: { status: 'NO_EXACT_PUBLICATION' } };
  assert.match(core.priceRecordIssue({ state: 'ready', data }), /표본 부족 여부|게시/);
  assert.equal(setup({ data }).sandbox.buildEntryData({ id: ram.canonical_product_id }), null);
});
test('mismatched published period is not plotted as the requested period', async () => {
  const original = globalThis.fetch;
  try {
    globalThis.fetch = async () => new Response(JSON.stringify({ ...raw(),
      window: { from: '2026-08-18', to: '2026-09-16' } }));
    const store = createPriceStore(() => {});
    await store.load([ram], 30, '2026-09-16');
    assert.equal(store.get(ram.canonical_product_id, 30, '2026-09-16').state, 'error');
    store.clear();
  } finally { globalThis.fetch = original; }
});
test('an implicit current request may show the latest completed daily publication only when the edge marks it', async () => {
  const original = globalThis.fetch;
  try {
    const to = new Date().toISOString().slice(0, 10), previous = new Date(Date.parse(`${to}T00:00:00.000Z`) - 86_400_000).toISOString().slice(0, 10);
    const from = new Date(Date.parse(`${previous}T00:00:00.000Z`) - 29 * 86_400_000).toISOString().slice(0, 10);
    globalThis.fetch = async () => new Response(JSON.stringify({ ...raw(), window: { from: new Date(Date.parse(`${to}T00:00:00.000Z`) - 29 * 86_400_000).toISOString().slice(0, 10), to },
      published_window: { from, to: previous, days: 30 }, as_of: `${previous}T18:05:00.000Z`, availability: { status: 'LAST_PUBLISHED' } }));
    const store = createPriceStore(() => {}); await store.load([ram], 30);
    assert.equal(store.get(ram.canonical_product_id, 30).state, 'ready');
    store.clear();
  } finally { globalThis.fetch = original; }
});
test('historical readiness error keeps a useful message without raw payload', async () => {
  const original = globalThis.fetch;
  try {
    globalThis.fetch = async () => new Response(JSON.stringify({ error: { code: 'HISTORICAL_EXACT_STATS_UNAVAILABLE', message: 'private diagnostic' } }), { status: 503 });
    await assert.rejects(readJson('/synthetic-only'), error => /선택 기간/.test(error.message)
      && error.code === 'HISTORICAL_EXACT_STATS_UNAVAILABLE' && !error.message.includes('private diagnostic'));
  } finally { globalThis.fetch = original; }
});
test('mobile category strip cannot extend past the content with a negative margin', () => {
  const css = readFileSync(new URL('../web-backend/public/pc-tools.css', import.meta.url), 'utf8');
  assert.doesNotMatch(css, /\.analysis-filter-bar\s*>\s*\.tools-tabs\s*\{[^}]*margin-right\s*:\s*-/);
  assert.doesNotMatch(css, /(?:html|body)[^{]*\{[^}]*overflow-x\s*:\s*(?:hidden|clip)/);
});
