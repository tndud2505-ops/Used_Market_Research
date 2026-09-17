import { idOf, coherentStats } from './pc-tools-core.mjs?v=parts-ux-v4';

export async function readJson(url, signal) {
  const request = new AbortController();
  const abort = () => request.abort();
  signal?.addEventListener('abort', abort, { once: true });
  if (signal?.aborted) request.abort();
  const timeout = setTimeout(() => request.abort(), 20000);
  try {
    const response = await fetch(url, { signal: request.signal, credentials: 'same-origin', cache: 'no-store', headers: { accept: 'application/json' } });
    const payload = await response.json().catch(() => null);
    if (!response.ok || payload?.status === 'error') {
      const rawCode = payload?.error?.code || payload?.code || (typeof payload?.error === 'string' ? payload.error : '');
      // Keep the public error classification, never an arbitrary raw response.
      const code = /^[A-Z][A-Z0-9_]{0,99}$/.test(rawCode) ? rawCode : '';
      const hint = ['HISTORICAL_PRICE_STATS_UNAVAILABLE', 'HISTORICAL_EXACT_STATS_UNAVAILABLE'].includes(code) ? '선택 기간의 보존 통계가 없습니다.'
        : /PUBLICATION|STATS_NOT_READY/.test(code) ? '정확 통계 게시가 준비되지 않았습니다.' : '자료 요청 실패';
      const error = new Error(`${hint} (${response.status}${code ? ` · ${code}` : ''})`);
      error.code = code; error.httpStatus = response.status; throw error;
    }
    if (!payload || typeof payload !== 'object') throw new Error('올바른 JSON 자료 응답이 아닙니다.');
    return payload.data ?? payload;
  } finally { clearTimeout(timeout); signal?.removeEventListener('abort', abort); }
}

export function createPriceStore(onChange, options = {}) {
  const marketPool = String(options.marketPool || 'KR_C2C_USED');
  const condition = String(options.condition || 'USED_WORKING');
  const currency = String(options.currency || 'KRW').toUpperCase();
  const cache = new Map();
  let generation = 0;
  let controller = new AbortController();
  const keyOf = (id, days, asOf = '') => `${id}:${days}:${asOf}`;
  const get = (id, days = 30, asOf = '') => cache.get(keyOf(id, days, asOf));
  async function load(products, days = 30, asOf = '') {
    const current = ++generation;
    controller.abort();
    for (const [key, value] of cache) if (value.state === 'loading') cache.delete(key);
    controller = new AbortController();
    const signal = controller.signal;
    const unique = [...new Map(products.map(p => [idOf(p), p])).values()];
    let offset = 0;
    const worker = async () => {
      while (offset < unique.length && !signal.aborted) {
        const id = idOf(unique[offset++]);
        const key = keyOf(id, days, asOf);
        const previous = cache.get(key);
        if (previous?.state === 'ready' && Date.now() - previous.loadedAt < 300000) continue;
        cache.set(key, { state: 'loading' });
        onChange();
        try {
          const params = new URLSearchParams({ days: String(days), market_pool: marketPool, condition, currency });
          if (asOf) params.set('as_of', asOf);
          const data = await readJson(`/api/products/${encodeURIComponent(id)}/price-stats?${params}`, signal);
          if (signal.aborted) break;
          if (data.canonical_product_id !== id) throw new Error('모델이 일치하지 않는 가격 응답입니다.');
          const scope = data.methodology || {};
          if (scope.days != null && Number(scope.days) !== days) throw new Error('가격 집계 기간이 일치하지 않습니다.');
          if (asOf && data.window?.to !== asOf) throw new Error('요청한 날짜의 가격 기록이 아닙니다.');
          if (data.published_window && data.window && ['from', 'to'].some(key => data.published_window[key] !== data.window[key])) {
            const error = new Error('선택 기간과 게시 요약기간이 다릅니다. 현재 가격으로 대체하지 않습니다.');
            error.code = 'HISTORICAL_PRICE_STATS_UNAVAILABLE'; throw error;
          }
          if ((scope.currency && scope.currency !== currency) || (scope.market_pool && scope.market_pool !== marketPool)
            || (scope.condition && scope.condition !== condition)) throw new Error('가격 집계 범위가 일치하지 않습니다.');
          cache.set(key, { state: 'ready', data: coherentStats(data), loadedAt: Date.now() });
        } catch (error) {
          if (signal.aborted) { if (current === generation && cache.get(key)?.state === 'loading') cache.delete(key); break; }
          cache.set(key, { state: 'error', error: error.message, errorCode: error.code || '', httpStatus: error.httpStatus || null });
        }
        if (current === generation) onChange();
      }
    };
    await Promise.all(Array.from({ length: Math.min(4, unique.length) }, worker));
    if (current === generation) onChange();
  }
  return { get, load, clear: () => { controller.abort(); generation++; cache.clear(); } };
}
