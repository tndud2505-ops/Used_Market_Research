import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import {
  SEARCH_SESSION_MAX_ENTRIES,
  SEARCH_SESSION_MAX_ITEMS,
  SEARCH_SESSION_PAGE_SIZE,
  SEARCH_SESSION_TTL_MS,
  SearchSessionStore
} from '../dist/web-backend/logic/search-session-store.js';
import {
  createWebSearchRunner,
  validateWebSearchRequest,
  webSearchExecutionKey
} from '../dist/web-backend/logic/search-service.js';

assert.equal(SEARCH_SESSION_TTL_MS, 10 * 60 * 1000);
assert.equal(SEARCH_SESSION_MAX_ENTRIES, 32);
assert.equal(SEARCH_SESSION_MAX_ITEMS, 1000);
assert.equal(SEARCH_SESSION_PAGE_SIZE, 30);

let now = Date.parse('2026-08-20T00:00:00.000Z');
const store = new SearchSessionStore({ now: () => now });
let collectionCalls = 0;

const runner = createWebSearchRunner({
  now: () => now,
  sessionStore: store,
  collect: async (request) => {
    collectionCalls += 1;
    const continuation = request.siteCursors.ebay === 'offset:30';
    const items = continuation
      ? [
          webItem('ebay', 18, 18),
          ...Array.from({ length: 30 }, (_, index) => webItem('ebay', index + 40, index + 40))
        ]
      : [
          ...Array.from({ length: 20 }, (_, index) => webItem('ebay', index, index)),
          ...Array.from({ length: 20 }, (_, index) => webItem('poshmark', index + 20, index + 20)),
          { ...webItem('ebay', 18, 18), url: 'https://fixtures.example/ebay/18?campid=1&mkcid=2&mkevt=3&toolid=4&customid=5&var=6&utm_source=duplicate#tracking' }
        ];
    return payload(items, continuation ? null : cursor({ ebay: 'offset:30', poshmark: 'exhausted:v1' }));
  }
});

const baseRequest = {
  keyword: 'ram',
  sites: ['ebay', 'poshmark'],
  limit: 30,
  refresh_index: true
};

const first = await runner(baseRequest);
assert.equal(collectionCalls, 1);
assert.equal(first.data.items.length, 30);
assert.equal(first.data.session.page, 0);
assert.equal(first.data.session.page_size, 30);
assert.equal(first.data.session.loaded_count, 40, 'canonical tracking URL duplicate must be removed');
assert.equal(first.data.session.window, 40);
assert.equal(first.data.session.available_count, 40);
assert.deepEqual(first.data.session.source_totals, { ebay: 20, poshmark: 20 });
assert.equal(first.data.quality.available_count, 40);
assert.equal(first.data.summary.item_count, 40);
assert.equal(typeof first.data.session.id, 'string');
assert.equal(first.data.session.generation, 1);
assert.equal(first.data.session.expires_at, new Date(now + SEARCH_SESSION_TTL_MS).toISOString());

const sessionId = first.data.session.id;
assert.throws(
  () => validateWebSearchRequest({
    ...baseRequest,
    cursor: first.data.pagination.next_cursor
  }),
  /cursor requires session_id/,
  'unsigned cursor-only replay must be rejected'
);
const secondPage = await runner({
  ...baseRequest,
  session_id: sessionId,
  session_generation: 1,
  session_page: 1,
  session_only: true,
  session_window: 40,
  refresh_index: false
});
assert.equal(collectionCalls, 1, 'session_only page navigation must not call the collector');
assert.equal(secondPage.data.items.length, 10);
assert.equal(secondPage.data.session.page, 1);
assert.equal(secondPage.data.session.window, 40);

const hiddenOverflow = await runner({
  ...baseRequest,
  session_id: sessionId,
  session_generation: 1,
  session_page: 0,
  session_only: true,
  session_window: 30,
  refresh_index: false
});
assert.equal(hiddenOverflow.data.session.loaded_count, 40);
assert.equal(hiddenOverflow.data.session.available_count, 40, 'a smaller request must not shrink the authoritative session window');
assert.equal(hiddenOverflow.data.session.window, 40);
assert.deepEqual(hiddenOverflow.data.session.source_totals, { ebay: 20, poshmark: 20 });

const ebayView = await runner({
  ...baseRequest,
  session_id: sessionId,
  session_generation: 1,
  session_page: 0,
  session_only: true,
  view_sites: ['ebay'],
  sort: 'price_desc',
  min_price: 5,
  max_price: 15,
  refresh_index: false
});
assert.equal(collectionCalls, 1, 'view/sort/filter must reuse normalized session memory');
assert.deepEqual(ebayView.data.items.map((entry) => entry.price), [15, 14, 13, 12, 11, 10, 9, 8, 7, 6, 5]);
assert.equal(ebayView.data.session.available_count, 11);
assert.deepEqual(ebayView.data.session.source_totals, { ebay: 11, poshmark: 0 });
assert.equal(ebayView.data.sources.find((source) => source.key === 'ebay').total_count, 11);
assert.equal(ebayView.data.sources.find((source) => source.key === 'poshmark').total_count, 0);
assert.equal(ebayView.data.quality.available_count, 11);
assert.equal(ebayView.data.summary.item_count, 11);

