import { readMarketHistoryBundle } from '../../market/logic/history-reader.js';

export async function getPriceHistory(keyword: string, lookbackDays = 90) {
  const safeLookbackDays = Math.min(90, Math.max(7, Math.floor(lookbackDays)));
  const bundle = await readMarketHistoryBundle(undefined, safeLookbackDays);
  const cutoff = new Date(Date.now() - safeLookbackDays * 24 * 60 * 60 * 1000);
  const matching = bundle.history_points.filter((point) => {
    const pointDate = new Date(`${point.date_key}T23:59:59+09:00`);
    return Number.isFinite(pointDate.getTime())
      && pointDate >= cutoff
      && historyPointMatchesKeyword(point, keyword);
  });
  const sourcePoints = matching;
  const windowDays = pickWindow(sourcePoints);
  const windowPoints = sourcePoints.filter((point) => point.window_days === windowDays && point.average_price !== null);
  const points = aggregateByDate(windowPoints);
  const observedPoints = points.filter((point) => point.source.split(', ').includes('observed'));
  const manualSeedPoints = points.filter((point) => point.source.split(', ').includes('manual_seed'));
  const trendPoints = observedPoints.length >= 2 ? observedPoints : [];
  const first = trendPoints[0]?.average_price ?? null;
  const last = trendPoints.at(-1)?.average_price ?? observedPoints.at(-1)?.average_price ?? null;
  const trendRate = first && last ? (last - first) / first : null;
  const pointPrices = points.map((point) => point.average_price).filter((price): price is number => price !== null);
  const averagePrice = pointPrices.length > 0
    ? Math.round(pointPrices.reduce((sum, price) => sum + price, 0) / pointPrices.length)
    : null;
  const sortedPointPrices = [...pointPrices].sort((left, right) => left - right);
  const middle = Math.floor(sortedPointPrices.length / 2);
  const medianPrice = sortedPointPrices.length === 0
    ? null
    : sortedPointPrices.length % 2 === 0
      ? (sortedPointPrices[middle - 1] + sortedPointPrices[middle]) / 2
      : sortedPointPrices[middle];

  return {
    keyword,
    lookback_days: safeLookbackDays,
    window_days: windowDays,
    points,
    summary: {
      observed_days: observedPoints.length,
      observed_snapshot_days: observedPoints.length,
      manual_seed_days: manualSeedPoints.length,
      sample_count: points.reduce((sum, point) => sum + point.sample_count, 0),
      observed_sample_count: observedPoints.reduce((sum, point) => sum + point.sample_count, 0),
      average_price: averagePrice,
      median_price: medianPrice,
      first_price: first,
      latest_price: last,
      trend_rate: trendRate,
      direction: trendPoints.length < 2 || trendRate === null ? 'unknown' : trendRate > 0.02 ? 'up' : trendRate < -0.02 ? 'down' : 'flat',
      data_source: matching.length > 0 ? 'component_history' : 'no_matching_history',
      latest_run_id: bundle.latest_run_id ?? null
    }
  };
}

function aggregateByDate(points: Array<{
  date_key: string;
  date_label: string;
  average_price: number | null;
  sample_count: number;
  source: string;
  component_key: string;
}>) {
  const grouped = new Map<string, { date_label: string; weighted_sum: number; sample_count: number; sources: Set<string>; keys: Set<string> }>();
  for (const point of points) {
    if (point.average_price === null) continue;
    const entry = grouped.get(point.date_key) ?? {
      date_label: point.date_label,
      weighted_sum: 0,
      sample_count: 0,
      sources: new Set<string>(),
      keys: new Set<string>()
    };
    const weight = Math.max(1, point.sample_count);
    entry.weighted_sum += point.average_price * weight;
    entry.sample_count += weight;
    entry.sources.add(point.source);
    entry.keys.add(point.component_key);
    grouped.set(point.date_key, entry);
  }

  return Array.from(grouped.entries()).sort(([left], [right]) => left.localeCompare(right)).map(([date, entry]) => ({
    date,
    label: entry.date_label,
    average_price: Math.round(entry.weighted_sum / entry.sample_count),
    sample_count: entry.sample_count,
    source: Array.from(entry.sources).join(', '),
    component_keys: Array.from(entry.keys).slice(0, 4)
  }));
}

function pickWindow(points: Array<{ window_days: number }>) {
  for (const preferred of [7, 30, 60, 90]) {
    if (points.some((point) => point.window_days === preferred)) return preferred;
  }
  return 7;
}

function tokenize(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9가-힣]+/g, ' ').split(/\s+/).filter((token) => token.length > 1);
}

function normalizeHistoryToken(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9가-힣]+/g, '');
}

function historyPointMatchesKeyword(point: { component_key: string; component_type: string }, keyword: string) {
  const normalizedKeyword = normalizeHistoryToken(keyword);
  if (!normalizedKeyword) return true;

  const normalizedComponent = normalizeHistoryToken(`${point.component_key} ${point.component_type}`);
  if (normalizedComponent.includes(normalizedKeyword)) return true;

  const numericTokens = tokenize(keyword).filter((token) => /\d/.test(token));
  const componentTokens = tokenize(`${point.component_key} ${point.component_type}`)
    .map((token) => normalizeHistoryToken(token));
  return numericTokens.length > 0 && numericTokens.every((token) =>
    componentTokens.includes(normalizeHistoryToken(token))
  );
}
