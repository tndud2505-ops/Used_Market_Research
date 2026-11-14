import assert from 'node:assert/strict';
import { mock } from 'node:test';
import { setImmediate as nextTurn } from 'node:timers/promises';
import {
  parseDaangnSearchHtml, fetchDaangnSearch, daangnErrorDetails, DAANGN_SEARCH_MAX_BYTES,
  DAANGN_SEARCH_TIMEOUT_MS, DAANGN_DEFAULT_AREA,
} from '../collector/logic/daangn-public-search.mjs';

// Offline contract: reduced public SSR evidence from the two authorized GETs
// on 2026-11-10 KST. No network, DB, registry, credentials or fixture files.
// 00:11:27: RTX 3060 / 반월동-1783 -> 200, 161773 bytes, nine JSON-LD
// products and nine cards. The first card's actual location was 당산제1동.
// 00:17:10: unique zero-result query -> 200, 92923 bytes, no JSON-LD or
// listing anchors; observed empty component is reproduced below.
const observedAt = '2026-11-09T15:11:27.118Z';
const observedArea = '반월동-1783';
const context = { observedAt, query: 'RTX 3060', searchArea: observedArea };
const origin = 'https://www.daangn.com';
const escape = value => String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;')
  .replaceAll('>', '&gt;').replaceAll('"', '&quot;');
const observedSlug = '삽니다-고장난-그래픽카드-구매합니다-3060-3070-3080-3090-4080-5060-5070-rtx-b5m17av54qy6';
const observed = {
  '@type': 'Product', name: '[삽니다] 고장난 그래픽카드 구매합니다. 3060 3070 3080 3090 4080 5060 5070 rtx',
  description: '부품 조립 지식 쌓아볼겸\n불량 그래픽카드 구매해봅니다.',
  image: 'https://img.kr.gcp-karroter.net/origin/article/202608/11774a0ead2bedbaecc8e03964666f714ede72396b6c78e2b2dab49c52a2b305_0.webp?q=95&s=1440x1440&t=inside&service=web-mixer',
  url: `${origin}/kr/buy-sell/${encodeURIComponent(observedSlug)}/`,
  offers: { '@type': 'Offer', price: '199999', priceCurrency: 'KRW',
    itemCondition: 'https://schema.org/UsedCondition', availability: 'https://schema.org/InStock' },
};
function product(id, overrides = {}) {
  return { ...observed, name: `RTX 3060 ${id}`, url: `${origin}/kr/buy-sell/rtx-3060-${id}/`, ...overrides };
}
function offer(overrides = {}) { return { ...observed.offers, ...overrides }; }
function ld(items) {
  return `<script type="application/ld+json">${JSON.stringify({ '@context': 'https://schema.org',
    '@type': 'ItemList', numberOfItems: items.length,
    itemListElement: items.map((item, index) => ({ '@type': 'ListItem', position: index + 1, item })),
  })}</script>`;
}
const badge = '<div class="seed-box"><svg data-seed-icon="true" aria-hidden="true"><g><path d="M1 2"></path></g></svg>'
  + '<span class="seed-text seed-text--textStyle_t1Bold">바로구매</span></div>';
function card(item, { location = '당산제1동', buyNow = true, href = item.url, title = item.name, extra = '' } = {}) {
  return `<li><a href="${escape(href)}" data-discover="true" title="1 > 0">
    <div class="seed-box"><div><noscript><span><img src="${escape(item.image)}" alt="thumbnail"/></span></noscript></div>
    <div class="seed-box"><div class="seed-box">
      <span class="seed-text seed-text--textStyle_t5Regular">${escape(title)}</span>
      <span class="seed-text seed-text--textStyle_t5Bold">${Number(item.offers.price).toLocaleString('en-US')}원</span>
    </div><span class="seed-tag-group__root">
      ${location === null ? '' : `<span class="seed-tag-group-item__root"><span class="seed-tag-group-item__label"><span class="_1588g1c0">${escape(location)}</span></span></span>`}
      <span aria-hidden="true" class="seed-tag-group__separator"> · </span>
      <span class="seed-tag-group-item__root"><span class="seed-tag-group-item__label"><span><time dateTime="2026-11-07T10:37:31.015Z">2일 전</time></span></span></span>
    </span>${buyNow ? badge : ''}${extra}</div></div></a></li>`;
}
function page(items, cards, extra = '') {
  return `<!DOCTYPE html><html><head>${ld(items)}</head><body><main>
    <header>${escape(observedArea)} ${badge}</header><ul>${cards.join('')}</ul>${extra}</main></body></html>`;
}
const bundle = product('bundle000001', { name: 'RTX 3060 + 본체 일괄 세트', offers: offer({ price: '350000' }) });
const sold = product('sold00000001', { offers: offer({ availability: 'https://schema.org/SoldOut' }) });
const unknownStock = product('unknownstock', { offers: offer({ availability: 'https://schema.org/PreOrder' }) });
const missingLocation = product('missing00001', { description: 'captcha 키캡 & <div> 포함\n일괄', offers: offer({ price: '0' }) });
const noBadge = product('nobadge00001', { name: '바로구매' });
const ldOnly = product('ldonly000001');
const cardOnly = product('cardonly0001');
const cards = [card(sold, { location: '역삼동' }), card(noBadge, { buyNow: false, location: '잠실동' }),
  card(missingLocation, { location: null }), card(bundle, { location: '강일동' }),
  card(observed, { href: `/kr/buy-sell/${observedSlug}/?source=search&sort=recent#card` }),
  card(unknownStock), card(cardOnly)];
