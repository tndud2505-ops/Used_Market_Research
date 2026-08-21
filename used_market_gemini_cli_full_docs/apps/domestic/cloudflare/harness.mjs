import worker, { CRON_TO_JOBS } from './worker.mjs';
import { freeCollectionPlan } from './free-collector.mjs';
import { readFileSync } from 'node:fs';

const wranglerConfig = JSON.parse(readFileSync(new URL('./wrangler.jsonc', import.meta.url), 'utf8'));
const workerSource = readFileSync(new URL('./worker.mjs', import.meta.url), 'utf8');
assert(wranglerConfig.vars?.SEARCH_RUNNER_TIMEOUT_MS === '60000', 'deep search proxy allows the full 60-second runner window');
assert(/Object\.fromEntries\(TARGET_SITES\.map\(\(site\) => \[site,/u.test(workerSource), 'public category catalog is filtered by the active target-site list');
assert(/DELETE FROM listings WHERE site NOT IN/u.test(workerSource), 'D1 cleanup removes rows for retired sources');

const calls = [];
let failuresRemaining = 0;
let runnerSearchPayload = null;
let fallbackSql = '';
let fallbackBindings = [];
const env = {
  RUNNER_URL: 'https://runner.example.test/api/runner/run',
  ORIGIN_URL: 'https://origin.example.test',
  RUNNER_TOKEN: 'runner-secret',
  MANUAL_RUN_TOKEN: 'manual-secret'
};

const originalFetch = globalThis.fetch;
const originalCaches = globalThis.caches;
const cacheEntries = new Map();
globalThis.caches = {
  default: {
    async match(request) {
      return cacheEntries.get(typeof request === 'string' ? request : request.url)?.clone() ?? undefined;
    },
    async put(request, response) {
      cacheEntries.set(typeof request === 'string' ? request : request.url, response.clone());
    }
  }
};
globalThis.fetch = async (url, options = {}) => {
  const requestUrl = typeof url === 'string' ? url : url instanceof URL ? url.toString() : url.url;
  const requestHeaders = url instanceof Request ? Object.fromEntries(url.headers.entries()) : {};
  const headers = options.headers ? { ...options.headers } : requestHeaders;
  calls.push({ url: requestUrl, options: { ...options, headers } });
  if (options.signal?.aborted) {
    throw new Error('aborted before fetch');
  }
  const originPath = new URL(requestUrl).pathname;
  if (requestUrl.startsWith('https://origin.example.test') && originPath === '/') {
    return new Response('origin-ok', { status: 200 });
  }
  let rawBody = options.body;
  if (rawBody === undefined && url instanceof Request) {
    rawBody = await url.clone().text();
  }
  const bodyText = rawBody instanceof ArrayBuffer
    ? new TextDecoder().decode(rawBody)
    : rawBody instanceof Uint8Array
      ? new TextDecoder().decode(rawBody)
      : rawBody;
  const body = bodyText ? JSON.parse(bodyText) : {};
  const shouldFail = failuresRemaining > 0;
  if (shouldFail) failuresRemaining -= 1;
  if (requestUrl.startsWith('https://search.example.test') && runnerSearchPayload) {
    return new Response(JSON.stringify(runnerSearchPayload), {
      status: 200,
      headers: { 'content-type': 'application/json' }
    });
  }
  return new Response(JSON.stringify({ status: shouldFail ? 'error' : 'success', data: { job_names: body.job_names } }), {
    status: shouldFail ? 500 : 200,
    headers: { 'content-type': 'application/json' }
  });
};

try {
  const health = await worker.fetch(new Request('https://worker.example.test/health'), env);
  assert(health.status === 200, 'health endpoint');

  const proxiedHome = await worker.fetch(new Request('https://worker.example.test/'), env);
  assert(proxiedHome.status === 200, 'origin proxy');
  assert(calls.at(-1).url === 'https://origin.example.test/', 'origin proxy preserves path');

  const canonicalRedirect = await worker.fetch(new Request('https://www.used-pick.com/search?keyword=iphone'), env);
  assert(canonicalRedirect.status === 301, 'www canonical redirect');
  assert(
    canonicalRedirect.headers.get('location') === 'https://used-pick.com/search?keyword=iphone',
    'www redirect preserves path and query'
  );

  const unauthorized = await worker.fetch(new Request('https://worker.example.test/run', {
    method: 'POST',
    body: JSON.stringify({ job_name: 'gpu-fast-scan' }),
    headers: { 'content-type': 'application/json' }
  }), env);
  assert(unauthorized.status === 401, 'manual auth boundary');

  const manual = await worker.fetch(new Request('https://worker.example.test/run', {
    method: 'POST',
    body: JSON.stringify({ job_name: 'cpu-scan' }),
    headers: {
      'content-type': 'application/json',
      authorization: 'Bearer manual-secret'
    }
  }), env);
  assert(manual.status === 200, 'manual runner dispatch');
  assert(calls.at(-1).options.headers['idempotency-key'], 'manual idempotency key');

  calls.length = 0;
  const searchRequest = () => new Request('https://worker.example.test/api/search', {
    method: 'POST',
    body: JSON.stringify({ keyword: 'RTX 3070', sites: ['joonggonara'], limit: 5 }),
    headers: { 'content-type': 'application/json' }
  });
  const searchMiss = await worker.fetch(searchRequest(), env);
  assert(searchMiss.status === 200, 'free-tier cached search miss');
  assert(searchMiss.headers.get('x-free-tier-cache') === 'MISS', 'free-tier cache miss header');
  const originCallsAfterMiss = calls.length;
  const searchHit = await worker.fetch(searchRequest(), env);
  assert(searchHit.status === 200, 'free-tier cached search hit');
  assert(searchHit.headers.get('x-free-tier-cache') === 'HIT', 'free-tier cache hit header');
  assert(calls.length === originCallsAfterMiss, 'free-tier search avoids duplicate origin scrape');

  const fallbackDb = {
    prepare(sql) {
      fallbackSql = sql;
      return {
        bind(...values) {
          fallbackBindings = values;
          return {
            async all() {
              return {
                results: [{
                  item_id: 'bunjang:fallback-noise',
                  site: 'bunjang',
                  category_id: 'mobile',
                  title: 'FALLBACK_UNCACHED 최고가 매입합니다',
                  price_value: 500,
                  currency: 'KRW',
                  url: 'https://m.bunjang.co.kr/products/fallback-noise',
                  image_url: null,
                  seller_name: null,
                  posted_at: null,
                  updated_at: new Date().toISOString()
                }, {
                  item_id: 'bunjang:fallback-1',
                  site: 'bunjang',
                  category_id: 'mobile',
                  title: 'FALLBACK_UNCACHED phone',
                  price_value: 100000,
                  currency: 'KRW',
                  url: 'https://m.bunjang.co.kr/products/fallback-1',
                  image_url: null,
                  seller_name: null,
                  posted_at: null,
                  updated_at: new Date().toISOString()
                }]
              };
            }
          };
        }
      };
    }
  };
  failuresRemaining = 1;
  const callsBeforeRunnerFailure = calls.length;
  const runnerFailureFallback = await worker.fetch(new Request('https://worker.example.test/api/search', {
    method: 'POST',
    body: JSON.stringify({ keyword: 'FALLBACK_UNCACHED', sites: ['bunjang'], limit: 5 }),
    headers: { 'content-type': 'application/json' }
  }), {
    ...env,
    SEARCH_RUNNER_URL: 'https://search.example.test/api/search',
    DB: fallbackDb,
    FREE_TIER_MODE: 'false'
  });
  assert(runnerFailureFallback.status === 200, 'AWS search failure falls back to D1');
  assert(runnerFailureFallback.headers.get('x-search-data-source') === 'd1-fallback', 'D1 fallback source header');
  assert(runnerFailureFallback.headers.get('x-search-runner-fallback') === 'true', 'D1 fallback marker header');
  assert(runnerFailureFallback.headers.get('x-search-quality-layer') === 'd1-backup', 'D1 fallback quality layer header');
  assert(calls.length === callsBeforeRunnerFailure + 1, 'AWS failure queries D1 directly without live source requests');
  const fallbackPayload = await runnerFailureFallback.json();
  assert(fallbackPayload.data.items.length === 1, 'D1 fallback returns stored listings');
  assert(fallbackPayload.data.items[0].id === 'bunjang:fallback-1', 'D1 fallback response contains a known D1 listing ID');
  assert(fallbackPayload.data.quality.selection.dropped.purchase_request === 1, 'D1 fallback removes purchase-request noise');

  failuresRemaining = 1;
  const descendingFallback = await worker.fetch(new Request('https://worker.example.test/api/search', {
    method: 'POST',
    body: JSON.stringify({
      keyword: 'FALLBACK_UNCACHED',
      sites: ['bunjang'],
      min_price: 100000,
      max_price: 200000,
      limit: 5,
      sort: 'price_desc'
    }),
    headers: { 'content-type': 'application/json' }
  }), {
    ...env,
    SEARCH_RUNNER_URL: 'https://search.example.test/api/search',
    DB: fallbackDb,
    FREE_TIER_MODE: 'false'
  });
  assert(descendingFallback.status === 200, 'D1 fallback accepts high-price sorting with a price range');
  assert(fallbackSql.includes('price_value DESC'), 'D1 fallback orders high-price results descending');
  assert(
    fallbackSql.includes('price_value >= ?') && fallbackSql.includes('price_value <= ?'),
    'D1 fallback keeps both price-range predicates'
  );
  assert(
    fallbackBindings.includes(100000) && fallbackBindings.includes(200000),
    'D1 fallback binds both requested price limits'
  );
  assert(
    fallbackSql.includes('CASE WHEN price_value IS NULL OR price_value <= 100 THEN 1 ELSE 0 END, price_value DESC'),
    'D1 fallback keeps missing prices last for high-price sorting'
  );

  failuresRemaining = 1;
  const retiredSiteFallback = await worker.fetch(new Request('https://worker.example.test/api/search', {
    method: 'POST',
    body: JSON.stringify({ keyword: '아이폰 15', sites: ['daangn'], limit: 5 }),
    headers: { 'content-type': 'application/json' }
  }), {
    ...env,
    SEARCH_RUNNER_URL: 'https://search.example.test/api/search',
    DB: fallbackDb,
    FREE_TIER_MODE: 'false'
  });
  assert(retiredSiteFallback.status === 400, 'D1 fallback rejects a request containing only a retired source');

  failuresRemaining = 1;
  const emptySiteFallback = await worker.fetch(new Request('https://worker.example.test/api/search', {
    method: 'POST',
    body: JSON.stringify({ keyword: '아이폰 15', sites: [], limit: 5 }),
    headers: { 'content-type': 'application/json' }
  }), {
    ...env,
    SEARCH_RUNNER_URL: 'https://search.example.test/api/search',
    DB: fallbackDb,
    FREE_TIER_MODE: 'false'
  });
  assert(emptySiteFallback.status === 400, 'D1 fallback rejects an explicit empty source list');

  const unauthorizedD1Check = await worker.fetch(new Request('https://worker.example.test/api/index/d1-fallback-check', {
    method: 'POST',
    body: JSON.stringify({ keyword: 'FALLBACK_UNCACHED', sites: ['bunjang'], limit: 5 }),
    headers: { 'content-type': 'application/json' }
  }), { ...env, DB: fallbackDb });
  assert(unauthorizedD1Check.status === 401, 'D1 fallback diagnostic requires operator authorization');
  const callsBeforeD1Check = calls.length;
  const authorizedD1Check = await worker.fetch(new Request('https://worker.example.test/api/index/d1-fallback-check', {
    method: 'POST',
    body: JSON.stringify({ keyword: 'FALLBACK UNCACHED', category_id: 'mobile', sites: ['bunjang', 'hellomarket'], limit: 5 }),
    headers: { 'content-type': 'application/json', authorization: 'Bearer manual-secret' }
  }), { ...env, DB: fallbackDb });
  assert(authorizedD1Check.status === 200, 'authorized D1 fallback diagnostic succeeds');
  assert(authorizedD1Check.headers.get('x-search-quality-layer') === 'd1-backup', 'D1 diagnostic proves the D1 backup quality layer');
  assert(calls.length === callsBeforeD1Check, 'D1 diagnostic does not call AWS or original sites');
  const d1CheckPayload = await authorizedD1Check.json();
  assert(d1CheckPayload.data.items[0].id === 'bunjang:fallback-1', 'D1 diagnostic returns a known D1 listing ID');
  assert(fallbackSql.includes('REPLACE('), 'D1 keyword lookup supports compact model names');
  assert(fallbackBindings.includes('%fallbackuncached%'), 'D1 keyword lookup binds a compact search term');

  runnerSearchPayload = {
    status: 'success',
    data: {
      items: [
        ['iphone7', '애플 리퍼상품 아이폰7플러스 256GB', 219000],
        ['commercial', '특가 아이폰16프로 미사용 선착순 한정판매 맥스/13/14/15/17', 130000],
        ['normal-1', '아이폰15 128기가 블랙', 360000],
        ['normal-2', '아이폰15 128기가 화이트', 380000],
        ['normal-3', '아이폰15 256기가 블루', 410000],
        ['normal-4', '아이폰15 프로 128기가', 500000],
        ['normal-5', '아이폰15 프로 256기가', 550000],
        ['normal-6', '아이폰15 프로맥스 256기가', 650000],
        ['normal-7', '아이폰15 프로맥스 512기가', 750000]
      ].map(([id, title, price]) => ({
        id,
        site: 'bunjang',
        title,
        price,
        currency: 'KRW',
        url: `https://m.bunjang.co.kr/products/${id}`,
        image_url: `https://example.test/${id}.jpg`,
        posted_at: new Date().toISOString()
      })),
      sources: [{ key: 'bunjang', supported: true, total_count: 9, raw_count: 9 }],
      pagination: { has_more: false, next_cursor: null }
    }
  };
  const refinedRunnerResponse = await worker.fetch(new Request('https://worker.example.test/api/search', {
    method: 'POST',
    body: JSON.stringify({ keyword: '아이폰 15', category_id: 'mobile', sites: ['bunjang'], limit: 5, sort: 'price_asc' }),
    headers: { 'content-type': 'application/json' }
  }), {
    ...env,
    SEARCH_RUNNER_URL: 'https://search.example.test/api/search',
    FREE_TIER_MODE: 'false'
  });
  const refinedRunnerPayload = await refinedRunnerResponse.json();
  assert(refinedRunnerResponse.headers.get('x-search-data-source') === 'aws-runner', 'healthy AWS runner remains the collection source');
  assert(refinedRunnerResponse.headers.get('x-search-quality-layer') === 'aws-runner-index', 'AWS index owns result filtering and ordering');
  assert(refinedRunnerPayload.data.items[0]?.id === 'iphone7', 'Cloudflare preserves the indexed result payload without rebuilding it');

  runnerSearchPayload = {
    status: 'success',
    data: {
      items: [{ id: 'new-1', site: 'bunjang', title: '아이폰15 새 매물', price: 350000 }],
      refresh: { state: 'completed', token: '12345678-1234-1234-1234-123456789012', added_count: 1 }
    }
  };
  const refreshResponse = await worker.fetch(new Request('https://worker.example.test/api/search/refresh/12345678-1234-1234-1234-123456789012'), {
    ...env,
    SEARCH_RUNNER_URL: 'https://search.example.test/api/search'
  });
  assert(refreshResponse.status === 200, 'refresh token result is proxied');
  assert(calls.at(-1).url.endsWith('/api/search/refresh/12345678-1234-1234-1234-123456789012'), 'refresh token path is preserved');

  const unauthorizedIndexStatus = await worker.fetch(new Request('https://worker.example.test/api/index/status'), {
    ...env,
    SEARCH_RUNNER_URL: 'https://search.example.test/api/search'
  });
  assert(unauthorizedIndexStatus.status === 401, 'index status requires operator authorization');
  const authorizedIndexStatus = await worker.fetch(new Request('https://worker.example.test/api/index/status', {
    headers: { authorization: 'Bearer manual-secret' }
  }), {
    ...env,
    SEARCH_RUNNER_URL: 'https://search.example.test/api/search'
  });
  assert(authorizedIndexStatus.status === 200, 'authorized index status is proxied');
  runnerSearchPayload = null;

  const queuedMessages = [];
  await worker.scheduled({ cron: '0 0 * * *', scheduledTime: Date.now() }, {
    ...env,
    BROWSER: {},
    DB: {
      prepare() {
        return {
          bind() {
            return { async run() { return { meta: { changes: 0 } }; } };
          }
        };
      }
    },
    COLLECTION_QUEUE: { async sendBatch(messages) { queuedMessages.push(...messages); } }
  }, { waitUntil() { throw new Error('free queue path must not call node runner'); } });
  assert(
    queuedMessages.length === 2
    && queuedMessages[0].body.job_name === 'gpu-fast-scan'
    && queuedMessages[1].body.job_name === 'iphone-scan',
    'free-tier queue scheduling'
  );
  assert(freeCollectionPlan('gpu-fast-scan').targets.length === 4, 'free-tier bounded collection plan');

  const invalidJsonBody = await worker.fetch(new Request('https://worker.example.test/run', {
    method: 'POST',
    body: 'null',
    headers: {
      'content-type': 'application/json',
      authorization: 'Bearer manual-secret'
    }
  }), env);
  assert(invalidJsonBody.status === 400, 'null JSON body validation');

  const oversizedBody = await worker.fetch(new Request('https://worker.example.test/run', {
    method: 'POST',
    body: JSON.stringify({ job_name: 'cpu-scan', padding: 'x'.repeat(1_100_000) }),
    headers: {
      'content-type': 'application/json',
      authorization: 'Bearer manual-secret'
    }
  }), env);
  assert(oversizedBody.status === 413, 'oversized runner request validation');

  const fallbackTokenEnv = { ...env, MANUAL_RUN_TOKEN: '' };
  const fallbackToken = await worker.fetch(new Request('https://worker.example.test/run', {
    method: 'POST',
    body: JSON.stringify({ job_name: 'cpu-scan' }),
    headers: {
      'content-type': 'application/json',
      authorization: 'Bearer runner-secret'
    }
  }), fallbackTokenEnv);
  assert(fallbackToken.status === 401, 'manual token does not fall back to runner token');

  const zeroTimeout = await worker.fetch(new Request('https://worker.example.test/run', {
    method: 'POST',
    body: JSON.stringify({ job_name: 'ram-scan' }),
    headers: {
      'content-type': 'application/json',
      authorization: 'Bearer manual-secret'
    }
  }), { ...env, RUNNER_TIMEOUT_MS: '0' });
  assert(zeroTimeout.status === 200, 'zero timeout falls back to a safe timeout');

  const waits = [];
  await worker.scheduled({ cron: '0 0 * * *', scheduledTime: Date.now() }, env, {
    waitUntil(promise) { waits.push(promise); }
  });
  await Promise.all(waits);
  const scheduledCall = calls.at(-1);
  assert(scheduledCall && JSON.parse(scheduledCall.options.body).job_names[0] === 'gpu-fast-scan', 'scheduled runner dispatch');
  assert(scheduledCall.options.headers.authorization === 'Bearer runner-secret', 'scheduled runner auth header');
  assert(scheduledCall.options.headers['idempotency-key'].startsWith('cloudflare:'), 'scheduled idempotency key');

  const dailyWaits = [];
  await worker.scheduled({
    cron: '0 18 * * *',
    scheduledTime: Date.UTC(2026, 0, 1, 18, 0, 0),
  }, env, {
    waitUntil(promise) { dailyWaits.push(promise); }
  });
  await Promise.all(dailyWaits);
  const dailyJobs = JSON.parse(calls.at(-1).options.body).job_names;
  assert(dailyJobs.includes('ssd-scan') && dailyJobs.includes('daily-price-refresh'), 'daily refresh window');

  const mappedJobNames = [...CRON_TO_JOBS.values()].flat();
  assert(CRON_TO_JOBS.size === 5, 'free cron trigger count');
  assert(new Set([...mappedJobNames, 'daily-price-refresh']).size === 11, 'all scheduler jobs represented');

  let unknownCronRejected = false;
  try {
    await worker.scheduled({ cron: 'unknown-cron', scheduledTime: Date.now() }, env, { waitUntil() {} });
  } catch (error) {
    unknownCronRejected = /No job mapping/.test(error instanceof Error ? error.message : String(error));
  }
  assert(unknownCronRejected, 'unknown cron mapping failure');

  failuresRemaining = 3;
  const downstreamFailure = await worker.fetch(new Request('https://worker.example.test/run', {
    method: 'POST',
    body: JSON.stringify({ job_name: 'gpu-fast-scan' }),
    headers: {
      'content-type': 'application/json',
      authorization: 'Bearer manual-secret'
    }
  }), env);
  assert(downstreamFailure.status === 502, 'downstream failure propagation');

  failuresRemaining = 3;
  const scheduledFailureWaits = [];
  await worker.scheduled({ cron: '0 6 * * *', scheduledTime: Date.now() }, env, {
    waitUntil(promise) { scheduledFailureWaits.push(promise); }
  });
  const scheduledFailure = await Promise.allSettled(scheduledFailureWaits);
  assert(scheduledFailure[0]?.status === 'rejected', 'scheduled downstream failure propagation');

  const missingTokenEnv = { ...env, RUNNER_TOKEN: '' };
  const missingTokenWaits = [];
  await worker.scheduled({ cron: '0 12 * * *', scheduledTime: Date.now() }, missingTokenEnv, {
    waitUntil(promise) { missingTokenWaits.push(promise); }
  });
  const missingTokenFailure = await Promise.allSettled(missingTokenWaits);
  assert(missingTokenFailure[0]?.status === 'rejected', 'scheduled missing token failure');

  console.log(JSON.stringify({ status: 'passed', checks: 45, dispatched: calls.length }, null, 2));
} finally {
  globalThis.fetch = originalFetch;
  if (originalCaches === undefined) {
    delete globalThis.caches;
  } else {
    globalThis.caches = originalCaches;
  }
}

function assert(condition, label) {
  if (!condition) throw new Error(`Cloudflare harness failed: ${label}`);
}
