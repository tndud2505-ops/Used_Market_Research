import assert from 'node:assert/strict';
import { once } from 'node:events';

const originalLimit = process.env.SEARCH_CONCURRENCY_LIMIT;
process.env.SEARCH_CONCURRENCY_LIMIT = '3';
const configured = await import(`../dist/web-backend/logic/config.js?configured=${Date.now()}`);
assert.equal(configured.WEB_BACKEND_CONFIG.search_concurrency_limit, 3);
process.env.SEARCH_CONCURRENCY_LIMIT = 'not-a-number';
const fallback = await import(`../dist/web-backend/logic/config.js?fallback=${Date.now()}`);
assert.equal(fallback.WEB_BACKEND_CONFIG.search_concurrency_limit, 1);
if (originalLimit === undefined) delete process.env.SEARCH_CONCURRENCY_LIMIT;
else process.env.SEARCH_CONCURRENCY_LIMIT = originalLimit;

const { createServer } = await import('../dist/web-backend/logic/server.js');
const originalConsoleError = console.error;
const capturedErrorLogs = [];
console.error = (...args) => {
  capturedErrorLogs.push(args.map((value) => {
    if (value instanceof Error) return `${value.name}: ${value.message}\n${value.stack || ''}`;
    return typeof value === 'string' ? value : JSON.stringify(value);
  }).join(' '));
};

let releaseSlowSearch;
let markSlowSearchStarted;
const slowSearchStarted = new Promise((resolve) => {
  markSlowSearchStarted = resolve;
});
const slowSearchReleased = new Promise((resolve) => {
  releaseSlowSearch = resolve;
});
const internalMessage = 'database-password=should-never-leak';

const server = createServer(0, {
  initializeStorage: false,
  searchConcurrencyLimit: 1,
  searchRetryAfterSeconds: 7,
  exposeInternalErrorDetails: false,
  publicApiOnly: true,
  corsAllowedOrigins: ['https://frontend.example'],
  runWebSearch: async (payload) => {
    if (payload.keyword === 'slow') {
      markSlowSearchStarted();
      await slowSearchReleased;
      return { status: 'success', data: { items: [] } };
    }
    if (payload.keyword === 'explode') throw new Error(internalMessage);
    return { status: 'success', data: { items: [] } };
  }
});

