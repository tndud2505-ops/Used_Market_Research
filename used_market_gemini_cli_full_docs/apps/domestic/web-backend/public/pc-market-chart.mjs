import { money } from './pc-tools-core.mjs?v=readable-chart-v2';

// Ported from KSTOCK StockPriceChart.tsx (chart-clean-canvas, cf7cdca7d):
// visible window/offset, price padding, nice ticks, date stride, wheel factors,
// pointer capture and the 4px drag threshold. Lines join observed prices only.
const views = new WeakMap(), cleanups = new WeakMap();
const NS = 'http://www.w3.org/2000/svg';
const clamp = (n, min, max) => Math.min(max, Math.max(min, n));
const valid = value => typeof value === 'number' && Number.isFinite(value) && value > 0;
const observed = point => valid(point.value) || (valid(point.lower) && valid(point.upper) && point.upper>=point.lower);
const svgNode = (tag, attrs = {}, text = '') => {
  const node = document.createElementNS(NS, tag);
  for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, value);
  node.textContent = text; return node;
};
const node = (tag, className = '', text = '') => {
  const element = document.createElement(tag); element.className = className; element.textContent = text; return element;
};
const dateLabel = date => date.slice(5).replace('-', '.');

export function marketLinePath(points, x, y, { connectObservations = false } = {}) {
  let path = '', previous = null;
  for (const point of points) {
    if (!valid(point.value)) { if (!connectObservations) previous = null; continue; }
    const adjacent = previous && (connectObservations || Date.parse(point.date) - Date.parse(previous.date) === 86400000);
    path += `${adjacent ? 'L' : 'M'}${x(point.date)},${y(point.value)} `;
    previous = point;
  }
  return path.trim();
}

// Connect only measured endpoints. Missing dates keep their null values and
// receive a separate dotted bridge rather than a fabricated observation.
export function marketGapPath(points, x, y) {
  let path = '', previous = null;
  for (const point of points) {
    if (!valid(point.value)) continue;
    if (previous && Date.parse(point.date) - Date.parse(previous.date) > 86400000)
      path += `M${x(previous.date)},${y(previous.value)} L${x(point.date)},${y(point.value)} `;
    previous = point;
  }
  return path.trim();
}

export function responsiveDateCount(width, spacing = 18) {
  return Math.max(5, Math.floor(Math.max(1, width - (width < 480 ? 92 : 106)) / spacing+1e-6));
}

export function movingAverage(points, period = 20) {
  const days = Math.max(2, Math.min(300, Math.round(period))), sorted = [...points].sort((a,b)=>a.date.localeCompare(b.date));
  const first = Date.parse(sorted[0]?.date);
  return sorted.map(point => {
    const end = Date.parse(point.date), start = end - (days-1)*86400000;
    const values = sorted.filter(item => Date.parse(item.date)>=start && Date.parse(item.date)<=end && valid(item.value)).map(item=>item.value);
    return {date:point.date, value: valid(point.value) && start>=first && values.length ? values.reduce((a,b)=>a+b,0)/values.length : null, observedDays:values.length};
  });
}

