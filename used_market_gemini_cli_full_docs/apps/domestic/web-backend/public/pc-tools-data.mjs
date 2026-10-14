import { idOf, coherentStats } from './pc-tools-core.mjs?v=readable-chart-v2';
import { readJsonResponse } from './read-json.mjs?v=lookup-recovery-v1';

export async function readJson(url, signal, onStatus) {
  const { response, payload } = await readJsonResponse(url, { signal, cache: 'no-store' });
  onStatus?.(response.status);
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
}

export function createPriceStore(onChange, options = {}) {
  const marketPool = String(options.marketPool || 'KR_DOMESTIC_USED');
  const condition = String(options.condition || 'USED_WORKING');
  const currency = String(options.currency || 'KRW').toUpperCase();
  const cache = new Map();
  let generation = 0;
  let controller = new AbortController();
  const backgroundControllers=new Set();
  const backgroundJobs=new Map();
  const cancelBackground = name => {
    const job=backgroundJobs.get(name);
    if(!job)return;
    job.controller.abort();
    for(const [key,record] of job.records)if(cache.get(key)===record)cache.delete(key);
    backgroundControllers.delete(job.controller);backgroundJobs.delete(name);
  };
  const keyOf = (id, days, asOf = '') => `${id}:${days}:${asOf}`;
  const get = (id, days = 30, asOf = '') => cache.get(keyOf(id, days, asOf));
  // Keep the already verified timeline visible while a wider window loads.
  // Scope and end date must match; never borrow another model or historical end.
  const getAvailable = (id, days = 30, asOf = '') => {
    const current = get(id, days, asOf);
    if (current?.state === 'ready') return current;
    let previous = null, previousDays = 0;
    for (const [key, record] of cache) {
      const count = Number(record.data?.methodology?.days);
      if (record.state === 'ready' && count <= days && count > previousDays && key === keyOf(id, count, asOf)) {
        previous = record; previousDays = count;
      }
    }
    return previous ? { ...previous, historyState: current?.state, historyError: current?.error } : current;
  };
  async function load(products, days = 30, asOf = '', {background=false,backgroundKey=''} = {}) {
    const current = background ? generation : ++generation;
    if(!background){
      controller.abort();for(const pending of backgroundControllers)pending.abort();backgroundControllers.clear();
      backgroundJobs.clear();
      for (const [key, value] of cache) if (value.state === 'loading') cache.delete(key);
      controller = new AbortController();
    }
    if(background&&backgroundKey)cancelBackground(backgroundKey);
    const requestController=background?new AbortController():controller;
    const job={controller:requestController,records:new Map()};
    if(background&&backgroundKey)backgroundJobs.set(backgroundKey,job);
    if(background)backgroundControllers.add(requestController);
    const signal = requestController.signal;
    const unique = [...new Map(products.map(p => [idOf(p), p])).values()];
    let offset = 0;
    const worker = async () => {
      while (offset < unique.length && !signal.aborted) {
        const id = idOf(unique[offset++]);
        const key = keyOf(id, days, asOf);
        const previous = cache.get(key);
        if(background&&previous?.state==='loading')continue;
        if (previous?.state === 'ready' && Date.now() - previous.loadedAt < 300000) continue;
        const params = new URLSearchParams({ days: String(days), market_pool: marketPool, condition, currency });
        if (options.dailyOnly) params.set('view','daily');
        else if (!asOf) params.set('freshness','last_published');
        if (asOf) params.set('as_of', asOf);
        const diagnostics = { requestUrl: `/api/products/${encodeURIComponent(id)}/price-stats?${params}`, httpStatus: null };
        const loadingRecord={ state: 'loading', ...diagnostics };
        cache.set(key, loadingRecord);job.records.set(key,loadingRecord);
        onChange(id);
        try {
          const data = await readJson(diagnostics.requestUrl, signal, code => { diagnostics.httpStatus = code; });
          if (signal.aborted) break;
          if (data.canonical_product_id !== id) throw new Error('모델이 일치하지 않는 가격 응답입니다.');
          const scope = data.methodology || {};
          if (options.dailyOnly && data.view !== 'daily') throw new Error('일별 가격 기록 응답이 아닙니다.');
          if (scope.days != null && Number(scope.days) !== days) throw new Error('가격 집계 기간이 일치하지 않습니다.');
          if (asOf && data.window?.to !== asOf) throw new Error('요청한 날짜의 가격 기록이 아닙니다.');
          const latestCompletedDailyPublication = !asOf && String(data?.availability?.status || '').toUpperCase() === 'LAST_PUBLISHED';
          if (!latestCompletedDailyPublication && data.published_window && data.window && ['from', 'to'].some(key => data.published_window[key] !== data.window[key])) {
            const error = new Error('선택 기간과 게시 요약기간이 다릅니다. 현재 가격으로 대체하지 않습니다.');
            error.code = 'HISTORICAL_PRICE_STATS_UNAVAILABLE'; throw error;
          }
          if ((scope.currency && scope.currency !== currency) || (scope.market_pool && scope.market_pool !== marketPool)
            || (scope.condition && scope.condition !== condition)) throw new Error('가격 집계 범위가 일치하지 않습니다.');
          cache.set(key, { state: 'ready', data: coherentStats(data), loadedAt: Date.now(), ...diagnostics });
        } catch (error) {
          if (signal.aborted) { if (cache.get(key)===loadingRecord) cache.delete(key); break; }
          cache.set(key, { state: 'error', error: error.message, errorCode: error.code || '', ...diagnostics, httpStatus: error.httpStatus || diagnostics.httpStatus });
        }
        if (current === generation) onChange(id);
      }
    };
    await Promise.all(Array.from({ length: Math.min(4, unique.length) }, worker));
    backgroundControllers.delete(requestController);
    if(backgroundKey&&backgroundJobs.get(backgroundKey)===job)backgroundJobs.delete(backgroundKey);
  }
  return { get, getAvailable, load, cancelBackground, clear: () => { controller.abort();for(const pending of backgroundControllers)pending.abort();backgroundControllers.clear();backgroundJobs.clear();generation++; cache.clear(); } };
}
