import { SERIES, idOf, nameOf, naturalCompare, money, metricValue, groupProducts, scopedStats, sourceStats, sourceId, priceDateRange, modelPageItems, buildTotals, compatibility, validateBuild, dailySeries, percentChange, overviewIndex } from './pc-tools-core.mjs?v=coverage-v4';
import { readJson, createPriceStore } from './pc-tools-data.mjs?v=coverage-v4';
import { drawChart } from './pc-tools-chart.mjs?v=coverage-v4';
import { createDatePicker } from './pc-tools-calendar.mjs?v=coverage-v4';
import { createAdfitSlot } from './adfit.js?v=adfit-v1';

const builder = document.body.dataset.page === 'builder';
const $ = selector => document.querySelector(selector);
const adfit = createAdfitSlot($('#adfit-banner'));
const STORAGE_KEY = 'used-pick:pc-build:v1';
const PAGE_SIZE = 12;
const state = {
  products: [], byId: new Map(), categories: [], category: builder ? 'CPU' : 'GPU',
  manufacturer: '', generation: '', grouped: true, sort: 'name', page: 1,
  expanded: new Set(), entries: [], selectedId: '', selectedManufacturer: '',
  days: 30, range: priceDateRange(), mode: 'amount', chartDate: '', source: '', overview: false, ready: false,
};
let repaintTimer, statusTimer;
const displayPrice = (value, currency = 'KRW') => value == null ? '—' : money(value, currency);
function pricePresentation(metric, seriesKey = 'active', currency = 'KRW') {
  const value = metricValue(metric), count = Number(metric?.sample_count || 0);
  if (value != null) return {
    text: displayPrice(value, currency),
    label: typeof metric?.mean === 'number' && metric.mean === value ? '평균' : '중앙값',
    empty: false,
  };
  const minimum = Number(metric?.min), maximum = Number(metric?.max);
  if (count > 0 && Number.isFinite(minimum) && minimum > 0 && Number.isFinite(maximum) && maximum >= minimum) {
    const wording = seriesKey === 'sold'
      ? { single: '표시', label: '표시가' }
      : seriesKey === 'confirmed_transactions'
        ? { single: '확인', label: '거래가' }
        : { single: '등록', label: '등록가' };
    if (minimum === maximum) return { text: `${wording.single} ${money(minimum, currency)}`, label: `${wording.label} 1건`, empty: false };
    return {
      text: `${money(minimum, currency)}~${money(maximum, currency)}`,
      label: `${wording.label} 범위`, empty: false,
    };
  }
  return { text: '—', label: '가격 자료 없음', empty: true };
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
function brandOf(p) { const s = specOf(p); return s.chip_manufacturer || s.platform_vendor || p.brand || ''; }
function generationOf(p) { const s = specOf(p); return s.generation || s.memory_generation || s.chipset || s.protocol || ''; }
function chartRecord(id) { return prices.get(id, builder ? 30 : state.days, builder ? '' : state.range.to); }
function payload(id) { return chartRecord(id)?.data; }
function chartPayload(id) { return sourceStats(chartRecord(id)?.data, state.source); }
function analysisRecord(id) {
  return !builder && state.source === 'ebay'
    ? overseasPrices?.get(id, state.days, state.range.to)
    : chartRecord(id);
}
function analysisData(id) { return sourceStats(analysisRecord(id)?.data, state.source); }
function selectionData(entry) { return scopedStats(payload(entry.id), entry.manufacturer); }
function currentProducts() {
  return state.products.filter(p => (!state.category || p.category_code === state.category)
    && (!state.manufacturer || brandOf(p) === state.manufacturer)
    && (!state.generation || generationOf(p) === state.generation));
}
function groups() {
  const rows = groupProducts(currentProducts(), state.grouped);
  if (state.sort === 'price') rows.sort((a, b) => (metricValue(payload(idOf(a.products[0]))?.active) ?? Infinity)
    - (metricValue(payload(idOf(b.products[0]))?.active) ?? Infinity) || naturalCompare(a.label, b.label));
  return rows;
}
function pageGroups() { return groups().slice((state.page - 1) * PAGE_SIZE, state.page * PAGE_SIZE); }
function revealModel(id) {
  const product = state.byId.get(id); if (!product) return;
  state.category = product.category_code; state.manufacturer = brandOf(product); state.generation = generationOf(product);
  const rows = groups(), index = rows.findIndex(g => g.products.some(p => idOf(p) === id));
  state.page = index < 0 ? 1 : Math.floor(index / PAGE_SIZE) + 1;
  if (index >= 0) state.expanded.add(rows[index].key);
}
function selectControl(label, id, options, selected) {
  const wrapper = el('label'), select = el('select'); select.id = id; select.setAttribute('aria-label', label);
  wrapper.append(el('span', 'sr-only', label));
  options.forEach(([value, text]) => { const option = el('option', '', text); option.value = value; option.selected = value === selected; select.append(option); });
  wrapper.append(select); return wrapper;
}
function renderControls() {
  const base = state.products.filter(p => !state.category || p.category_code === state.category);
  const manufacturers = [...new Set(base.map(brandOf).filter(Boolean))].sort(naturalCompare);
  const generations = [...new Set(base.filter(p => !state.manufacturer || brandOf(p) === state.manufacturer).map(generationOf).filter(Boolean))].sort(naturalCompare);
  const controls = el('div', 'tools-controls');
  if (builder) controls.append(selectControl('부품', 'tool-category', state.categories.map(c => [c.code, c.label]), state.category));
  controls.append(selectControl('제조사', 'tool-manufacturer', [['', '전체 제조사'], ...manufacturers.map(v => [v, v])], state.manufacturer));
  controls.append(selectControl('시리즈·규격', 'tool-generation', [['', '전체 규격'], ...generations.map(v => [v, v])], state.generation));
  controls.append(selectControl('정렬', 'tool-sort', [['name', '모델명순'], ['price', '판매중 낮은가격순']], state.sort));
  const check = el('label', 'tools-check');
  const input = el('input'); input.type = 'checkbox'; input.id = 'tool-group'; input.checked = state.grouped;
  check.append(input, document.createTextNode('동일 모델 묶기')); controls.append(check);
  controls.append(action('새로고침', 'retry'));
  $('#model-controls').replaceChildren(controls);
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
  const metric = data?.[key], presentation = pricePresentation(metric, key, currency);
  td.append(document.createTextNode(record?.state === 'loading' ? '확인 중' : record?.state === 'error' ? '조회 실패' : presentation.text));
  td.classList.toggle('is-empty', presentation.empty);
  td.title = `${presentation.label} · 표본 ${Number(metric?.sample_count || 0).toLocaleString('ko-KR')}건${builder ? ' · 최근 30일' : ` · ${state.range.from} ~ ${state.range.to}`}${data?.integrity_filtered_source_count || data?.integrity_repaired_source_ids?.length ? ' · 불일치 사이트 제외' : ''}`;
  if (data?.availability?.status === 'unavailable') td.title = '공개 통계 미제공';
  if (showChange) {
    const change = percentChange(dailySeries(data, key, state.days));
    if (change != null) td.append(el('span', `tools-change ${change > 0 ? 'up' : 'down'}`, `${state.days}일 ${change > 0 ? '▲' : change < 0 ? '▼' : '—'} ${Math.abs(change).toFixed(1)}%`));
  }
  return td;
}
function chosen(id, manufacturer = '') { return state.entries.some(e => e.id === id && e.manufacturer === manufacturer); }
function showConfirmed() {
  return pageGroups().some(g => g.products.some(p => metricValue(payload(idOf(p))?.confirmed_transactions) != null))
    || metricValue(payload(state.selectedId)?.confirmed_transactions) != null;
}
function renderModelTable() {
  const container = $('#model-table');
  // Price completion must not interrupt a focused row action.
  const focus = document.activeElement;
  const focusKey = container.contains(focus) ? { ...focus.dataset } : null;
  const visibleSeries = SERIES.filter(s => s.key !== 'confirmed_transactions' || showConfirmed());
  const { table, body } = makeTable(['모델', ...visibleSeries.map(s => s.label), builder ? '조합' : '보기']);
  for (const group of pageGroups()) {
    const product = group.products[0], id = idOf(product), record = chartRecord(id), data = record?.data;
    const open = state.expanded.has(group.key);
    const row = el('tr', state.selectedId === id ? 'is-selected' : '');
    const name = el('td', 'model-name');
    const toggle = action('', 'expand', { key: group.key, id }, 'model-toggle');
    toggle.append(el('span', '', open ? '⌄' : '›'), document.createTextNode(group.label));
    toggle.setAttribute('aria-expanded', String(open)); name.append(toggle);
    if (group.products.length > 1) name.append(el('small', '', `세부 모델 ${group.products.length}개`));
    else if (['FACET', 'BROWSE_FACET'].includes(specOf(product).directory_node_type)) name.title = '제조사·규격별 그룹';
    row.append(name);
    visibleSeries.forEach(s => row.append(group.products.length > 1 ? el('td', 'price', '세부 모델별') : priceCell(data, s.key, record, { showChange: !builder })));
    const control = el('td');
    const button = group.products.length > 1
      ? action('세부 모델', 'expand', { key: group.key, id })
      : action(builder ? chosen(id) ? '선택됨' : '선택' : state.selectedId === id && !state.selectedManufacturer ? '분석중' : '분석', builder ? 'choose' : 'analyze', { id });
    if (builder && chosen(id)) button.classList.add('primary');
    control.append(button); row.append(control); body.append(row);
    if (open) {
      if (group.products.length > 1) {
        group.products.forEach(p => appendDetailRow(body, p, '', visibleSeries));
      }
      const manufacturers = Array.isArray(data?.by_manufacturer) ? data.by_manufacturer : [];
      if (group.products.length === 1 && manufacturers.length) {
        [...manufacturers].sort((a, b) => naturalCompare(a.manufacturer, b.manufacturer)).forEach(m => appendDetailRow(body, product, m.manufacturer, visibleSeries));
      } else if (group.products.length === 1) {
        const detail = el('tr', 'tools-subrow'), td = el('td'); td.colSpan = visibleSeries.length + 2;
        const specs = Object.entries(specOf(product)).filter(([key, value]) => ['socket', 'exact_model', 'memory_generation', 'form_factor', 'interface', 'protocol', 'rated_wattage', 'gpu_model', 'cpu_model', 'module_capacity_gb', 'module_count'].includes(key) && value != null);
        if (specs.length) td.append(el('small', '', specs.map(([, v]) => `${v}`).join(' · ')));
        if (!['CASE', 'COOLING'].includes(product.category_code)) {
          const link = el('a', '', '원문 매물 보기'); link.href = `/?category_code=${encodeURIComponent(product.category_code)}&model_id=${encodeURIComponent(id)}`; td.append(link);
        }
        if (!td.children.length) td.append(el('span', '', '세부 자료 없음'));
        detail.append(td); body.append(detail);
      }
    }
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
function appendDetailRow(body, p, manufacturer, visibleSeries) {
  const id = idOf(p), record = chartRecord(id), data = scopedStats(record?.data, manufacturer);
  const row = el('tr', `tools-subrow${state.selectedId === id && state.selectedManufacturer === manufacturer ? ' is-selected' : ''}`);
  const name = el('td', 'model-name', manufacturer || nameOf(p));
  if (manufacturer) name.title = '제조사별 평균 · 개별 제품 통계 아님';
  row.append(name); visibleSeries.forEach(s => row.append(priceCell(data, s.key, record)));
  const control = el('td'); control.append(action(builder ? chosen(id, manufacturer) ? '선택됨' : '선택' : '분석', builder ? 'choose' : 'analyze', { id, manufacturer }));
  row.append(control); body.append(row);
}
function summaryItem(label, value, detail = '', className = '') {
  const node = el('div', 'tools-summary-item'); node.append(el('span', '', label), el('strong', className, value)); if (detail) node.title = detail; return node;
}
function renderSummary() {
  const summary = $('#tools-summary'); summary.replaceChildren();
  if (builder) {
    const totals = buildTotals(state.entries, selectionData);
    summary.append(summaryItem('선택', `${state.entries.length}종`, `${state.entries.reduce((n, e) => n + e.quantity, 0)}개`));
    SERIES.filter(s => s.key !== 'confirmed_transactions' || totals[s.key].covered > 0).forEach(s => {
      const total = totals[s.key]; summary.append(summaryItem(`${s.label.replace(' 평균', '').replace(' 표시가', '')} ${total.complete || !total.total ? '합계' : '부분 합계'}`, displayPrice(total.amount), `${total.covered}/${total.total}종 가격 반영 · 최근 30일`, `series-${s.key}`));
    });
  } else if (!state.overview && state.selectedId) {
    const record = analysisRecord(state.selectedId);
    const data = scopedStats(analysisData(state.selectedId), state.selectedManufacturer);
    const currency = record?.data?.methodology?.currency || (state.source === 'ebay' ? 'USD' : 'KRW');
    SERIES.filter(s => s.key !== 'confirmed_transactions' || Number(data?.[s.key]?.sample_count || 0) > 0).forEach(s => {
      const presentation = pricePresentation(data?.[s.key], s.key, currency);
      summary.append(summaryItem(s.label, presentation.text, `${presentation.label} · 표본 ${Number(data?.[s.key]?.sample_count || 0)}건 · ${currency} · ${state.range.from} ~ ${state.range.to}${state.source ? ` · ${SOURCE_LABELS[state.source] || state.source}` : data?.integrity_filtered_source_count || data?.integrity_repaired_source_ids?.length ? ' · 불일치 사이트 제외' : ''}`, `series-${s.key}`));
    });
  } else {
    const scope = currentProducts(), datasets = scope.map(p => payload(idOf(p))).filter(Boolean);
    summary.append(summaryItem('분석 범위', `${scope.length}개 모델`, state.category ? labelOf(state.category) : '전체 부품'));
    SERIES.slice(0, 2).forEach(s => {
      const result = overviewIndex(datasets, s.key, state.days);
      summary.append(summaryItem(s.label, result.points.length ? `${result.points.at(-1).value?.toFixed(1) ?? '—'}` : '자료 없음', `기간 시작=100 · 비교 가능 ${result.covered}개`, `series-${s.key}`));
    });
  }
}
function renderBuild() {
  const container = $('#build-table'), focus = document.activeElement;
  const quantityFocus = container.contains(focus) && focus.dataset.quantity;
  if (quantityFocus) return;
  const { table, body } = makeTable(['부품 / 수량', '선택 모델', '판매중 가격', '판매완료 표시가', '']);
  state.categories.forEach(category => {
    const entry = state.entries.find(e => e.category === category.code), p = state.byId.get(entry?.id), data = entry ? selectionData(entry) : null;
    const row = el('tr', state.category === category.code ? 'is-selected' : ''), part = el('td', '', category.label);
    if (entry) {
      const input = el('input'); input.type = 'number'; input.min = '1'; input.max = '16'; input.value = entry.quantity; input.dataset.quantity = entry.id; input.setAttribute('aria-label', `${category.label} 수량`); part.append(el('br'), input);
    }
    const name = el('td', 'model-name', p ? nameOf(p) : '—');
    if (entry?.manufacturer) name.append(el('small', '', `${entry.manufacturer} · 제조사 기준`));
    row.append(part, name, priceCell(data, 'active', entry ? prices.get(entry.id, 30) : null), priceCell(data, 'sold', entry ? prices.get(entry.id, 30) : null));
    const control = el('td'); control.append(action(entry ? '변경' : '선택', 'category', { category: category.code }));
    if (entry) { const remove = action('×', 'remove', { id: entry.id }); remove.setAttribute('aria-label', `${category.label} 제거`); control.append(remove); }
    row.append(control); body.append(row);
  });
  container.replaceChildren(table);
  const result = compatibility(state.entries, state.byId), box = $('#build-compatibility'); box.replaceChildren();
  box.hidden = !result.checks.length; box.title = result.note;
  result.checks.forEach(c => box.append(el('span', c.status, `${c.label} ${c.status === 'match' ? '일치' : c.status === 'conflict' ? '충돌' : '미확인'} · ${c.detail}`)));
  $('#save-build').disabled = !state.ready; $('#share-build').disabled = !state.entries.length; $('#clear-build').disabled = !state.entries.length;
}
function renderAnalysis() {
  const domesticRecord = chartRecord(state.selectedId);
  const overseasRecord = overseasPrices?.get(state.selectedId, state.days, state.range.to);
  const record = analysisRecord(state.selectedId), base = record?.data;
  const data = scopedStats(sourceStats(base, state.source), state.selectedManufacturer);
  const currency = base?.methodology?.currency || (state.source === 'ebay' ? 'USD' : 'KRW');
  const scope = currentProducts();
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
  const sources = new Set([state.source, domesticRecord?.data, overseasRecord?.data]
    .flatMap(value => typeof value === 'string' ? [value] : (value?.by_source || []).map(sourceId)).filter(Boolean));
  const sourceControls = $('#chart-sources'), sourceFocus = sourceControls.contains(document.activeElement) ? document.activeElement.dataset.source : null; sourceControls.replaceChildren();
  sourceControls.hidden = state.overview || (!sources.size && !state.source);
  [['', sources.has('ebay') ? '국내 전체' : '전체 사이트'], ...[...sources].sort(naturalCompare).map(id => [id, id === 'ebay' ? 'eBay (USD)' : SOURCE_LABELS[id] || id])].forEach(([id, label]) => {
    const button = action(label, 'chart-source', { source: id }); button.setAttribute('aria-pressed', String(state.source === id)); sourceControls.append(button);
  });
  if (sourceFocus != null) [...sourceControls.children].find(b => b.dataset.source === sourceFocus)?.focus({ preventScroll: true });
  const coverage = $('#chart-coverage'); coverage.textContent = ''; coverage.hidden = true;
  let series, index = state.overview || state.mode === 'index';
  if (state.overview) {
    const datasets = scope.map(p => chartPayload(idOf(p))).filter(Boolean);
    series = SERIES.slice(0, 2).map(s => ({ key: s.key, ...overviewIndex(datasets, s.key, state.days) }));
    $('#chart-title').textContent = `${state.category ? labelOf(state.category) : '전체 부품'} · 모델별 변동 지수`;
    const loading = scope.filter(p => chartRecord(idOf(p))?.state === 'loading' || !chartRecord(idOf(p))).length;
    const errors = scope.filter(p => chartRecord(idOf(p))?.state === 'error').length;
    $('#price-chart').setAttribute('aria-busy', String(loading > 0));
    if (errors) { coverage.textContent = `가격 조회 실패 ${errors}건 · 새로고침`; coverage.hidden = false; }
  } else {
    series = SERIES.slice(0, 2).map(s => {
      const points = dailySeries(data, s.key, state.days);
      const start = points[0]?.value;
      return { key: s.key, points: index ? points.map(p => ({ ...p, value: start != null && p.value != null ? p.value / start * 100 : null })) : points };
    });
    $('#chart-title').textContent = `${nameOf(state.byId.get(state.selectedId))}${state.selectedManufacturer ? ` · ${state.selectedManufacturer}` : ''}`;
    $('#price-chart').setAttribute('aria-busy', String(record?.state === 'loading'));
    if (record?.state === 'error') { coverage.textContent = '가격 조회 실패 · 새로고침'; coverage.hidden = false; }
  }
  $('#chart-mode').value = index ? 'index' : 'amount'; $('#chart-mode').disabled = state.overview;
  $('#chart-mode').title = index ? '기간 시작=100 · 같은 모델의 가격 변화' : '일별 평균 표시가격';
  $('#overview-button').setAttribute('aria-pressed', String(state.overview));
  drawChart($('#price-chart'), series, { index, label: $('#chart-title').textContent, selectedDate: state.chartDate || window.to, currency });
}
function render() { renderControls(); renderSummary(); renderModelTable(); if (builder) renderBuild(); else renderAnalysis(); }
function refreshPrices() {
  const targets = state.overview || state.sort === 'price' ? currentProducts() : pageGroups().flatMap(g => g.products);
  const selected = state.byId.get(state.selectedId);
  if (selected) targets.push(selected);
  if (builder) targets.push(...state.entries.map(e => state.byId.get(e.id)).filter(Boolean));
  void prices.load(targets, builder ? 30 : state.days, builder ? '' : state.range.to);
  if (!builder && selected) void overseasPrices.load([selected], state.days, state.range.to);
}
function selectCategory(category) {
  state.category = category; state.manufacturer = ''; state.generation = ''; state.page = 1; state.expanded.clear(); state.selectedManufacturer = ''; state.chartDate = '';
  state.source = '';
  if (builder) {
    const entry = state.entries.find(e => e.category === category);
    if (entry) { state.selectedId = entry.id; state.selectedManufacturer = entry.manufacturer; revealModel(entry.id); }
  }
  if (!builder) {
    state.overview = !category;
    state.selectedId = idOf(currentProducts()[0]);
  }
  render(); refreshPrices();
  if (builder) $('#model-controls').scrollIntoView({ block: 'nearest', behavior: 'smooth' });
}
document.addEventListener('click', event => {
  const button = event.target.closest('[data-action]'); if (!button || !state.ready) return;
  const { action: type, id, manufacturer = '', key, category } = button.dataset;
  if (type === 'category') { selectCategory(category); return; }
  if (type === 'range-apply') {
    try {
      const from = $('#chart-from').value, to = $('#chart-to').value;
      if (!from || !to) throw new Error('시작일과 종료일을 선택하세요.');
      const range = priceDateRange(from, to);
      state.range = range; state.days = range.days; state.chartDate = '';
      status(''); renderSummary(); renderModelTable(); renderAnalysis(); refreshPrices();
    } catch (error) { status(error.message, true); }
    return;
  }
  if (type === 'chart-source') { state.source = button.dataset.source; renderSummary(); renderAnalysis(); return; }
  if (type === 'retry') { prices.clear(); overseasPrices?.clear(); status('새로고침'); refreshPrices(); return; }
  if (type === 'page') {
    state.page = Math.max(1, Math.min(Math.ceil(groups().length / PAGE_SIZE) || 1, Number(button.dataset.page)));
    renderModelTable(); $('#model-table').scrollTop = 0; refreshPrices(); return;
  }
  if (type === 'expand') { state.expanded.has(key) ? state.expanded.delete(key) : state.expanded.add(key); renderModelTable(); return; }
  if (type === 'choose') {
    const product = state.byId.get(id); if (!product) return;
    state.entries = validateBuild([...state.entries.filter(e => e.category !== product.category_code), { id, quantity: state.entries.find(e => e.category === product.category_code)?.quantity || 1, manufacturer }], state.byId, new Set(state.categories.map(c => c.code)));
    state.selectedId = id; state.selectedManufacturer = manufacturer;
    $('#share-output').hidden = true;
    status('');
  }
  if (type === 'remove') { state.entries = state.entries.filter(e => e.id !== id); status(''); $('#share-output').hidden = true; }
  if (type === 'analyze') {
    state.selectedId = id; state.selectedManufacturer = manufacturer; state.overview = false; state.chartDate = ''; state.source = '';
    const url = new URL(location.href); url.searchParams.set('model', id); if (manufacturer) url.searchParams.set('manufacturer', manufacturer); else url.searchParams.delete('manufacturer');
    history.replaceState(null, '', url);
  }
  renderSummary(); renderModelTable(); if (builder) renderBuild(); else renderAnalysis(); refreshPrices();
});
document.addEventListener('change', event => {
  const target = event.target;
  if (target.dataset.quantity) {
    const entry = state.entries.find(e => e.id === target.dataset.quantity); const n = Number(target.value);
    if (!Number.isInteger(n) || n < 1 || n > 16) { target.value = entry.quantity; status('수량은 1~16개로 입력해 주세요.', true); return; }
    entry.quantity = n; $('#share-output').hidden = true; renderSummary(); status(''); return;
  }
  if (target.id === 'tool-category') { selectCategory(target.value); return; }
  if (target.id === 'tool-manufacturer') { state.manufacturer = target.value; state.generation = ''; }
  else if (target.id === 'tool-generation') state.generation = target.value;
  else if (target.id === 'tool-sort') state.sort = target.value;
  else if (target.id === 'tool-group') state.grouped = target.checked;
  else if (target.id === 'chart-mode') { state.mode = target.value; renderAnalysis(); return; }
  else return;
  state.page = 1; state.expanded.clear(); renderControls(); renderModelTable(); if (!builder && state.overview) { renderSummary(); renderAnalysis(); } refreshPrices();
});
document.addEventListener('input', event => {
  const target = event.target;
  if (!target.dataset.quantity) return;
  const entry = state.entries.find(e => e.id === target.dataset.quantity), n = Number(target.value);
  if (!entry || !Number.isInteger(n) || n < 1 || n > 16) return;
  entry.quantity = n;
  $('#share-output').hidden = true;
  renderSummary();
});
if (builder) {
  $('#save-build').addEventListener('click', () => {
    if (!state.ready) return;
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state.entries)); status('저장됨'); }
    catch { status('브라우저 저장소를 사용할 수 없습니다. 공유 주소로 보관해 주세요.', true); }
  });
  $('#share-build').addEventListener('click', async () => {
    if (!state.ready || !state.entries.length) return;
    const url = new URL('/computer-builder.html', location.origin); url.hash = `build=${encodeURIComponent(JSON.stringify(state.entries))}`;
    $('#share-url').value = url.href; $('#share-output').hidden = false;
    try { await navigator.clipboard.writeText(url.href); status('공유 주소 복사됨'); }
    catch { $('#share-url').focus(); $('#share-url').select(); status('공유 주소를 복사하세요.'); }
  });
  $('#clear-build').addEventListener('click', () => { state.entries = []; $('#share-output').hidden = true; renderSummary(); renderBuild(); renderModelTable(); status('비움 · 저장하면 기존 조합도 지워집니다.'); });
} else {
  $('#overview-button').addEventListener('click', () => { state.overview = true; state.source = ''; state.chartDate = ''; renderSummary(); renderAnalysis(); refreshPrices(); });
}

async function start() {
  try {
    const catalog = await readJson('/api/pc/catalog');
    state.products = catalog.tools_catalog?.products || catalog.public_catalog?.products || catalog.products || [];
    state.categories = (catalog.tools_catalog?.categories || catalog.categories || []).map(c => ({ code: c.code || c.category_code, label: c.label || c.display_name || c.code }));
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
      if (requested) { state.category = requested.category_code; state.selectedId = idOf(requested); state.selectedManufacturer = params.get('manufacturer') || ''; }
      else state.selectedId = idOf(currentProducts()[0]);
      status('');
    }
    if (state.selectedId) revealModel(state.selectedId);
    render(); refreshPrices();
    if (!builder) adfit.setEligible(true);
  } catch (error) {
    status(`${error.message} `, true);
    const button = el('button', '', '다시 시도'); button.type = 'button'; button.addEventListener('click', start); $('#tools-status').append(button);
  }
}
void start();
let resizeFrame;
window.addEventListener('resize', () => {
  if (builder || !state.ready) return;
  cancelAnimationFrame(resizeFrame); resizeFrame = requestAnimationFrame(renderAnalysis);
});