const fixture = page([observed, bundle, sold, unknownStock, missingLocation, noBadge, ldOnly], cards,
  `<script>const ignored = ${JSON.stringify(card(ldOnly))}; const less = 2 < 3;</script>`);
const result = parseDaangnSearchHtml(fixture, context);
assert.deepEqual(result.items.map(item => [item.id, item.location, item.price]), [
  ['b5m17av54qy6', '당산제1동', 199999], ['bundle000001', '강일동', 350000], ['missing00001', null, 0],
], 'canonical URL join must survive shuffled cards without mixing badge/region evidence');
assert.deepEqual(result.items[0], {
  id: 'b5m17av54qy6', url: observed.url, title: observed.name, price: 199999, currency: 'KRW',
  location: '당산제1동', description: observed.description, image_url: observed.image,
  lifecycle_status: 'ACTIVE', shipping_evidence: 'BUY_NOW_BADGE', shipping_fee: null,
  observed_at: observedAt, query: context.query, search_area: observedArea,
});
assert.equal(result.items[2].description, missingLocation.description, 'preserve candidate text for separate classification');
assert.equal(result.diagnostics.missing_location_count, 1);
assert.equal(result.diagnostics.unmatched_jsonld_count, 1);
assert.equal(result.diagnostics.unmatched_card_count, 1);
assert.equal(result.diagnostics.joined_count, 6);
assert.equal(result.diagnostics.excluded_not_in_stock_count, 2);
assert.equal(result.diagnostics.excluded_no_buy_now_count, 1);
assert.equal(result.diagnostics.exhaustive, false);
assert.equal(result.diagnostics.checkout_verified, false);
assert.equal(result.items.some(item => item.location === observedArea), false);

const duplicate = parseDaangnSearchHtml(page([observed, { ...observed, url: observed.url + '?ref=duplicate' }],
  [card(observed), card(observed, { href: observed.url + '#duplicate' })]), context);
assert.equal(duplicate.items.length, 1);
assert.throws(() => parseDaangnSearchHtml(page([observed], [card(observed), card(observed, { location: '강일동' })]), context), /CONFLICTING_CARDS/u);
for (const marker of [null, '—', '지역 미상']) {
  const missing = parseDaangnSearchHtml(page([observed], [card(observed, { location: marker })]), context);
  assert.equal(missing.items[0].location, null);
  assert.equal(missing.diagnostics.missing_location_count, 1);
}
const entityRegion = page([observed], [card(observed)]).replace('당산제1동', '당산제&#49;동');
assert.equal(parseDaangnSearchHtml(entityRegion, context).items[0].location, '당산제1동');
const excluded = parseDaangnSearchHtml(page([sold, noBadge], [card(sold), card(noBadge, { buyNow: false })]), context);
assert.deepEqual(excluded.items, []);
assert.equal(excluded.diagnostics.empty_reason, 'NO_ELIGIBLE_BUY_NOW_IN_STOCK');

