import { SERIES, idOf, nameOf, naturalCompare, money, metricValue, metricPresentation, statsUnavailable, priceRecordIssue, analysisSelectionUrl, groupProducts, scopedStats, sourceStats, priceDateRange, modelPageItems, buildTotals, compactBuild, compatibility, validateBuild, dailySeries, percentChange } from './pc-tools-core.mjs?v=parts-ux-v5';
import { readJson, createPriceStore } from './pc-tools-data.mjs?v=parts-data-v5';
import { drawChart } from './pc-tools-chart.mjs?v=search-first-v2';
import { createDatePicker } from './pc-tools-calendar.mjs?v=coverage-v4';
import { createAdfitSlot } from './adfit.js?v=adfit-v2';
import { createContextualAffiliate } from './affiliate.js?v=compact-ad-v2';
import { toolBrand, toolFilterSchema, toolFacetValues, toolFacetLabel, filterToolProducts, visibleSelection, toolScopeNote } from './pc-tools-catalog.mjs?v=parts-ux-v4';

const builder = document.body.dataset.page === 'builder';
const $ = selector => document.querySelector(selector);
const adfit = createAdfitSlot($('#adfit-banner'));
const affiliate = builder ? createContextualAffiliate($('#contextual-offer')) : null;
const STORAGE_KEY = 'used-pick:pc-build:v1';
const PAGE_SIZE = 12;
const state = {
  products: [], byId: new Map(), categories: [], sources: [], category: builder ? 'CPU' : 'GPU',
  manufacturer: '', generation: '', capacity: '', query: '', sort: 'name', page: 1,
  entries: [], selectedId: '', selectedManufacturer: '',
  days: 30, range: priceDateRange(), chartDate: '', source: '', ready: false,
};
let repaintTimer, statusTimer;
const displayPrice = (value, currency = 'KRW') => value == null ? '—' : money(value, currency);
function quotePrice(value, currency = 'KRW') {
  // Keep fractional-won representatives on both sides of unit × quantity.
  // Only the final headline total is rounded to whole won.
  if (currency !== 'KRW' || value == null || !Number.isFinite(value)) return money(value, currency);
  return `${value.toLocaleString('ko-KR', { maximumFractionDigits: 2 })}원`;
}
function pricePresentation(metric, seriesKey = 'active', currency = 'KRW', record = null) {
  if (record?.state === 'error') {
    const code = record.errorCode || '';
    const historical = ['HISTORICAL_PRICE_STATS_UNAVAILABLE', 'HISTORICAL_EXACT_STATS_UNAVAILABLE'].includes(code);
    const incomplete = /PUBLICATION|STATS_NOT_READY/.test(code);
    return { text: historical ? '기간 미제공' : incomplete ? '집계 미완료' : '조회 실패',
      label: record.error, empty: true, state: historical ? 'period-unavailable' : incomplete ? 'incomplete' : 'error' };
  }
  if (!record || record.state === 'loading') return { text: '확인 중', label: '자료 요청 중', empty: true, state: 'loading' };
  if (statsUnavailable(record?.data)) return { text: '통계 미제공', label: '표본 부족 여부 미확인', empty: true, state: 'unavailable' };
  if (!metric) return { text: '통계 미제공', label: '선택 범위의 통계가 제공되지 않았습니다.', empty: true, state: 'unavailable' };
  return metricPresentation(metric, seriesKey, currency);
}
const scheduleRepaint = () => {
  clearTimeout(repaintTimer);
  repaintTimer = setTimeout(() => { renderSummary(); renderModelTable(); if (builder) renderBuild(); else renderAnalysis(); }, 50);
};
const prices = createPriceStore(scheduleRepaint);
const overseasPrices = builder ? null : createPriceStore(scheduleRepaint, {
  marketPool: 'OVERSEAS_USED', condition: 'USED_WORKING', currency: 'USD'
});
const SOURCE_LABELS = { joonggonara: '중고나라', bunjang: '번개장터', hellomarket: '헬로마켓', danawa: '다나와', coolenjoy: '쿨엔조이', ebay: 'eBay', rethinkmall: '리씽크몰' };
const el = (tag, className = '', text = '') => {
  const node = document.createElement(tag); if (className) node.className = className;
  node.textContent = text; return node;
};
const action = (text, name, data = {}, className = '') => {
  const button = el('button', className, text); button.type = 'button'; button.dataset.action = name;
  Object.entries(data).forEach(([key, value]) => { button.dataset[key] = value; });
  return button;
};
function status(text = '', error = false) {
  clearTimeout(statusTimer);
  $('#tools-status').textContent = text; $('#tools-status').dataset.error = String(error);
  if (text && !error) statusTimer = setTimeout(() => { $('#tools-status').textContent = ''; }, 3500);
}
function labelOf(code) { return state.categories.find(c => c.code === code)?.label || code; }
function specOf(p) { return p.key_specs || {}; }
const brandOf = toolBrand;
function generationOf(p) { return toolFacetValues(p, toolFilterSchema(p.category_code)[0]?.[0])[0] || ''; }
function chartRecord(id) { return prices.get(id, builder ? 30 : state.days, builder ? '' : state.range.to); }
function payload(id) {
  const record = chartRecord(id);
  return record?.state === 'ready' && !statsUnavailable(record.data) ? record.data : null;
}
function analysisRecord(id) {
  return !builder && state.source === 'ebay'
    ? overseasPrices?.get(id, state.days, state.range.to)
    : chartRecord(id);
}
function analysisData(id) {
  const record = analysisRecord(id);
  return record?.state === 'ready' && !statsUnavailable(record.data) ? sourceStats(record.data, state.source) : null;
}
function syncAnalysisUrl() {
  if (builder) return;
  const url = new URL(analysisSelectionUrl(location.href, state.selectedId, state.selectedManufacturer));
  if (state.source) url.searchParams.set('source', state.source); else url.searchParams.delete('source');
  url.searchParams.set('from', state.range.from); url.searchParams.set('to', state.range.to);
  history.replaceState(null, '', url.href);
}
function buildEntryData(entry) {
  const record = chartRecord(entry.id);
  if (record?.state !== 'ready' || statsUnavailable(record.data) || buildScopeConflict()) return null;
  return scopedStats(record.data, entry.manufacturer);
}
function buildScopeConflict() {
  // Separate fetches may straddle a publication change. Never total different
  // publication/date/currency scopes as if they belonged to one estimate.
  const scopes = state.entries.map(entry => chartRecord(entry.id))
    .filter(record => record?.state === 'ready' && !statsUnavailable(record.data))
    .map(({ data }) => JSON.stringify([data.publication_id || '', data.window?.from || '', data.window?.to || '',
      data.methodology?.market_pool || '', data.methodology?.condition || '', data.methodology?.currency || '']));
  return new Set(scopes).size > 1;
}
function currentProducts() {
  const schema = toolFilterSchema(state.category);
  const facets = Object.fromEntries(schema.map(([key], i) => [key, i === 0 ? state.generation : state.capacity]));
  return filterToolProducts(state.products, { category: state.category, manufacturer: state.manufacturer, query: state.query, facets });
}
function groups() {
  const rows = groupProducts(currentProducts(), false);
  const sortData = builder ? payload : analysisData;
  if (state.sort === 'price') rows.sort((a, b) => (metricValue(sortData(idOf(a.products[0]))?.active) ?? Infinity)
    - (metricValue(sortData(idOf(b.products[0]))?.active) ?? Infinity) || naturalCompare(a.label, b.label));
  return rows;
}
function pageGroups() { return groups().slice((state.page - 1) * PAGE_SIZE, state.page * PAGE_SIZE); }
function revealModel(id) {
  const product = state.byId.get(id); if (!product) return;
  state.category = product.category_code; state.manufacturer = brandOf(product); state.generation = generationOf(product);
  state.capacity = ''; state.query = '';
  const rows = groups(), index = rows.findIndex(g => g.products.some(p => idOf(p) === id));
  state.page = index < 0 ? 1 : Math.floor(index / PAGE_SIZE) + 1;
}
function selectControl(label, id, options, selected) {
  const wrapper = el('label'), select = el('select'); select.id = id; select.setAttribute('aria-label', label);
  wrapper.append(el('span', 'sr-only', label));
  options.forEach(([value, text]) => { const option = el('option', '', text); option.value = value; option.selected = value === selected; select.append(option); });
  wrapper.append(select); return wrapper;
}
function renderControls() {
  const base = filterToolProducts(state.products, { category: state.category });
  const manufacturers = [...new Set(base.map(brandOf).filter(Boolean))].sort(naturalCompare);
  const schema = toolFilterSchema(state.category);
  const controls = el('div', 'tools-controls');
  if (builder) controls.append(selectControl('부품', 'tool-category', state.categories.map(c => [c.code, c.label]), state.category));
  const searchLabel = el('label', 'tools-search'), search = el('input');
  search.id = 'tool-query'; search.type = 'search'; search.value = state.query; search.maxLength = 160;
  search.placeholder = '모델·브랜드 검색 (지스킬, 5600…)'; search.setAttribute('aria-label', '모델·브랜드 검색');
  searchLabel.append(search); controls.append(searchLabel);
  const brandLabel = state.category === 'GPU' ? '칩 제조사' : state.category === 'RAM' ? '모듈 제조사' : '제조사';
  controls.append(selectControl(brandLabel, 'tool-manufacturer', [['', `전체 ${brandLabel}`], ...manufacturers.map(v => [v, v])], state.manufacturer));
  schema.forEach(([key, label], index) => {
    const candidates = base.filter(p => (!state.manufacturer || brandOf(p) === state.manufacturer)
      && (index === 0 || !state.generation || toolFacetValues(p, schema[0][0]).includes(state.generation)));
    const options = [...new Set(candidates.flatMap(p => toolFacetValues(p, key)))].sort(naturalCompare);
    controls.append(selectControl(label, index === 0 ? 'tool-generation' : 'tool-capacity',
      [['', `전체 ${label}`], ...options.map(value => [value, toolFacetLabel(key, value)])], index === 0 ? state.generation : state.capacity));
  });
  controls.append(selectControl('정렬', 'tool-sort', [['name', '모델명순'], ['price', !builder && state.source === 'ebay' ? 'eBay 낮은가격순 (USD)' : '판매중 낮은가격순']], state.sort));
  controls.append(action('조건 초기화', 'reset-filters', {}, 'tools-reset'));
  $('#model-controls').replaceChildren(controls, el('p', 'tools-scope-note', toolScopeNote(state.category)));
  if (builder) $('#picker-title').textContent = `${labelOf(state.category)} 모델 선택`;
  else {
    const tabs = $('#analysis-categories'); tabs.replaceChildren();
    [{ code: '', label: '전체' }, ...state.categories].forEach(c => {
      const button = action(c.label, 'category', { category: c.code }); button.setAttribute('aria-pressed', String(c.code === state.category)); tabs.append(button);
    });
  }
}
function makeTable(headings) {
  const table = el('table'), head = el('thead'), tr = el('tr'), body = el('tbody');
  headings.forEach(text => { const th = el('th', '', text); th.scope = 'col'; tr.append(th); });
  head.append(tr); table.append(head, body); return { table, body };
}
function priceCell(data, key, record, { showChange = false } = {}) {
  const td = el('td', `price series-${key}`);
  const currency = record?.data?.methodology?.currency || 'KRW';
  const metric = data?.[key], presentation = pricePresentation(metric, key, currency, record);
  if (record?.state === 'error') td.append(action(`${presentation.text} · 재시도`, 'retry'));
  else td.append(document.createTextNode(record?.state === 'loading' ? '확인 중' : presentation.text));
  td.classList.toggle('is-empty', presentation.empty);
  const sample = record?.state === 'ready' && !statsUnavailable(record.data) && Number.isInteger(metric?.sample_count)
    ? `표본 ${metric.sample_count.toLocaleString('ko-KR')}건` : '표본 미확인';
  td.title = `${presentation.label} · ${sample}${builder ? ' · 최근 30일' : ` · ${state.range.from} ~ ${state.range.to}`}${data?.integrity_filtered_source_count || data?.integrity_repaired_source_ids?.length ? ' · 불일치 사이트 제외' : ''}`;
  if (statsUnavailable(data)) td.title = '공개 통계 미제공 · 표본 부족 여부 미확인';
  if (showChange) {
    const change = percentChange(dailySeries(data, key, state.days));
    if (change != null) td.append(el('span', `tools-change ${change > 0 ? 'up' : 'down'}`, `${state.days}일 ${change > 0 ? '▲' : change < 0 ? '▼' : '—'} ${Math.abs(change).toFixed(1)}%`));
  }
  return td;
}
function chosen(id, manufacturer = '') { return state.entries.some(e => e.id === id && e.manufacturer === manufacturer); }
function renderModelTable() {
  const container = $('#model-table');
  // Price completion must not interrupt a focused row action.
  const focus = document.activeElement;
  const focusKey = container.contains(focus) ? { ...focus.dataset } : null;
  const visibleSeries = builder ? SERIES.filter(s => s.key !== 'confirmed_transactions') : [];
  const { table, body } = makeTable(['모델', ...visibleSeries.map(s => s.label), builder ? '조합' : '보기']);
  for (const group of pageGroups()) {
    const product = group.products[0], id = idOf(product), record = chartRecord(id), data = record?.data;
    const row = el('tr', state.selectedId === id ? 'is-selected' : '');
    const name = el('td', 'model-name');
    const publicCategory = !['CASE', 'COOLING'].includes(product.category_code);
    const link = el('a', 'model-name-link', nameOf(product));
    if (publicCategory) {
      link.href = `/?category_code=${encodeURIComponent(product.category_code)}&model_id=${encodeURIComponent(id)}`;
      name.append(link);
    } else {
      name.append(el('span', 'model-name-link', nameOf(product)));
    }
    if (['FACET', 'BROWSE_FACET'].includes(specOf(product).directory_node_type)) name.title = '제조사·규격별 그룹';
    row.append(name);
    visibleSeries.forEach(s => { const cell = priceCell(data, s.key, record, { showChange: !builder }); cell.dataset.label = s.label; row.append(cell); });
    const control = el('td');
    const button = action(builder ? chosen(id) ? '선택됨' : '선택' : state.selectedId === id && !state.selectedManufacturer ? '분석중' : '분석', builder ? 'choose' : 'analyze', { id });
    if (builder && chosen(id)) button.classList.add('primary');
    control.append(button); row.append(control); body.append(row);
  }
  if (!body.children.length) { const tr = el('tr'), td = el('td', 'tools-empty', '해당 조건의 모델이 없습니다.'); td.colSpan = visibleSeries.length + 2; tr.append(td); body.append(tr); }
  container.replaceChildren(table);
  if (focusKey) {
    const replacement = [...container.querySelectorAll('button')].find(b => Object.entries(focusKey).every(([k, v]) => b.dataset[k] === v));
    replacement?.focus({ preventScroll: true });
  }
  const count = Math.max(1, Math.ceil(groups().length / PAGE_SIZE));
  const pages = $('#model-pages'), pageFocus = pages.contains(document.activeElement) ? document.activeElement.dataset.page : null;
  pages.replaceChildren(); pages.hidden = count <= 1;
  const prev = action('‹', 'page', { page: state.page - 1 }), next = action('›', 'page', { page: state.page + 1 });
  prev.setAttribute('aria-label', '이전 모델 페이지'); next.setAttribute('aria-label', '다음 모델 페이지');
  prev.disabled = state.page <= 1; next.disabled = state.page >= count; pages.append(prev);
  modelPageItems(state.page, count).forEach(n => {
    if (n === 'ellipsis') { pages.append(el('span', '', '…')); return; }
    const button = action(String(n), 'page', { page: n }); button.setAttribute('aria-label', `모델 ${n}페이지`);
    if (n === state.page) button.setAttribute('aria-current', 'page'); pages.append(button);
  });
  pages.append(next);
  if (pageFocus) [...pages.querySelectorAll('button')].find(b => b.dataset.page === pageFocus)?.focus({ preventScroll: true });
}
function summaryItem(label, value, detail = '', className = '') {
  const node = el('div', 'tools-summary-item'); node.append(el('span', '', label), el('strong', className, value));
  if (detail) { node.title = detail; node.append(el('small', 'tools-summary-detail', detail)); }
  return node;
}
function persistBuild() {
  const categories = new Set(state.categories.map(c => c.code));
  const raw = JSON.stringify(compactBuild(state.entries, state.byId, categories));
  let saved = false;
  try { localStorage.setItem(STORAGE_KEY, raw); saved = true; } catch {}
  const url = new URL(location.href);
  url.hash = new URLSearchParams({ build: raw }).toString();
  let urlSaved = true;
  try { history.replaceState(null, '', url); } catch { urlSaved = false; }
  const feedback = $('#build-save-status');
  if (feedback) feedback.textContent = saved ? '이 브라우저에 저장되었습니다. 선택을 바꾸면 자동 저장됩니다.'
    : urlSaved ? '브라우저 저장을 사용할 수 없습니다. 현재 주소의 구성 정보는 유지됩니다.'
      : '브라우저 저장과 주소 갱신을 사용할 수 없습니다. 현재 구성을 다시 확인해 주세요.';
  if (feedback && saved && !urlSaved) feedback.textContent += ' 현재 주소 갱신은 실패했습니다.';
  return saved;
}

