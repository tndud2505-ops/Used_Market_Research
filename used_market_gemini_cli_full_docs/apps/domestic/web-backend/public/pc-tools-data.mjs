import { idOf, coherentStats } from './pc-tools-core.mjs?v=8';

export async function readJson(url, signal) {
  const request = new AbortController();
  const abort = () => request.abort();
  signal?.addEventListener('abort', abort, { once: true });
  if (signal?.aborted) request.abort();
  const timeout = setTimeout(() => request.abort(), 20000);
  try {
    const response = await fetch(url, { signal: request.signal, credentials: 'same-origin', headers: { accept: 'application/json' } });
    if (!response.ok) throw new Error(`자료 요청 실패 (${response.status})`);
    const payload = await response.json();
    if (payload.status === 'error') throw new Error('자료를 불러오지 못했습니다.');
    return payload.data ?? payload;
  } finally { clearTimeout(timeout); signal?.removeEventListener('abort', abort); }
}

export function createPriceStore(onChange) {
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
          const params = new URLSearchParams({ days: String(days), market_pool: 'KR_C2C_USED', condition: 'USED_WORKING', currency: 'KRW' });
          if (asOf) params.set('as_of', asOf);
          const data = await readJson(`/api/products/${encodeURIComponent(id)}/price-stats?${params}`, signal);
          if (signal.aborted) break;
          if (data.canonical_product_id !== id) throw new Error('모델이 일치하지 않는 가격 응답입니다.');
          const scope = data.methodology || {};
          if (scope.days != null && Number(scope.days) !== days) throw new Error('가격 집계 기간이 일치하지 않습니다.');
          if (asOf && data.window?.to !== asOf) throw new Error('요청한 날짜의 가격 기록이 아닙니다.');
          if ((scope.currency && scope.currency !== 'KRW') || (scope.market_pool && scope.market_pool !== 'KR_C2C_USED')
            || (scope.condition && scope.condition !== 'USED_WORKING')) throw new Error('가격 집계 범위가 일치하지 않습니다.');
          cache.set(key, { state: 'ready', data: coherentStats(data), loadedAt: Date.now() });
        } catch (error) {
          if (signal.aborted) { if (current === generation && cache.get(key)?.state === 'loading') cache.delete(key); break; }
          cache.set(key, { state: 'error', error: error.message });
        }
        if (current === generation) onChange();
      }
    };
    await Promise.all(Array.from({ length: Math.min(4, unique.length) }, worker));
    if (current === generation) onChange();
  }
  return { get, load, clear: () => { controller.abort(); generation++; cache.clear(); } };
}