try {
  if (!server.listening) await once(server, 'listening');
  const address = server.address();
  assert.ok(address && typeof address === 'object');
  const baseUrl = `http://127.0.0.1:${address.port}`;

  const headHealth = await fetch(`${baseUrl}/health`, { method: 'HEAD' });
  assert.equal(headHealth.status, 200);
  assert.match(headHealth.headers.get('content-type') || '', /application\/json/u);
  assert.equal(await headHealth.text(), '');

  const headRoot = await fetch(`${baseUrl}/`, { method: 'HEAD' });
  assert.equal(headRoot.status, 200);
  assert.match(headRoot.headers.get('content-type') || '', /text\/html/u);
  assert.equal(await headRoot.text(), '');

  const sameOriginCors = await fetch(`${baseUrl}/health`, { headers: { Origin: baseUrl } });
  assert.equal(sameOriginCors.headers.get('access-control-allow-origin'), baseUrl);
  const allowlistedCors = await fetch(`${baseUrl}/health`, { headers: { Origin: 'https://frontend.example' } });
  assert.equal(allowlistedCors.headers.get('access-control-allow-origin'), 'https://frontend.example');
  const deniedCors = await fetch(`${baseUrl}/health`, { headers: { Origin: 'https://evil.example' } });
  assert.equal(deniedCors.headers.get('access-control-allow-origin'), null);

  const preflight = await fetch(`${baseUrl}/api/search`, {
    method: 'OPTIONS',
    headers: {
      Origin: 'https://frontend.example',
      'Access-Control-Request-Method': 'POST',
      'Access-Control-Request-Headers': 'content-type'
    }
  });
  assert.equal(preflight.status, 204);
  assert.equal(preflight.headers.get('access-control-allow-origin'), 'https://frontend.example');
  assert.equal(preflight.headers.get('access-control-allow-methods'), 'POST, OPTIONS');
  assert.equal(preflight.headers.get('access-control-allow-headers'), 'content-type');

  const deniedPreflight = await fetch(`${baseUrl}/api/search`, {
    method: 'OPTIONS',
    headers: {
      Origin: 'https://evil.example',
      'Access-Control-Request-Method': 'POST'
    }
  });
  assert.equal(deniedPreflight.status, 403);
  assert.equal(deniedPreflight.headers.get('access-control-allow-origin'), null);

  const privateApi = await fetch(`${baseUrl}/api/status/summary`);
  assert.equal(privateApi.status, 404);
  const privatePreflight = await fetch(`${baseUrl}/api/status/summary`, {
    method: 'OPTIONS',
    headers: {
      Origin: 'https://frontend.example',
      'Access-Control-Request-Method': 'GET'
    }
  });
  assert.equal(privatePreflight.status, 404);

  for (const country of ['jp', 'us']) {
    const response = await fetch(`${baseUrl}/?market=global&country=${country}`);
    assert.equal(response.status, 200);
    const html = await response.text();
    const canonical = `https://used-pick.com/?market=global&amp;country=${country}`;
    assert.match(html, /<html lang="en"/u);
    assert.match(html, /<title>Global Used Listings Search \| USED MARKET<\/title>/u);
    assert.match(html, /<meta name="description" content="Search and compare public used listings from marketplaces in Japan and the United States\."/u);
    assert.match(html, /<meta property="og:locale" content="en_US"/u);
    assert.match(html, /<meta property="og:title" content="Global Used Listings Search \| USED MARKET"/u);
    assert.match(html, /<meta property="og:description" content="Search and compare public used listings/u);
    assert.match(html, new RegExp(`<meta property="og:url" content="${escapeRegExp(canonical)}"`, 'u'));
    assert.match(html, /<meta name="twitter:title" content="Global Used Listings Search \| USED MARKET"/u);
    assert.match(html, /<meta name="twitter:description" content="Search and compare public used listings/u);
    assert.match(html, new RegExp(`<link rel="canonical" href="${escapeRegExp(canonical)}"`, 'u'));

    const jsonLdMatch = html.match(/<script type="application\/ld\+json">\s*([\s\S]*?)\s*<\/script>/u);
    assert.ok(jsonLdMatch);
    const jsonLd = JSON.parse(jsonLdMatch[1]);
    const rawCanonical = canonical.replace('&amp;', '&');
    assert.equal(jsonLd.inLanguage, 'en-US');
    assert.equal(jsonLd.name, 'Global Used Listings Search | USED MARKET');
    assert.equal(jsonLd.url, rawCanonical);
    assert.equal(jsonLd['@id'], `${rawCanonical}#website`);
    assert.match(jsonLd.description, /^Search and compare/u);
  }

  const domestic = await fetch(`${baseUrl}/?market=domestic`).then((response) => response.text());
  assert.match(domestic, /<html lang="ko">/u);
  assert.match(domestic, /<title>중고매물 통합검색 \| USED MARKET<\/title>/u);
  assert.match(domestic, /<link rel="canonical" href="https:\/\/used-pick\.com\/"/u);

  const firstSearch = fetch(`${baseUrl}/api/search`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ keyword: 'slow', sites: ['rakuma'] })
  });
  await slowSearchStarted;

  const rejected = await fetch(`${baseUrl}/api/search`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ keyword: 'second', sites: ['rakuma'] })
  });
  assert.equal(rejected.status, 429);
  assert.equal(rejected.headers.get('retry-after'), '7');
  assert.deepEqual(await rejected.json(), {
    status: 'error',
    error: 'Search capacity reached. Retry later.',
    code: 'SEARCH_CONCURRENCY_LIMIT',
    retry_after_seconds: 7
  });

  releaseSlowSearch();
  assert.equal((await firstSearch).status, 200);
  const afterRelease = await fetch(`${baseUrl}/api/search`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ keyword: 'after-release', sites: ['rakuma'] })
  });
  assert.equal(afterRelease.status, 200);

  const hiddenError = await fetch(`${baseUrl}/api/search`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ keyword: 'explode', sites: ['rakuma'] })
  });
  assert.equal(hiddenError.status, 500);
  const errorRequestId = hiddenError.headers.get('x-request-id');
  assert.match(errorRequestId || '', /^[0-9a-f-]{36}$/u);
  const hiddenErrorText = await hiddenError.text();
  assert.doesNotMatch(hiddenErrorText, new RegExp(escapeRegExp(internalMessage), 'u'));
  assert.deepEqual(JSON.parse(hiddenErrorText), { status: 'error', error: 'Internal error' });
  const productionLogs = capturedErrorLogs.join('\n');
  assert.doesNotMatch(productionLogs, new RegExp(escapeRegExp(internalMessage), 'u'));
  assert.match(productionLogs, new RegExp(escapeRegExp(errorRequestId), 'u'));
  assert.match(productionLogs, /error_name/u);

  console.log(JSON.stringify({
    status: 'passed',
    checks: 62,
    concurrency_policy: 'immediate-429',
    retry_after_seconds: 7
  }, null, 2));
} finally {
  releaseSlowSearch?.();
  server.close();
  if (server.listening) await once(server, 'close');
  console.error = originalConsoleError;
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
}
