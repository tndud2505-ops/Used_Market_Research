import { SERIES, idOf, nameOf, naturalCompare, money, metricValue, groupProducts, scopedStats, sourceStats, sourceId, shiftDate, historyWindow, buildTotals, compatibility, validateBuild, dailySeries, percentChange, overviewIndex } from './pc-tools-core.mjs?v=7';
import { readJson, createPriceStore } from './pc-tools-data.mjs?v=7';
import { drawChart } from './pc-tools-chart.mjs?v=7';

const builder = document.body.dataset.page === 'builder';
const $ = selector => document.querySelector(selector);
const STORAGE_KEY = 'used-pick:pc-build:v1';
const PAGE_SIZE = 12;
const state = {
  products: [], byId: new Map(), categories: [], category: builder ? 'CPU' : 'GPU',
  manufacturer: '', generation: '', grouped: true, sort: 'name', page: 1,
  expanded: new Set(), entries: [], selectedId: '', selectedManufacturer: '',
  days: 30, mode: 'amount', chartDate: '', anchor: '', source: '', overview: false, ready: false,
};
let repaintTimer;
const prices = createPriceStore(() => {
  clearTimeout(repaintTimer);
  repaintTimer = setTimeout(() => { renderSummary(); renderModelTable(); if (builder) renderBuild(); else renderAnalysis(); }, 50);
});
const historyPrices = createPriceStore(() => { if (state.ready && !builder) renderAnalysis(); });
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
function status(text = '', error = false) { $('#tools-status').textContent = text; $('#tools-status').dataset.error = String(error); }
function labelOf(code) { return state.categories.find(c => c.code === code)?.label || code; }
function specOf(p) { return p.key_specs || {}; }
function brandOf(p) { const s = specOf(p); return s.chip_manufacturer || s.platform_vendor || p.brand || ''; }
function generationOf(p) { const s = specOf(p); return s.generation || s.memory_generation || s.chipset || s.protocol || ''; }
function payload(id, days = builder ? 30 : state.days) { return prices.get(id, days)?.data; }
function chartRecord(id) { return state.anchor ? historyPrices.get(id, 30, state.anchor) : prices.get(id, 30); }
function chartPayload(id) { return sourceStats(chartRecord(id)?.data, state.source); }
function selectionData(entry) { return scopedStats(payload(entry.id, 30), entry.manufacturer); }
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
  const wrapper = el('label', '', label), select = el('select'); select.id = id; select.setAttribute('aria-label', label);
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
  controls.append(action('가격 새로고침', 'retry'));
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
  const metric = data?.[key], value = metricValue(metric);
  td.append(document.createTextNode(record?.state === 'loading' ? '불러오는 중' : record?.state === 'error' ? '조회 실패' : money(value)));
  if (value == null && metric?.sample_count > 0) td.append(el('small', '', `표본 ${metric.sample_count}건 · 평균 미제공`));
  else if (metric?.sample_count > 0) td.append(el('small', '', `표본 ${Number(metric.sample_count).toLocaleString('ko-KR')}건`));
  if (data?.availability?.status === 'unavailable') td.append(el('small', '', '공개 통계 미제공'));
  if (data?.integrity_filtered_source_count) td.append(el('small', '', '불일치 사이트 제외'));
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
  const { table, body } = makeTable(['기준 모델 / 세부 제품', ...visibleSeries.map(s => s.label), builder ? '조합' : '보기']);
  for (const group of pageGroups()) {
    const product = group.products[0], id = idOf(product), record = prices.get(id, builder ? 30 : state.days), data = record?.data;
    const open = state.expanded.has(group.key);
    const row = el('tr', state.selectedId === id ? 'is-selected' : '');
    const name = el('td', 'model-name');
    const toggle = action('', 'expand', { key: group.key, id }, 'model-toggle');
    toggle.append(el('span', '', open ? '⌄' : '›'), document.createTextNode(group.label));
    toggle.setAttribute('aria-expanded', String(open)); name.append(toggle);
    if (group.products.length > 1) name.append(el('small', '', `세부 모델 ${group.products.length}개`));
    else if (specOf(product).directory_node_type === 'FACET') name.append(el('small', '', '규격 그룹 · 세부 모델 확인 필요'));
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
        td.append(el('span', '', nameOf(product)));
        const specs = Object.entries(specOf(product)).filter(([key, value]) => ['socket', 'exact_model', 'memory_generation', 'form_factor', 'interface', 'protocol', 'rated_wattage', 'gpu_model', 'cpu_model', 'module_capacity_gb', 'module_count'].includes(key) && value != null);
        if (specs.length) td.append(el('small', '', specs.map(([, v]) => `${v}`).join(' · ')));
        td.append(el('small', '', record?.state === 'loading' ? '제조사별 자료 확인 중' : '추가 세부 모델 통계가 아직 없습니다.'));
        if (!['CASE', 'COOLING'].includes(product.category_code)) {
          const link = el('a', '', '원문 매물 보기'); link.href = `/?category_code=${encodeURIComponent(product.category_code)}&model_id=${encodeURIComponent(id)}`; td.append(link);
        }
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
  const total = groups().length, count = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const pages = $('#model-pages'); pages.replaceChildren(el('span', '', `${total.toLocaleString('ko-KR')}개 모델 그룹 · ${state.page} / ${count}`));
  const actions = el('div'), prev = action('이전', 'page', { page: state.page - 1 }), next = action('다음', 'page', { page: state.page + 1 });
  prev.disabled = state.page <= 1; next.disabled = state.page >= count; actions.append(prev, next); pages.append(actions);
}
function appendDetailRow(body, p, manufacturer, visibleSeries) {
  const id = idOf(p), record = prices.get(id, builder ? 30 : state.days), data = scopedStats(record?.data, manufacturer);
  const row = el('tr', `tools-subrow${state.selectedId === id && state.selectedManufacturer === manufacturer ? ' is-selected' : ''}`);
  const name = el('td', 'model-name', manufacturer || nameOf(p));
  if (manufacturer) name.append(el('small', '', '제조사 집계 · 제품명 세분류 미제공'));
  row.append(name); visibleSeries.forEach(s => row.append(priceCell(data, s.key, record)));
  const control = el('td'); control.append(action(builder ? chosen(id, manufacturer) ? '선택됨' : '선택' : '분석', builder ? 'choose' : 'analyze', { id, manufacturer }));
  row.append(control); body.append(row);
}
function summaryItem(label, value, detail = '', className = '') {
  const node = el('div', 'tools-summary-item'); node.append(el('span', '', label), el('strong', className, value)); if (detail) node.append(el('small', '', detail)); return node;
}
function renderSummary() {
  const summary = $('#tools-summary'); summary.replaceChildren();
  if (builder) {
    const totals = buildTotals(state.entries, selectionData);
    summary.append(summaryItem('선택 부품', `${state.entries.length}종`, `${state.entries.reduce((n, e) => n + e.quantity, 0)}개`));
    SERIES.filter(s => s.key !== 'confirmed_transactions' || totals[s.key].covered > 0).forEach(s => {
      const total = totals[s.key]; summary.append(summaryItem(`${s.label} ${total.complete ? '합계' : '부분 합계'}`, money(total.amount), `${total.covered}/${total.total}종 가격 반영 · 30일 표본`, `series-${s.key}`));
    });
  } else if (!state.overview && state.selectedId) {
    const data = scopedStats(sourceStats(payload(state.selectedId), state.source), state.selectedManufacturer);
    SERIES.filter(s => s.key !== 'confirmed_transactions' || metricValue(data?.[s.key]) != null).forEach(s => {
      summary.append(summaryItem(s.label, money(metricValue(data?.[s.key])), `표본 ${Number(data?.[s.key]?.sample_count || 0)}건 · 최근 30일${state.source ? ` · ${SOURCE_LABELS[state.source] || state.source}` : data?.integrity_filtered_source_count ? ' · 불일치 사이트 제외' : ''}`, `series-${s.key}`));
    });
    const a = metricValue(data?.active), b = metricValue(data?.sold);
    summary.append(summaryItem('판매중 − 판매완료', a != null && b != null ? money(a - b) : '자료 없음', state.selectedManufacturer || nameOf(state.byId.get(state.selectedId))));
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
  const { table, body } = makeTable(['부품 / 수량', '선택 모델', '판매중 평균', '판매완료 표시가', '변경']);
  state.categories.forEach(category => {
    const entry = state.entries.find(e => e.category === category.code), p = state.byId.get(entry?.id), data = entry ? selectionData(entry) : null;
    const row = el('tr', state.category === category.code ? 'is-selected' : ''), part = el('td', '', category.label);
    if (entry) {
      const input = el('input'); input.type = 'number'; input.min = '1'; input.max = '16'; input.value = entry.quantity; input.dataset.quantity = entry.id; input.setAttribute('aria-label', `${category.label} 수량`); part.append(el('br'), input);
    }
    const name = el('td', 'model-name', p ? nameOf(p) : '모델을 선택하세요');
    if (entry?.manufacturer) name.append(el('small', '', `${entry.manufacturer} · 제조사 기준`));
    row.append(part, name, priceCell(data, 'active', entry ? prices.get(entry.id, 30) : null), priceCell(data, 'sold', entry ? prices.get(entry.id, 30) : null));
    const control = el('td'); control.append(action(entry ? '모델 변경' : '모델 선택', 'category', { category: category.code }));
    if (entry) control.append(action('제거', 'remove', { id: entry.id }));
    row.append(control); body.append(row);
  });
  container.replaceChildren(table);
  const result = compatibility(state.entries, state.byId), box = $('#build-compatibility'); box.replaceChildren();
  box.append(el('strong', '', result.conflict ? '호환성 충돌 확인' : result.checks.length ? '확인 가능한 호환성' : '부품을 선택하면 호환성을 확인합니다'));
  result.checks.forEach(c => box.append(el('p', c.status, `${c.status === 'match' ? '✓' : c.status === 'conflict' ? '!' : '—'} ${c.label} · ${c.detail}`)));
  box.append(el('p', 'tools-caption', result.note));
  $('#save-build').disabled = !state.ready; $('#share-build').disabled = !state.entries.length; $('#clear-build').disabled = !state.entries.length;
}
function renderAnalysis() {
  const record = chartRecord(state.selectedId), base = record?.data;
  const data = scopedStats(sourceStats(base, state.source), state.selectedManufacturer);
  const scope = currentProducts();
  const window = historyWindow(state.anchor);
  const controls = $('#chart-navigation'); controls.replaceChildren();
  [['−1개월', -1, 'month', '한 달 이전'], ['−1일', -1, 'day', '하루 이전'], ['+1일', 1, 'day', '하루 다음'], ['+1개월', 1, 'month', '한 달 다음']].forEach(([label, amount, unit, aria]) => {
    const button = action(label, 'chart-shift', { amount, unit }); button.setAttribute('aria-label', `${aria} 가격 보기`);
    button.disabled = amount < 0 ? !window.previous : !window.next; controls.append(button);
  });
  const latest = action('최신', 'chart-latest'); latest.disabled = !state.anchor; controls.append(latest, el('span', '', `${window.from} ~ ${window.to}`));
  const sources = new Set([state.source, ...[base, payload(state.selectedId)].flatMap(d => (d?.by_source || []).map(sourceId))].filter(Boolean));
  const sourceControls = $('#chart-sources'); sourceControls.replaceChildren();
  sourceControls.hidden = state.overview || (!sources.size && !state.source);
  [['', '전체 사이트'], ...[...sources].sort(naturalCompare).map(id => [id, SOURCE_LABELS[id] || id])].forEach(([id, label]) => {
    const button = action(label, 'chart-source', { source: id }); button.setAttribute('aria-pressed', String(state.source === id)); sourceControls.append(button);
  });
  let series, index = state.overview || state.mode === 'index';
  if (state.overview) {
    const datasets = scope.map(p => chartPayload(idOf(p))).filter(Boolean);
    series = SERIES.slice(0, 2).map(s => ({ key: s.key, ...overviewIndex(datasets, s.key, state.days) }));
    $('#chart-title').textContent = `${state.category ? labelOf(state.category) : '전체 부품'} · 모델별 변동 지수`;
    const loading = scope.filter(p => chartRecord(idOf(p))?.state === 'loading' || !chartRecord(idOf(p))).length;
    const errors = scope.filter(p => chartRecord(idOf(p))?.state === 'error').length;
    $('#chart-coverage').textContent = `동일 모델 · 동일 기간 비교 / 판매중 ${series[0].covered}개 · 판매완료 ${series[1].covered}개${loading ? ` · 확인 중 ${loading}개` : ''}${errors ? ` · 조회 실패 ${errors}개` : ''}. 시작·종료 자료가 있는 모델만 같은 비중으로 비교합니다.`;
  } else {
    series = SERIES.slice(0, 2).map(s => {
      const points = dailySeries(data, s.key, state.days);
      const start = points[0]?.value;
      return { key: s.key, points: index ? points.map(p => ({ ...p, value: start != null && p.value != null ? p.value / start * 100 : null })) : points };
    });
    $('#chart-title').textContent = `${nameOf(state.byId.get(state.selectedId))}${state.selectedManufacturer ? ` · ${state.selectedManufacturer}` : ''}${state.source ? ` · ${SOURCE_LABELS[state.source] || state.source}` : ''}`;
    $('#chart-coverage').textContent = record?.state === 'loading' ? '가격 기록을 불러오는 중입니다.'
      : record?.state === 'error' ? `${record.error} 가격 새로고침으로 다시 시도하세요.`
      : state.selectedManufacturer && !data?.daily?.length ? '제조사별 기간 평균만 제공됩니다. 일별 기록은 기본 모델을 선택하면 볼 수 있습니다.'
      : state.source && !data ? '선택한 사이트의 가격 기록이 없습니다.'
      : `${base?.as_of ? `자료 기준 ${String(base.as_of).slice(0, 10)} · ` : ''}${state.days}일${index ? ' · 기간 시작=100, 시작일 자료가 없으면 비교하지 않습니다.' : ' · 날짜를 선택하면 해당일 가격을 확인할 수 있습니다.'}`;
  }
  $('#chart-mode').value = index ? 'index' : 'amount'; $('#chart-mode').disabled = state.overview;
  $('#overview-button').setAttribute('aria-pressed', String(state.overview));
  drawChart($('#price-chart'), series, { index, label: $('#chart-title').textContent, selectedDate: state.chartDate, onSelect: date => { state.chartDate = date; renderAnalysis(); } });
}
function render() { renderControls(); renderSummary(); renderModelTable(); if (builder) renderBuild(); else renderAnalysis(); }
function refreshPrices() {
  const targets = state.overview || state.sort === 'price' ? currentProducts() : pageGroups().flatMap(g => g.products);
  const selected = state.byId.get(state.selectedId);
  if (selected) targets.push(selected);
  if (builder) targets.push(...state.entries.map(e => state.byId.get(e.id)).filter(Boolean));
  void prices.load(targets, builder ? 30 : state.days);
  if (!builder) {
    if (state.anchor) void historyPrices.load(state.overview ? targets : selected ? [selected] : [], 30, state.anchor);
    else historyPrices.clear();
  }
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
  if (builder) $('#picker-title').scrollIntoView({ block: 'nearest', behavior: 'smooth' });
}
document.addEventListener('click', event => {
  const button = event.target.closest('[data-action]'); if (!button || !state.ready) return;
  const { action: type, id, manufacturer = '', key, category } = button.dataset;
  if (type === 'category') { selectCategory(category); return; }
  if (type === 'chart-shift' || type === 'chart-latest') {
    const window = historyWindow(state.anchor);
    const date = type === 'chart-latest' ? window.latest : historyWindow(shiftDate(window.to, Number(button.dataset.amount), button.dataset.unit)).to;
    state.anchor = date === window.latest ? '' : date; state.chartDate = ''; renderAnalysis(); refreshPrices(); return;
  }
  if (type === 'chart-source') { state.source = button.dataset.source; renderSummary(); renderAnalysis(); return; }
  if (type === 'retry') { prices.clear(); historyPrices.clear(); status('가격을 다시 확인합니다.'); refreshPrices(); return; }
  if (type === 'page') { state.page = Number(button.dataset.page); renderModelTable(); refreshPrices(); return; }
  if (type === 'expand') { state.expanded.has(key) ? state.expanded.delete(key) : state.expanded.add(key); renderModelTable(); return; }
  if (type === 'choose') {
    const product = state.byId.get(id); if (!product) return;
    state.entries = validateBuild([...state.entries.filter(e => e.category !== product.category_code), { id, quantity: state.entries.find(e => e.category === product.category_code)?.quantity || 1, manufacturer }], state.byId, new Set(state.categories.map(c => c.code)));
    state.selectedId = id; state.selectedManufacturer = manufacturer;
    $('#share-output').hidden = true;
    status(`${nameOf(product)}${manufacturer ? ` · ${manufacturer}` : ''} 선택됨. 저장 버튼으로 보관할 수 있습니다.`);
  }
  if (type === 'remove') { state.entries = state.entries.filter(e => e.id !== id); status('부품을 조합에서 제외했습니다.'); $('#share-output').hidden = true; }
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
    entry.quantity = n; $('#share-output').hidden = true; renderSummary(); status('수량을 변경했습니다.'); return;
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
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state.entries)); status('이 브라우저에 조합을 저장했습니다.'); }
    catch { status('브라우저 저장소를 사용할 수 없습니다. 공유 주소로 보관해 주세요.', true); }
  });
  $('#share-build').addEventListener('click', async () => {
    if (!state.ready || !state.entries.length) return;
    const url = new URL('/computer-builder.html', location.origin); url.hash = `build=${encodeURIComponent(JSON.stringify(state.entries))}`;
    $('#share-url').value = url.href; $('#share-output').hidden = false;
    try { await navigator.clipboard.writeText(url.href); status('조합 주소를 복사했습니다.'); }
    catch { $('#share-url').focus(); $('#share-url').select(); status('공유 주소를 선택했습니다. 복사해서 보관해 주세요.'); }
  });
  $('#clear-build').addEventListener('click', () => { state.entries = []; $('#share-output').hidden = true; renderSummary(); renderBuild(); renderModelTable(); status('화면의 조합을 비웠습니다. 저장된 조합은 저장 버튼을 누르기 전까지 유지됩니다.'); });
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
        status(state.entries.length ? '저장된 조합을 불러왔습니다.' : '부품별 모델 선택으로 조합을 시작하세요.');
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
  } catch (error) {
    status(`${error.message} `, true);
    const button = el('button', '', '다시 시도'); button.type = 'button'; button.addEventListener('click', start); $('#tools-status').append(button);
  }
}
void start();
