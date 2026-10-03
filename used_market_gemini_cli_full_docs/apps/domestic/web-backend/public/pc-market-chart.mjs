import { money } from './pc-tools-core.mjs?v=price-clarity-v1';

// Ported from KSTOCK StockPriceChart.tsx (chart-clean-canvas, cf7cdca7d):
// visible window/offset, price padding, nice ticks, date stride, wheel factors,
// pointer capture and the 4px drag threshold. Lines join observed prices only.
const views = new WeakMap(), cleanups = new WeakMap();
const NS = 'http://www.w3.org/2000/svg';
const clamp = (n, min, max) => Math.min(max, Math.max(min, n));
const valid = value => typeof value === 'number' && Number.isFinite(value) && value > 0;
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
  const values = series.flatMap(line => [...line.points, ...(averagePeriod ? line.averages || movingAverage(line.points,averagePeriod) : [])].filter(point => shownSet.has(point.date) && valid(point.value)).map(point => point.value));
  if (!values.length) return null;
  const pad = { left: 16, right: width < 480 ? 76 : 90, top: 26, bottom: 34 };
  // KSTOCK volume pane: shared dates, 17% height, 44–110px and an independent scale.
  const sampleHeight = showSamples ? Math.min(110, Math.max(44, height*.17)) : 0;
  const plotWidth = Math.max(1, width - pad.left - pad.right), plotHeight = Math.max(1, height - pad.top - pad.bottom - (showSamples ? sampleHeight+24 : 0));
  const sampleTop = pad.top+plotHeight+24, sampleBottom = sampleTop+sampleHeight;
  const sampleTotals = shownDates.map(date=>series.reduce((sum,line)=>sum+(line.points.find(point=>point.date===date)?.sampleCount || 0),0));
  const maxSamples = Math.max(1,...sampleTotals), sampleY = value => sampleBottom-value/maxSamples*sampleHeight;
  const min = Math.min(...values), max = Math.max(...values);
  const margin = Math.max((max - min) * 0.07, max * 0.005, series[0]?.currency === 'USD' ? 0.01 : 1);
  const scaleMin = Math.max(0, min - margin), scaleMax = max + margin, range = scaleMax - scaleMin;
  const y = value => pad.top + (scaleMax - value) / range * plotHeight;
  const step = plotWidth / Math.max(1, shownDates.length);
  const x = date => pad.left + step * shownDates.indexOf(date) + step / 2;
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
  return { shownDates, shownSet, shownCount, maxOffset, pad, plotWidth, plotHeight, priceTicks, dateTicks, x, y, sampleTop, sampleBottom, sampleHeight, maxSamples, sampleY, step };
}