let pickerReturnCategory = '';
function openModelPicker() {
  const dialog = $('#builder-model-dialog');
  if (!builder || !dialog || !state.ready) return;
  pickerReturnCategory = state.category;
  if (!dialog.open) dialog.showModal();
  $('#picker-title')?.focus({ preventScroll: true });
}

function closeModelPicker() {
  $('#builder-model-dialog')?.close();
}
function renderSummary() {
  if (!builder) return;
  const summary = $('#tools-summary');
  if (!summary) return;
  summary.replaceChildren();
  const totals = buildTotals(state.entries, buildEntryData);
  summary.append(summaryItem('선택', `${state.entries.length}종`, `${state.entries.reduce((n,e) => n + e.quantity, 0)}개`));
  [['active', '판매중 합계'], ['sold', '판매완료 합계']].forEach(([key, label]) => {
    const total = totals[key];
    const title = total.total > 0 && !total.complete ? label.replace('합계', '부분 합계') : label;
    summary.append(summaryItem(title, displayPrice(total.amount), `가격 확인 ${total.covered}/${total.total}개`, `series-${key}`));
  });
  const issues = [...new Set(state.entries.map(entry => priceRecordIssue(chartRecord(entry.id), buildEntryData(entry))).filter(Boolean))];
  if (buildScopeConflict()) issues.unshift('서로 다른 게시 기준의 가격은 합산하지 않습니다.');
  if (issues.length) {
    const note = el('p', 'tools-quote-status', issues.join(' '));
    if (buildScopeConflict() || state.entries.some(e => chartRecord(e.id)?.state === 'error')) note.append(action('가격 다시 조회', 'retry'));
    summary.append(note);
  }
  if (state.entries.length && (!totals.active.complete || !totals.sold.complete)) {
    summary.append(el('p', 'tools-quote-status', '대표가격이 확인된 부품만 합산합니다. 미확인·표본 3건 미만 가격은 제외합니다.'));
  }
}
function refreshBuildPriceDetails() {
  for (const node of $('#build-table').querySelectorAll('[data-build-price]')) {
    const entry = state.entries.find(item => item.id === node.dataset.buildPrice);
    if (!entry) continue;
    const key = node.dataset.series, record = chartRecord(entry.id), data = buildEntryData(entry);
    const currency = record?.data?.methodology?.currency || 'KRW';
    const value = metricValue(data?.[key]), presentation = pricePresentation(data?.[key], key, currency, record);
    node.replaceChildren();
    node.dataset.priceState = buildScopeConflict() ? 'scope-conflict' : presentation.state;
    if (value == null || record?.state !== 'ready' || statsUnavailable(record.data)) {
      node.append(el('strong', '', '—'));
      node.append(el('small', '', buildScopeConflict() ? '게시 기준 불일치' :
        presentation.text === '—' ? '대표가격 없음' : presentation.text + (presentation.state === 'insufficient' ? ' · 합계 제외' : '')));
      node.title = presentation.label;
    } else {
      const relation = Number(value.toFixed(2)) === value ? '=' : '≈';
      node.append(el('strong', '', quotePrice(value * entry.quantity, currency)));
      node.append(el('small', 'tools-line-price', `단가 ${quotePrice(value, currency)} × ${entry.quantity}`));
      node.title = `단가 ${quotePrice(value, currency)} × ${entry.quantity} ${relation} ${quotePrice(value * entry.quantity, currency)} · ${presentation.label} · 표본 ${data[key].sample_count}건 · ${data.window?.from || '—'} ~ ${data.window?.to || '—'}`;
    }
  }
  for (const node of $('#build-table').querySelectorAll('[data-memory-total]')) {
    const entry = state.entries.find(item => item.id === node.dataset.memoryTotal), product = state.byId.get(entry?.id);
    const capacity = Number(product?.key_specs?.module_capacity_gb);
    node.textContent = entry && capacity > 0 ? `${capacity}GB × ${entry.quantity}개 = 총 ${capacity * entry.quantity}GB` : '';
  }
  for (const button of $('#build-table').querySelectorAll('[data-quantity-step]')) {
    const entry = state.entries.find(item => item.id === button.dataset.id);
    button.disabled = !entry || entry.quantity + Number(button.dataset.quantityStep) < 1 || entry.quantity + Number(button.dataset.quantityStep) > 16;
  }
}
function renderBuild() {
  const container = $('#build-table'), focus = document.activeElement;
  if (container.contains(focus) && focus.dataset.quantity) { refreshBuildPriceDetails(); return; }
  const focusKey = container.contains(focus) ? { ...focus.dataset } : null;
  const focusedCategory = focus?.closest?.('tr[data-category]')?.dataset.category;
  const summary = $('#build-summary');
  const { table, body } = makeTable(['부품', '선택 모델', '수량', '판매중 가격', '판매완료 표시가', '변경']);
  table.className = 'sf-build-table'; table.setAttribute('aria-label', 'PC 부품 구성 및 수량 반영 가격');
  const caption = el('caption', 'sf-build-caption', '수량 반영 금액 · KRW · 단가·부품 금액은 소수 둘째 자리, 합계는 원 단위 반올림 · 판매완료 표시가는 실제 체결가가 아닙니다.');
  table.prepend(caption);
  const columns = el('colgroup');
  ['part','model','quantity','active','sold','action'].forEach(name => columns.append(el('col', `build-col-${name}`)));
  table.prepend(columns);
  state.categories.forEach(category => {
    const entry = state.entries.find(e => e.category === category.code), product = state.byId.get(entry?.id);
    const row = el('tr'); row.dataset.category = category.code;
    const part = el('th', 'build-part', category.label); part.scope = 'row';
    const name = el('td', entry ? 'model-name' : 'model-name build-empty'); name.dataset.label = '선택 모델';
    if (entry) {
      name.append(el('span', '', product ? nameOf(product) : '—'));
      if (entry.manufacturer) name.append(el('small', '', `${entry.manufacturer} · 제조사 기준`));
      if (product?.category_code === 'RAM') { const memory = el('small', 'tools-memory-total'); memory.dataset.memoryTotal = entry.id; name.append(memory); }
    } else {
      const choose = action('+ 부품 선택', 'category', { category: category.code });
      choose.setAttribute('aria-label', `${category.label} 부품 선택`); name.append(choose);
    }
    const quantity = el('td', 'build-quantity'); quantity.dataset.label = '수량';
    if (entry) {
      const control = el('div', 'sf-quantity');
      const minus = action('−', 'quantity-step', { id:entry.id, quantityStep:-1 }); minus.setAttribute('aria-label', `${category.label} 수량 줄이기`);
      const plus = action('+', 'quantity-step', { id:entry.id, quantityStep:1 }); plus.setAttribute('aria-label', `${category.label} 수량 늘리기`);
      const input = el('input'); input.type = 'number'; input.min = '1'; input.max = '16'; input.step = '1'; input.value = entry.quantity;
      input.dataset.quantity = entry.id; input.setAttribute('aria-label', `${category.label} 수량`);
      control.append(minus,input,plus); quantity.append(control);
    } else quantity.append(el('span', '', '—'));
    row.append(part, name, quantity);
    for (const {key,label} of SERIES.slice(0,2)) {
      const cell = el('td', `build-price series-${key}`); cell.dataset.label = label; cell.dataset.series = key;
      if (entry) cell.dataset.buildPrice = entry.id; else cell.textContent = '—';
      row.append(cell);
    }
    const control = el('td', 'build-actions');
    if (entry) {
      const change = action('변경', 'category', {category: category.code}); change.setAttribute('aria-label', `${category.label} 모델 변경`);
      const remove = action('×', 'remove', {id:entry.id}); remove.setAttribute('aria-label', `${category.label} 제거`);
      control.append(change,remove);
    }
    row.append(control); body.append(row);
  });
  if (summary) { const foot=el('tfoot'), row=el('tr'), cell=el('td'); cell.colSpan=6; cell.append(summary); row.append(cell); foot.append(row); table.append(foot); }
  container.replaceChildren(table);
  refreshBuildPriceDetails();
  const result = compatibility(state.entries, state.byId), box = $('#build-compatibility'); box.replaceChildren();
  box.hidden = !result.checks.length;
  result.checks.forEach(c => box.append(el('span', c.status, `${c.label} ${c.status === 'match' ? '일치' : c.status === 'conflict' ? '충돌' : '미확인'} · ${c.detail}`)));
  if (result.checks.length) box.append(el('span','compatibility-note',result.note));
  if (focusKey && Object.keys(focusKey).length) {
    const replacement=[...container.querySelectorAll('button')].find(b => Object.entries(focusKey).every(([k,v]) => b.dataset[k] === v))
      || [...container.querySelectorAll('button[data-action="category"]')].find(b => b.dataset.category === focusedCategory);
    replacement?.focus({preventScroll:true});
  }
}
function renderAnalysis() {
  const record = analysisRecord(state.selectedId), base = record?.data;
  const data = scopedStats(sourceStats(base, state.source), state.selectedManufacturer);
  const currency = base?.methodology?.currency || (state.source === 'ebay' ? 'USD' : 'KRW');
  const window = state.range;
  const controls = $('#chart-navigation');
  if (!$('#chart-from')) {
    [['from', '시작일'], ['to', '종료일']].forEach(([key, label]) => {
      const field = el('div', `tools-range-field tools-range-${key}`), caption = el('label', '', label);
      caption.htmlFor = `chart-${key}`; field.append(caption); controls.append(field);
      const input = createDatePicker(field, { id: `chart-${key}`, label });
      input.min = window.earliest; input.max = window.latest; input.value = window[key];
    });
    const apply = action('적용', 'range-apply'); apply.setAttribute('aria-label', '선택 기간 적용'); controls.append(apply);
  }
  controls.title = `${window.from} ~ ${window.to} · ${window.days}일`;
  const sourceControls = $('#chart-sources'), sourceFocus = sourceControls.contains(document.activeElement) ? document.activeElement.dataset.source : null; sourceControls.replaceChildren();
  const sourceOrder = ['ebay', 'joonggonara', 'bunjang'];
  const availableSources = new Set(state.sources.map(source => String(source.source_id || source.id || source.key || '')));
  const sourceIds = [...sourceOrder.filter(id => availableSources.has(id)),
    ...[...availableSources].filter(id => id && !sourceOrder.includes(id)).sort(naturalCompare)];
  [['', '국내 전체'], ...sourceIds.map(id => [id, id === 'ebay' ? 'eBay (USD)' : SOURCE_LABELS[id] || id])].forEach(([id, label]) => {
    const button = action(label, 'chart-source', { source: id }); button.setAttribute('aria-pressed', String(state.source === id)); sourceControls.append(button);
  });
  if (sourceFocus != null) [...sourceControls.children].find(b => b.dataset.source === sourceFocus)?.focus({ preventScroll: true });
  const coverage = $('#chart-coverage'); coverage.replaceChildren(); coverage.hidden = true;
  const chartData = record?.state !== 'ready' || statsUnavailable(base) || statsUnavailable(data) ? null : data;
  const series = SERIES.slice(0, 2).map(s => ({ key: s.key, points: dailySeries(chartData, s.key, state.days) }));
  const product = state.byId.get(state.selectedId), modelName = product ? nameOf(product) : '선택 모델 없음';
  $('#analysis-title').textContent = product ? `가격 분석 · ${modelName}` : '가격 분석';
  $('#analysis-model-select').textContent = `${modelName} ▾`;
  $('#chart-title').textContent = '가격 추이';
  $('#price-chart').setAttribute('aria-busy', String(Boolean(state.selectedId) && (!record || record.state === 'loading')));
  $('#price-chart').dataset.modelId = state.selectedId;
  $('#price-chart').dataset.priceState = !state.selectedId ? 'empty' : record?.state === 'error' ? 'error'
    : !record || record.state === 'loading' ? 'loading' : priceRecordIssue(record, data) ? 'unavailable' : 'ready';
  const issue = !state.selectedId ? '선택 조건에 맞는 모델이 없습니다.' : priceRecordIssue(record, data);
  if (issue) {
    coverage.append(document.createTextNode(issue));
    if (record?.state === 'error') coverage.append(action('다시 시도', 'retry'));
    coverage.hidden = false;
  } else {
    const excluded = Number(base?.integrity_filtered_source_count || base?.integrity_repaired_source_ids?.length || 0);
    if (excluded) { coverage.textContent = `집계값이 불일치하는 출처 ${excluded}곳 제외`; coverage.hidden = false; }
  }
  renderAnalysisContext(record, data, currency);
  drawChart($('#price-chart'), series, { label: `${modelName} 가격 추이`, selectedDate: state.chartDate || window.to, currency });
}