const emptyQuery = '__USED_PICK_EMPTY_20261110_79e3a8b0__';
const emptyContext = { ...context, query: emptyQuery };
const emptyMarker = '<div class="sprinkles_display_flex_base__1byufe82i sprinkles_alignItems_center_base__1byufe8si sprinkles_justifyContent_center_base__1byufe8su sprinkles_flexDirection_column_base__1byufe8te sprinkles_width_full_base__1byufe84q sprinkles_gap_2.5_base__1byufe8sa _1pxmuhp0"><span class="sprinkles_fontSize_300_base__1byufe8uy sprinkles_fontWeight_semibold__1byufe81y sprinkles_lineHeight_body.large_base__1byufe8wa sprinkles_color_neutral__1byufe81">검색 결과가 없어요.</span></div>';
const emptyPage = `<html><head></head><body><main><nav aria-label="검색 결과 서비스">
  <a href="/kr/search/buy-sell/?in=${encodeURIComponent(observedArea)}&amp;q=${emptyQuery}" aria-current="page">중고거래</a>
  </nav><h1><span>“${emptyQuery}” 중고거래 검색 결과</span></h1><div class="_1cjs0icr">${emptyMarker}</div></main></body></html>`;
const empty = parseDaangnSearchHtml(emptyPage, emptyContext);
assert.deepEqual(empty.items, []);
assert.equal(empty.diagnostics.empty_reason, 'EXPLICIT_NO_RESULTS');
assert.equal(empty.diagnostics.empty_marker, '검색 결과가 없어요.');
assert.equal(empty.diagnostics.jsonld_item_count, 0);
assert.equal(empty.diagnostics.card_count, 0);
assert.equal(parseDaangnSearchHtml(emptyPage.replace('</head>', '<script type="application/ld+json">{broken</script></head>'), emptyContext)
  .diagnostics.jsonld_parse_error_count, 1, 'the authoritative empty component is independent evidence');
assert.throws(() => parseDaangnSearchHtml(emptyPage.replace('</head>', ld([observed]) + '</head>'), emptyContext), /EMPTY_MARKER_CONTRADICTS_JSONLD/u);

for (const broken of [
  '', '<html><main>loading</main></html>', ld([]), ld([observed]), card(observed),
  '<script type="application/ld+json">{broken</script>',
  page([observed], [card(bundle)]),
  page([observed], [card(observed)]).replace('seed-text--textStyle_t5Regular', 'unrecognized-title'),
  page([observed], [card(observed)]).replace('</div></div></a>', '</a>'),
  emptyPage.replace(emptyMarker, ''), emptyPage.replace('aria-current="page"', ''),
  emptyPage.replace(emptyMarker, `<template>${emptyMarker}</template>`),
  emptyPage.replace(emptyMarker, `<div hidden>${emptyMarker}</div>`),
]) assert.throws(() => parseDaangnSearchHtml(broken, emptyContext), error => error.code === 'DAANGN_SEARCH_PARSE_ERROR');
assert.throws(() => parseDaangnSearchHtml(emptyPage, { ...context, query: 'different query' }), /ITEMLIST_MISSING/u);
assert.throws(() => parseDaangnSearchHtml(page([{ ...observed, url: 'https://evil.example/kr/buy-sell/other/' }], [card(observed)]), context), /INVALID_LISTING_URL/u);

for (const block of ['<title>Access denied</title>', '<h1>Verify you are human</h1>',
  '<form id="challenge-form"><p>CAPTCHA</p></form>', '<div class="g-recaptcha"></div>',
  '<script src="/cdn-cgi/challenge-platform/test"></script>']) {
  assert.throws(() => parseDaangnSearchHtml(block + emptyPage, emptyContext), error => error.code === 'DAANGN_SEARCH_BLOCKED' && error.stop);
}

