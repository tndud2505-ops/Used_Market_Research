// Shared, DOM-independent rules for the builder and price analysis.
export const SERIES = [
  { key: 'active', label: '판매중 평균', color: '#bd422f' },
  { key: 'sold', label: '판매완료 표시가', color: '#357e58' },
  { key: 'confirmed_transactions', label: '확인 거래가', color: '#477dae' },
];
export const idOf = p => String(p?.canonical_product_id || '');
export const nameOf = p => String(p?.canonical_display_name || '모델 미확인');
export const naturalCompare = (a, b) => String(a).localeCompare(String(b), 'ko', { numeric: true, sensitivity: 'base' });
export const money = value => value == null || !Number.isFinite(value) ? '자료 없음' : `${Math.round(value).toLocaleString('ko-KR')}원`;
export function metricValue(metric) {
  if (!(Number(metric?.sample_count) > 0) || typeof metric?.mean !== 'number'
    || !Number.isFinite(metric.mean) || metric.mean <= 0) return null;
  if (typeof metric.min === 'number' && metric.mean < metric.min) return null;
  if (typeof metric.max === 'number' && metric.mean > metric.max) return null;
  return metric.mean;
}
export function normalizedName(value) {
  return String(value || '').normalize('NFKC').trim().replace(/\s+/g, ' ').toUpperCase();
}
export function productGroup(p) {
  const s = p.key_specs || {};
  if (p.category_code === 'GPU' && s.gpu_model) {
    const ram = s.vram_gb ?? s.vram_options_gb;
    return `${normalizedName(s.gpu_model)}${ram ? ` · ${[].concat(ram).join('/')}GB` : ''}`;
  }
  return nameOf(p);
}
export function groupProducts(products, grouped = true) {
  const map = new Map();
  for (const product of products) {
    const label = productGroup(product);
    // Category and specifications remain part of identity; similar names are never fuzzy-merged.
    const key = grouped ? `${product.category_code}:${normalizedName(label)}` : idOf(product);
    if (!map.has(key)) map.set(key, { key, label: grouped ? label : nameOf(product), products: [] });
    if (!map.get(key).products.some(p => idOf(p) === idOf(product))) map.get(key).products.push(product);
  }
  return [...map.values()].sort((a, b) => naturalCompare(a.label, b.label))
    .map(group => ({ ...group, products: group.products.sort((a, b) => naturalCompare(nameOf(a), nameOf(b))) }));
}
export function scopedStats(data, manufacturer = '') {
  if (!manufacturer) return data;
  const row = data?.by_manufacturer?.find(row => row.manufacturer === manufacturer);
  return row ? { ...row, as_of: data.as_of, window: data.window } : null;
}
export const sourceId = row => String(row?.source_id || row?.site || row?.source || '');
export function sourceStats(data, source = '') {
  if (!source) return data;
  const row = data?.by_source?.find(row => sourceId(row) === source);
  return row ? { ...row, as_of: data.as_of, window: data.window } : null;
}
// Match the existing marketplace's exclusion of internally inconsistent source summaries.
export function coherentStats(data) {
  if (!data) return data;
  const sampled = row => ['active', 'sold'].filter(key => Number(row?.[key]?.sample_count) > 0);
  const rows = (data.by_source || []).filter(row => sampled(row).length || row.daily?.some(day => sampled(day).length));
  if (!rows.length) return data;
  const valid = rows.filter(row => sampled(row).length && sampled(row).every(key => metricValue(row[key]) != null));
  if (valid.length === rows.length) return data;
  const combine = (rows, key) => {
    const metrics = rows.map(row => row[key]).filter(metric => metricValue(metric) != null);
    const count = metrics.reduce((sum, metric) => sum + Number(metric.sample_count), 0);
    return { sample_count: count, mean: count ? metrics.reduce((sum, metric) => sum + metric.mean * Number(metric.sample_count), 0) / count : null };
  };
  const days = new Map();
  valid.forEach(row => (row.daily || []).forEach(day => {
    const date = String(day.date || day.stat_date).slice(0, 10);
    if (!days.has(date)) days.set(date, []);
    days.get(date).push(day);
  }));
  return { ...data, active: combine(valid, 'active'), sold: combine(valid, 'sold'), by_source: valid,
    // Manufacturer totals cannot be assigned to the remaining sources without joint evidence.
    by_manufacturer: [], integrity_filtered_source_count: rows.length - valid.length,
    daily: [...days].sort(([a], [b]) => a.localeCompare(b)).map(([date, rows]) => ({ date, active: combine(rows, 'active'), sold: combine(rows, 'sold') })) };
}
export function shiftDate(date, amount, unit = 'day') {
  const value = new Date(`${date}T00:00:00Z`);
  if (unit === 'month') {
    const day = value.getUTCDate();
    value.setUTCDate(1); value.setUTCMonth(value.getUTCMonth() + amount);
    value.setUTCDate(Math.min(day, new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth() + 1, 0)).getUTCDate()));
  } else value.setUTCDate(value.getUTCDate() + amount);
  return value.toISOString().slice(0, 10);
}
export function historyWindow(anchor = '', today = new Date().toISOString().slice(0, 10)) {
  const earliest = shiftDate(today, -700);
  const end = anchor ? anchor < earliest ? earliest : anchor > today ? today : anchor : today;
  return { from: shiftDate(end, -29), to: end, earliest, latest: today, previous: end > earliest, next: end < today };
}
export function chartDateSelection(date, anchor = '', today = new Date().toISOString().slice(0, 10)) {
  const window = historyWindow(anchor, today);
  const timestamp = Date.parse(`${date}T00:00:00Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(timestamp)
    || new Date(timestamp).toISOString().slice(0, 10) !== date
    || date < shiftDate(window.earliest, -29) || date > today) throw new Error('최근 2년 안의 날짜를 선택하세요.');
  if (date >= window.from && date <= window.to) return { date, anchor };
  const end = historyWindow(date, today).to;
  return { date, anchor: end === today ? '' : end };
}
export function modelPageItems(page, count) {
  if (count <= 7) return Array.from({ length: count }, (_, i) => i + 1);
  const start = Math.max(1, Math.min(count - 4, page - 2));
  const pages = [...new Set([1, ...Array.from({ length: 5 }, (_, i) => start + i), count])].sort((a, b) => a - b);
  return pages.flatMap((n, i) => i && n > pages[i - 1] + 1 ? ['ellipsis', n] : [n]);
}
export function buildTotals(entries, getStats) {
  return Object.fromEntries(SERIES.map(({ key }) => {
    let sum = 0, covered = 0;
    for (const entry of entries) {
      const value = metricValue(getStats(entry)?.[key]);
      if (value != null) { sum += value * entry.quantity; covered++; }
    }
    return [key, { amount: covered ? sum : null, covered, total: entries.length, complete: entries.length > 0 && covered === entries.length }];
  }));
}
export function compatibility(entries, products) {
  const byCategory = new Map(entries.map(e => [products.get(e.id)?.category_code || e.category, products.get(e.id)]));
  const cpu = byCategory.get('CPU')?.key_specs;
  const board = byCategory.get('MOTHERBOARD')?.key_specs;
  const ram = byCategory.get('RAM')?.key_specs;
  const checks = [];
  if (cpu && board) {
    checks.push(cpu.socket && board.socket
      ? { label: 'CPU·메인보드 소켓', status: normalizedName(cpu.socket) === normalizedName(board.socket) ? 'match' : 'conflict', detail: `${cpu.socket} / ${board.socket}` }
      : { label: 'CPU·메인보드 소켓', status: 'unknown', detail: '세부 사양 필요' });
  }
  if (board && ram) {
    const a = board.memory_generation, b = ram.memory_generation || ram.generation;
    checks.push(a && b
      ? { label: '메모리 규격', status: normalizedName(a) === normalizedName(b) ? 'match' : 'conflict', detail: `${a} / ${b}` }
      : { label: '메모리 규격', status: 'unknown', detail: '세부 사양 필요' });
  }
  return { checks, conflict: checks.some(c => c.status === 'conflict'), note: 'BIOS·크기·전원 커넥터는 별도 확인이 필요합니다.' };
}
export function validateBuild(input, products, categories) {
  if (!Array.isArray(input) || input.length > 20) throw new Error('조합 형식이 올바르지 않습니다.');
  const used = new Set();
  return input.map(e => {
    if (!e || typeof e !== 'object' || !products.has(e.id)) throw new Error('등록되지 않은 모델입니다.');
    const category = products.get(e.id).category_code;
    if (!categories.has(category) || used.has(category)) throw new Error('같은 부품 종류가 중복되었습니다.');
    used.add(category);
    const quantity = Number(e.quantity ?? 1);
    if (!Number.isInteger(quantity) || quantity < 1 || quantity > 16) throw new Error('수량은 1~16개여야 합니다.');
    const manufacturer = typeof e.manufacturer === 'string' ? e.manufacturer.trim() : '';
    if (manufacturer.length > 120) throw new Error('제조사 값이 너무 깁니다.');
    return { id: e.id, quantity, manufacturer, category };
  });
}
export function dailySeries(data, key, days = 30) {
  const rows = Array.isArray(data?.daily) ? data.daily : [];
  const date = String(data?.window?.to || data?.as_of || rows.at(-1)?.date || rows.at(-1)?.stat_date || '').slice(0, 10);
  const end = Date.parse(`${date}T00:00:00Z`);
  if (!Number.isFinite(end)) return [];
  const start = end - (days - 1) * 86400000;
  const map = new Map(rows.map(row => [String(row.date || row.stat_date).slice(0, 10), metricValue(row[key])]));
  return Array.from({ length: days }, (_, i) => {
    const day = new Date(start + i * 86400000).toISOString().slice(0, 10);
    return { date: day, value: map.get(day) ?? null };
  });
}
export function percentChange(points) {
  if (!points.length || points[0].value == null || points.at(-1).value == null) return null;
  return (points.at(-1).value / points[0].value - 1) * 100;
}
// Equal-model index: fixed constituents with both endpoints; raw prices of unlike parts are not averaged.
export function overviewIndex(datasets, key, days) {
  const series = datasets.map(data => dailySeries(data, key, days));
  const usable = series.filter(points => points.length && points[0].value != null && points.at(-1).value != null);
  if (!usable.length) return { points: [], covered: 0, total: datasets.length };
  const dates = usable[0].map(p => p.date);
  const aligned = usable.filter(points => points.every((p, i) => p.date === dates[i]));
  return { covered: aligned.length, total: datasets.length, points: dates.map((date, i) => ({
    date, value: aligned.every(points => points[i].value != null)
      ? aligned.reduce((sum, points) => sum + points[i].value / points[0].value * 100, 0) / aligned.length : null,
  })) };
}