export function buildMarketView(series, dates, count, offset, width, height, { averagePeriod = 0, showSamples = false } = {}) {
  const shownCount = clamp(Math.round(count), 1, dates.length);
  const maxOffset = Math.max(0, dates.length - shownCount);
  const end = dates.length - clamp(Math.round(offset), 0, maxOffset);
  const shownDates = dates.slice(Math.max(0, end - shownCount), end);
  const shownSet = new Set(shownDates);
  const priceValues = point => valid(point.value) ? [point.value] : observed(point) ? [point.lower,point.upper] : [];
  const values = series.flatMap(line => [...line.points, ...(averagePeriod ? line.averages || movingAverage(line.points,averagePeriod) : [])].filter(point => shownSet.has(point.date)).flatMap(priceValues));
  const emptyViewport = !values.length;
  // A data gap still needs a navigable time axis. These values set its scale
  // only; points and readouts remain empty until an observed date is visible.
  if (emptyViewport) values.push(...series.flatMap(line=>line.points.flatMap(priceValues)));
  if (!values.length) return null;
  const pad = { left: 16, right: width < 480 ? 76 : 90, top: 26, bottom: 34 };
  // KSTOCK volume pane: shared dates, 17% height, 44–110px and an independent scale.
  const sampleHeight = showSamples ? Math.min(110, Math.max(44, height*.17)) : 0;
  const plotWidth = Math.max(1, width - pad.left - pad.right), plotHeight = Math.max(1, height - pad.top - pad.bottom - (showSamples ? sampleHeight+24 : 0));
  const sampleTop = pad.top+plotHeight+24, sampleBottom = sampleTop+sampleHeight;
  const sampleMaps=showSamples?series.map(line=>line.pointsByDate||new Map(line.points.map(point=>[point.date,point]))):[];
  const sampleTotals = showSamples?shownDates.map(date=>sampleMaps.reduce((sum,map)=>sum+(map.get(date)?.sampleCount || 0),0)):[];
  const maxSamples = Math.max(1,...sampleTotals), sampleY = value => sampleBottom-value/maxSamples*sampleHeight;
  const min = Math.min(...values), max = Math.max(...values);
  const margin = Math.max((max - min) * 0.07, max * 0.005, series[0]?.currency === 'USD' ? 0.01 : 1);
  const scaleMin = Math.max(0, min - margin), scaleMax = max + margin, range = scaleMax - scaleMin;
  const y = value => pad.top + (scaleMax - value) / range * plotHeight;
  const step = plotWidth / Math.max(1, shownDates.length);
  const dateIndices = new Map(shownDates.map((date,index)=>[date,index]));
  const x = date => pad.left + step * dateIndices.get(date) + step / 2;
  const rawTickStep = range / Math.max(2, Math.floor(plotHeight / 68));
  const magnitude = 10 ** Math.floor(Math.log10(rawTickStep));
  const tickStep = ([1, 2, 2.5, 5, 10].find(value => value * magnitude >= rawTickStep) ?? 10) * magnitude;
  const priceTicks = [];
  for (let value = Math.ceil(scaleMin / tickStep) * tickStep; value <= scaleMax; value += tickStep) priceTicks.push({ value, y: y(value) });
  const stride = Math.max(1, Math.ceil(shownDates.length / Math.max(2, Math.floor(plotWidth / 125))));
  const dateTicks = shownDates.filter((_, i) => i % stride === 0);
  const last = shownDates.at(-1);
  if (dateTicks.at(-1) !== last) {
    if (x(last) - x(dateTicks.at(-1)) < 85 && dateTicks.length > 1) dateTicks.pop();
    if (x(last) - x(dateTicks.at(-1)) >= 45) dateTicks.push(last);
  }
  return { shownDates, shownSet, shownCount, maxOffset, pad, plotWidth, plotHeight, priceTicks, dateTicks, x, y, sampleTop, sampleBottom, sampleHeight, maxSamples, sampleY, step, emptyViewport };
}

