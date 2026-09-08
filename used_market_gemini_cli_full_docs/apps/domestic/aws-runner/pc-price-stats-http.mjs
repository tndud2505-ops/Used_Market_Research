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
  if (days !== 30) throw new Error("days must be 30");
  const today = utcDateKey(now);
  const requestedAsOf = String(url.searchParams.get("as_of") || today).trim();
  if (!DATE_ONLY.test(requestedAsOf) || utcDateKey(`${requestedAsOf}T00:00:00.000Z`) !== requestedAsOf) {
    throw new Error("as_of must be YYYY-MM-DD");
  }
  const historyFrom = shiftUtcDate(today, -(MAX_PRICE_HISTORY_DAYS - 1));
  const earliestWindowEnd = shiftUtcDate(historyFrom, days - 1);
  if (requestedAsOf < earliestWindowEnd || requestedAsOf > today) {
    throw new Error("as_of must keep the 30-day window within the last 2 years");
  }
  return {
    canonicalProductId,
    days,
    asOf: `${requestedAsOf}T23:59:59.999Z`,
    asOfDate: requestedAsOf,
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

function confidenceFor(sampleCount) {
  if (sampleCount >= 10) return { level: "높음", reasons: ["최근 30일 판매완료 표본이 10건 이상입니다."] };
  if (sampleCount >= 5) return { level: "높음", reasons: ["최근 30일 판매완료 표본이 5건 이상입니다."] };
  if (sampleCount >= 3) return { level: "낮음", reasons: ["표본이 5건 미만이므로 중앙값만 참고할 수 있습니다."] };
  return { level: "자료 부족", reasons: ["대표가격을 계산하려면 표본이 3건 이상 필요합니다."] };
}

export function priceStatsResponse(request, stats) {
  const sold = stats?.sold || { sample_count: 0, median: null, mean: null };
  const soldCount = Number(sold.sample_count || 0);
  const soldMedian = Number.isFinite(Number(sold.median)) ? Number(sold.median) : null;
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
      amount: soldCount >= 3 ? soldMedian : null,
      currency: request.currency,
      label: "최근 30일 판매완료 중앙값"
    },
    confidence: confidenceFor(soldCount),
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
    traceability: stats?.traceability || { member_count: 0 },
    as_of: stats?.as_of || new Date().toISOString()
  };
}

export { PRODUCT_STATS_PATH };
