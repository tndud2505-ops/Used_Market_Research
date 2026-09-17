// Independent oracle: deliberately imports no application/UI aggregation code.
// A daily member reference is NOT necessarily a distinct period listing.
export const PRICE_METRICS = Object.freeze(['active', 'reserved', 'sold', 'confirmed_transactions']);
const money = value => typeof value === 'number' && Number.isFinite(value) && value > 0;
const digest = value => typeof value === 'string' && /^[a-f0-9]{64}$/u.test(value);

export function inspectPriceMetric(metric) {
  const problems = [];
  const n = metric?.sample_count;
  if (!Number.isSafeInteger(n) || n < 0) problems.push('INVALID_SAMPLE_COUNT');
  if (metric?.aggregate_incomplete === true) problems.push('AGGREGATE_INCOMPLETE');
  for (const field of ['mean', 'median', 'average', 'trimmed_mean', 'min', 'max', 'p25', 'p75']) {
    const value = metric?.[field];
    if (value == null) continue;
    if (!money(value) || n === 0) problems.push(`INVALID_VALUE:${field}`);
    if (money(metric?.min) && value < metric.min || money(metric?.max) && value > metric.max) problems.push(`OUT_OF_BOUNDS:${field}`);
  }
  if (n < 3 && ['mean', 'median', 'average', 'trimmed_mean'].some(field => metric?.[field] != null)) problems.push('LOW_SAMPLE_REPRESENTATIVE');
  if (n >= 3 && !money(metric?.median)) problems.push('MEDIAN_MISSING');
  if (n >= 5 && !money(metric?.mean)) problems.push('MEAN_MISSING');
  if (n > 0 && (!money(metric?.min) || !money(metric?.max))) problems.push('PRICE_RANGE_MISSING');
  const value = problems.length || n < 3 ? null : n < 5 ? metric.median : metric.mean;
  return { sample_count: Number.isSafeInteger(n) ? n : null, value,
    policy: n < 3 ? 'NO_REPRESENTATIVE' : n < 5 ? 'MEDIAN' : 'MEAN', problems };
}

export function inspectPriceStats(raw, expected) {
  const problems = [];
  const metrics = {};
  const checkParent = (parent, label) => {
    const result = {};
    for (const key of PRICE_METRICS) {
      result[key] = inspectPriceMetric(parent?.[key]);
      for (const problem of result[key].problems) problems.push(`${label}:${key}:${problem}`);
    }
    return result;
  };
  Object.assign(metrics, checkParent(raw, 'ALL'));
  if (raw?.canonical_product_id !== expected.productId) problems.push('PRODUCT_ID_MISMATCH');
  for (const [field, value] of Object.entries({ market_pool: expected.marketPool, condition: expected.condition, currency: expected.currency, days: expected.days })) {
    if (raw?.methodology?.[field] !== value) problems.push(`SCOPE_MISMATCH:${field}`);
  }
  const samples = PRICE_METRICS.some(key => (metrics[key].sample_count ?? 0) > 0);
  const incomplete = raw?.aggregate_incomplete === true || PRICE_METRICS.some(key => raw?.[key]?.aggregate_incomplete === true);
  if (incomplete) problems.push('EXACT_AGGREGATE_NOT_READY');
  const hasPublication = typeof raw?.publication_id === 'string' && raw.publication_id.length > 0;
  const traceReady = Number.isSafeInteger(raw?.traceability?.member_count) && raw.traceability.member_count >= 0 && digest(raw?.traceability?.member_checksum);
  if (samples && !hasPublication) problems.push('EXACT_PUBLICATION_MISSING');
  if (samples && !traceReady) problems.push('MEMBER_TRACE_MISSING');
  if (expected.publicationId && hasPublication && raw.publication_id !== expected.publicationId) problems.push('PUBLICATION_ID_MISMATCH');
  if (!expected.browseOnly) {
    for (const [key, version] of Object.entries(expected.versions || {})) {
      if (raw?.versions?.[key] !== version) problems.push(`VERSION_MISMATCH:${key}`);
    }
  }
  const sourceIds = new Set();
  const bySource = (raw?.by_source || []).map(source => {
    if (sourceIds.has(source.source_id)) problems.push(`DUPLICATE_SOURCE:${source.source_id}`);
    sourceIds.add(source.source_id);
    if (expected.allowedSources && !expected.allowedSources.includes(source.source_id)) problems.push(`UNAPPROVED_SOURCE:${source.source_id}`);
    return { source_id: source.source_id, metrics: checkParent(source, source.source_id) };
  });
  const published = raw?.published_window;
  if (hasPublication) {
    const through = String(raw.as_of || '').slice(0, 10);
    const from = /^\d{4}-\d{2}-\d{2}$/u.test(through)
      ? new Date(Date.parse(`${through}T00:00:00Z`) - (expected.days - 1) * 86400000).toISOString().slice(0, 10) : null;
    if (!published || published.to !== through || published.from !== from || published.days !== expected.days) problems.push('PUBLISHED_WINDOW_MISMATCH');
    if (expected.asOfDate && published?.to !== expected.asOfDate) problems.push('HISTORICAL_WINDOW_SUBSTITUTED');
    for (const parent of [raw, ...(raw.by_source || [])]) {
      const dates = new Set();
      for (const day of parent.daily || []) {
        if (!/^\d{4}-\d{2}-\d{2}$/u.test(day.date || '') || day.date < from || day.date > through || dates.has(day.date)) problems.push('DAILY_WINDOW_INVALID');
        dates.add(day.date);
      }
    }
  }
  if (expected.browseOnly && (samples || PRICE_METRICS.some(key => metrics[key].value != null))) problems.push('BROWSE_FACET_PRICED');
  const exactReady = hasPublication && traceReady && !incomplete && problems.length === 0 && !expected.browseOnly;
  const cause = !exactReady ? (expected.browseOnly ? 'BROWSE_ONLY' : samples || incomplete || problems.length ? 'INTERNAL_STATS_OR_PUBLICATION_ERROR' : 'UNPUBLISHED_EMPTY_NOT_VERIFIED')
    : !samples ? 'NO_VALID_SAMPLE_IN_PUBLISHED_SCOPE' : metrics.active.sample_count < 3 && metrics.sold.sample_count < 3 ? 'ONE_OR_TWO_VALID_SAMPLES' : 'PRICE_AVAILABLE';
  return { exact_ready: exactReady, cause, has_samples: samples, publication_id: raw?.publication_id || null,
    versions: raw?.versions || null, as_of: raw?.as_of || null, traceability: raw?.traceability || null,
    metrics, by_source: bySource, problems: [...new Set(problems)] };
}