export function drawMarketChart(container, input, options = {}) {
  const { label = '가격 추이', currency = 'KRW', identity = '', averagePeriod = 0, showSamples = false,
    onLoadEarlier, canLoadEarlier = false, loadingEarlier = false, onViewChange } = options;
  const currentView=views.get(container);
  if(currentView?.interacting && currentView.identity===identity){
    currentView.pendingRender=()=>drawMarketChart(container,input,options);return;
  }
  cleanups.get(container)?.(); container.replaceChildren();
  const series = input.map(line => ({ ...line, currency: line.currency || currency,
    sourceId: line.id.split(':')[0], sourceLabel: line.label.split(' · ')[0],
    color: line.id.startsWith('bunjang:') ? '#c73546'
      : line.id.startsWith('danawa:') ? '#a66b12'
      : /^(joonggonara|daangn):/.test(line.id) ? '#346fca' : '#7446be',
    points: [...line.points].sort((a,b) => a.date.localeCompare(b.date)),
    pointsByDate:new Map(line.points.map(point=>[point.date,point]))
  })).filter(line => line.currency === currency && line.points.some(observed));
  const sourceOrder = ['joonggonara', 'bunjang', 'danawa', 'ebay'];
  series.sort((a,b) => (sourceOrder.indexOf(a.sourceId)+1 || 99)-(sourceOrder.indexOf(b.sourceId)+1 || 99));
  for (const line of series) line.averages = averagePeriod ? movingAverage(line.points,averagePeriod) : [];
  if (!series.length) {
    const state = container.dataset.priceState;
    container.append(node('p', 'market-chart-empty', state === 'loading' ? '불러오는 중' : state === 'error' ? '가격 조회 실패'
      : state === 'insufficient' ? '대표가격 표본 부족' : '가격 자료 없음'));
    return;
  }
  const measuredDates=[...new Set(series.flatMap(line=>line.points.filter(observed).map(point=>point.date)))].sort();
  const dates = [...new Set(series.flatMap(line => line.points.map(point => point.date)))].sort().filter(date=>date>=measuredDates[0]&&date<=measuredDates.at(-1));
  let view = views.get(container);
  if (!view || view.identity !== identity) view = { identity, count: responsiveDateCount(container.clientWidth), spacing: 18, offset: 0, hidden: new Set() };
  views.set(container, view);
  view.count = clamp(responsiveDateCount(container.clientWidth,view.spacing),Math.min(5,dates.length),dates.length);
  view.offset = clamp(view.offset,0,dates.length-view.count);
  const summary = node('div', 'market-chart-summary'); summary.setAttribute('role', 'group'); summary.setAttribute('aria-label', '가격선 표시');
  const sourceGroups = new Map();
  for (const line of series) {
    if (!sourceGroups.has(line.sourceId)) {
      const group = node('div', 'market-source-legend'); group.style.setProperty('--series-color', line.color);
      group.append(node('strong', 'market-source-name', line.sourceLabel));
      sourceGroups.set(line.sourceId, group); summary.append(group);
    }
    const button = node('button', 'market-series'); button.type = 'button'; button.dataset.series = line.id;
    button.dataset.metric = line.metricKey;
    button.style.setProperty('--series-color', line.color); button.setAttribute('aria-pressed', String(!view.hidden.has(line.id)));
    button.setAttribute('aria-label', line.label);
    button.title = `${line.label} 표시 전환`;
    const title = node('span', 'market-series-name', line.priceBasis === 'listed-minimum' ? '중고 최저 표시가' : line.metricKey === 'sold' ? '판매완료 표시가' : '판매중'); title.prepend(node('i'));
    button.append(title);
    button.addEventListener('click', () => {
      if (view.hidden.has(line.id)) view.hidden.delete(line.id); else view.hidden.add(line.id);
      button.setAttribute('aria-pressed', String(!view.hidden.has(line.id))); paint();
    });
    sourceGroups.get(line.sourceId).append(button);
  }
  if (averagePeriod) summary.append(node('span','market-average-legend',`${averagePeriod}일 평균`));
  const stage = node('div', 'market-chart-stage');
  const svg = svgNode('svg', { tabindex: 0, role: 'group', 'aria-roledescription': '가격 차트', 'aria-label': `${label}. 드래그: 좌우 이동, Ctrl+휠·핀치: 확대·축소, 좌우 키: 날짜, Home: 최근으로, Escape: 선택 해제` });
  const plot = svgNode('g'), cursor = svgNode('g', { 'pointer-events': 'none' }); svg.append(plot, cursor);
  const readout = node('div', 'market-chart-readout'); readout.hidden = true; readout.setAttribute('role', 'dialog'); readout.setAttribute('aria-label', '날짜별 가격');
  const note = node('p', 'market-chart-note', '점선은 가격 기록 사이의 간격입니다.');
  if (series.some(line => line.metricKey === 'sold')) note.append(node('span', '', '판매완료 표시가는 실제 체결가와 다를 수 있습니다.'));
  stage.append(svg, readout); container.append(summary, stage, note);
  let geometry, width, height, drag = null, activeIndex = dates.length - 1, frame, pinch = null, shownDate=null;
  const pointers = new Map();
  const finishInteraction=()=>{
    view.interacting=pointers.size>0;
    if(!view.interacting&&view.pendingRender){const render=view.pendingRender;view.pendingRender=null;queueMicrotask(render);}
  };
  const requestEarlier = () => { if (canLoadEarlier && !loadingEarlier) onLoadEarlier?.(); };
  const visible = () => series.filter(line => !view.hidden.has(line.id));
  const clearCursor = () => { cursor.replaceChildren(); readout.hidden = true;shownDate=null; };
  function show(date) {
    if (!geometry || !geometry.shownSet.has(date)) { clearCursor(); return; }
    if(shownDate===date&&!readout.hidden)return;
    shownDate=date;
    activeIndex = dates.indexOf(date); cursor.replaceChildren();
    const heading = node('div', 'market-tooltip-heading'), time = node('time', '', date.slice(2).replaceAll('-', '.'));
    time.dateTime = date;
    const close = node('button', 'market-tooltip-close', '×'); close.type = 'button'; close.setAttribute('aria-label', '가격 도움말 닫기');
    close.addEventListener('click', () => { view.pinned = null; clearCursor(); svg.focus({ preventScroll: true }); });
    heading.append(time, close);
    const values = node('table', 'market-tooltip-values'); values.setAttribute('aria-label', `${date} 사이트별 가격`);
    const head = node('thead'), headings = node('tr');
    for (const text of ['사이트', '가격', '표본']) { const cell = node('th', '', text); cell.scope = 'col'; headings.append(cell); }
    head.append(headings); const body = node('tbody'); values.append(head, body); readout.replaceChildren(heading, values);
    const { x, y, pad, plotHeight } = geometry;
    cursor.append(svgNode('line', { x1:x(date), x2:x(date), y1:pad.top, y2:showSamples ? geometry.sampleBottom : pad.top+plotHeight, class:'market-crosshair' }));
    for (const line of visible()) {
        const point=line.pointsByDate.get(date);
        if(!point||!observed(point))continue;
        const row = node('tr'), caption = node('th', '', line.sourceLabel); caption.scope = 'row'; caption.style.color = line.color; row.append(caption);
        const cell = node('td', 'market-tooltip-value'); row.append(cell);
        cell.dataset.series = line.id;
        const value=point.value;
        cell.append(node('strong', '', valid(value) ? money(value,currency) : `${money(point.lower,currency)}~${money(point.upper,currency)}`));
        cell.append(node('small','',point.priceLabel || (line.priceBasis==='listed-minimum'?'중고 최저 표시가':line.metricKey==='sold'?'판매완료 표시가':'판매중 가격')));
        row.append(node('td','',Number.isInteger(point.sampleCount)?`${point.sampleCount.toLocaleString('ko-KR')}건`:'—'));
        if (averagePeriod) { const average = line.averages.find(point=>point.date===date); cell.append(node('small','',`${averagePeriod}일 평균 ${valid(average?.value) ? money(average.value,currency) : '자료 부족'}`)); }
        if (valid(value)) cursor.append(svgNode('circle', {cx:x(date), cy:y(value), r:4.5, fill:line.metricKey === 'sold' ? 'white' : line.color, stroke:line.color, 'stroke-width':2}));
        body.append(row);
    }
    readout.hidden = false;
    const selectedValues = visible().map(line => line.pointsByDate.get(date)?.value).filter(valid);
    const selectedY = selectedValues.length ? y(selectedValues.includes(view.anchorValue) ? view.anchorValue : selectedValues[0]) : pad.top;
    const left = clamp(x(date) + 14, 8, Math.max(8, width - readout.offsetWidth - 8));
    const top = clamp(selectedY - readout.offsetHeight - 14 < 8 ? selectedY + 14 : selectedY - readout.offsetHeight - 14, 8, Math.max(8, height - readout.offsetHeight - 8));
    readout.style.left = `${left}px`; readout.style.top = `${top}px`;
  }
  function paintNow() {
    width = stage.clientWidth; height = stage.clientHeight;
    if (width < 120 || height < 100) return;
    svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
    geometry = buildMarketView(visible(), dates, view.count, view.offset, width, height, {averagePeriod,showSamples});
    svg.dataset.visibleCount = String(view.count); svg.dataset.offset = String(view.offset);
    plot.replaceChildren(); clearCursor();
    if (!geometry) { plot.append(svgNode('text', { x:16, y:height/2 }, '표시할 가격 없음')); return; }
    const { pad, plotWidth, plotHeight, priceTicks, dateTicks, shownSet, x, y } = geometry;
    onViewChange?.({ from: geometry.shownDates[0], to: geometry.shownDates.at(-1) });
    const edge = pad.left + plotWidth;
    if(geometry.emptyViewport)plot.append(svgNode('text',{x:pad.left+plotWidth/2,y:pad.top+plotHeight/2,'text-anchor':'middle'},'이 구간에는 가격 기록이 없습니다'));
    plot.append(svgNode('text', {x:edge+10, y:14, class:'market-axis'}, currency === 'USD' ? 'USD' : '원'));
    for (const tick of priceTicks) {
      plot.append(svgNode('line', {x1:pad.left, x2:edge, y1:tick.y, y2:tick.y, class:'market-grid'}));
      plot.append(svgNode('text', {x:edge+10, y:tick.y+4, class:'market-axis', 'data-price-y':tick.y}, currency === 'USD' ? `$${tick.value.toFixed(2)}` : Math.round(tick.value).toLocaleString('ko-KR')));
    }
    for (const date of dateTicks) {
      plot.append(svgNode('line', {x1:x(date), x2:x(date), y1:height-30, y2:height-24, class:'market-grid'}));
      plot.append(svgNode('text', {x:x(date), y:height-10, 'text-anchor':'middle', class:'market-axis'}, dateLabel(date)));
    }
    if (showSamples) {
      const {sampleTop,sampleBottom,sampleY,maxSamples,step} = geometry;
      plot.append(svgNode('text',{x:pad.left,y:sampleTop-8,class:'market-axis'},'표본 수 (건)'));
      plot.append(svgNode('text',{x:edge+10,y:sampleTop+5,class:'market-axis'},maxSamples.toLocaleString('ko-KR')));
      plot.append(svgNode('line',{x1:pad.left,x2:edge,y1:sampleBottom,y2:sampleBottom,class:'market-grid'}));
      const barWidth = Math.max(1,Math.min(12,step*.62));
      for (const date of geometry.shownDates) {
        let total=0;
        for (const line of visible()) {
          const count=line.pointsByDate.get(date)?.sampleCount;
          if (!(count>0)) continue;
          plot.append(svgNode('rect',{x:x(date)-barWidth/2,y:sampleY(total+count),width:barWidth,height:sampleY(total)-sampleY(total+count),fill:line.color,opacity:.6,class:'market-sample-bar','data-date':date,'data-series':line.id,'data-count':count}));
          total+=count;
        }
      }
    }
    for (const line of visible()) {
      const group = svgNode('g', {'data-series':line.id}), points = line.points.filter(point => shownSet.has(point.date));
      const sold = line.metricKey === 'sold';
      const singleObservation = points.filter(point => valid(point.value)).length === 1;
      const path = marketLinePath(points, x, y);
      group.append(svgNode('path', {d:path, fill:'none', stroke:line.color, 'stroke-width':sold ? 2 : 2.3, 'stroke-linejoin':'round', ...(sold ? {'stroke-dasharray':'6 5'} : {})}));
      const gapPath = marketGapPath(points, x, y);
      if (gapPath) group.append(svgNode('path', {d:gapPath, fill:'none', stroke:line.color, 'stroke-width':1.8, 'stroke-dasharray':'2 5', opacity:.65, 'data-gap-bridge':'true'}));
      // Keep every exact observed range in one path instead of creating a DOM
      // node per day. Readouts still use the original daily records.
      const ranges = points.filter(point=>valid(point.lower)&&valid(point.upper));
      if(ranges.length) group.append(svgNode('path',{d:ranges.map(point=>`M${x(point.date)},${y(point.lower)}V${y(point.upper)}`).join(' '),fill:'none',stroke:line.color,'stroke-width':3,'data-range-series':line.id}));
      for (const point of points) {
        if(valid(point.lower)&&valid(point.upper))continue;
        if (!valid(point.value)) continue;
        if(points.length>180&&!singleObservation)continue;
        group.append(svgNode('circle', {cx:x(point.date), cy:y(point.value), r:singleObservation ? 4 : sold ? (points.length < 80 ? 3.5 : 2.5) : (points.length < 80 ? 2 : 1.5), fill:sold ? 'white' : line.color, stroke:line.color, 'stroke-width':sold ? 1.8 : 0, 'data-date':point.date}));
      }
      plot.append(group);
      const averages=line.averages.filter(point=>shownSet.has(point.date));
      if (averages.some(point=>valid(point.value))) plot.append(svgNode('path',{d:marketLinePath(averages,x,y),fill:'none',stroke:line.color,'stroke-width':2.6,opacity:.5,'stroke-dasharray':'9 4','pointer-events':'none',class:'market-average-line','data-average-series':line.id}));
    }
    if (view.pinned) show(view.pinned);
  }
  const paint=()=>{cancelAnimationFrame(frame);frame=requestAnimationFrame(paintNow);};
  const redraw = () => { cancelAnimationFrame(frame); frame = requestAnimationFrame(() => {
    view.count=clamp(responsiveDateCount(stage.clientWidth, view.spacing),Math.min(5,dates.length),dates.length);
    view.offset=clamp(view.offset,0,dates.length-view.count);paintNow();
  }); };
  const reset = () => { view.spacing=18;view.count=Math.min(dates.length,responsiveDateCount(stage.clientWidth));view.offset=0;view.pinned=null;paint(); };
  const pan = offset => {
    view.offset=clamp(Math.round(offset),0,dates.length-view.count);view.pinned=null;paint();
    if (dates.length-view.offset-view.count<=Math.max(2,Math.floor(view.count*.15))) requestEarlier();
  };
  const zoom = (factor, anchor=.5) => {
    if(!geometry)return;
    const before = view.count, requested = Math.max(5,Math.round(before*factor)), next = Math.min(requested,dates.length);
    const start = dates.length-view.offset-before;
    view.spacing=geometry.plotWidth/requested;
    view.count=next; view.offset=clamp(Math.round(dates.length-(start+anchor*before+(1-anchor)*next)),0,dates.length-next);
    view.pinned=null; paint();
    if (factor>1 && dates.length-view.offset-view.count<=Math.max(2,Math.floor(view.count*.15))) requestEarlier();
  };
  const pointAtPointer = event => {
    if (!geometry) return null;
    const bounds = svg.getBoundingClientRect(), scaleX = bounds.width/width, scaleY = bounds.height/height;
    if (showSamples && event.clientY-bounds.top>=geometry.sampleTop*scaleY && event.clientY-bounds.top<=geometry.sampleBottom*scaleY) {
      const date=geometry.shownDates.find(date=>Math.abs(event.clientX-bounds.left-geometry.x(date)*scaleX)<=Math.max(6,geometry.step*scaleX/2));
      if (date && visible().some(line=>(line.points.find(point=>point.date===date)?.sampleCount || 0)>0)) return {date,value:null};
    }
    // Select the calendar date anywhere in the plot; the readout uses actual values only.
    const px = (event.clientX-bounds.left)/scaleX, py = (event.clientY-bounds.top)/scaleY;
    if (px < geometry.pad.left || px > geometry.pad.left+geometry.plotWidth || py < geometry.pad.top || py > (showSamples ? geometry.sampleBottom : geometry.pad.top+geometry.plotHeight)) return null;
    const index = clamp(Math.floor((px-geometry.pad.left)/geometry.step), 0, geometry.shownDates.length-1);
    for(let distance=0;distance<geometry.shownDates.length;distance++)for(const candidate of [index-distance,index+distance]){
      const date=geometry.shownDates[candidate];
      if(date&&visible().some(line=>observed(line.pointsByDate.get(date)||{})))return {date,value:null};
    }
    return null;
  };
  svg.addEventListener('wheel', event => {
    if (!geometry||(!event.ctrlKey&&!event.shiftKey&&Math.abs(event.deltaX)<=Math.abs(event.deltaY))) return; event.preventDefault();
    if (event.shiftKey || Math.abs(event.deltaX)>Math.abs(event.deltaY)) pan(view.offset-(event.deltaX || event.deltaY)/geometry.step);
    else if(event.deltaY) zoom(event.ctrlKey ? Math.exp(clamp(event.deltaY,-100,100)*.01) : event.deltaY<0?.86:1.16,clamp((event.clientX-svg.getBoundingClientRect().left-geometry.pad.left)/geometry.plotWidth,0,1));
  },{passive:false});
  svg.addEventListener('pointerdown', event => {
    if (!geometry || event.button!==0) return;
    pointers.set(event.pointerId,{x:event.clientX,y:event.clientY});
    view.interacting=true;
    if (pointers.size===2) {
      const [a,b]=[...pointers.values()];pinch={distance:Math.hypot(a.x-b.x,a.y-b.y),count:view.count};
      if(drag)drag.moved=true;
    }
    drag={id:event.pointerId,x:event.clientX,y:event.clientY,offset:view.offset,moved:false};svg.setPointerCapture(event.pointerId);
  });
  svg.addEventListener('pointermove', event => {
    if (!geometry) return;
    if(pointers.has(event.pointerId))pointers.set(event.pointerId,{x:event.clientX,y:event.clientY});
    if(pinch && pointers.size===2) {
      const [a,b]=[...pointers.values()],distance=Math.hypot(a.x-b.x,a.y-b.y);
      if(distance>0)zoom(pinch.count*pinch.distance/distance/view.count,clamp(((a.x+b.x)/2-svg.getBoundingClientRect().left-geometry.pad.left)/geometry.plotWidth,0,1));
      return;
    }
    if (drag && drag.id===event.pointerId) {
      if (Math.abs(drag.x-event.clientX)>4&&Math.abs(drag.x-event.clientX)>Math.abs(drag.y-event.clientY)*1.2) drag.moved=true;
      if (drag.moved) { pan(drag.offset+(event.clientX-drag.x)/(geometry.plotWidth/view.count));return; }
    }
    if (!drag && !view.pinned && event.pointerType === 'mouse') {
      const point = pointAtPointer(event); if (point) { view.anchorValue=point.value; show(point.date); } else clearCursor();
    }
  });
  stage.addEventListener('pointerleave',()=>{if(!view.pinned)clearCursor();});
  svg.addEventListener('pointerup', event => {
    pointers.delete(event.pointerId);
    if(pinch){pinch=null;drag=null;if(svg.hasPointerCapture(event.pointerId))svg.releasePointerCapture(event.pointerId);finishInteraction();return;}
    if (!drag || drag.id!==event.pointerId){finishInteraction();return;}
    if (!drag.moved) { const point=pointAtPointer(event);view.pinned=point?.date || null;view.anchorValue=point?.value;if(view.pinned)show(view.pinned);else clearCursor(); }
    drag=null;if(svg.hasPointerCapture(event.pointerId))svg.releasePointerCapture(event.pointerId);
    finishInteraction();
  });
  svg.addEventListener('pointercancel',event=>{pointers.delete(event.pointerId);pinch=null;drag=null;finishInteraction();});
  svg.addEventListener('dblclick',reset);
  svg.addEventListener('keydown',event=>{
    if(!['ArrowLeft','ArrowRight','+','=','-','Home','Escape'].includes(event.key))return;event.preventDefault();
    if(event.key==='Home')reset();
    else if(event.key==='Escape'){view.pinned=null;clearCursor();}
    else if(['+','=','-'].includes(event.key))zoom(event.key==='-'?1.16:.86);
    else { activeIndex=clamp(activeIndex+(event.key==='ArrowLeft'?-1:1),0,dates.length-1);
      const start=dates.length-view.offset-view.count;
      if(activeIndex<start)view.offset=dates.length-view.count-activeIndex;
      if(activeIndex>=start+view.count)view.offset=dates.length-activeIndex-1;
      view.pinned=dates[activeIndex];paint();if(event.key==='ArrowLeft'&&activeIndex<=Math.max(2,Math.floor(view.count*.15)))requestEarlier(); }
  });
  container.addEventListener('chart-reset',reset);
  const navigate=event=>{if(event.type==='chart-pan')pan(view.offset+(event.detail==='older'?1:-1)*Math.max(1,Math.round(view.count*.65)));else zoom(event.detail==='in'?.75:1.35);};
  container.addEventListener('chart-pan',navigate);container.addEventListener('chart-zoom',navigate);
  const dismissOutside = event => { if (!container.contains(event.target)) { view.pinned=null;clearCursor(); } };
  document.addEventListener('pointerdown',dismissOutside);
  readout.addEventListener('keydown',event=>{if(event.key==='Escape'){event.stopPropagation();view.pinned=null;clearCursor();svg.focus({preventScroll:true});}});
  const resize=new ResizeObserver(redraw);resize.observe(stage);paintNow();
  cleanups.set(container,()=>{resize.disconnect();cancelAnimationFrame(frame);container.removeEventListener('chart-reset',reset);container.removeEventListener('chart-pan',navigate);container.removeEventListener('chart-zoom',navigate);document.removeEventListener('pointerdown',dismissOutside);});
}
