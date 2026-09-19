// Shared, DOM-independent rules for the builder and price analysis.
export const SERIES = [
  { key: 'active', label: '판매중 가격', color: '#bd422f' },
  { key: 'sold', label: '판매완료 표시가', color: '#357e58' },
  { key: 'confirmed_transactions', label: '확인 거래가', color: '#477dae' },
];
export const idOf = p => String(p?.canonical_product_id || '');
export const nameOf = p => String(p?.canonical_display_name || '모델 미확인');
export const naturalCompare = (a, b) => String(a).localeCompare(String(b), 'ko', { numeric: true, sensitivity: 'base' });
export const money = (value, currency = 'KRW') => {
  if (value == null || !Number.isFinite(value)) return '자료 없음';
  const code = String(currency || 'KRW').toUpperCase();
  if (code === 'KRW') return `${Math.round(value).toLocaleString('ko-KR')}원`;
  if (code === 'USD') return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 2 }).format(value);
  return `${Number(value).toLocaleString('ko-KR')} ${code}`;
};
export function metricValue(metric) {
  // A partial aggregate is not a published representative, even when a stale
  // or diagnostic central value is present in the response.
  if (metric?.aggregate_incomplete === true) return null;
  const count = Number(metric?.sample_count);
  if (!Number.isInteger(count) || !(count >= 3) || !metricIsConsistent(metric)) return null;
  for (const key of count < 5 ? ['median'] : ['mean', 'median', 'average']) {
    const value = metric?.[key];
    if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) continue;
    if (typeof metric.min === 'number' && value < metric.min) continue;
    if (typeof metric.max === 'number' && value > metric.max) continue;
    return value;
  }
  return null;
}
export function metricPresentation(metric, seriesKey = 'active', currency = 'KRW') {
  const count = Number(metric?.sample_count || 0);
  if (metric?.aggregate_incomplete === true) return { text: '집계 준비 중', label: '정확 집계·게시 미완료', empty: true, state: 'incomplete' };
  const value = metricValue(metric);
  if (value != null) return {
    text: money(value, currency),
    label: count < 5 ? '중앙값' : metric?.mean === value || metric?.average === value ? '평균' : '중앙값',
    empty: false, state: 'ready',
  };
  if (count >= 3 || !Number.isInteger(count) || count < 0 || (metric && !metricIsConsistent(metric))) {
    return { text: '집계 확인 필요', label: '표본 부족이 아닌 통계 오류', empty: true, state: 'invalid' };
  }
  const minimum = Number(metric?.min), maximum = Number(metric?.max);
  if (count > 0 && Number.isFinite(minimum) && minimum > 0 && Number.isFinite(maximum) && maximum >= minimum) {
    const wording = seriesKey === 'sold' ? { single: '표시', label: '표시가' }
      : seriesKey === 'confirmed_transactions' ? { single: '확인', label: '거래가' } : { single: '등록', label: '등록가' };
    return { text: minimum === maximum ? `${wording.single} ${money(minimum, currency)}` : `${money(minimum, currency)}~${money(maximum, currency)}`,
      label: `${wording.label} ${count}건 · 대표가격 없음`, empty: false, state: 'insufficient' };
  }
  return { text: '—', label: count > 0 ? '표본 부족 · 대표가격 없음' : '가격 자료 없음', empty: true, state: count > 0 ? 'insufficient' : 'missing' };
}
export function statsUnavailable(data) {
  // Runner and Worker expose uppercase and legacy lowercase readiness states.
  // Missing publication is unknown coverage, not proof of zero market samples.
  const status = String(data?.availability?.status || '').toUpperCase();
  return status === 'UNAVAILABLE' || status === 'NO_EXACT_PUBLICATION' || data?.aggregate_incomplete === true;
}
export function priceRecordIssue(record, data = record?.data) {
  if (record?.state === 'error') return `가격 조회 실패 · ${record.error || '다시 시도해 주세요.'}`;
  if (record?.state === 'loading' || !record) return '가격 자료 확인 중';
  if (statsUnavailable(record?.data) || statsUnavailable(data)) {
    const code = data?.availability?.code || record?.data?.availability?.code || '';
    if (['HISTORICAL_PRICE_STATS_UNAVAILABLE', 'HISTORICAL_EXACT_STATS_UNAVAILABLE'].includes(code)) {
      return '선택 기간의 정확 통계가 게시되지 않았습니다. 현재 기간의 가격으로 대체하지 않습니다.';
    }
    return '공개 통계 미제공 · 표본 부족 여부를 확인할 수 없습니다.';
  }
  if (!data) return '선택한 사이트·제조사의 통계가 제공되지 않았습니다.';
  if (['active', 'sold'].some(key => metricPresentation(data[key]).state === 'incomplete')) {
    return '정확 집계·게시 준비 중입니다. 현재 숫자는 완성된 고유 매물 표본 수가 아니므로 대표가격과 구분합니다.';
  }
  if (['active', 'sold'].some(key => metricPresentation(data[key]).state === 'invalid')) {
    return '통계 집계값 확인이 필요합니다. 실제 시장 표본 부족으로 판정하지 않습니다.';
  }
  return '';
}
export function analysisSelectionUrl(href, id = '', manufacturer = '') {
  const url = new URL(href);
  if (id) url.searchParams.set('model', id); else url.searchParams.delete('model');
  if (id && manufacturer) url.searchParams.set('manufacturer', manufacturer); else url.searchParams.delete('manufacturer');
  return url.href;
}
export function metricIsConsistent(metric) {
  const count = Number(metric?.sample_count || 0);
  if (count <= 0) return metric?.mean == null && metric?.median == null && metric?.average == null;
  const minimum = metric?.min == null ? null : Number(metric.min);
  const maximum = metric?.max == null ? null : Number(metric.max);
  const mean = metric?.mean == null ? null : Number(metric.mean);
  const median = metric?.median == null ? null : Number(metric.median);
  const average = metric?.average == null ? null : Number(metric.average);
  const central = mean ?? median ?? average;
  if (count >= 5 && metric?.aggregate_incomplete !== true && (!Number.isFinite(central) || central <= 0)) return false;
  if (mean !== null && (!Number.isFinite(mean) || mean <= 0)) return false;
  if (count >= 3 && count < 5 && metric?.aggregate_incomplete !== true && (!Number.isFinite(median) || median <= 0)) return false;
  if (median !== null && (!Number.isFinite(median) || median <= 0)) return false;
  if (average !== null && (!Number.isFinite(average) || average <= 0)) return false;
  if (Number.isFinite(minimum) && Number.isFinite(maximum) && minimum > maximum) return false;
  if (Number.isFinite(mean) && Number.isFinite(minimum) && mean < minimum) return false;
  if (Number.isFinite(mean) && Number.isFinite(maximum) && mean > maximum) return false;
  if (Number.isFinite(median) && Number.isFinite(minimum) && median < minimum) return false;
  if (Number.isFinite(median) && Number.isFinite(maximum) && median > maximum) return false;
  if (Number.isFinite(average) && Number.isFinite(minimum) && average < minimum) return false;
  if (Number.isFinite(average) && Number.isFinite(maximum) && average > maximum) return false;
  return true;
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
  return row ? inheritStatsScope(data, row) : null;
}
function inheritStatsScope(data, row) {
  const inherited = Object.fromEntries(['as_of', 'window', 'published_window', 'methodology', 'publication_id', 'versions', 'availability']
    .filter(key => data[key] !== undefined).map(key => [key, data[key]]));
  // Member traceability belongs to the selected row, never to the whole market.
  return { ...inherited, ...row, as_of: data.as_of, window: data.window };
}
export const sourceId = row => String(row?.source_id || row?.site || row?.source || '');
export function sourceStats(data, source = '') {
  if (!source) return data;
  const row = data?.by_source?.find(row => sourceId(row) === source);
  return row ? inheritStatsScope(data, row) : null;
}
// Match the existing marketplace's exclusion of internally inconsistent source summaries.
export function coherentStats(data) {
  if (!data) return data;
  const sampled = row => ['active', 'sold'].filter(key => Number(row?.[key]?.sample_count) > 0);
  const rows = (data.by_source || []).filter(row => sampled(row).length || row.daily?.some(day => sampled(day).length));
  if (!rows.length) return data;
  const valid = rows.filter(row => sampled(row).every(key => metricIsConsistent(row[key])));
  if (valid.length === rows.length) return data;
  const combine = (rows, key) => {
    if (rows.length === 1 && metricIsConsistent(rows[0]?.[key])) return { ...rows[0][key] };
    const metrics = rows.map(row => row[key]).filter(metric => Number(metric?.sample_count) > 0 && metricIsConsistent(metric));
    const count = metrics.reduce((sum, metric) => sum + Number(metric.sample_count), 0);
    const minimums = metrics.map(metric => Number(metric.min)).filter(value => Number.isFinite(value) && value > 0);
    const maximums = metrics.map(metric => Number(metric.max)).filter(value => Number.isFinite(value) && value > 0);
    const centralOf = metric => ['mean', 'average'].map(key => Number(metric[key])).find(value => Number.isFinite(value) && value > 0) ?? null;
    const allHaveCentral = metrics.length > 0 && metrics.every(metric => centralOf(metric) != null);
    return {
      sample_count: count,
      min: minimums.length ? Math.min(...minimums) : null,
      max: maximums.length ? Math.max(...maximums) : null,
      mean: count >= 5 && allHaveCentral
        ? metrics.reduce((sum, metric) => sum + centralOf(metric) * Number(metric.sample_count), 0) / count
        : null,
      median: null,
      aggregate_incomplete: count > 0 && !allHaveCentral,
    };
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
export function priceDateRange(from = '', to = '', today = new Date().toISOString().slice(0, 10)) {
  const end = to || today, start = from || shiftDate(end, -29), earliest = shiftDate(today, -729);
  for (const date of [start, end]) {
    const timestamp = Date.parse(`${date}T00:00:00Z`);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(timestamp)
      || new Date(timestamp).toISOString().slice(0, 10) !== date) throw new Error('올바른 시작일과 종료일을 선택하세요.');
    if (date < earliest || date > today) throw new Error('최근 2년 안의 기간을 선택하세요.');
  }
  if (start > end) throw new Error('종료일은 시작일보다 빠를 수 없습니다.');
  return { from: start, to: end, days: (Date.parse(end) - Date.parse(start)) / 86400000 + 1, earliest, latest: today };
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
      if (value != null) { sum += value * entry.quantity; covered += entry.quantity; }
    }
    const total = entries.reduce((count, entry) => count + entry.quantity, 0);
    return [key, { amount: covered ? sum : null, covered, total, complete: total > 0 && covered === total }];
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
    if (category === 'MOTHERBOARD' && ['FACET', 'BROWSE_FACET'].includes(products.get(e.id).key_specs?.directory_node_type)) {
      throw new Error('메인보드는 검증된 정확 모델만 견적에 선택할 수 있습니다.');
    }
    if (!categories.has(category) || used.has(category)) throw new Error('같은 부품 종류가 중복되었습니다.');
    used.add(category);
    const quantity = Number(e.quantity ?? 1);
    if (!Number.isInteger(quantity) || quantity < 1 || quantity > 16) throw new Error('수량은 1~16개여야 합니다.');
    const manufacturer = typeof e.manufacturer === 'string' ? e.manufacturer.trim() : '';
    if (manufacturer.length > 120) throw new Error('제조사 값이 너무 깁니다.');
    return { id: e.id, quantity, manufacturer, category };
  });
}
export function compactBuild(input, products, categories) {
  return validateBuild(input, products, categories).map(({ id, quantity, manufacturer }) => {
    const entry = { id };
    if (quantity !== 1) entry.quantity = quantity;
    if (manufacturer) entry.manufacturer = manufacturer;
    return entry;
  });
}
export function dailySeries(data, key, days = 30) {
  const rows = Array.isArray(data?.daily) ? data.daily : [];
  const latestPublished = String(data?.availability?.status || '').toUpperCase() === 'LAST_PUBLISHED';
  const date = String((latestPublished ? data?.published_window?.to : '') || data?.window?.to || data?.as_of || rows.at(-1)?.date || rows.at(-1)?.stat_date || '').slice(0, 10);
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
