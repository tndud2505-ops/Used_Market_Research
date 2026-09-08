import { SERIES, money } from './pc-tools-core.mjs?v=7';
const ns = 'http://www.w3.org/2000/svg';
const svgNode = (name, attrs = {}, text = '') => {
  const element = document.createElementNS(ns, name);
  Object.entries(attrs).forEach(([key, value]) => element.setAttribute(key, value));
  if (text) element.textContent = text;
  return element;
};

export function drawChart(container, series, { index = false, label = '가격 변화', selectedDate = '', onSelect } = {}) {
  const dateFocused = container.contains(document.activeElement) && document.activeElement?.getAttribute('aria-label') === '차트 날짜';
  container.replaceChildren();
  const points = series.flatMap(s => s.points).filter(p => p.value != null);
  if (!points.length) {
    const empty = document.createElement('p');
    empty.className = 'tools-empty';
    empty.textContent = '선택한 범위의 가격 기록이 없습니다.';
    container.append(empty);
    return;
  }
  const width = 800, height = 300, left = 78, right = 24, top = 24, bottom = 42;
  const values = points.map(p => p.value);
  let low = Math.min(...values), high = Math.max(...values);
  const margin = Math.max((high - low) * 0.2, high * 0.025, 1);
  low -= margin; high += margin;
  const dates = [...new Set(series.flatMap(s => s.points.map(p => p.date)))].sort();
  const x = date => left + dates.indexOf(date) / Math.max(1, dates.length - 1) * (width - left - right);
  const y = value => top + (high - value) / (high - low) * (height - top - bottom);
  const svg = svgNode('svg', { viewBox: `0 0 ${width} ${height}`, role: 'img', 'aria-label': `${label}. 날짜별 수치는 아래에서 확인할 수 있습니다.` });
  for (let i = 0; i < 5; i++) {
    const value = low + (high - low) * i / 4;
    svg.append(svgNode('line', { x1: left, x2: width - right, y1: y(value), y2: y(value), stroke: '#e5ddd2' }));
    svg.append(svgNode('text', { x: left - 10, y: y(value) + 4, 'text-anchor': 'end' }, index ? value.toFixed(1) : Math.round(value).toLocaleString('ko-KR')));
  }
  [...new Set([0, Math.floor((dates.length - 1) / 3), Math.floor((dates.length - 1) * 2 / 3), dates.length - 1])].forEach(i => {
    svg.append(svgNode('text', { x: x(dates[i]), y: height - 10, 'text-anchor': 'middle' }, dates[i].slice(5).replace('-', '/')));
  });
  series.forEach(({ key, points }) => {
    const color = SERIES.find(s => s.key === key)?.color || '#655d54';
    let drawing = false, path = '';
    points.forEach(point => {
      if (point.value == null) { drawing = false; return; }
      path += `${drawing ? 'L' : 'M'}${x(point.date)},${y(point.value)} `;
      drawing = true;
      const dot = svgNode('circle', { cx: x(point.date), cy: y(point.value), r: 3, fill: color });
      dot.append(svgNode('title', {}, `${point.date} ${index ? point.value.toFixed(1) : money(point.value)}`));
      svg.append(dot);
    });
    svg.append(svgNode('path', { d: path, fill: 'none', stroke: color, 'stroke-width': 2, 'stroke-dasharray': key === 'sold' ? '6 3' : key === 'confirmed_transactions' ? '2 3' : 'none' }));
  });
  const date = dates.includes(selectedDate) ? selectedDate : dates.at(-1);
  svg.append(svgNode('line', { x1: x(date), x2: x(date), y1: top, y2: height - bottom, stroke: '#aaa', 'stroke-dasharray': '3 4' }));
  container.append(svg);
  const detail = document.createElement('div'); detail.className = 'tools-chart-detail';
  const control = document.createElement('label'); control.textContent = '날짜 ';
  const select = document.createElement('select'); select.setAttribute('aria-label', '차트 날짜');
  dates.forEach(day => { const option = document.createElement('option'); option.value = day; option.textContent = day; option.selected = day === date; select.append(option); });
  select.addEventListener('change', () => onSelect?.(select.value));
  control.append(select); detail.append(control);
  series.forEach(({ key, points }) => {
    const definition = SERIES.find(s => s.key === key);
    const value = points.find(p => p.date === date)?.value;
    const span = document.createElement('span'); span.className = `series-${key}`;
    span.textContent = `${definition.label} ${value == null ? '자료 없음' : index ? value.toFixed(1) : money(value)}`;
    detail.append(span);
  });
  container.append(detail);
  if (dateFocused) select.focus({ preventScroll: true });
}