await assert.rejects(
  () => runner({
    ...baseRequest,
    session_id: sessionId,
    session_generation: 1,
    cursor: cursor({ ebay: 'offset:60', poshmark: 'exhausted:v1' })
  }),
  /SESSION_MISMATCH/,
  'incoming continuation must exactly match the cursor stored in the session'
);
assert.equal(collectionCalls, 1);

const continuation = await runner({
  ...baseRequest,
  session_id: sessionId,
  session_generation: 1,
  cursor: first.data.pagination.next_cursor,
  session_page: 1,
  session_window: 60,
  refresh_index: true
});
assert.equal(collectionCalls, 2);
assert.equal(continuation.data.session.generation, 2);
assert.equal(continuation.data.session.loaded_count, 70, 'continuation must append 30 new canonical items');
assert.equal(continuation.data.session.window, 60);
assert.equal(continuation.data.session.available_count, 60);
assert.deepEqual(continuation.data.session.source_totals, { ebay: 40, poshmark: 20 });
assert.equal(continuation.data.summary.item_count, 60);
assert.equal(continuation.data.quality.available_count, 60);
assert.equal(continuation.data.sources.find((source) => source.key === 'ebay').total_count, 40);
assert.equal(continuation.data.sources.find((source) => source.key === 'poshmark').total_count, 20);
assert.equal(continuation.data.items.length, 30);
assert.equal(new Set(store.read(sessionId).items.map((entry) => entry.url)).size, 70);

for (const mismatched of [
  { ...baseRequest, keyword: 'ssd', session_id: sessionId, session_generation: 2, session_only: true },
  { ...baseRequest, sites: ['ebay'], session_id: sessionId, session_generation: 2, session_only: true },
  { ...baseRequest, category_id: 'pc', session_id: sessionId, session_generation: 2, session_only: true },
  { ...baseRequest, limit: 12, session_id: sessionId, session_generation: 2, session_only: true }
]) {
  await assert.rejects(
    () => runner(mismatched),
    /SESSION_MISMATCH/,
    'session replay with another query/category/source identity must fail'
  );
}

await assert.rejects(
  () => runner({
    ...baseRequest,
    session_id: sessionId,
    session_generation: 1,
    cursor: first.data.pagination.next_cursor
  }),
  /SESSION_MISMATCH/,
  'a stale continuation generation must fail before collector replay'
);
assert.equal(collectionCalls, 2, 'stale continuation replay must not call the collector');

let casCollectionCalls = 0;
const casRunner = createWebSearchRunner({
  sessionStore: new SearchSessionStore(),
  collect: async () => {
    casCollectionCalls += 1;
    return casCollectionCalls === 1
      ? payload([webItem('ebay', 500, 500)], cursor({ ebay: 'offset:30' }))
      : payload([webItem('ebay', 501, 501)], null);
  }
});
const casFirst = await casRunner({ keyword: 'ram', sites: ['ebay'], limit: 30 });
const casContinuation = {
  keyword: 'ram',
  sites: ['ebay'],
  limit: 30,
  session_id: casFirst.data.session.id,
  session_generation: 1,
  cursor: casFirst.data.pagination.next_cursor
};
const casResults = await Promise.allSettled([
  casRunner(casContinuation),
  casRunner(casContinuation)
]);
assert.equal(casResults.filter((result) => result.status === 'fulfilled').length, 1);
assert.equal(casResults.filter((result) => result.status === 'rejected' && /SESSION_MISMATCH/.test(String(result.reason))).length, 1);

const validated = validateWebSearchRequest({
  ...baseRequest,
  session_id: sessionId,
  session_generation: 2,
  session_page: 2,
  session_only: true,
  view_sites: ['ebay']
});
assert.equal(validated.sessionId, sessionId);
assert.equal(validated.sessionGeneration, 2);
assert.equal(validateWebSearchRequest({
  keyword: 'ram',
  sites: ['poshmark'],
  limit: 30,
  session_id: sessionId,
  session_generation: 2,
  session_page: 0,
  session_only: true,
  session_window: 1
}).sessionWindow, 1, 'a sparse session window returned by the server must round-trip');
assert.equal(validated.sessionPage, 2);
assert.equal(validated.sessionOnly, true);
assert.deepEqual(validated.viewSites, ['ebay']);
assert.throws(
  () => validateWebSearchRequest({ ...baseRequest, session_id: sessionId, session_only: true }),
  /session_id requires session_generation/
);
assert.match(webSearchExecutionKey({
  ...baseRequest,
  session_id: sessionId,
  session_generation: 2,
  session_only: true
}), new RegExp(`^session:${sessionId}$`));

