import { SERIES, money } from './pc-tools-core.mjs?v=parts-ux-v4';
const ns = 'http://www.w3.org/2000/svg';
const cleanups = new WeakMap();
const svgNode = (name, attrs = {}, text = '') => {
  const element = document.createElementNS(ns, name);
  Object.entries(attrs).forEach(([key, value]) => element.setAttribute(key, value));
  if (text) element.textContent = text;
  return element;
};

export function drawChart(container, series, { index = false, label = '가격 변화', selectedDate = '', currency = 'KRW', compact = false } = {}) {
  cleanups.get(container)?.();
  container.replaceChildren();
  const points = series.flatMap(s => s.points).filter(p => p.value != null);
  if (!points.length) {
    const empty = document.createElement('p');
    empty.className = 'tools-empty';
    empty.textContent = '가격 자료 없음';
    container.append(empty);
    return;
  }
  const width = Math.max(220, container.clientWidth), height = compact ? 250 : width < 420 ? 260 : 360;
  const left = width < 420 ? 62 : 68, right = width < 420 ? 16 : 24, top = 24, bottom = 42;
  const values = points.map(p => p.value);
  let low = Math.min(...values), high = Math.max(...values);
  const margin = Math.max((high - low) * 0.2, high * 0.025, 1);
  low -= margin; high += margin;
  const dates = [...new Set(series.flatMap(s => s.points.map(p => p.date)))].sort();
  const x = date => left + dates.indexOf(date) / Math.max(1, dates.length - 1) * (width - left - right);
  const y = value => top + (high - value) / (high - low) * (height - top - bottom);
  const svg = svgNode('svg', { viewBox: `0 0 ${width} ${height}`, role: 'img', 'aria-label': `${label} · 일별 대표가격` });
  for (let i = 0; i < 5; i++) {
    const value = low + (high - low) * i / 4;
    svg.append(svgNode('line', { x1: left, x2: width - right, y1: y(value), y2: y(value), stroke: 'var(--line, #e4e8ed)' }));
    svg.append(svgNode('text', { x: left - 10, y: y(value) + 4, 'text-anchor': 'end' }, index ? value.toFixed(1) : currency === 'USD' ? `$${value.toLocaleString('en-US', { maximumFractionDigits: 0 })}` : Math.round(value).toLocaleString('ko-KR')));
  }
  const ticks = width < 420 ? [0, Math.floor((dates.length - 1) / 2), dates.length - 1]
    : [0, Math.floor((dates.length - 1) / 3), Math.floor((dates.length - 1) * 2 / 3), dates.length - 1];
  [...new Set(ticks)].forEach(i => {
    svg.append(svgNode('text', { x: x(dates[i]), y: height - 10, 'text-anchor': 'middle' }, dates[i].slice(5).replace('-', '/')));
  });
  series.forEach(({ key, points }) => {
    const color = key === 'active' ? 'var(--accent-strong, #bd422f)' : key === 'sold' ? 'var(--sold, #357e58)'
      : SERIES.find(s => s.key === key)?.color || '#526071';
    let drawing = false, path = '';
    points.forEach(point => {
      if (point.value == null) { drawing = false; return; }
      path += `${drawing ? 'L' : 'M'}${x(point.date)},${y(point.value)} `;
      drawing = true;
      const dot = svgNode('circle', { cx: x(point.date), cy: y(point.value), r: 3, fill: color });
      dot.append(svgNode('title', {}, `${point.date} ${index ? point.value.toFixed(1) : money(point.value, currency)}`));
      svg.append(dot);
    });
    svg.append(svgNode('path', { d: path, fill: 'none', stroke: color, 'stroke-width': 2, 'stroke-dasharray': key === 'sold' ? '6 3' : key === 'confirmed_transactions' ? '2 3' : 'none' }));
  });
  let current = Math.max(0, dates.indexOf(selectedDate)), pinned = false;
  const guide = svgNode('line', { y1: top, y2: height - bottom, stroke: '#aaa', 'stroke-dasharray': '3 4', visibility: 'hidden' });
  svg.append(guide);
  svg.setAttribute('tabindex', '0');
  svg.setAttribute('aria-label', `${label} · 날짜별 가격: 좌우 방향키로 이동, Escape로 닫기`);
  const plot = document.createElement('div'); plot.className = 'tools-chart-plot'; plot.append(svg);
  const detail = document.createElement('div'); detail.className = 'tools-chart-tooltip'; detail.hidden = true;
  detail.setAttribute('role', 'status'); plot.append(detail);
  const legend = document.createElement('div'); legend.className = 'tools-chart-legend';
  series.forEach(({ key }) => {
    const item = document.createElement('span'); item.className = `series-${key}`;
    item.textContent = `● ${SERIES.find(s => s.key === key).label} (${currency})`; legend.append(item);
  });
  container.append(plot, legend);
  const hide = () => { pinned = false; detail.hidden = true; guide.setAttribute('visibility', 'hidden'); };
  const show = i => {
    current = Math.max(0, Math.min(dates.length - 1, i));
    const date = dates[current]; detail.replaceChildren();
    const time = document.createElement('time'); time.dateTime = date; time.textContent = date; detail.append(time);
    series.forEach(({ key, points }) => {
      const value = points.find(p => p.date === date)?.value;
      const row = document.createElement('div'); row.className = `series-${key}`;
      row.textContent = `${SERIES.find(s => s.key === key).label} ${value == null ? '—' : money(value, currency)}`; detail.append(row);
    });
    guide.setAttribute('x1', x(date)); guide.setAttribute('x2', x(date)); guide.setAttribute('visibility', 'visible');
    detail.hidden = false;
    const px = x(date) / width * svg.clientWidth;
    detail.style.left = `${Math.max(container.scrollLeft + 8, Math.min(px + 12, container.scrollLeft + container.clientWidth - detail.offsetWidth - 8))}px`;
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
  cleanups.set(container, () => document.removeEventListener('pointerdown', outside));
}