function searchReturnPath(product) {
  const params = new URLSearchParams(location.search || new URL(location.href).search);
  const raw = params.get('return_to');
  if (raw && raw.startsWith('/') && !raw.startsWith('//')) {
    try {
      const url = new URL(raw, location.href);
      const originalSource = url.searchParams.get('sites') || '';
      if (url.origin === new URL(location.href).origin && /^\/(?:categories\/(?:cpu|gpu|ram|motherboard|ssd|hdd|psu))?$/.test(url.pathname)
        && url.searchParams.get('model_id') === idOf(product) && originalSource === state.source) return url.pathname + url.search;
    } catch {}
  }
  const query = new URLSearchParams({category_code: product.category_code, model_id:idOf(product)});
  if (state.source) query.set('sites',state.source);
  return '/?' + query;
}

function renderAnalysisContext(record, data, currency) {
  const product = state.byId.get(state.selectedId), link = $('#analysis-listing-link');
  if (link) {
    const publicModel = product && !['CASE', 'COOLING'].includes(product.category_code);
    link.hidden = !publicModel;
    link.href = publicModel ? searchReturnPath(product) : '/';
  }
  const comparison = $('#analysis-source-comparison');
  if (!comparison) return;
  const type = product?.key_specs?.directory_node_type;
  const unit = !product ? '선택 모델 없음' : type === 'PRODUCT' ? '등록 모델'
    : ['FACET','BROWSE_FACET'].includes(type) ? '제조사·규격 구간 참고' : '카탈로그 비교 단위';
  const rows = record?.state === 'ready' && !statsUnavailable(record.data)
    ? (record.data.by_source || []).filter(row => !state.source || String(row.source_id || row.site || row.source) === state.source) : [];
  const showConfirmed = rows.some(row => Number(row.confirmed_transactions?.sample_count) > 0);
  const keys = showConfirmed ? SERIES : SERIES.slice(0,2);
  const {table,body} = makeTable(['출처','통화','기간',...keys.flatMap(s => [s.label,'표본'])]);
  table.className = 'sf-price-table'; table.setAttribute('aria-label','출처별 가격 비교');
  const caption = el('caption','sf-source-caption',`${product ? nameOf(product) + ' · ' : ''}비교 단위: ${unit}${state.selectedManufacturer ? ' · ' + state.selectedManufacturer : ''}`);
  const scope = record?.data?.methodology;
  if (scope?.market_pool) caption.append(el('span','sf-price-method',' · ' + ({ KR_C2C_USED:'국내 개인 중고',OVERSEAS_USED:'해외 중고',KR_DEALER_USED:'국내 업자 중고',KR_REFURB_RETAIL:'국내 리퍼비시' }[scope.market_pool] || scope.market_pool)));
  caption.append(el('span','sf-price-method',' · 판매완료 표시가는 실제 체결가가 아닙니다.'));
  table.prepend(caption);
  for (const item of rows) {
    const id = String(item.source_id || item.site || item.source || '');
    const scoped = scopedStats(sourceStats(record.data, id), state.selectedManufacturer);
    const row = el('tr'); row.dataset.source = id;
    const sourceName = el('th','source-name',SOURCE_LABELS[id] || id); sourceName.scope = 'row'; row.append(sourceName);
    const rowCurrency = scoped?.methodology?.currency || record.data.methodology?.currency;
    const code = el('td','source-currency',rowCurrency || '—'); code.dataset.label = '통화'; row.append(code);
    const period = scoped?.window || record.data.window;
    const date = el('td','source-period',period?.from && period?.to ? `${period.from} ~ ${period.to}` : '—'); date.dataset.label = '기간'; row.append(date);
    for (const {key,label} of keys) {
      const metric = scoped?.[key], presentation = pricePresentation(metric,key,rowCurrency || currency,record);
      const cell = el('td','source-price series-' + key); cell.dataset.label = label; cell.dataset.series = key;
      const usable = Boolean(scoped) && !statsUnavailable(scoped);
      cell.append(el('strong','',usable ? presentation.text : '—'));
      if (usable && !presentation.empty && presentation.state !== 'insufficient') cell.append(el('small','',presentation.label));
      else if (!usable) cell.append(el('small','','선택 범위 미제공'));
      else if (presentation.state === 'insufficient') cell.append(el('small','','대표가격 없음'));
      cell.title = presentation.label; row.append(cell);
      const count = usable && metric?.aggregate_incomplete !== true && Number.isInteger(metric?.sample_count) && metric.sample_count >= 0
        ? metric.sample_count.toLocaleString('ko-KR') : '—';
      const sample = el('td','source-sample',count); sample.dataset.label = label + ' 표본'; sample.dataset.series = key; row.append(sample);
    }
    body.append(row);
  }
  if (!rows.length) { const row=el('tr'), cell=el('td','tools-empty',state.selectedId ? '출처별 가격 자료 없음' : '선택 조건에 맞는 모델이 없습니다.'); cell.colSpan=3+keys.length*2; row.append(cell); body.append(row); }
  comparison.replaceChildren(table);
}
function render() { renderControls(); renderSummary(); renderModelTable(); if (builder) renderBuild(); else renderAnalysis(); }
function refreshPrices() {
  const targets = state.sort === 'price' ? currentProducts() : builder && $('#builder-model-dialog')?.open ? pageGroups().flatMap(g => g.products) : [];
  const selected = state.byId.get(state.selectedId);
  const contextProduct = selected?.category_code === state.category ? selected : null;
  void affiliate?.update({ hasResults: state.ready && currentProducts().length > 0,
    canonical_product_id: contextProduct ? idOf(contextProduct) : '', category_code: state.category });
  if (selected) targets.push(selected);
  if (builder) targets.push(...state.entries.map(e => state.byId.get(e.id)).filter(Boolean));
  const overseas = !builder && state.source === 'ebay';
  void prices.load(overseas ? [] : targets, builder ? 30 : state.days, builder ? '' : state.range.to);
  if (!builder) void overseasPrices.load(overseas ? targets : [], state.days, state.range.to);
}
function selectCategory(category) {
  state.category = category; state.manufacturer = ''; state.generation = ''; state.capacity = ''; state.query = ''; state.page = 1; state.selectedManufacturer = ''; state.chartDate = '';
  state.source = '';
  if (builder) {
    const entry = state.entries.find(e => e.category === category);
    if (entry) { state.selectedId = entry.id; state.selectedManufacturer = entry.manufacturer; revealModel(entry.id); }
    else state.selectedId = '';
  }
  if (!builder) {
    state.selectedId = idOf(currentProducts()[0]);
    syncAnalysisUrl();
  }
  render();
  if (builder) openModelPicker();
  refreshPrices();
}
document.addEventListener('click', event => {
  const button = event.target.closest('[data-action]'); if (!button || !state.ready) return;
  const { action: type, id, manufacturer = '', key, category } = button.dataset;
  if (type === 'open-picker') { openModelPicker(); refreshPrices(); return; }
  if (type === 'open-analysis-picker') { $('#analysis-model-dialog').showModal(); $('#analysis-picker-title').focus({ preventScroll: true }); refreshPrices(); return; }
  if (type === 'close-analysis-picker') { $('#analysis-model-dialog').close(); return; }
  if (type === 'close-picker') { closeModelPicker(); return; }
  if (type === 'save-build') { persistBuild(); return; }
  if (type === 'print-build') { window.print(); return; }
  if (type === 'quantity-step') {
    const entry = state.entries.find(e => e.id === id), delta = Number(button.dataset.quantityStep);
    if (!entry || ![-1,1].includes(delta) || entry.quantity + delta < 1 || entry.quantity + delta > 16) return;
    entry.quantity += delta;
    const input = [...$('#build-table').querySelectorAll('[data-quantity]')].find(n => n.dataset.quantity === id);
    if (input) input.value = entry.quantity;
    persistBuild(); renderSummary(); refreshBuildPriceDetails(); return;
  }
  if (type === 'category') { selectCategory(category); return; }
  if (type === 'reset-filters') { resetToolFilters(); return; }
  if (type === 'range-apply') {
    try {
      const from = $('#chart-from').value, to = $('#chart-to').value;
      if (!from || !to) throw new Error('시작일과 종료일을 선택하세요.');
      const range = priceDateRange(from, to);
      state.range = range; state.days = range.days; state.chartDate = ''; syncAnalysisUrl();
      status(''); renderSummary(); renderModelTable(); renderAnalysis(); refreshPrices();
    } catch (error) { status(error.message, true); }
    return;
  }
  if (type === 'chart-source') { state.source = button.dataset.source; state.page = 1; syncAnalysisUrl(); renderControls(); renderSummary(); renderModelTable(); renderAnalysis(); refreshPrices(); return; }
  if (type === 'retry') {
    prices.clear(); overseasPrices?.clear(); status(''); refreshPrices();
    renderSummary(); renderModelTable(); if (builder) renderBuild(); else renderAnalysis();
    return;
  }
  if (type === 'page') {
    state.page = Math.max(1, Math.min(Math.ceil(groups().length / PAGE_SIZE) || 1, Number(button.dataset.page)));
    renderModelTable(); $('#model-table').scrollTop = 0; refreshPrices(); return;
  }
  if (type === 'choose') {
    const product = state.byId.get(id); if (!product) return;
    state.entries = validateBuild([...state.entries.filter(e => e.category !== product.category_code), { id, quantity: state.entries.find(e => e.category === product.category_code)?.quantity || 1, manufacturer }], state.byId, new Set(state.categories.map(c => c.code)));
    state.selectedId = id; state.selectedManufacturer = manufacturer;
    persistBuild();
    status('');
  }
  if (type === 'remove') { state.entries = state.entries.filter(e => e.id !== id); persistBuild(); status(''); }
  if (type === 'analyze') {
    state.selectedId = id; state.selectedManufacturer = manufacturer; state.chartDate = '';
    syncAnalysisUrl();
  }
  renderSummary(); renderModelTable(); if (builder) renderBuild(); else renderAnalysis(); refreshPrices();
  if (type === 'choose') closeModelPicker();
  if (type === 'analyze') $('#analysis-model-dialog')?.close();
});
document.addEventListener('change', event => {
  const target = event.target;
  if (target.dataset.quantity) {
    const entry = state.entries.find(e => e.id === target.dataset.quantity); const n = Number(target.value);
    if (!entry) return;
    if (!Number.isInteger(n) || n < 1 || n > 16) { target.value = entry.quantity; status('수량은 1~16개로 입력해 주세요.', true); return; }
    entry.quantity = n; persistBuild(); renderSummary(); refreshBuildPriceDetails(); status(''); return;
  }
  if (target.id === 'tool-category') { selectCategory(target.value); return; }
  if (target.id === 'tool-manufacturer') { state.manufacturer = target.value; state.generation = ''; state.capacity = ''; }
  else if (target.id === 'tool-generation') { state.generation = target.value; state.capacity = ''; }
  else if (target.id === 'tool-capacity') state.capacity = target.value;
  else if (target.id === 'tool-sort') state.sort = target.value;
  else return;
  applyModelFilters();
});
function resetToolFilters() {
  state.manufacturer = ''; state.generation = ''; state.capacity = ''; state.query = ''; state.sort = 'name';
  // selectCategory would reapply the saved component's maker/specification.
  // Preserve the build, selected site and date range; reset only its filters.
  applyModelFilters();
}
function applyModelFilters({ renderFilterControls = true } = {}) {
  state.page = 1;
  if (!builder) {
    state.selectedId = visibleSelection(currentProducts(), state.selectedId);
    state.selectedManufacturer = ''; state.chartDate = '';
    syncAnalysisUrl();
  }
  if (renderFilterControls) renderControls();
  renderSummary(); renderModelTable(); if (!builder) renderAnalysis(); refreshPrices();
}
let queryTimer;
document.addEventListener('input', event => {
  const target = event.target;
  if (target.id === 'tool-query') {
    state.query = target.value; clearTimeout(queryTimer);
    queryTimer = setTimeout(() => applyModelFilters({ renderFilterControls: false }), 180); return;
  }
  if (!target.dataset.quantity) return;
  const entry = state.entries.find(e => e.id === target.dataset.quantity), n = Number(target.value);
  if (!entry || !Number.isInteger(n) || n < 1 || n > 16) return;
  entry.quantity = n;
  persistBuild();
  renderSummary();
  refreshBuildPriceDetails();
});

