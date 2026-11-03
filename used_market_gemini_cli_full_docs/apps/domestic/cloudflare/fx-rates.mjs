// Daily USD→KRW reference rates (European Central Bank via Frankfurter, no key).
// Business days only; callers carry the previous rate over weekends and holidays.
const SOURCE = 'https://api.frankfurter.dev/v1';
const MAX_DAYS = 1100;
const CACHE_SECONDS = 6 * 60 * 60;
const DAY = 86400000;
const isoDay = value => /^\d{4}-\d{2}-\d{2}$/u.test(value || '') && Number.isFinite(Date.parse(value + 'T00:00:00Z')) ? value : '';

export function parseFxRequest(url, now = Date.now()) {
  const today = new Date(now).toISOString().slice(0, 10);
  const to = isoDay(url.searchParams.get('to')) || today;
  // A few days before the first chart date supply the carried-over weekend rate.
  const from = isoDay(url.searchParams.get('from')) || new Date(Date.parse(to) - 90 * DAY).toISOString().slice(0, 10);
  const start = new Date(Date.parse(from) - 7 * DAY).toISOString().slice(0, 10);
  if (start > to || (Date.parse(to) - Date.parse(start)) / DAY > MAX_DAYS) throw new TypeError('invalid fx range');
  return { from: start, to: to > today ? today : to };
}

export async function handleFxRates(request, { fetchImpl = fetch, cache = globalThis.caches?.default, now = Date.now() } = {}) {
  let range;
  try { range = parseFxRequest(new URL(request.url), now); }
  catch { return Response.json({ status: 'error', error: 'invalid fx range' }, { status: 400 }); }
  const cacheKey = new Request(`https://used-pick.invalid/fx/usd-krw/${range.from}/${range.to}`);
  const cached = await cache?.match(cacheKey).catch(() => null);
  if (cached) return cached;
  let upstream;
  try {
    upstream = await fetchImpl(`${SOURCE}/${range.from}..${range.to}?base=USD&symbols=KRW`,
      { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(8000) });
  } catch { return Response.json({ status: 'error', error: 'fx source unavailable' }, { status: 503 }); }
  const body = upstream.ok ? await upstream.json().catch(() => null) : null;
  const rates = {};
  for (const [date, value] of Object.entries(body?.rates || {})) {
    const rate = Number(value?.KRW);
    if (isoDay(date) && Number.isFinite(rate) && rate > 100 && rate < 10000) rates[date] = rate;
  }
  if (!Object.keys(rates).length) return Response.json({ status: 'error', error: 'fx source unavailable' }, { status: 503 });
  const response = Response.json({ status: 'success', data: { base: 'USD', quote: 'KRW', source: 'ECB', from: range.from, to: range.to, rates } },
    { headers: { 'cache-control': `public, max-age=${CACHE_SECONDS}` } });
  await cache?.put(cacheKey, response.clone()).catch(() => {});
  return response;
}