export function independentQuoteLine({ id, stats, quantity, sourceId = 'ALL', metric = 'active', expected }) {
  if (!Number.isSafeInteger(quantity) || quantity < 1 || quantity > 100) throw new Error('INVALID_QUANTITY');
  if (!PRICE_METRICS.includes(metric)) throw new Error('INVALID_METRIC');
  const audit = inspectPriceStats(stats, { ...expected, productId: id });
  const selected = sourceId === 'ALL' ? audit.metrics[metric] : audit.by_source.find(source => source.source_id === sourceId)?.metrics[metric];
  const unitPrice = audit.exact_ready ? selected?.value ?? null : null;
  return { id, source_id: sourceId, metric, market_pool: expected.marketPool, condition: expected.condition,
    currency: expected.currency, days: expected.days, as_of: stats?.as_of || null, publication_id: stats?.publication_id || null,
    quantity, unit_price: unitPrice, line_total: unitPrice == null ? null : unitPrice * quantity,
    sample_count: selected?.sample_count ?? null, policy: selected?.policy || null,
    cause: unitPrice != null ? 'PRICE_AVAILABLE' : !audit.exact_ready ? audit.cause
      : !selected ? 'SELECTED_SOURCE_NO_PUBLISHED_METRIC'
        : selected.sample_count === 0 ? 'NO_SAMPLE_FOR_SELECTED_METRIC'
          : selected.sample_count < 3 ? 'ONE_OR_TWO_VALID_SAMPLES' : 'INVALID_SELECTED_METRIC', problems: audit.problems };
}

export function independentQuoteTotals(lines) {
  // Distinct currency, market, condition, period, publication and metric are
  // never summed into an apparently complete coherent quotation.
  const groups = new Map();
  for (const line of lines) {
    const key = JSON.stringify([line.currency, line.market_pool, line.condition, line.days, line.as_of, line.publication_id, line.source_id, line.metric]);
    if (!groups.has(key)) groups.set(key, { currency: line.currency, market_pool: line.market_pool, condition: line.condition,
      days: line.days, as_of: line.as_of, publication_id: line.publication_id, source_id: line.source_id, metric: line.metric,
      subtotal: 0, priced_lines: 0, total_lines: 0, quantity: 0, complete: true });
    const group = groups.get(key);
    group.total_lines++; group.quantity += line.quantity;
    if (line.line_total == null) group.complete = false;
    else { group.subtotal += line.line_total; group.priced_lines++; }
  }
  for (const group of groups.values()) if (group.priced_lines === 0) group.subtotal = null;
  return [...groups.values()];
}
