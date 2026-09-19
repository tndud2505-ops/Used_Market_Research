const PRODUCT_STATS_PATH = /^\/api\/products\/([^/]+)\/price-stats$/u;
const SINGLE_VALUE = /^[A-Z0-9_:-]+$/u;
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/u;
const DAY_MS = 86_400_000;
export const MAX_PRICE_HISTORY_DAYS = 730;

function oneValue(searchParams, name, fallback) {
  const values = searchParams.getAll(name).map((value) => value.trim()).filter(Boolean);
  const value = values.length ? values[0] : fallback;
  if (values.length > 1 || String(value).includes(",")) throw new Error(`exactly one ${name} is required`);
  if (!SINGLE_VALUE.test(String(value))) throw new Error(`${name} is invalid`);
  return String(value);
}

function utcDateKey(value) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) throw new Error("as_of is invalid");
  return date.toISOString().slice(0, 10);
}

function shiftUtcDate(dateKey, days) {
  return new Date(Date.parse(`${dateKey}T00:00:00.000Z`) + days * DAY_MS).toISOString().slice(0, 10);
}

export function parsePriceStatsRequest(url, now = Date.now()) {
  const match = url.pathname.match(PRODUCT_STATS_PATH);
  if (!match) throw new Error("price stats path is invalid");
  let canonicalProductId;
  try {
    canonicalProductId = decodeURIComponent(match[1]).trim();
  } catch {
    throw new Error("canonicalProductId is invalid");
  }
  if (!canonicalProductId || canonicalProductId.length > 200) throw new Error("canonicalProductId is invalid");
  const days = Number(url.searchParams.get("days") || "30");
  if (!Number.isInteger(days) || days < 1 || days > MAX_PRICE_HISTORY_DAYS) throw new Error("days must be an integer from 1 to 730");
  const today = utcDateKey(now);
  const requestedAsOf = String(url.searchParams.get("as_of") || today).trim();
  if (!DATE_ONLY.test(requestedAsOf) || utcDateKey(`${requestedAsOf}T00:00:00.000Z`) !== requestedAsOf) {
    throw new Error("as_of must be YYYY-MM-DD");
  }
  const historyFrom = shiftUtcDate(today, -(MAX_PRICE_HISTORY_DAYS - 1));
  const earliestWindowEnd = shiftUtcDate(historyFrom, days - 1);
  if (requestedAsOf < earliestWindowEnd || requestedAsOf > today) {
    throw new Error("as_of must keep the selected window within the last 2 years");
  }
  return {
    canonicalProductId,
    days,
    asOf: `${requestedAsOf}T23:59:59.999Z`,
    asOfDate: requestedAsOf,
    asOfExplicit: url.searchParams.has("as_of"),
    isHistorical: requestedAsOf !== today,
    window: {
      days,
      from: shiftUtcDate(requestedAsOf, -(days - 1)),
      to: requestedAsOf,
      history_from: historyFrom,
      history_to: today,
      max_history_days: MAX_PRICE_HISTORY_DAYS,
      can_go_previous: requestedAsOf > earliestWindowEnd,
      can_go_next: requestedAsOf < today
    },
    marketPool: oneValue(url.searchParams, "market_pool", "KR_C2C_USED"),
    condition: oneValue(url.searchParams, "condition", "USED_WORKING"),
    currency: oneValue(url.searchParams, "currency", "KRW")
  };
}

function confidenceFor(sampleCount, period) {
  if (sampleCount >= 10) return { level: "높음", reasons: [`${period} 판매완료 표본이 10건 이상입니다.`] };
  if (sampleCount >= 5) return { level: "높음", reasons: [`${period} 판매완료 표본이 5건 이상입니다.`] };
  if (sampleCount >= 3) return { level: "낮음", reasons: ["표본이 5건 미만이므로 중앙값만 참고할 수 있습니다."] };
  return { level: "자료 부족", reasons: ["대표가격을 계산하려면 표본이 3건 이상 필요합니다."] };
}