async function start() {
  try {
    const catalog = await readJson('/api/pc/catalog');
    state.products = catalog.tools_catalog?.products || catalog.public_catalog?.products || catalog.products || [];
    state.categories = (catalog.tools_catalog?.categories || catalog.categories || []).map(c => ({ code: c.code || c.category_code, label: c.label || c.display_name || c.code }));
    state.sources = (catalog.sources || []).filter(source => source.public_enabled !== false);
    state.byId = new Map(state.products.map(p => [idOf(p), p]));
    if (!state.products.length || !state.categories.length) throw new Error('공개 카탈로그가 비어 있습니다.');
    if (!state.categories.some(c => c.code === state.category)) state.category = state.categories[0].code;
    state.ready = true;
    if (builder) {
      try {
        const fragment = new URLSearchParams(location.hash.slice(1));
        const raw = fragment.has('build') ? fragment.get('build') : localStorage.getItem(STORAGE_KEY);
        if (raw) {
          if (raw.length > 20000) throw new Error('조합 주소가 너무 깁니다.');
          state.entries = validateBuild(JSON.parse(raw), state.byId, new Set(state.categories.map(c => c.code)));
        }
        status('');
      } catch (error) { status(`조합을 불러오지 못했습니다. ${error.message}`, true); }
      if (state.entries.length) { state.category = state.entries[0].category; state.selectedId = state.entries[0].id; }
    } else {
      const params = new URLSearchParams(location.search), requested = state.byId.get(params.get('model'));
      if (requested && filterToolProducts([requested]).length) { state.category = requested.category_code; state.selectedId = idOf(requested); state.selectedManufacturer = params.get('manufacturer') || ''; }
      else state.selectedId = idOf(currentProducts()[0]);
      status(params.has('model') && (!requested || !filterToolProducts([requested]).length)
        ? '요청한 모델은 가격 선택 대상이 아닙니다. 검증된 모델을 다시 선택해 주세요.' : '', params.has('model') && (!requested || !filterToolProducts([requested]).length));
      const requestedSource = params.get('source');
      if (state.sources.some(s => String(s.source_id || s.id || s.key) === requestedSource)) state.source = requestedSource;
      if (params.has('from') || params.has('to')) {
        try { state.range = priceDateRange(params.get('from') || '', params.get('to') || ''); state.days = state.range.days; }
        catch (error) { status(error.message, true); }
      }
      syncAnalysisUrl();
    }
    if (state.selectedId) revealModel(state.selectedId);
    render(); refreshPrices();
    adfit.setEligible(true);
  } catch (error) {
    status(`${error.message} `, true);
    const button = el('button', '', '다시 시도'); button.type = 'button'; button.addEventListener('click', start); $('#tools-status').append(button);
  }
}
if (builder) {
  $('#builder-model-dialog')?.addEventListener('close', () => {
    const target = [...document.querySelectorAll('#build-table button[data-action="category"]')]
      .find(button => button.dataset.category === pickerReturnCategory)
      || document.querySelector('[data-action="open-picker"]');
    target?.focus({ preventScroll: true });
  });
}
if (!builder) $('#analysis-model-dialog')?.addEventListener('close', () => $('#analysis-model-select')?.focus({ preventScroll: true }));
for (const dialog of document.querySelectorAll('#builder-model-dialog, #analysis-model-dialog')) {
  // Chromium search inputs consume Escape to clear text. A model picker must
  // still close in one keystroke; IME composition retains its own cancel key.
  dialog.addEventListener('keydown', event => {
    if (event.key !== 'Escape' || event.isComposing) return;
    event.preventDefault(); event.stopPropagation(); dialog.close();
  }, { capture: true });
}
void start();
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && state.ready) refreshPrices();
});
let resizeFrame;
window.addEventListener('resize', () => {
  if (builder || !state.ready) return;
  cancelAnimationFrame(resizeFrame); resizeFrame = requestAnimationFrame(renderAnalysis);
});
