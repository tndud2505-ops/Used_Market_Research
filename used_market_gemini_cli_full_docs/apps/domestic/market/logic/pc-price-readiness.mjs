const DAY_MS = 86_400_000;

function shiftUtcDate(date, days) {
  return new Date(Date.parse(`${date}T00:00:00.000Z`) + days * DAY_MS).toISOString().slice(0, 10);
}

// The daily Korean-market publication completes shortly after 03:00 KST and
// contains the most recently completed UTC day. It is safe for an implicit
// current request, but never for a user-selected date or an older publication.
export function isLatestCompletedDailyPublication(query, stats) {
  if (query?.isHistorical || query?.asOfExplicit || !stats?.publication_id) return false;
  const published = stats?.published_window;
  const expectedTo = shiftUtcDate(query.asOfDate, -1);
  const expectedFrom = shiftUtcDate(expectedTo, -(Number(query.days) - 1));
  return published?.from === expectedFrom
    && published?.to === expectedTo
    && Number(published?.days) === Number(query.days)
    && String(stats?.as_of || "").slice(0, 10) === expectedTo;
}

// Pure shared read contract. It does not collect, rebuild or alter prices.
export function pcPriceReadinessProblem(query, stats) {
  if (!stats || typeof stats !== 'object') return null;
  const parents = [stats, ...(Array.isArray(stats.by_source) ? stats.by_source : [])];
  const incomplete = stats.aggregate_incomplete === true || parents.some(parent =>
    ['active', 'reserved', 'sold', 'confirmed_transactions'].some(key => parent?.[key]?.aggregate_incomplete === true));
  const status = String(stats.availability?.status || '').toUpperCase();
  const explicitlyUnavailable = status === 'UNAVAILABLE'
    && stats.availability?.reason !== 'EXACT_MODEL_REQUIRED';
  // Explicit dates and every non-adjacent period need their own exact
  // publication. An implicit current request may instead use the last
  // completed daily window when its identity remains exact.
  const latestCompletedDailyPublication = isLatestCompletedDailyPublication(query, stats);
  const wrongPublishedWindow = Boolean(stats.publication_id) && !latestCompletedDailyPublication
    && (stats.published_window?.from !== query.window.from || stats.published_window?.to !== query.window.to
      || Number(stats.published_window?.days) !== query.days || String(stats.as_of || '').slice(0, 10) !== query.asOfDate
      || (stats.window && (stats.window.from !== query.window.from || stats.window.to !== query.window.to)));
  if (!incomplete && !explicitlyUnavailable && !wrongPublishedWindow) return null;
  return {
    code: query.isHistorical ? 'HISTORICAL_PRICE_STATS_UNAVAILABLE' : 'EXACT_STATS_NOT_READY',
    reason: wrongPublishedWindow ? 'PUBLISHED_WINDOW_MISMATCH' : incomplete ? 'AGGREGATE_INCOMPLETE' : 'EXPLICITLY_UNAVAILABLE',
    requested_as_of: query.asOfDate,
    requested_window: query.window
  };
}