const cappedStore = new SearchSessionStore();
const capped = cappedStore.create('cap', payload(
  Array.from({ length: 1100 }, (_, index) => webItem('ebay', index, index)),
  cursor({ ebay: 'offset:1000' })
).data);
assert.equal(capped.items.length, 1000);
assert.equal(capped.pagination.has_more, false);
assert.equal(capped.pagination.next_cursor, null);

const windowStore = new SearchSessionStore();
const windowed = windowStore.create('window', payload(
  Array.from({ length: 30 }, (_, index) => webItem('ebay', index, index)),
  cursor({ ebay: 'offset:30' })
).data);
assert.equal(windowed.windowLimit, 30);
assert.equal(windowStore.advanceWindow(windowed.id, 190).windowLimit, 190, '30 -> 190 is one authorized +160 step');
assert.equal(windowStore.advanceWindow(windowed.id, 350).windowLimit, 350, '190 -> 350 is one authorized +160 step');
assert.throws(
  () => windowStore.advanceWindow(windowed.id, 640),
  /at most 160/,
  '350 -> 640 must not bypass incremental expansion'
);

const ttlStore = new SearchSessionStore({ now: () => now });
const ttl = ttlStore.create('ttl', payload([webItem('ebay', 1, 1)], null).data);
now += SEARCH_SESSION_TTL_MS + 1;
assert.equal(ttlStore.read(ttl.id), null, 'idle sessions must expire after ten minutes');

let slidingNow = 10_000;
const slidingStore = new SearchSessionStore({ now: () => slidingNow });
const sliding = slidingStore.create('sliding', payload([webItem('ebay', 1, 1)], null).data);
slidingNow += SEARCH_SESSION_TTL_MS / 2;
assert.ok(slidingStore.read(sliding.id), 'a session hit must refresh its idle TTL');
slidingNow += SEARCH_SESSION_TTL_MS / 2 + 1;
assert.ok(slidingStore.read(sliding.id), 'sliding TTL is measured from the latest hit');
slidingNow += SEARCH_SESSION_TTL_MS + 1;
assert.equal(slidingStore.read(sliding.id), null);

const lruStore = new SearchSessionStore({ maxEntries: 2 });
const lruA = lruStore.create('lru:a', payload([webItem('ebay', 1, 1)], null).data).id;
const lruB = lruStore.create('lru:b', payload([webItem('ebay', 2, 2)], null).data).id;
assert.ok(lruStore.read(lruA), 'a hit must promote the session to most-recent');
const lruC = lruStore.create('lru:c', payload([webItem('ebay', 3, 3)], null).data).id;
assert.equal(lruStore.read(lruB), null, 'A, B, hit A, C must evict B');
assert.ok(lruStore.read(lruA));
assert.ok(lruStore.read(lruC));

now += SEARCH_SESSION_TTL_MS + 1;
await assert.rejects(
  () => runner({ ...baseRequest, session_id: sessionId, session_generation: 2, session_only: true }),
  /SESSION_EXPIRED/,
  'expired server sessions must fail explicitly'
);

const storeSource = await readFile(new URL('../web-backend/logic/search-session-store.ts', import.meta.url), 'utf8');
const serverSource = await readFile(new URL('../web-backend/logic/server.ts', import.meta.url), 'utf8');
assert.doesNotMatch(storeSource, /node:fs|writeFile|D1|sqlite|persist/i, 'sessions including eBay must remain memory-only');
assert.match(serverSource, /webSearchExecutionKey\(payload\)/, 'server concurrency must recognize cheap session-only requests');

console.log(JSON.stringify({
  status: 'passed',
  assertion_sites: 78,
  collection_calls: collectionCalls,
  session_policy: 'memory-only-10m-lru32-page30-max1000'
}, null, 2));

function webItem(site, number, price) {
  return {
    id: `${site}:${number}`,
    site,
    title: `RAM ${number}`,
    price,
    currency: 'USD',
    url: `https://fixtures.example/${site}/${number}`,
    posted_at: new Date(Date.parse('2026-08-20T00:00:00.000Z') - number * 1000).toISOString()
  };
}

function cursor(siteCursors) {
  return Buffer.from(JSON.stringify({ version: 1, site_cursors: siteCursors }), 'utf8').toString('base64url');
}

function payload(items, nextCursor) {
  const sites = [...new Set(items.map((entry) => entry.site))];
  return {
    status: 'success',
    data: {
      query: 'ram',
      pagination: { has_more: Boolean(nextCursor), next_cursor: nextCursor },
      searched_at: '2026-08-20T00:00:00.000Z',
      sources: sites.map((site) => {
        const count = items.filter((entry) => entry.site === site).length;
        return { key: site, count, normalized_count: count, extracted_count: count, filtered_count: 0, warnings: [], errors: [] };
      }),
      items,
      summary: { item_count: items.length, source_count: sites.length, suspect_count: 0 },
      quality: { raw_count: items.length, normalized_count: items.length, merged_count: items.length, available_count: items.length, filtered_out_count: 0, warnings: [] }
    }
  };
}
