import { SERIES, idOf, nameOf, naturalCompare, money, metricValue, soldMeanValue, metricPresentation, listedPriceRange, statsUnavailable, priceRecordIssue, analysisSelectionUrl, groupProducts, scopedStats, sourceStats, priceDateRange, shiftDate, modelPageItems, buildTotals, compactBuild, compatibility, validateBuild, dailySeries, percentChange, buildAnalysisSeries } from './pc-tools-core.mjs?v=shared-price-v2';
import { readJson, createPriceStore } from './pc-tools-data.mjs?v=picker-fast-v3';
import { drawMarketChart as drawChart } from './pc-market-chart.mjs?v=chart-corners-v8';
import { createAdfitSlots } from './adfit.js?v=adfit-all-v3';
import { toolBrand, toolFilterSchema, toolFacetValues, toolFacetLabel, filterToolProducts, visibleSelection, toolScopeNote } from './pc-tools-catalog.mjs?v=parts-ux-v4';

const builder = document.body.dataset.page === 'builder';
const $ = selector => document.querySelector(selector);
const adfit = createAdfitSlots(document.querySelectorAll('.adfit-banner'));
const STORAGE_KEY = 'used-pick:pc-build:v1';
const PAGE_SIZE = 12;
const state = {
  products: [], byId: new Map(), categories: [], sources: [], category: builder ? 'CPU' : 'GPU',
  manufacturer: '', generation: '', capacity: '', query: '', sort: 'name', page: 1,
  entries: [], selectedId: '', selectedManufacturer: '',
  days: builder ? 30 : 60, range: priceDateRange(builder ? '' : shiftDate(new Date().toISOString().slice(0,10),-59)), chartDate: '', source: '', ready: false,
  historyPending: false,
  priceKind: 'active',
  priceKindExplicit: false,
  priceSources: new Set(['joonggonara','bunjang','danawa','ebay']),
};
let repaintTimer, statusTimer, pickerRepaintTimer;
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
const scheduleRepaint = id => {
  if(!builder&&id&&id!==state.selectedId){
    if($('#analysis-model-dialog')?.open&&pageGroups().some(group=>group.products.some(product=>idOf(product)===id))){clearTimeout(pickerRepaintTimer);pickerRepaintTimer=setTimeout(renderModelTable,80);}
    return;
  }
  clearTimeout(repaintTimer);
  repaintTimer = setTimeout(() => { renderSummary(); if(builder||$('#analysis-model-dialog')?.open)renderModelTable(); if (builder) renderBuild(); else renderAnalysis(); }, 50);
};
const prices = createPriceStore(scheduleRepaint, { dailyOnly: !builder });
const overseasPrices = builder ? null : createPriceStore(scheduleRepaint, {
  marketPool: 'OVERSEAS_USED', condition: 'USED_WORKING', currency: 'USD', dailyOnly: true
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
function requestedPriceAsOf() { return builder || state.range.to === state.range.latest ? '' : state.range.to; }
function chartRecord(id) { return builder ? prices.get(id, 30) : prices.getAvailable(id, state.days, requestedPriceAsOf()); }
function payload(id) {
  const record = chartRecord(id);
  return record?.state === 'ready' && !statsUnavailable(record.data) ? record.data : null;
}
function analysisRecord(id) {
  return !builder && state.source === 'ebay'
    ? overseasPrices?.getAvailable(id, state.days, requestedPriceAsOf())
    : chartRecord(id);
}
function analysisData(id) {
  const record = analysisRecord(id);
  return record?.state === 'ready' && !statsUnavailable(record.data) ? sourceStats(record.data, state.source) : null;
}
let analysisUrlTimer;
function syncAnalysisUrl(range = state.range, deferred = false) {
  if (builder) return;
  clearTimeout(analysisUrlTimer);
  if(deferred){analysisUrlTimer=setTimeout(()=>syncAnalysisUrl(range),180);return;}
  const url = new URL(analysisSelectionUrl(location.href, state.selectedId, state.selectedManufacturer));
  if (state.source) url.searchParams.set('source', state.source); else url.searchParams.delete('source');
  url.searchParams.set('from', range.from); url.searchParams.set('to', range.to);
  if(url.href!==location.href)history.replaceState(null, '', url.href);
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
  const sortPrice = product => {
    const data=sortData(idOf(product));
    return (builder ? metricValue(data?.active) : dailySeries(data,'active',state.days).filter(point=>point.value!=null).at(-1)?.value) ?? Infinity;
  };
  if (state.sort === 'price') rows.sort((a, b) => sortPrice(a.products[0])-sortPrice(b.products[0]) || naturalCompare(a.label,b.label));
  return rows;
}
function pageGroups() { return groups().slice((state.page - 1) * PAGE_SIZE, state.page * PAGE_SIZE); }
function revealModel(id) {
  const product = state.byId.get(id); if (!product) return;
  if(!builder)return;
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
  if(builder)controls.append(selectControl('정렬', 'tool-sort', [['name', '모델명순'], ['price','판매중 낮은가격순 (전체)']], state.sort));
  controls.append(action('조건 초기화', 'reset-filters', {}, 'tools-reset'));
  $('#model-controls').replaceChildren(controls,...(builder||state.category?[el('p','tools-scope-note',toolScopeNote(state.category))]:[]));
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
  // One retry action above the picker is enough; do not fill every price cell
  // with duplicate buttons when the publication is temporarily unavailable.
  if (record?.state === 'error' && !builder) td.append(action(`${presentation.text} · 재시도`, 'retry'));
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
function renderDanawaPrice(node, data, record, id, manufacturer = '') {
  node.replaceChildren(); node.dataset.label = '다나와 중고 표시가';
  const metric = sourceStats(data, 'danawa')?.active;
  const range = record?.state === 'ready' && !statsUnavailable(record.data) && !statsUnavailable(data)
    ? listedPriceRange(metric) : null;
  if (!range) {
    const pending = !record || record.state !== 'ready' || statsUnavailable(record.data) || statsUnavailable(data);
    const presentation = pricePresentation(null, 'active', 'KRW', statsUnavailable(data) ? { ...record, data } : record);
    node.textContent = pending ? presentation.text : Number(metric?.sample_count) > 0 ? '표시가 확인 필요'
      : manufacturer ? '제조사별 자료 없음' : '자료 없음';
    node.dataset.priceState = pending ? presentation.state : Number(metric?.sample_count) > 0 ? 'invalid' : 'missing';
    node.title = pending ? presentation.label : '선택 모델의 다나와 중고 표시가';
    return;
  }
  const text = range.minimum === range.maximum ? money(range.minimum) : `${money(range.minimum)}~${money(range.maximum)}`;
  const link = el('a', 'danawa-price-link', text);
  const url = new URL(analysisSelectionUrl(new URL('/price-analysis.html', location.href).href, id, manufacturer));
  url.searchParams.set('source', 'danawa');
  link.href = url.pathname + url.search;
  link.setAttribute('aria-label', `다나와 중고 표시가 ${text} · 가격 분석 보기`);
  node.append(link, el('small', 'danawa-price-detail', `가격 표본 ${range.count}건 · 개당`));
  node.dataset.priceState = 'listed';
  node.title = `최근 30일 다나와 중고 등록가 · ${range.count}건 · 국내 통합 시세 합계와 별도 비교`;
}
function chosen(id, manufacturer = '') { return state.entries.some(e => e.id === id && e.manufacturer === manufacturer); }
const pickerSummaries=new WeakMap();
function pickerPrice(id) {
  const store=state.source==='ebay'?overseasPrices:prices;
  const record=store.get(id,60)||((id===state.selectedId)?analysisRecord(id):null);
  if(!record||record.state==='loading')return {state:'loading',text:'기록 확인 중'};
  if(record.state==='error')return {state:'unknown',text:'조회 실패',coverage:'기록 확인 불가'};
  if(statsUnavailable(record.data))return {state:'unknown',text:'공개 통계 없음',coverage:'표본 부족 여부 미확인'};
  const cacheKey=`${state.source}:${state.priceKindExplicit?state.priceKind:'auto'}`;
  const memo=pickerSummaries.get(record.data);
  if(memo?.key===cacheKey)return memo.value;
  const remember=value=>{pickerSummaries.set(record.data,{key:cacheKey,value});return value;};
  const data=sourceStats(record.data,state.source),days=data?.methodology?.days||60;
  if(!data)return {state:'unknown',text:'선택 사이트 통계 없음',coverage:'표본·기록 미확인'};
  // Match the source lines the selected chart can actually display. An overall
  // aggregate alone must not promise a chart when no source history exists.
  const scopes=state.source?[{id:state.source,data}]:
    (data.by_source||[]).filter(row=>row.source_id!=='ebay').map(row=>({id:row.source_id,data:{...data,...row,by_source:undefined}}));
  const lines=scopes.flatMap(scope=>buildAnalysisSeries(scope.data,{source:scope.id,allowedSourceIds:[scope.id],days,includeSparse:false}));
  const key=state.priceKindExplicit?state.priceKind:lines.some(line=>line.metricKey==='active')?'active':lines.some(line=>line.metricKey==='sold')?'sold':'active';
  const points=lines.filter(line=>line.metricKey===key).flatMap(line=>line.points.map(point=>({...point,sourceId:line.id.split(':')[0]})))
    .filter(point=>point.value!=null).sort((a,b)=>b.date.localeCompare(a.date));
  const combined=dailySeries(data,key,days,{listedMinimum:state.source==='danawa'&&key==='active'}).filter(point=>point.value!=null).at(-1);
  const point=combined?{...combined,sourceId:state.source||'overall'}:points[0],currency=record.data?.methodology?.currency||'KRW';
  const formatDate=date=>date.replaceAll('-','.');
  // Daily snapshots are not added together: the same listing can appear on
  // several dates. Show both lifecycle counts from one latest observed date.
  const observed=(data.daily||[]).filter(day=>['active','sold'].some(kind=>Number(day[kind]?.sample_count)>0)).sort((a,b)=>a.date.localeCompare(b.date));
  const recent=observed.at(-1);
  const countLabel=kind=>Number.isInteger(recent?.[kind]?.sample_count)?`${recent[kind].sample_count.toLocaleString('ko-KR')}건`:'미확인';
  const metadata=recent?{
    coverage:`판매중 ${countLabel('active')} · 판매완료 ${countLabel('sold')}`,
    period:`${formatDate(observed[0].date)} ~ ${formatDate(recent.date)}`,
    sample:`${formatDate(recent.date)} 기준`,
  }:{};
  if(points.length&&point)return remember({state:'ready',text:money(point.value,currency),
    ...metadata,date:point.date,priceTitle:`${point.priceLabel} · ${formatDate(point.date)}`});
  const observations=observed.filter(day=>Number(day[key]?.sample_count)>0);
  const latest=observations.at(-1),count=latest?.[key]?.sample_count;
  if(recent)return remember({state:'sparse',text:'—',...metadata,priceTitle:count<3?'대표가격 표본 부족':'가격선 없음'});
  return remember({state:'empty',text:'—',coverage:`최근 ${days}일 기록 없음`});
}
function loadPickerPrices() {
  if(builder||!$('#analysis-model-dialog')?.open)return;
  const store=state.source==='ebay'?overseasPrices:prices;
  void store.load(pageGroups().flatMap(group=>group.products),60,'',{background:true,backgroundKey:'picker'});
}
function renderModelTable() {
  const container = $('#model-table');
  const priceStatus = $('#model-price-status');
  if (priceStatus) {
    const hadFocus = priceStatus.contains(document.activeElement);
    const failed = pageGroups().filter(group => chartRecord(idOf(group.products[0]))?.state === 'error');
    priceStatus.replaceChildren();
    priceStatus.hidden = !failed.length;
    if (failed.length) {
      priceStatus.append(el('span', '', `${failed.length}개 모델의 가격 통계를 확인하지 못했습니다. 가격 없이도 부품을 선택할 수 있습니다.`));
      const retry = action('가격 다시 조회', 'retry');
      priceStatus.append(retry);
      if (hadFocus) retry.focus({ preventScroll: true });
    } else if (builder) {
      const delayed = [...new Set(pageGroups().map(group => chartRecord(idOf(group.products[0])))
        .filter(record => record?.state === 'ready' && record.data?.availability?.stale === true)
        .map(record => priceRecordIssue(record)).filter(Boolean))];
      if (delayed.length) { priceStatus.hidden = false; priceStatus.append(el('span', '', delayed.join(' · '))); }
    }
  }
  // Price completion must not interrupt a focused row action.
  const focus = document.activeElement;
  const focusKey = container.contains(focus) ? { ...focus.dataset } : null;
  const visibleSeries = builder ? SERIES.filter(s => s.key !== 'confirmed_transactions') : [];
  const { table, body } = makeTable(['모델', ...visibleSeries.map(s => s.label), ...(builder ? ['다나와 중고 표시가'] : ['가격','가격 기록 · 최근 표본']), builder ? '조합' : '']);
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
    if (builder) {
      const cell = el('td', 'price danawa-price'); renderDanawaPrice(cell, data, record, id); row.append(cell);
    }
    const priceInfo=builder?null:pickerPrice(id);
    // Model navigation is independent of statistics availability. A sparse or
    // unpublished price must never make a real model inaccessible.
    if(!builder){link.href=analysisSelectionUrl(new URL('/price-analysis.html',location.href).href,id);link.dataset.action='analyze';link.dataset.id=id;}
    if(!builder){const cell=el('td','analysis-model-price',priceInfo.text);if(priceInfo.priceTitle)cell.title=priceInfo.priceTitle;cell.dataset.priceState=priceInfo.state;row.append(cell);}
    if(!builder){const cell=el('td','analysis-model-coverage');cell.append(el('span','',priceInfo.coverage||'기록 확인 중'));if(priceInfo.sample)cell.append(el('small','analysis-sample-date',priceInfo.sample));if(priceInfo.period){const period=el('small','analysis-record-period',priceInfo.period);period.title='가격 기록 기간';cell.append(period);}cell.dataset.priceState=priceInfo.state;row.append(cell);}
    const control = el('td');
    const currentAnalysisModel = !builder && state.selectedId === id;
    const button = action(builder ? chosen(id) ? '선택됨' : '선택' : currentAnalysisModel ? '현재 모델' : '보기', builder ? 'choose' : 'analyze', { id });
    if(!builder&&!currentAnalysisModel&&priceInfo.state==='ready')button.textContent='차트 보기';
    if (builder && chosen(id)) button.classList.add('primary');
    if (currentAnalysisModel) { button.disabled = true; button.setAttribute('aria-current', 'true'); }
    control.append(button);
    if(!builder&&['empty','sparse'].includes(priceInfo.state)&&!currentAnalysisModel){
      const listings=el('a','model-name-link','매물 보기');listings.href=searchReturnPath(product);control.append(listings);
    }else if(!builder&&priceInfo.state==='unknown'&&!currentAnalysisModel){control.append(action('재조회','picker-retry'));}
    row.append(control); body.append(row);
  }
  if (!body.children.length) { const tr = el('tr'), td = el('td', 'tools-empty', '해당 조건의 모델이 없습니다.'); td.colSpan = builder?visibleSeries.length+3:4; tr.append(td); body.append(tr); }
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
  if (feedback) feedback.textContent = saved ? ''
    : urlSaved ? '브라우저 저장을 사용할 수 없습니다. 현재 주소의 구성 정보는 유지됩니다.'
      : '브라우저 저장과 주소 갱신을 사용할 수 없습니다. 현재 구성을 다시 확인해 주세요.';
  if (feedback && saved && !urlSaved) feedback.textContent = '구성은 저장됐지만 현재 주소 갱신에 실패했습니다.';
  if (feedback) feedback.hidden = !feedback.textContent;
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
  const row = el('tr', 'build-total-row'); row.id = 'build-summary';
  const partial = state.entries.length > 0 && (!totals.active.complete || !totals.sold.complete);
  const heading = el('th', 'build-total-heading', partial ? '부분 합계' : '합계'); heading.scope = 'row';
  const selection = el('td', 'build-total-selection');
  const quantity = el('td', 'build-total-quantity');
  row.append(heading, selection, quantity);
  [['active', '판매중 합계'], ['sold', '판매완료 합계']].forEach(([key, label]) => {
    const total = totals[key];
    const title = total.total > 0 && !total.complete ? label.replace('합계', '부분 합계') : label;
    const item = summaryItem(title, displayPrice(total.amount), '', `series-${key}`);
    item.title = title;
    item.children[0].className = 'sr-only';
    if (total.total > 0 && !total.complete) item.append(el('small', 'build-total-partial', `${total.covered}/${total.total}개 가격만 반영`));
    const cell = el('td', 'build-total-price'); cell.dataset.label = label;
    cell.append(item); row.append(cell);
  });
  row.append(el('td', 'build-total-spacer'), el('td', 'build-total-spacer'));
  summary.append(row);
  const issues = [...new Set(state.entries.map(entry => priceRecordIssue(chartRecord(entry.id), buildEntryData(entry))).filter(Boolean))];
  if (buildScopeConflict()) issues.unshift('서로 다른 게시 기준의 가격은 합산하지 않습니다.');
  if (issues.length) {
    const note = el('p', 'tools-quote-status', issues.join(' '));
    if (buildScopeConflict() || state.entries.some(e => chartRecord(e.id)?.state === 'error')) note.append(action('가격 다시 조회', 'retry'));
    const issueRow = el('tr', 'build-total-issues'), cell = el('td'); cell.colSpan = 7;
    cell.append(note); issueRow.append(cell); summary.append(issueRow);
  }
}
function refreshBuildPriceDetails() {
  for (const node of $('#build-table').querySelectorAll('[data-danawa-price]')) {
    const entry = state.entries.find(item => item.id === node.dataset.danawaPrice);
    if (!entry) continue;
    if (buildScopeConflict()) { node.textContent = '기준 확인 필요'; node.dataset.priceState = 'scope-conflict'; continue; }
    renderDanawaPrice(node, buildEntryData(entry), chartRecord(entry.id), entry.id, entry.manufacturer);
  }
  for (const node of $('#build-table').querySelectorAll('[data-build-price]')) {
    const entry = state.entries.find(item => item.id === node.dataset.buildPrice);
    if (!entry) continue;
    const key = node.dataset.series, record = chartRecord(entry.id), data = buildEntryData(entry);
    const currency = record?.data?.methodology?.currency || 'KRW';
    const value = key === 'sold' ? soldMeanValue(data?.sold) : metricValue(data?.[key]);
    const presentation = pricePresentation(data?.[key], key, currency, record);
    node.replaceChildren();
    node.dataset.priceState = buildScopeConflict() ? 'scope-conflict' : presentation.state;
    if (value == null || record?.state !== 'ready' || statsUnavailable(record.data)) {
      const missing = buildScopeConflict() ? '기준 확인 필요' : presentation.state === 'insufficient' ? '표본 부족'
        : presentation.state === 'missing' ? '자료 없음' : presentation.empty ? presentation.text : '자료 없음';
      node.append(el('span', 'build-price-unavailable', missing));
      node.title = buildScopeConflict() ? '게시 기준 불일치' : presentation.label;
    } else {
      const relation = Number(value.toFixed(2)) === value ? '=' : '≈';
      node.append(el('strong', '', money(value * entry.quantity, currency)));
      if (key === 'sold') node.dataset.priceState = 'ready';
      node.title = `단가 ${quotePrice(value, currency)} × ${entry.quantity} ${relation} ${quotePrice(value * entry.quantity, currency)} · ${key === 'sold' ? '판매완료 표시가 평균' : presentation.label} · 표본 ${data[key].sample_count}건 · ${data.window?.from || '—'} ~ ${data.window?.to || '—'}`;
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
  const result = compatibility(state.entries, state.byId);
  const warnings = result.checks.filter(check => check.kind === 'socket' || check.status !== 'match');
  const { table, body } = makeTable(['부품', '선택 모델', '수량', '판매중', '판매완료 표시가', '다나와 중고 표시가', '']);
  table.className = 'sf-build-table'; table.setAttribute('aria-label', 'PC 부품 구성 및 수량 반영 가격');
  const columns = el('colgroup');
  ['part','model','quantity','active','sold','danawa','action'].forEach(name => columns.append(el('col', `build-col-${name}`)));
  table.prepend(columns);
  state.categories.forEach(category => {
    const entry = state.entries.find(e => e.category === category.code), product = state.byId.get(entry?.id);
    const row = el('tr'); row.dataset.category = category.code;
    const part = el('th', 'build-part', category.label); part.scope = 'row';
    const name = el('td', entry ? 'model-name' : 'model-name build-empty'); name.dataset.label = '선택 모델';
    if (entry) {
      name.append(el('span', '', product ? nameOf(product) : '—'));
      if (entry.manufacturer) name.append(el('small', '', `${entry.manufacturer} · 제조사 기준`));
    } else {
      const choose = action('+ 부품 선택', 'category', { category: category.code });
      choose.setAttribute('aria-label', `${category.label} 부품 선택`); name.append(choose);
    }
    const quantity = el('td', 'build-quantity'); quantity.dataset.label = '수량';
    if (entry) {
      const input = el('input'); input.type = 'number'; input.min = '1'; input.max = '16'; input.step = '1'; input.value = entry.quantity;
      input.dataset.quantity = entry.id; input.setAttribute('aria-label', `${category.label} 수량`);
      quantity.append(input);
    } else quantity.append(el('span', '', '—'));
    row.append(part, name, quantity);
    for (const {key,label} of SERIES.slice(0,2)) {
      const cell = el('td', `build-price series-${key}`); cell.dataset.label = key === 'sold' ? '판매완료 표시가' : label; cell.dataset.series = key;
      if (entry) cell.dataset.buildPrice = entry.id; else cell.textContent = '—';
      row.append(cell);
    }
    const danawa = el('td', 'build-danawa-price danawa-price'); danawa.dataset.label = '다나와 중고 표시가';
    if (entry) danawa.dataset.danawaPrice = entry.id; else danawa.textContent = '—';
    row.append(danawa);
    const control = el('td', 'build-actions');
    if (entry) {
      const check = warnings.find(check => check.category === category.code);
      const rowActions = el('div', 'build-row-actions');
      if (check) {
        if (check.status !== 'match') row.classList.add('has-compatibility-warning');
        const warning = action(check.status === 'conflict' ? '호환 안 됨' : check.status === 'match' ? 'CPU 지원 확인' : '규격 확인', 'compatibility-help', { kind: check.kind, status: check.status });
        warning.className = 'build-warning-trigger'; warning.setAttribute('aria-label', `${category.label} ${warning.textContent} · 도움말`);
        warning.setAttribute('aria-haspopup', 'dialog'); warning.setAttribute('aria-controls', 'compatibility-dialog');
        rowActions.append(warning);
      }
      const remove = action('×', 'remove', {id:entry.id}); remove.setAttribute('aria-label', `${category.label} 제거`);
      rowActions.append(remove); control.append(rowActions);
    }
    row.append(control); body.append(row);
  });
  const footer = el('tfoot'); footer.id = 'tools-summary'; footer.setAttribute('aria-live', 'polite');
  table.append(footer);
  container.replaceChildren(table);
  renderSummary();
  refreshBuildPriceDetails();
  if (focusKey && Object.keys(focusKey).length) {
    const replacement=[...container.querySelectorAll('button')].find(b => Object.entries(focusKey).every(([k,v]) => b.dataset[k] === v))
      || [...container.querySelectorAll('button[data-action="category"]')].find(b => b.dataset.category === focusedCategory);
    replacement?.focus({preventScroll:true});
  }
}
function openCompatibilityHelp(kind) {
  const check = compatibility(state.entries, state.byId).checks.find(check => check.kind === kind && check.explanation);
  if (!check) return;
  $('#compatibility-title').textContent = check.title;
  $('#compatibility-explanation').textContent = check.explanation;
  $('#compatibility-recommendation').textContent = check.recommendation;
  const controls = $('#compatibility-actions'); controls.replaceChildren();
  for (const category of check.changeCategories) {
    const label = state.categories.find(item => item.code === category)?.label || category;
    controls.append(action(`${label} 변경`, 'compatibility-change', { category }));
  }
  const dialog = $('#compatibility-dialog'); dialog.dataset.kind = kind; if (!dialog.open) dialog.showModal();
  $('#compatibility-title').focus();
}
function resetChartView() {
  $('#price-chart')?.dispatchEvent(new CustomEvent('chart-reset'));
}
function resetHistoryWindow() {
  state.days=60;state.range=priceDateRange(shiftDate(state.range.latest,-59),state.range.latest);state.historyPending=false;
}
function loadEarlierPrices({retry=false} = {}) {
  const product=state.byId.get(state.selectedId),store=state.source==='ebay'?overseasPrices:prices;
  if (!product || state.historyPending || (!retry&&store.get(state.selectedId,state.days,requestedPriceAsOf())?.state==='error')) return;
  const maxDays=priceDateRange(state.range.earliest,state.range.to).days;
  if(!retry&&state.days>=maxDays)return;
  const identity=`${state.selectedId}:${state.source}:${state.range.to}`;
  if(!retry)state.days=Math.min(maxDays,state.days+60);
  state.range=priceDateRange(shiftDate(state.range.to,1-state.days),state.range.to);
  state.historyPending=true;
  const task=store.load([product],state.days,requestedPriceAsOf(),{background:true});
  scheduleRepaint();
  void task.finally(()=>{
    if(identity!==`${state.selectedId}:${state.source}:${state.range.to}`)return;
    state.historyPending=false;syncAnalysisUrl();scheduleRepaint();
  });
}
function analysisSources({ latest = false } = {}) {
  const allowedSources = new Set(state.sources.map(source => String(source.source_id || source.id || source.key || '')));
  const ids = latest ? ['joonggonara','bunjang','danawa','ebay'] : state.source ? [state.source] : [...allowedSources].filter(id => id !== 'ebay');
  return ids.filter(id => allowedSources.has(id) && (latest || state.priceSources.has(id))).map(id => {
    const store = id === 'ebay' ? overseasPrices : prices;
    const record = latest ? store?.getAvailable(state.selectedId,60,'') : id === 'ebay' ? overseasPrices?.getAvailable(state.selectedId, state.days, requestedPriceAsOf()) : chartRecord(state.selectedId);
    const data = record?.state === 'ready' && !statsUnavailable(record.data)
      ? sourceStats(scopedStats(record.data, state.selectedManufacturer), id) : null;
    return { id, record, data, currency: id === 'ebay' ? 'USD' : 'KRW' };
  });
}
function renderLatestPrices(series,record,sources = null) {
  const container=$('#analysis-prices');if(!container)return;
  container.replaceChildren();
  const list=el('ul','market-snapshot-list');
  const order=['joonggonara','bunjang','danawa','ebay'];
  const rank=line=>{const index=order.indexOf(line.id.split(':')[0]);return index<0?order.length:index;};
  for(const line of [...series].sort((a,b)=>rank(a)-rank(b))){
    const point=line.points.filter(point=>point.value!=null||point.lower!=null).at(-1);if(!point)continue;
    const sourceId=line.id.split(':')[0],item=el('li','market-snapshot-item');item.dataset.source=sourceId;
    const price=point.value!=null?money(point.value,line.currency):`${money(point.lower,line.currency)}~${money(point.upper,line.currency)}`;
    const basis=line.priceBasis==='listed-minimum'?'최저 표시가 참고':point.priceLabel?.startsWith('등록가')?'등록가 참고 · 대표가격 아님':point.priceLabel||'대표가격';
    const count=Number.isInteger(point.sampleCount)?`${point.sampleCount.toLocaleString('ko-KR')}건`:'표본 미확인';
    const marker=el('i','market-snapshot-marker');marker.setAttribute('aria-hidden','true');
    item.append(marker,el('strong','market-snapshot-source',line.label.split(' · ')[0]),el('span','market-snapshot-basis',basis),
      el('b','market-snapshot-amount',price),el('span','market-snapshot-meta',`· ${count} · ${point.date.slice(5).replace('-', '.')}`));
    list.append(item);
  }
  if(sources){
    for(const source of sources){
      if([...list.children].some(item=>item.dataset.source===source.id))continue;
      const item=el('li','market-snapshot-item');item.dataset.source=source.id;
      const pending=!source.record||source.record.state==='loading';
      const failed=source.record?.state==='error'||statsUnavailable(source.record?.data);
      item.append(el('i','market-snapshot-marker'),el('strong','market-snapshot-source',SOURCE_LABELS[source.id]||source.id),
        el('b','market-snapshot-amount',pending?'확인 중':failed?'조회 실패':'자료 없음'));
      if(failed)item.append(action('다시 조회','retry',{},'market-snapshot-retry'));
      list.append(item);
    }
    const items=[...list.children].sort((a,b)=>order.indexOf(a.dataset.source)-order.indexOf(b.dataset.source));
    list.replaceChildren(...items);
    for(const item of items){
      const checkbox=el('input','market-source-check');checkbox.type='checkbox';checkbox.dataset.priceSource=item.dataset.source;
      checkbox.checked=state.priceSources?.has(item.dataset.source)??true;
      checkbox.setAttribute('aria-label',`${SOURCE_LABELS[item.dataset.source]||item.dataset.source} 가격선 표시`);
      item.dataset.visible=String(checkbox.checked);item.prepend(checkbox);
      if(item.dataset.source==='ebay')item.append(action('USD 차트 ↗','source-chart',{source:'ebay'},'market-source-link'));
    }
    container.append(list);
    if(!items.length)container.append(el('p','market-price-empty','+에서 사이트를 선택하세요.'));
    return;
  }
  if(list.children.length){container.append(list);return;}
  const message=!record||record.state==='loading'?'가격 기록을 확인하고 있습니다.':record.state==='error'||statsUnavailable(record.data)?'가격 기록을 불러오지 못했습니다.':'이 기간에 표시할 대표가격이 없습니다.';
  const empty=el('div','market-price-empty');empty.append(el('p','',message),action('다른 모델 찾기','open-analysis-picker'));
  if(record?.state==='error'||statsUnavailable(record?.data))empty.append(action('다시 조회','retry'));
  const product=state.byId.get(state.selectedId);if(product){const link=el('a','','이 모델 매물 보기');link.href=searchReturnPath(product);empty.append(link);}
  if(record?.state==='ready'&&!statsUnavailable(record.data)&&state.days<priceDateRange(state.range.earliest,state.range.to).days)empty.append(action('이전 기록 확인','history-more'));
  container.append(empty);
}
function renderAnalysis() {
  const record = analysisRecord(state.selectedId), base = record?.data;
  const data = sourceStats(scopedStats(base, state.selectedManufacturer), state.source);
  const currency = base?.methodology?.currency || (state.source === 'ebay' ? 'USD' : 'KRW');
  const window = state.range;
  const sourceControls = $('#chart-sources'); sourceControls.replaceChildren();
  const sourceOrder = ['joonggonara', 'bunjang', 'danawa', 'ebay'];
  const availableSources = new Set(state.sources.map(source => String(source.source_id || source.id || source.key || '')));
  const sourceIds = [...sourceOrder.filter(id => availableSources.has(id)),
    ...[...availableSources].filter(id => id && !sourceOrder.includes(id)).sort(naturalCompare)];
  [['', '국내 비교'], ...sourceIds.map(id => [id, id === 'ebay' ? 'eBay (USD)' : SOURCE_LABELS[id] || id])].forEach(([id, label]) => {
    const option = el('option', '', label); option.value = id; option.selected = state.source === id; sourceControls.append(option);
  });
  const coverage = $('#chart-coverage'); coverage.replaceChildren(); coverage.hidden = true;
  const sources = analysisSources();
  const availableSeries = sources.flatMap(item => buildAnalysisSeries(statsUnavailable(item.data) ? null : item.data, {
    source: item.id, allowedSourceIds: [item.id], days: item.data?.methodology?.days || state.days, sourceLabels: SOURCE_LABELS,includeSparse:false,
  }).map(line => ({ ...line,
    label: `${SOURCE_LABELS[item.id] || item.id} · ${line.priceBasis === 'listed-minimum' ? '중고 최저 표시가' : line.metricKey === 'sold' ? '판매완료 표시가' : '판매중'}`, currency: item.currency })));
  // Sparse asks remain useful reference evidence, but never become representative chart lines.
  const referenceSeries = sources.flatMap(item => buildAnalysisSeries(statsUnavailable(item.data) ? null : item.data, {
    source: item.id, allowedSourceIds: [item.id], days: item.data?.methodology?.days || state.days, sourceLabels: SOURCE_LABELS, includeSparse:true,
  }).map(line => ({ ...line, currency:item.currency })));
  if(!state.priceKindExplicit)state.priceKind=referenceSeries.some(line=>line.metricKey==='active')?'active':availableSeries.some(line=>line.metricKey==='sold')?'sold':'active';
  const series=availableSeries.filter(line=>line.metricKey===state.priceKind);
  const chartSeries=series;
  const dates = [...new Set(chartSeries.flatMap(item => item.points.map(point => point.date)))].sort();
  const latestSources=analysisSources({latest:true});
  const latestSeries=latestSources.flatMap(item=>buildAnalysisSeries(statsUnavailable(item.data)?null:item.data,{
    source:item.id,allowedSourceIds:[item.id],days:item.data?.methodology?.days||60,sourceLabels:SOURCE_LABELS,includeSparse:true,
  }).map(line=>({...line,currency:item.currency})));
  renderLatestPrices(latestSeries.filter(line=>line.metricKey===state.priceKind),record,latestSources);
  $('#chart-price-kind').value=state.priceKind;
  const totalDates = dates.length;
  const workspace = $('#analysis-workspace');
  if (workspace) workspace.dataset.chartPointCount = String(totalDates);
  const product = state.byId.get(state.selectedId), modelName = product ? nameOf(product) : '선택 모델 없음';
  $('#analysis-title').textContent = '가격 분석';
  $('#analysis-model-select').textContent = `${modelName} ▾`;
  const pending = sources.some(item => !item.record || item.record.state === 'loading');
  const failedSource = sources.find(item => item.record?.state === 'error');
  const sparsePrices = sources.some(item => item.data?.daily?.some(day => metricPresentation(day.active).state === 'insufficient'));
  $('#price-chart').setAttribute('aria-busy', String(Boolean(state.selectedId) && pending));
  $('#price-chart').dataset.modelId = state.selectedId;
  $('#price-chart').dataset.priceState = !state.selectedId ? 'empty' : pending ? 'loading'
    : chartSeries.length ? 'ready' : failedSource ? 'error' : sparsePrices ? 'insufficient' : 'unavailable';
  $('#price-chart').hidden=false;
  const issue = !state.selectedId ? '선택 조건에 맞는 모델이 없습니다.'
    : failedSource ? `${SOURCE_LABELS[failedSource.id] || failedSource.id} · ${priceRecordIssue(failedSource.record, failedSource.data)}`
    : priceRecordIssue(record, data);
  if (issue) {
    coverage.append(document.createTextNode(issue));
    if (failedSource) coverage.append(action('다시 시도', 'retry'));
    coverage.hidden = false;
  } else {
    const excluded = Number(base?.integrity_filtered_source_count || base?.integrity_repaired_source_ids?.length || 0);
    if (excluded) { coverage.textContent = `집계값이 불일치하는 출처 ${excluded}곳 제외`; coverage.hidden = false; }
  }
  if(record?.historyError){coverage.textContent='이전 기록을 불러오지 못했습니다. 현재 기록은 유지됩니다.';coverage.append(action('다시 시도','history-retry'));coverage.hidden=false;}
  const historyStatus=$('#chart-history-status');
  if(historyStatus)historyStatus.textContent=state.historyPending?'이전 기록 불러오는 중':'';
  renderAnalysisContext(record, data, currency);
  drawChart($('#price-chart'), chartSeries, { label: `${modelName} 가격 추이`, currency, identity: `${state.selectedId}:${state.selectedManufacturer}:${state.source}:${state.priceKind}:${window.to}`,
    showLegend:false,showNote:false,cornerReadout:true,axisLeft:true,
    readoutInput:sources.map(item=>referenceSeries.find(line=>line.id===`${item.id}:${state.priceKind}`)||{
      id:`${item.id}:${state.priceKind}`,label:SOURCE_LABELS[item.id]||item.id,currency:item.currency,metricKey:state.priceKind,points:[],
    }),
    onLoadEarlier:loadEarlierPrices,loadingEarlier:state.historyPending,
    canLoadEarlier:state.days<priceDateRange(window.earliest,window.to).days&&!record?.historyError,
    onViewChange:range=>syncAnalysisUrl(range,true)
  });
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
}

function render() { renderControls(); renderSummary(); renderModelTable(); if (builder) renderBuild(); else renderAnalysis(); }
function refreshPrices() {
  const targets = builder&&state.sort === 'price' ? currentProducts() : builder && $('#builder-model-dialog')?.open ? pageGroups().flatMap(g => g.products) : [];
  const selected = state.byId.get(state.selectedId);
  if (selected) targets.push(selected);
  if (builder) targets.push(...state.entries.map(e => state.byId.get(e.id)).filter(Boolean));
  const overseas = !builder && state.source === 'ebay';
  const asOf = requestedPriceAsOf();
  void prices.load(overseas ? [] : targets, builder ? 30 : state.days, asOf);
  if (!builder) void overseasPrices.load(overseas ? targets : [], state.days, asOf);
  if(!builder&&selected){
    // The price rail is always current, independent of a historical chart window.
    void prices.load([selected],60,'',{background:true});
    void overseasPrices.load([selected],60,'',{background:true});
  }
  if(!builder)loadPickerPrices();
}
function selectCategory(category) {
  if(!builder){state.category=category;state.manufacturer='';state.generation='';state.capacity='';state.query='';state.page=1;renderControls();renderModelTable();loadPickerPrices();return;}
  state.category = category; state.manufacturer = ''; state.generation = ''; state.capacity = ''; state.query = ''; state.page = 1; state.selectedManufacturer = ''; state.chartDate = ''; resetChartView();
  state.source = '';
  if (builder) {
    const entry = state.entries.find(e => e.category === category);
    if (entry) { state.selectedId = entry.id; state.selectedManufacturer = entry.manufacturer; revealModel(entry.id); }
    else state.selectedId = '';
  }
  if (!builder) {
    resetHistoryWindow();
    state.selectedId = idOf(currentProducts()[0]);
    syncAnalysisUrl();
  }
  render();
  if (builder) openModelPicker();
  refreshPrices();
}
document.addEventListener('click', event => {
  const button = event.target.closest('[data-action]'); if (!button || !state.ready) return;
  if(button.tagName==='A'&&(event.ctrlKey||event.metaKey||event.shiftKey||event.altKey))return;
  const { action: type, id, manufacturer = '', key, category } = button.dataset;
  if(type==='toggle-latest-prices'){
    const rail=$('#analysis-price-rail'),toggle=$('#chart-latest-toggle'),open=rail.hidden;
    rail.hidden=!open;$('#analysis-workspace').dataset.pricesOpen=String(open);
    toggle.setAttribute('aria-expanded',String(open));toggle.setAttribute('aria-label',open?'최근 가격 접기':'최근 가격 펼치기');
    toggle.textContent=open?'−':'+';
    if(!open&&button!==toggle)toggle.focus({preventScroll:true});
    return;
  }
  if(type==='source-chart'){
    state.source=button.dataset.source;state.priceSources.add(state.source);state.page=1;
    const checkbox=document.querySelector(`[data-price-source="${state.source}"]`);if(checkbox)checkbox.checked=true;
    resetHistoryWindow();resetChartView();syncAnalysisUrl();renderAnalysis();refreshPrices();return;
  }
  if(type==='analyze')event.preventDefault();
  if (type === 'open-picker') { openModelPicker(); refreshPrices(); return; }
  if (type === 'open-analysis-picker') {
    state.category='';state.manufacturer='';state.generation='';state.capacity='';state.query='';state.page=1;
    renderControls();renderModelTable();$('#analysis-model-dialog').showModal();$('#tool-query').focus({ preventScroll: true });loadPickerPrices();return;
  }
  if (type === 'close-analysis-picker') { $('#analysis-model-dialog').close(); return; }
  if (type === 'close-picker') { closeModelPicker(); return; }
  if (type === 'save-build') {
    if (persistBuild()) { button.textContent = '저장됨'; setTimeout(() => { button.textContent = '구성 저장'; }, 1800); }
    return;
  }
  if (type === 'compatibility-help') { openCompatibilityHelp(button.dataset.kind); return; }
  if (type === 'close-compatibility') { $('#compatibility-dialog').close(); return; }
  if (type === 'compatibility-change') {
    $('#compatibility-dialog').close(); selectCategory(button.dataset.category); return;
  }
  if (type === 'print-build') { window.print(); return; }
  if (type === 'chart-recent') {
    if(state.range.to!==state.range.latest){resetHistoryWindow();syncAnalysisUrl();renderAnalysis();refreshPrices();}
    resetChartView();return;
  }
  if(type==='history-retry'){loadEarlierPrices({retry:true});return;}
  if(type==='history-more'){loadEarlierPrices();return;}
  if(type==='picker-retry'){loadPickerPrices();return;}
  if(type==='chart-pan'||type==='chart-zoom'){$('#price-chart').dispatchEvent(new CustomEvent(type,{detail:button.dataset.direction}));return;}
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
  if (type === 'retry') {
    prices.clear(); overseasPrices?.clear(); status(''); refreshPrices();
    renderSummary(); renderModelTable(); if (builder) renderBuild(); else renderAnalysis();
    return;
  }
  if (type === 'page') {
    state.page = Math.max(1, Math.min(Math.ceil(groups().length / PAGE_SIZE) || 1, Number(button.dataset.page)));
    renderModelTable(); $('#model-table').scrollTop = 0;
    // 전체 가격 정렬은 이미 필터 결과 전부를 조회 중이므로 페이지 이동으로 다시 시작하지 않습니다.
    if(!builder)loadPickerPrices();else if (state.sort !== 'price') refreshPrices();
    return;
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
    $('#analysis-model-dialog')?.close();
    state.priceKind='active';state.priceKindExplicit=false;
    state.selectedId = id; state.selectedManufacturer = manufacturer; state.chartDate = ''; resetHistoryWindow();resetChartView();
    syncAnalysisUrl();
  }
  renderSummary(); renderModelTable(); if (builder) renderBuild(); else renderAnalysis(); refreshPrices();
  if (type === 'choose') closeModelPicker();
});
document.addEventListener('change', event => {
  const target = event.target;
  if(target.dataset.priceSource){
    if(target.checked)state.priceSources.add(target.dataset.priceSource);else state.priceSources.delete(target.dataset.priceSource);
    renderAnalysis();document.querySelector(`[data-price-source="${target.dataset.priceSource}"]`)?.focus({preventScroll:true});return;
  }
  if (target.id === 'chart-sources') { state.source = target.value; state.page = 1; resetHistoryWindow();resetChartView(); syncAnalysisUrl(); renderControls(); renderModelTable(); renderAnalysis(); refreshPrices(); return; }
  if(target.id==='chart-price-kind'){state.priceKind=target.value==='sold'?'sold':'active';state.priceKindExplicit=true;renderAnalysis();return;}
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
  if(!builder){if(renderFilterControls)renderControls();renderModelTable();loadPickerPrices();return;}
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
    const pageCatalog = builder ? catalog.tools_catalog : catalog.public_catalog;
    const excludedBuildIds = new Set((pageCatalog?.products || catalog.products || []).filter(p => builder && ['CASE', 'COOLING'].includes(p.category_code)).map(idOf));
    state.products = (pageCatalog?.products || catalog.products || []).filter(p => !excludedBuildIds.has(idOf(p)));
    state.categories = (pageCatalog?.categories || catalog.categories || []).map(c => ({ code: c.code || c.category_code, label: c.label || c.display_name || c.code })).filter(c => !builder || !['CASE', 'COOLING'].includes(c.code));
    state.sources = (catalog.sources || []).filter(source => source.public_enabled === true);
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
          const saved = JSON.parse(raw);
          state.entries = validateBuild(Array.isArray(saved) ? saved.filter(entry => !excludedBuildIds.has(entry?.id)) : saved, state.byId, new Set(state.categories.map(c => c.code)));
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
  $('#compatibility-dialog')?.addEventListener('close', () => requestAnimationFrame(() => {
    if (!$('#builder-model-dialog')?.open) document.querySelector(`.build-warning-trigger[data-kind="${$('#compatibility-dialog').dataset.kind}"]`)?.focus({ preventScroll: true });
  }));
  $('#builder-model-dialog')?.addEventListener('close', () => {
    const target = [...document.querySelectorAll('#build-table button[data-action="category"]')]
      .find(button => button.dataset.category === pickerReturnCategory)
      || document.querySelector('[data-action="open-picker"]');
    target?.focus({ preventScroll: true });
  });
}
if (!builder) $('#analysis-model-dialog')?.addEventListener('close', () => {
  prices.cancelBackground('picker');overseasPrices.cancelBackground('picker');
  clearTimeout(pickerRepaintTimer);$('#analysis-model-select')?.focus({ preventScroll: true });
});
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