let requests = 0;
const response = (body, init = {}) => new Response(body, { ...init, headers: { 'content-type': 'text/html', ...init.headers } });
assert.equal(DAANGN_DEFAULT_AREA, null);
const fetched = await fetchDaangnSearch('RTX 3060 & RX', { fetchImpl: async (input, init) => {
  requests++;
  const url = new URL(input);
  assert.equal(url.origin, origin);
  assert.equal(url.pathname, '/kr/search/buy-sell/');
  assert.equal(input, `${origin}/kr/search/buy-sell/?only_on_sale=true&q=RTX+3060+%26+RX`);
  assert.deepEqual(Object.fromEntries(url.searchParams), { only_on_sale: 'true', q: 'RTX 3060 & RX' });
  assert.equal(init.method, 'GET');
  assert.equal(init.redirect, 'error');
  assert.equal(init.credentials, 'omit');
  assert.deepEqual(init.headers, { accept: 'text/html' });
  assert.equal(init.signal.aborted, false);
  const canonical = response(fixture);
  Object.defineProperty(canonical, 'url', { value: input });
  return canonical;
} });
assert.equal(requests, 1);
assert.equal(fetched.items.length, 3);
assert.equal(fetched.items[0].location, '당산제1동');
assert.deepEqual(fetched.items.map(item => item.location), result.items.map(item => item.location));
assert.ok(fetched.items.every(item => item.search_area === null));
assert.equal(fetched.diagnostics.search_area, null);
assert.equal(fetched.diagnostics.status, 200);
assert.ok(Number.isFinite(Date.parse(fetched.items[0].observed_at)));
const scoped = await fetchDaangnSearch('CPU', { area: observedArea, fetchImpl: async input => {
  assert.deepEqual(Object.fromEntries(new URL(input).searchParams), { in: observedArea, only_on_sale: 'true', q: 'CPU' });
  return response(fixture);
} });
assert.equal(scoped.diagnostics.search_area, observedArea);
assert.ok(scoped.items.every(item => item.search_area === observedArea));
assert.deepEqual(scoped.items.map(item => item.location), result.items.map(item => item.location));
const canonicalEmptyPage = emptyPage.replace(`in=${encodeURIComponent(observedArea)}&amp;q=`, 'only_on_sale=true&amp;q=');
for (const html of [emptyPage, canonicalEmptyPage]) {
  const emptyFetched = await fetchDaangnSearch(emptyQuery, { fetchImpl: async () => response(html) });
  assert.equal(emptyFetched.diagnostics.empty_reason, 'EXPLICIT_NO_RESULTS');
  assert.equal(emptyFetched.diagnostics.search_area, null);
}
const mismatched = response(fixture);
Object.defineProperty(mismatched, 'url', { value: `${origin}/kr/search/buy-sell/?in=${encodeURIComponent(observedArea)}&only_on_sale=true&q=CPU` });
await assert.rejects(fetchDaangnSearch('CPU', { fetchImpl: async () => mismatched }), /DAANGN_SEARCH_RESPONSE_URL_MISMATCH/u);
let canonicalRedirectCalls = 0;
await assert.rejects(fetchDaangnSearch('CPU', { area: observedArea, fetchImpl: async () => {
  canonicalRedirectCalls++;
  return response('', { status: 301, headers: { location: '/kr/search/buy-sell/?only_on_sale=true&q=CPU' } });
} }), /DAANGN_SEARCH_REDIRECT/u);
assert.equal(canonicalRedirectCalls, 1, 'even same-origin canonical redirects are not followed');
for (const status of [403, 429]) {
  let cancelled = false;
  await assert.rejects(fetchDaangnSearch('CPU', { fetchImpl: async () => {
    requests++;
    return response(new ReadableStream({ cancel() { cancelled = true; } }), { status });
  } }), error => {
    const details = JSON.parse(JSON.stringify(daangnErrorDetails(error)));
    assert.equal(details.code, `DAANGN_SEARCH_HTTP_${status}`);
    assert.equal(details.diagnostics.status, status);
    assert.equal(details.retryable, false);
    return error.stop;
  });
  assert.equal(cancelled, true);
}
assert.equal(requests, 3, 'blocked responses are never retried');
await assert.rejects(fetchDaangnSearch('CPU', { fetchImpl: async () => response('<h1>CAPTCHA</h1>') }), error => error.stop && error.code === 'DAANGN_SEARCH_BLOCKED');
await assert.rejects(fetchDaangnSearch('CPU', { fetchImpl: async () => response('', { headers: { 'cf-mitigated': 'challenge' } }) }), error => error.stop);
await assert.rejects(fetchDaangnSearch('CPU', { fetchImpl: async () => response('', { status: 302 }) }), /DAANGN_SEARCH_REDIRECT/u);
await assert.rejects(fetchDaangnSearch('CPU', { fetchImpl: async () => { throw new TypeError('redirect refused'); } }), /DAANGN_SEARCH_FETCH_ERROR/u);

