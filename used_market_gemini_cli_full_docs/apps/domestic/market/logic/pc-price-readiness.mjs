// Pure shared read contract. It does not collect, rebuild or alter prices.
export function pcPriceReadinessProblem(query, stats) {
  if (!stats || typeof stats !== 'object') return null;
  const parents = [stats, ...(Array.isArray(stats.by_source) ? stats.by_source : [])];
  const incomplete = stats.aggregate_incomplete === true || parents.some(parent =>
    ['active', 'reserved', 'sold', 'confirmed_transactions'].some(key => parent?.[key]?.aggregate_incomplete === true));
  const status = String(stats.availability?.status || '').toUpperCase();
  const explicitlyUnavailable = status === 'UNAVAILABLE'
    && stats.availability?.reason !== 'EXACT_MODEL_REQUIRED';
  const wrongHistoricalWindow = query.isHistorical && Boolean(stats.publication_id)
    && (stats.published_window?.from !== query.window.from || stats.published_window?.to !== query.window.to
      || Number(stats.published_window?.days) !== query.days || String(stats.as_of || '').slice(0, 10) !== query.asOfDate);
  if (!incomplete && !explicitlyUnavailable && !wrongHistoricalWindow) return null;
  return {
    code: query.isHistorical ? 'HISTORICAL_PRICE_STATS_UNAVAILABLE' : 'EXACT_STATS_NOT_READY',
    reason: wrongHistoricalWindow ? 'PUBLISHED_WINDOW_MISMATCH' : incomplete ? 'AGGREGATE_INCOMPLETE' : 'EXPLICITLY_UNAVAILABLE',
    requested_as_of: query.asOfDate,
    requested_window: query.window
  };
}