export function drawMarketChart(container, input, { label = '가격 추이', currency = 'KRW', identity = '', averagePeriod = 0, showSamples = false } = {}) {
  cleanups.get(container)?.(); container.replaceChildren();
  const series = input.map(line => ({ ...line, currency: line.currency || currency,
    sourceId: line.id.split(':')[0], sourceLabel: line.label.split(' · ')[0],
    color: line.id.startsWith('bunjang:') ? '#c73546'
      : line.id.startsWith('danawa:') ? '#a66b12'
      : /^(joonggonara|daangn):/.test(line.id) ? '#346fca' : '#7446be',
    points: [...line.points].sort((a,b) => a.date.localeCompare(b.date))
  })).filter(line => line.currency === currency && line.points.some(point => valid(point.value)));
  const sourceOrder = ['joonggonara', 'bunjang', 'danawa', 'ebay'];
  series.sort((a,b) => (sourceOrder.indexOf(a.sourceId)+1 || 99)-(sourceOrder.indexOf(b.sourceId)+1 || 99));
  for (const line of series) line.averages = averagePeriod ? movingAverage(line.points,averagePeriod) : [];
  if (!series.length) {
    const state = container.dataset.priceState;
    container.append(node('p', 'market-chart-empty', state === 'loading' ? '불러오는 중' : state === 'error' ? '가격 조회 실패'
      : state === 'insufficient' ? '대표가격 표본 부족' : '가격 자료 없음'));
    return;
  }
  const dates = [...new Set(series.flatMap(line => line.points.map(point => point.date)))].sort();
  let view = views.get(container);
  if (!view || view.identity !== identity) view = { identity, count: dates.length, offset: 0, hidden: new Set() };
  views.set(container, view);
  view.count = clamp(view.count, 1, dates.length);
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
  const svg = svgNode('svg', { tabindex: 0, role: 'group', 'aria-roledescription': '가격 차트', 'aria-label': `${label}. 좌우 키: 날짜, +와 -: 확대·축소, Home: 전체 보기, Escape: 선택 해제` });
  const plot = svgNode('g'), cursor = svgNode('g', { 'pointer-events': 'none' }); svg.append(plot, cursor);
  const readout = node('div', 'market-chart-readout'); readout.hidden = true; readout.setAttribute('role', 'dialog'); readout.setAttribute('aria-label', '날짜별 가격');
  const note = node('p', 'market-chart-note', series.some(line => line.metricKey === 'sold')
    ? '판매완료 점선은 기록이 있는 날짜를 연결합니다. 표시가는 실제 체결가와 다를 수 있습니다.' : '가격 기록이 없는 날짜는 빈 구간으로 표시합니다.');
  const hint = node('span', '', '날짜를 선택하면 가격과 표본을 볼 수 있습니다.'); note.append(hint);
  stage.append(svg, readout); container.append(summary, stage, note);
  let geometry, width, height, drag = null, activeIndex = dates.length - 1, frame;
  const visible = () => series.filter(line => !view.hidden.has(line.id));
  const clearCursor = () => { cursor.replaceChildren(); readout.hidden = true; };
  function show(date) {
    if (!geometry || !geometry.shownSet.has(date)) { clearCursor(); return; }
    activeIndex = dates.indexOf(date); cursor.replaceChildren();
    const heading = node('div', 'market-tooltip-heading'), time = node('time', '', date.slice(2).replaceAll('-', '.'));
    time.dateTime = date;
    const close = node('button', 'market-tooltip-close', '×'); close.type = 'button'; close.setAttribute('aria-label', '가격 도움말 닫기');
    close.addEventListener('click', () => { view.pinned = null; clearCursor(); svg.focus({ preventScroll: true }); });
    heading.append(time, close);
    const values = node('table', 'market-tooltip-values'); values.setAttribute('aria-label', `${date} 사이트별 가격`);
    const head = node('thead'), headings = node('tr');
    for (const text of ['사이트', '판매중', '판매완료 표시가']) { const cell = node('th', '', text); cell.scope = 'col'; headings.append(cell); }
    head.append(headings); const body = node('tbody'); values.append(head, body); readout.replaceChildren(heading, values);
    const { x, y, pad, plotHeight } = geometry;
    cursor.append(svgNode('line', { x1:x(date), x2:x(date), y1:pad.top, y2:showSamples ? geometry.sampleBottom : pad.top+plotHeight, class:'market-crosshair' }));
    for (const sourceId of sourceGroups.keys()) {
      const sourceLines = visible().filter(line => line.sourceId === sourceId);
      if (!sourceLines.length) continue;
      const row = node('tr'), caption = node('th', '', sourceLines[0].sourceLabel); caption.scope = 'row'; caption.style.color = sourceLines[0].color; row.append(caption);
      for (const metric of ['active', 'sold']) {
        const line = series.find(line => line.sourceId === sourceId && line.metricKey === metric);
        const cell = node('td', 'market-tooltip-value'); row.append(cell);
        if (!line || view.hidden.has(line.id)) { cell.append(node('span', '', line ? '숨김' : '자료 없음')); continue; }
        cell.dataset.series = line.id;
        const point = line.points.find(point => point.date === date), value = point?.value;
        cell.append(node(valid(value) ? 'strong' : 'span', '', valid(value) ? money(value, currency) : '자료 없음'));
        if (line.priceBasis === 'listed-minimum' && valid(value)) cell.append(node('small', '', '중고 최저 표시가'));
        if (Number.isInteger(point?.sampleCount)) cell.append(node('small', '', `표본 ${point.sampleCount.toLocaleString('ko-KR')}건`));
        if (averagePeriod) { const average = line.averages.find(point=>point.date===date); cell.append(node('small','',`${averagePeriod}일 평균 ${valid(average?.value) ? money(average.value,currency) : '자료 부족'}`)); }
        if (valid(value)) cursor.append(svgNode('circle', {cx:x(date), cy:y(value), r:4.5, fill:metric === 'sold' ? 'white' : line.color, stroke:line.color, 'stroke-width':2}));
      }
      body.append(row);
    }
    readout.hidden = false;
    const selectedValues = visible().map(line => line.points.find(point => point.date === date)?.value).filter(valid);
    const selectedY = selectedValues.length ? y(selectedValues.includes(view.anchorValue) ? view.anchorValue : selectedValues[0]) : pad.top;
    const left = clamp(x(date) + 14, 8, Math.max(8, width - readout.offsetWidth - 8));
    const top = clamp(selectedY - readout.offsetHeight - 14 < 8 ? selectedY + 14 : selectedY - readout.offsetHeight - 14, 8, Math.max(8, height - readout.offsetHeight - 8));
    readout.style.left = `${left}px`; readout.style.top = `${top}px`;
  }
  function paint() {
    width = stage.clientWidth; height = stage.clientHeight;
    if (width < 120 || height < 100) return;
    svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
    geometry = buildMarketView(visible(), dates, view.count, view.offset, width, height, {averagePeriod,showSamples});
    svg.dataset.visibleCount = String(view.count); svg.dataset.offset = String(view.offset);
    plot.replaceChildren(); clearCursor();
    if (!geometry) { plot.append(svgNode('text', { x:16, y:height/2 }, '표시할 가격 없음')); return; }
    const { pad, plotWidth, plotHeight, priceTicks, dateTicks, shownSet, x, y } = geometry;
    const edge = pad.left + plotWidth;
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
          const count=line.points.find(point=>point.date===date)?.sampleCount;
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
      const path = marketLinePath(points, x, y, { connectObservations: sold });
      group.append(svgNode('path', {d:path, fill:'none', stroke:line.color, 'stroke-width':sold ? 2 : 2.3, 'stroke-linejoin':'round', ...(sold ? {'stroke-dasharray':'6 5'} : {})}));
      for (const point of points) {
        if (!valid(point.value)) continue;
        group.append(svgNode('circle', {cx:x(point.date), cy:y(point.value), r:singleObservation ? 4 : sold ? (points.length < 80 ? 3.5 : 2.5) : (points.length < 80 ? 2 : 1.5), fill:sold ? 'white' : line.color, stroke:line.color, 'stroke-width':sold ? 1.8 : 0, 'data-date':point.date}));
      }
      plot.append(group);
      const averages=line.averages.filter(point=>shownSet.has(point.date));
      if (averages.some(point=>valid(point.value))) plot.append(svgNode('path',{d:marketLinePath(averages,x,y),fill:'none',stroke:line.color,'stroke-width':2.6,opacity:.5,'stroke-dasharray':'9 4','pointer-events':'none',class:'market-average-line','data-average-series':line.id}));
    }
    if (view.pinned) show(view.pinned);
  }
  const redraw = () => { cancelAnimationFrame(frame); frame = requestAnimationFrame(paint); };
  const reset = () => { view.count=dates.length;view.offset=0;view.pinned=null;paint(); };
  const zoom = (factor, anchor=.5) => {
    const before = view.count, next = clamp(Math.round(before*factor), Math.min(5,dates.length), dates.length);
    const start = dates.length-view.offset-before;
    view.count=next; view.offset=clamp(Math.round(dates.length-(start+anchor*before+(1-anchor)*next)),0,dates.length-next);
    view.pinned=null; paint();
  };
  const pointAtPointer = event => {
    if (!geometry) return null;
    const bounds = svg.getBoundingClientRect(), scaleX = bounds.width/width, scaleY = bounds.height/height;
    if (showSamples && event.clientY-bounds.top>=geometry.sampleTop*scaleY && event.clientY-bounds.top<=geometry.sampleBottom*scaleY) {
      const date=geometry.shownDates.find(date=>Math.abs(event.clientX-bounds.left-geometry.x(date)*scaleX)<=Math.max(6,geometry.step*scaleX/2));
      if (date && visible().some(line=>(line.points.find(point=>point.date===date)?.sampleCount || 0)>0)) return {date,value:null};
    }
    let nearest = null, distance = (event.pointerType === 'touch' ? 20 : 12) ** 2;
    for (const line of visible()) for (const point of line.points) {
      if (!valid(point.value) || !geometry.shownSet.has(point.date)) continue;
      const dx = event.clientX - bounds.left - geometry.x(point.date)*scaleX;
      const dy = event.clientY - bounds.top - geometry.y(point.value)*scaleY;
      const next = dx*dx + dy*dy;
      if (next <= distance) { nearest = point; distance = next; }
    }
    if (nearest) return nearest;
    // Select the calendar date anywhere in the plot; the readout uses actual values only.
    const px = (event.clientX-bounds.left)/scaleX, py = (event.clientY-bounds.top)/scaleY;
    if (px < geometry.pad.left || px > geometry.pad.left+geometry.plotWidth || py < geometry.pad.top || py > (showSamples ? geometry.sampleBottom : geometry.pad.top+geometry.plotHeight)) return null;
    const index = clamp(Math.floor((px-geometry.pad.left)/geometry.step), 0, geometry.shownDates.length-1);
    return {date:geometry.shownDates[index], value:null};
  };
  svg.addEventListener('wheel', event => {
    if (!geometry) return; event.preventDefault();
    if (Math.abs(event.deltaX)>Math.abs(event.deltaY)) { view.offset=clamp(view.offset+Math.trunc(event.deltaX/18),0,dates.length-view.count);paint(); }
    else if(event.deltaY) zoom(event.deltaY<0?.86:1.16,clamp((event.clientX-svg.getBoundingClientRect().left-geometry.pad.left)/geometry.plotWidth,0,1));
  },{passive:false});
  svg.addEventListener('pointerdown', event => {
    if (!geometry || event.button!==0) return;
    drag={id:event.pointerId,x:event.clientX,offset:view.offset,moved:false};svg.setPointerCapture(event.pointerId);
  });
  svg.addEventListener('pointermove', event => {
    if (!geometry) return;
    if (drag && drag.id===event.pointerId) {
      if (Math.abs(drag.x-event.clientX)>4) drag.moved=true;
      if (drag.moved) { view.offset=clamp(drag.offset+Math.round((drag.x-event.clientX)/(geometry.plotWidth/view.count)),0,dates.length-view.count);view.pinned=null;paint();return; }
    }
    if (!drag && !view.pinned && event.pointerType === 'mouse') {
      const point = pointAtPointer(event); if (point) { view.anchorValue=point.value; show(point.date); } else clearCursor();
    }
  });
  stage.addEventListener('pointerleave',()=>{if(!view.pinned)clearCursor();});
  svg.addEventListener('pointerup', event => {
    if (!drag || drag.id!==event.pointerId) return;
    if (!drag.moved) { const point=pointAtPointer(event);view.pinned=point?.date || null;view.anchorValue=point?.value;if(view.pinned)show(view.pinned);else clearCursor(); }
    drag=null;if(svg.hasPointerCapture(event.pointerId))svg.releasePointerCapture(event.pointerId);
  });
  svg.addEventListener('pointercancel',()=>{drag=null;});
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
      view.pinned=dates[activeIndex];paint(); }
  });
  container.addEventListener('chart-reset',reset);
  const dismissOutside = event => { if (!container.contains(event.target)) { view.pinned=null;clearCursor(); } };
  document.addEventListener('pointerdown',dismissOutside);
  readout.addEventListener('keydown',event=>{if(event.key==='Escape'){event.stopPropagation();view.pinned=null;clearCursor();svg.focus({preventScroll:true});}});
  const resize=new ResizeObserver(redraw);resize.observe(stage);paint();
  cleanups.set(container,()=>{resize.disconnect();cancelAnimationFrame(frame);container.removeEventListener('chart-reset',reset);document.removeEventListener('pointerdown',dismissOutside);});
}