// Real fetch wraps transport/redirect errors in TypeError.cause. Exercise that
// shape through the adapter, retaining the original exception without retries.
for (const code of ['EAI_AGAIN', 'ECONNRESET', 'ETIMEDOUT', 'UND_ERR_CONNECT_TIMEOUT',
  'UND_ERR_SOCKET', 'UND_ERR_HEADERS_TIMEOUT', 'UND_ERR_BODY_TIMEOUT']) {
  const transport = Object.assign(new Error(`transport ${code}`), { code });
  const original = new TypeError('fetch failed', { cause: transport });
  let calls = 0;
  await assert.rejects(fetchDaangnSearch('CPU', { fetchImpl: async () => { calls++; throw original; } }), error => {
    assert.equal(error.cause, original);
    assert.equal(original.cause, transport);
    assert.deepEqual(JSON.parse(JSON.stringify(daangnErrorDetails(error))), {
      code: 'DAANGN_SEARCH_FETCH_ERROR', message: 'DAANGN_SEARCH_FETCH_ERROR: Public search request or stream failed',
      cause: { name: 'Error', code, message: `transport ${code}` },
      diagnostics: { url: `${origin}/kr/search/buy-sell/`, status: null, reason: 'Public search request or stream failed' },
      retryable: true,
    });
    return true;
  });
  assert.equal(calls, 1);
}
const refusedRedirect = new TypeError('fetch failed', { cause: new Error('unexpected redirect') });
await assert.rejects(fetchDaangnSearch('CPU', { fetchImpl: async () => { throw refusedRedirect; } }), error => {
  assert.equal(error.code, 'DAANGN_SEARCH_REDIRECT');
  assert.equal(error.cause, refusedRedirect);
  assert.equal(daangnErrorDetails(error).retryable, false);
  return true;
});
for (const status of [500, 502, 503, 504, 501]) {
  await assert.rejects(fetchDaangnSearch('CPU', { fetchImpl: async () => response('', { status }) }), error => {
    assert.equal(daangnErrorDetails(error).retryable, status !== 501);
    return true;
  });
}
for (const html of ['<title>Access denied</title>', '<form id="challenge-form"><p>CAPTCHA</p></form>',
  '<script src="/cdn-cgi/challenge-platform/test"></script>']) {
  let calls = 0;
  await assert.rejects(fetchDaangnSearch('CPU', { fetchImpl: async () => {
    calls++;
    return response(html, { status: 503 });
  } }), error => {
    const details = daangnErrorDetails(error);
    assert.equal(details.code, 'DAANGN_SEARCH_BLOCKED');
    assert.equal(details.diagnostics.status, 503);
    assert.equal(details.retryable, false);
    return error.stop;
  });
  assert.equal(calls, 1, 'a 503 challenge must stop without an adapter retry');
}
for (const [body, headers] of [
  ['<h1>Service temporarily unavailable</h1>', {}],
  ['Service temporarily unavailable', { 'content-type': 'text/plain' }],
  [null, {}],
]) {
  let calls = 0;
  await assert.rejects(fetchDaangnSearch('CPU', { fetchImpl: async () => {
    calls++;
    return response(body, { status: 503, headers });
  } }), error => {
    const details = daangnErrorDetails(error);
    assert.equal(details.code, 'DAANGN_SEARCH_HTTP_503');
    assert.equal(details.diagnostics.status, 503);
    assert.equal(details.retryable, true);
    return !error.stop;
  });
  assert.equal(calls, 1, 'a nonchallenge 503 remains retryable by the caller only');
}
for (const code of ['DAANGN_SEARCH_HTTP_403', 'DAANGN_SEARCH_HTTP_429', 'DAANGN_SEARCH_BLOCKED',
  'DAANGN_SEARCH_PARSE_ERROR', 'DAANGN_SEARCH_REDIRECT', 'CERT_HAS_EXPIRED', 'ERR_TLS_CERT_ALTNAME_INVALID', 'UNKNOWN_CODE']) {
  assert.equal(daangnErrorDetails(Object.assign(new Error('terminal'), {
    code, cause: Object.assign(new Error('transient cause cannot override denial'), { code: 'ECONNRESET' }),
  })).retryable, false, code);
}
const unsafe = Object.assign(new Error('request https://operator:url-secret@example.test/search?token=query-secret#fragment-secret Authorization: Bearer auth-secret'), {
  code: 'UNKNOWN_CODE', env: { PRIVATE: 'env-secret' }, headers: { cookie: 'cookie-secret' },
  diagnostics: { url: 'https://operator:url-secret@www.daangn.com/kr/search/buy-sell/?token=query-secret#fragment-secret',
    status: 403, reason: 'API_KEY=reason-secret', extra: { nested: 'nested-secret' } },
});
unsafe.cause = unsafe;
const safe = daangnErrorDetails(unsafe);
assert.deepEqual(Object.keys(safe), ['code', 'message', 'cause', 'diagnostics', 'retryable']);
assert.deepEqual(safe.diagnostics, { url: `${origin}/kr/search/buy-sell/`, status: 403, reason: '[REDACTED]' });
assert.equal(safe.cause, null);
assert.equal(safe.retryable, false);
assert.doesNotMatch(JSON.stringify(safe), /secret|operator|stack|headers|env|extra/u);
assert.deepEqual(daangnErrorDetails({ code: 1n, message: {}, diagnostics: { url: {}, status: 1n, reason: {} } }), {
  code: 'UNKNOWN', message: 'Unknown error', cause: null,
  diagnostics: { url: null, status: null, reason: null }, retryable: false,
});
assert.ok(daangnErrorDetails({ message: 'x'.repeat(20_000) }).message.length <= 256);
let deepCause = Object.assign(new Error('too deep'), { code: 'ECONNRESET' });
for (let depth = 0; depth < 9; depth++) deepCause = new Error('wrapper', { cause: deepCause });
assert.equal(daangnErrorDetails(deepCause).retryable, false, 'cause traversal must be bounded');

