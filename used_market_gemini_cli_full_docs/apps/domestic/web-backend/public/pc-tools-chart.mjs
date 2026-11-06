import { SERIES, money } from './pc-tools-core.mjs?v=parts-ux-v10';
const ns = 'http://www.w3.org/2000/svg';
const cleanups = new WeakMap();
const hiddenSeries = new WeakMap();
const svgNode = (name, attrs = {}, text = '') => {
  const element = document.createElementNS(ns, name);
  Object.entries(attrs).forEach(([key, value]) => element.setAttribute(key, value));
  if (text) element.textContent = text;
  return element;
};

export function drawChart(container, series, { index = false, label = '가격 변화', selectedDate = '', currency = 'KRW', compact = false, zoomX = 1, zoomY = 1, scrollable = false, onZoom } = {}) {
  const previousViewport = container.querySelector('.tools-chart-viewport');
  const scrollPosition = { left: previousViewport?.scrollLeft || 0, top: previousViewport?.scrollTop || 0 };
  cleanups.get(container)?.();
  container.replaceChildren();
  const hidden = hiddenSeries.get(container) || new Set();
  hiddenSeries.set(container, hidden);
  const normalizedSeries = series.map(item => {
    const metricKey = item.metricKey || item.key;
    const metric = SERIES.find(candidate => candidate.key === metricKey);
    return {
      ...item,
      id: item.id || item.key,
      currency: item.currency || currency,
      metricKey,
      label: item.label || metric?.label || metricKey,
      color: item.color || (metricKey === 'active' ? 'var(--accent-strong, #bd422f)'
        : metricKey === 'sold' ? 'var(--sold, #357e58)' : metric?.color || '#526071'),
      dash: item.dash ?? (metricKey === 'sold' ? '6 3' : metricKey === 'confirmed_transactions' ? '2 3' : 'none'),
    };
  }).filter(item => item.points.some(point => point.value != null));
  const points = normalizedSeries.flatMap(s => s.points).filter(p => p.value != null);
  if (!points.length) {
    const empty = document.createElement('p');
    empty.className = 'tools-empty';
    empty.textContent = '가격 자료 없음';
    container.append(empty);
    return;
  }
  const width = Math.max(220, container.clientWidth - (scrollable ? 18 : 0)) * zoomX;
  const height = (scrollable ? 342 : compact ? 250 : width < 420 ? 260 : 360) * zoomY;
  const currencies = [...new Set(normalizedSeries.map(item => item.currency))];
  const left = 68, right = currencies.length > 1 ? 70 : 24, top = 28, bottom = 42;
  const ranges = new Map(currencies.map(code => {
    const values = normalizedSeries.filter(item => item.currency === code).flatMap(item => item.points)
      .filter(point => point.value != null).map(point => point.value);
    let low = Math.min(...values), high = Math.max(...values);
    const margin = Math.max((high - low) * 0.2, high * 0.025, 1);
    return [code, { low: low - margin, high: high + margin }];
  }));
  const dates = [...new Set(normalizedSeries.flatMap(s => s.points.map(p => p.date)))].sort();
  const x = date => left + dates.indexOf(date) / Math.max(1, dates.length - 1) * (width - left - right);
  const y = (value, code = currencies[0]) => {
    const { low, high } = ranges.get(code);
    return top + (high - value) / (high - low) * (height - top - bottom);
  };
  const svg = svgNode('svg', { viewBox: `0 0 ${width} ${height}`, role: 'img', 'aria-label': `${label} · 일별 대표가격` });
  if (scrollable) { svg.style.width = `${width}px`; svg.style.height = `${height}px`; }
  const grid = svgNode('g', { 'aria-hidden': 'true' }); svg.append(grid);
  const { low, high } = ranges.get(currencies[0]);
  for (let i = 0; i < 5; i++) {
    const value = low + (high - low) * i / 4;
    grid.append(svgNode('line', { x1: left, x2: width - right, y1: y(value), y2: y(value), stroke: 'var(--line, #e4e8ed)' }));
    if (!scrollable) currencies.forEach((code, axis) => {
      const range = ranges.get(code), tick = range.low + (range.high - range.low) * i / 4;
      svg.append(svgNode('text', { x: axis ? width - right + 10 : left - 10, y: y(tick, code) + 4, 'text-anchor': axis ? 'start' : 'end' }, index ? tick.toFixed(1) : code === 'USD' ? `$${tick.toLocaleString('en-US', { maximumFractionDigits: 1 })}` : Math.round(tick).toLocaleString('ko-KR')));
    });
  }
  if (!scrollable) currencies.forEach((code, axis) => svg.append(svgNode('text', { x: axis ? width - right + 10 : left - 10, y: 14, 'text-anchor': axis ? 'start' : 'end' }, code)));
  const ticks = width < 420 ? [0, Math.floor((dates.length - 1) / 2), dates.length - 1]
    : [0, Math.floor((dates.length - 1) / 3), Math.floor((dates.length - 1) * 2 / 3), dates.length - 1];
  if (!scrollable) [...new Set(ticks)].forEach(i => {
    svg.append(svgNode('text', { x: x(dates[i]), y: height - 10, 'text-anchor': 'middle' }, dates[i].slice(5).replace('-', '/')));
  });
  const groups = new Map();
  normalizedSeries.forEach(({ id, metricKey, label: seriesLabel, color, dash, points, currency: seriesCurrency }) => {
    const group = svgNode('g', { 'data-series': id });
    group.style.display = hidden.has(id) ? 'none' : '';
    groups.set(id, group);
    let drawing = false, path = '';
    points.forEach(point => {
      if (point.value == null) { drawing = false; return; }
      path += `${drawing ? 'L' : 'M'}${x(point.date)},${y(point.value, seriesCurrency)} `;
      drawing = true;
      const dot = metricKey === 'sold'
        ? svgNode('rect', { x: x(point.date) - 4, y: y(point.value, seriesCurrency) - 4, width: 8, height: 8, fill: color })
        : svgNode('circle', { cx: x(point.date), cy: y(point.value, seriesCurrency), r: 3, fill: color });
      dot.append(svgNode('title', {}, `${seriesLabel} · ${point.date} ${index ? point.value.toFixed(1) : money(point.value, seriesCurrency)}`));
      group.append(dot);
    });
    group.append(svgNode('path', { d: path, fill: 'none', stroke: color, 'stroke-width': 2, 'stroke-dasharray': dash, 'data-metric': metricKey }));
    svg.append(group);
  });
  let current = Math.max(0, dates.indexOf(selectedDate)), pinned = false;
  const guide = svgNode('line', { y1: top, y2: height - bottom, stroke: '#aaa', 'stroke-dasharray': '3 4', visibility: 'hidden' });
  svg.append(guide);
  svg.setAttribute('tabindex', '0');
  svg.setAttribute('aria-label', `${label} · 날짜별 가격: 좌우 방향키로 이동, Escape로 닫기`);
  const plot = document.createElement('div'); plot.className = 'tools-chart-plot'; plot.append(svg);
  const viewport = document.createElement('div'); viewport.className = 'tools-chart-viewport';
  viewport.setAttribute('tabindex', '0'); viewport.setAttribute('aria-label', '차트 가로 세로 스크롤');
  viewport.append(plot);
  if (scrollable) plot.style.width = `${width}px`;
  const detail = document.createElement('div'); detail.className = 'tools-chart-tooltip'; detail.hidden = true;
  detail.setAttribute('role', 'status'); plot.append(detail);
  const legend = document.createElement('div'); legend.className = 'tools-chart-legend';
  normalizedSeries.forEach(({ id, metricKey, label: seriesLabel, color, dash, currency: seriesCurrency }) => {
    const item = document.createElement('button'); item.type = 'button'; item.className = `series-${metricKey}`;
    item.dataset.series = id;
    item.setAttribute('aria-pressed', String(!hidden.has(id)));
    item.title = '클릭하여 그래프 숨기기 / 표시';
    item.addEventListener('click', () => {
      if (hidden.has(id)) hidden.delete(id); else hidden.add(id);
      groups.get(id).style.display = hidden.has(id) ? 'none' : '';
      item.setAttribute('aria-pressed', String(!hidden.has(id)));
      hide();
    });
    item.style.color = color;
    const swatch = document.createElement('i'); swatch.className = 'tools-chart-swatch';
    swatch.style.setProperty('--series-color', color); swatch.dataset.dash = dash === 'none' ? 'solid' : 'dashed';
    item.append(swatch, document.createTextNode(`${seriesLabel} (${seriesCurrency})`)); legend.append(item);
  });
  const frame = document.createElement('div'); frame.className = 'tools-chart-frame'; frame.append(viewport);
  const axes = svgNode('svg', { class: 'tools-chart-fixed-axes', 'aria-label': '고정 날짜·가격 축' });
  if (scrollable) frame.append(axes);
  container.append(frame, legend);
  const updateAxes = () => {
    if (!scrollable) return;
    const w = viewport.clientWidth, h = viewport.clientHeight;
    axes.style.width = `${w}px`; axes.style.height = `${h}px`;
    axes.setAttribute('viewBox', `0 0 ${w} ${h}`); axes.replaceChildren();
    grid.replaceChildren();
    for (let i = 0; i < 5; i++) {
      const gy = viewport.scrollTop + top + (h - top - bottom) * i / 4;
      grid.append(svgNode('line', { x1: left, x2: width - right, y1: gy, y2: gy, stroke: 'var(--line, #e4e8ed)' }));
    }
    for (const [rx, ry, rw, rh, axis] of [[0, 0, left, h - bottom, 'y'], [w - right, 0, right, h - bottom, 'y'], [0, h - bottom, w, bottom, 'x']]) {
      const hit = svgNode('rect', { x: rx, y: ry, width: rw, height: rh, fill: 'var(--surface, #fff)', 'data-zoom-axis': axis, tabindex: 0, role: 'button', 'aria-label': `${axis === 'x' ? '날짜' : '가격'}축 확대·축소` });
      hit.style.pointerEvents = 'all'; hit.style.cursor = axis === 'x' ? 'ew-resize' : 'ns-resize';
      hit.append(svgNode('title', {}, '휠로 확대·축소 · 두 번 클릭하면 초기화'));
      hit.addEventListener('wheel', event => {
        if (!onZoom || !event.deltaY) return;
        event.preventDefault(); event.stopPropagation();
        const rect = axes.getBoundingClientRect();
        onZoom(axis, Math.exp(-Math.sign(event.deltaY) * 0.16), axis === 'x' ? event.clientX - rect.left : event.clientY - rect.top);
      }, { passive: false });
      hit.addEventListener('dblclick', () => onZoom?.(axis, 0));
      hit.addEventListener('keydown', event => {
        if (!['ArrowUp', 'ArrowRight', 'ArrowDown', 'ArrowLeft', 'Home', 'Enter', ' '].includes(event.key)) return;
        event.preventDefault();
        onZoom?.(axis, ['Home', 'Enter', ' '].includes(event.key) ? 0 : ['ArrowUp', 'ArrowRight'].includes(event.key) ? 1.2 : 1 / 1.2);
      });
      axes.append(hit);
    }
    currencies.forEach((code, axis) => {
      const range = ranges.get(code), tx = axis ? w - right + 10 : left - 10;
      axes.append(svgNode('text', { x: tx, y: 14, 'text-anchor': axis ? 'start' : 'end' }, code));
      for (let i = 0; i < 5; i++) {
        const py = top + (h - top - bottom) * i / 4;
        const value = range.high - (py + viewport.scrollTop - top) / (height - top - bottom) * (range.high - range.low);
        const text = index ? value.toFixed(1) : code === 'USD' ? `$${value.toLocaleString('en-US', { maximumFractionDigits: 1 })}` : Math.round(value).toLocaleString('ko-KR');
        axes.append(svgNode('text', { x: tx, y: py + 4, 'text-anchor': axis ? 'start' : 'end' }, text));
      }
    });
    const visibleDates = new Set();
    for (let i = 0; i < (w < 420 ? 3 : 4); i++) {
      const px = left + (w - left - right) * i / (w < 420 ? 2 : 3);
      const day = Math.max(0, Math.min(dates.length - 1, Math.round((px + viewport.scrollLeft - left) / (width - left - right) * (dates.length - 1))));
      if (visibleDates.has(day)) continue;
      visibleDates.add(day);
      const dx = x(dates[day]) - viewport.scrollLeft;
      if (dx >= left - 1 && dx <= w - right + 1) axes.append(svgNode('text', { x: dx, y: h - 12, 'text-anchor': 'middle' }, dates[day].slice(5).replace('-', '/')));
    }
  };
  viewport.addEventListener('scroll', updateAxes, { passive: true });
  viewport.scrollTo(scrollPosition);
  updateAxes();
  const resize = typeof ResizeObserver === 'function' ? new ResizeObserver(updateAxes) : null;
  resize?.observe(viewport);
  const hide = () => { pinned = false; detail.hidden = true; guide.setAttribute('visibility', 'hidden'); };
  const show = i => {
    current = Math.max(0, Math.min(dates.length - 1, i));
    const date = dates[current]; detail.replaceChildren();
    const time = document.createElement('time'); time.dateTime = date; time.textContent = date; detail.append(time);
    normalizedSeries.filter(item => !hidden.has(item.id)).forEach(({ metricKey, label: seriesLabel, color, points, currency: seriesCurrency }) => {
      const value = points.find(p => p.date === date)?.value;
      const row = document.createElement('div'); row.className = `series-${metricKey}`;
      row.style.color = color;
      row.textContent = `${seriesLabel} ${value == null ? '—' : money(value, seriesCurrency)}`; detail.append(row);
    });
    guide.setAttribute('x1', x(date)); guide.setAttribute('x2', x(date)); guide.setAttribute('visibility', 'visible');
    detail.hidden = false;
    const px = x(date) / width * svg.clientWidth;
    detail.style.left = `${Math.max(viewport.scrollLeft + 8, Math.min(px + 12, viewport.scrollLeft + viewport.clientWidth - detail.offsetWidth - 8))}px`;
    detail.style.top = `${viewport.scrollTop + 32}px`;
  };
  const atPointer = event => {
    const rect = svg.getBoundingClientRect();
    return Math.round(((event.clientX - rect.left) / rect.width * width - left) / (width - left - right) * (dates.length - 1));
  };
  svg.addEventListener('pointermove', event => { if (!pinned && event.pointerType === 'mouse') show(atPointer(event)); });
  svg.addEventListener('pointerleave', () => { if (!pinned) hide(); });
  svg.addEventListener('click', event => { pinned = true; show(atPointer(event)); });
  svg.addEventListener('keydown', event => {
    if (event.key === 'Escape') hide();
    else if (['ArrowLeft', 'ArrowRight', 'Enter', ' '].includes(event.key)) {
      event.preventDefault(); pinned = true; show(current + (event.key === 'ArrowLeft' ? -1 : event.key === 'ArrowRight' ? 1 : 0));
    }
  });
  const outside = event => { if (!plot.contains(event.target)) hide(); };
  document.addEventListener('pointerdown', outside);
  cleanups.set(container, () => { document.removeEventListener('pointerdown', outside); resize?.disconnect(); });
}