export function priceStatsResponse(request, stats) {
  const sold = stats?.sold || { sample_count: 0, median: null, mean: null };
  const soldCount = Number(sold.sample_count || 0);
  const soldMedian = typeof sold.median === 'number' && Number.isFinite(sold.median) && sold.median > 0 ? sold.median : null;
  const period = request.days === 30 && !request.isHistorical ? '최근 30일' : '선택 기간';
  const aggregateIncomplete = stats?.aggregate_incomplete === true
    || [stats, ...(stats?.by_source || [])].some(parent => ['active', 'reserved', 'sold', 'confirmed_transactions']
      .some(key => parent?.[key]?.aggregate_incomplete === true));
  const wrongHistoricalWindow = request.isHistorical && Boolean(stats?.publication_id)
    && stats?.published_window?.to !== request.asOfDate;
  if (wrongHistoricalWindow) {
    const error = new Error('HISTORICAL_PRICE_STATS_UNAVAILABLE');
    error.code = 'HISTORICAL_PRICE_STATS_UNAVAILABLE';
    error.reason = 'PUBLISHED_WINDOW_MISMATCH';
    throw error; // Never return another day's summary as the requested history.
  }
  const exactUnavailable = aggregateIncomplete || wrongHistoricalWindow;
  // Daily observation totals are not distinct period listings. Incomplete
  // storage/publication is an internal readiness state, not market scarcity.
  const availability = exactUnavailable ? {
    status: 'UNAVAILABLE',
    code: request.isHistorical ? 'HISTORICAL_EXACT_STATS_UNAVAILABLE' : 'EXACT_STATS_NOT_READY',
    reason: wrongHistoricalWindow ? 'PUBLISHED_WINDOW_MISMATCH' : 'AGGREGATE_INCOMPLETE',
    counts_are_unique_period_listings: false,
    requested_as_of: request.asOfDate
  } : { status: stats?.publication_id ? 'EXACT_PUBLISHED' : 'NO_EXACT_PUBLICATION',
    counts_are_unique_period_listings: Boolean(stats?.publication_id) };
  return {
    canonical_product_id: request.canonicalProductId,
    active: stats?.active || { sample_count: 0, median: null, mean: null },
    reserved: stats?.reserved || { sample_count: 0, median: null, mean: null },
    sold: {
      ...sold,
      disclosure: "실제 거래가격이 아니라 판매완료 매물에 마지막으로 표시된 가격입니다."
    },
    confirmed_transactions: stats?.confirmed_transactions || { sample_count: 0, median: null, mean: null },
    by_source: Array.isArray(stats?.by_source) ? stats.by_source : [],
    by_manufacturer: Array.isArray(stats?.by_manufacturer) ? stats.by_manufacturer : [],
    daily: Array.isArray(stats?.daily) ? stats.daily : [],
    window: request.window,
    reference_price: {
      amount: !exactUnavailable && soldCount >= 3 ? soldMedian : null,
      currency: request.currency,
      label: `${period} 판매완료 중앙값`
    },
    confidence: exactUnavailable ? { level: '통계 준비 미완료', reasons: [
      request.isHistorical ? '선택한 과거 기간의 정확한 통계가 게시되지 않았습니다.'
        : '정확한 기간 통계 게시가 완료되지 않았습니다. 시장 표본 부족을 의미하지 않습니다.'
    ] } : confidenceFor(soldCount, period),
    availability,
    exclusions: stats?.exclusions || { total: 0, reasons: {} },
    methodology: {
      days: request.days,
      market_pool: request.marketPool,
      condition: request.condition,
      currency: request.currency,
      active_counting: "하루의 마지막 유효 관측을 1회 집계",
      reserved_counting: "하루의 마지막 예약중 유효 관측을 1회 집계",
      sold_counting: "최초 판매완료 관측일에 확인한 마지막 표시가격을 1회 집계",
      sample_policy: "n<3 대표가격 없음, n=3~4 중앙값, n>=5 평균·중앙값, n>=10 절사평균·IQR"
    },
    versions: stats?.versions || { parser: null, rule: null, filter: null },
    ...(stats?.publication_id ? { publication_id: stats.publication_id } : {}),
    ...(stats?.published_window ? { published_window: stats.published_window } : {}),
    traceability: stats?.traceability || { member_count: 0 },
    ...(stats?.integrity_repaired_active ? { integrity_repaired_active: true } : {}),
    ...(Array.isArray(stats?.integrity_repaired_source_ids) && stats.integrity_repaired_source_ids.length > 0
      ? { integrity_repaired_source_ids: stats.integrity_repaired_source_ids }
      : {}),
    as_of: stats?.as_of || new Date().toISOString()
  };
}

export { PRODUCT_STATS_PATH };