for (const status of [200, 503]) {
  let sizeCancelled = false;
  await assert.rejects(fetchDaangnSearch('CPU', { fetchImpl: async () => response(new ReadableStream({
    start(controller) { controller.enqueue(new Uint8Array(DAANGN_SEARCH_MAX_BYTES)); controller.enqueue(new Uint8Array(1)); },
    cancel() { sizeCancelled = true; },
  }), { status }) }), /DAANGN_SEARCH_BODY_LIMIT/u);
  assert.equal(sizeCancelled, true);
  await assert.rejects(fetchDaangnSearch('CPU', { fetchImpl: async () => response('', { status, headers: {
    'content-length': String(DAANGN_SEARCH_MAX_BYTES + 1),
  } }) }), /DAANGN_SEARCH_BODY_LIMIT/u);
}
const exactLimit = emptyPage + ' '.repeat(DAANGN_SEARCH_MAX_BYTES - Buffer.byteLength(emptyPage));
assert.equal((await fetchDaangnSearch(emptyQuery, { fetchImpl: async () => response(exactLimit) })).items.length, 0);
assert.throws(() => parseDaangnSearchHtml('한'.repeat(Math.floor(DAANGN_SEARCH_MAX_BYTES / 3) + 1)), /DAANGN_SEARCH_BODY_LIMIT/u);

const preAborted = new AbortController();
const abortReason = new Error('contract cancellation');
preAborted.abort(abortReason);
await assert.rejects(fetchDaangnSearch('CPU', { signal: preAborted.signal,
  fetchImpl: async () => assert.fail('pre-aborted call must not fetch') }), error => error === abortReason);
const midAbort = new AbortController();
let midCancelled = false;
const inFlight = fetchDaangnSearch('CPU', { signal: midAbort.signal, fetchImpl: async () => response(new ReadableStream({
  cancel() { midCancelled = true; },
})) });
const abortCheck = assert.rejects(inFlight, error => error === abortReason);
await nextTurn();
midAbort.abort(abortReason);
await abortCheck;
assert.equal(midCancelled, true);

// Advance only the timer, testing both headers and body stalls without a live
// wait or a fetch implementation that cooperates with AbortSignal.
assert.ok(DAANGN_SEARCH_TIMEOUT_MS <= 15_000);
for (const stage of ['headers', 'body', '503-body']) {
  mock.timers.enable({ apis: ['setTimeout'] });
  let boundedSignal, timeoutCancelled = false;
  try {
    const pending = fetchDaangnSearch('CPU', { fetchImpl: (_url, init) => {
      boundedSignal = init.signal;
      return stage === 'headers' ? new Promise(() => {}) : response(new ReadableStream({
        cancel() { timeoutCancelled = true; return new Promise(() => {}); },
      }), { status: stage === '503-body' ? 503 : 200 });
    } });
    const timeoutCheck = assert.rejects(pending, error => error.code === 'DAANGN_SEARCH_TIMEOUT'
      && daangnErrorDetails(error).retryable);
    await nextTurn();
    mock.timers.tick(DAANGN_SEARCH_TIMEOUT_MS);
    await timeoutCheck;
    assert.equal(boundedSignal.aborted, true);
    if (stage !== 'headers') assert.equal(timeoutCancelled, true);
  } finally { mock.timers.reset(); }
}
console.log('PASS daangn public search: canonical joins, actual regions, candidates, authoritative/filtered empty results, blocking, bounded fetch and safe error diagnostics');
