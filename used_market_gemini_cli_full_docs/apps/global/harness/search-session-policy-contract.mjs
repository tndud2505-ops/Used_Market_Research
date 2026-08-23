import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import { resolveBrowserSiteAdapter } from '../dist/collector/logic/sites/index.js';
import {
  createWebSearchRunner,
  validateWebSearchRequest
} from '../dist/web-backend/logic/search-service.js';
import {
  RESULT_PAGE_SIZE,
  RESULT_WINDOW_MAX,
  paginationControlItems,
  resultPageCount
} from '../web-backend/public/pagination.mjs';

const failures = [];
let checks = 0;
const TEST_SESSION = { session_id: '00000000-0000-4000-8000-000000000001', session_generation: 1 };

async function checkContract(name, contract) {
  checks += 1;
  try {
    await contract();
  } catch (error) {
    failures.push(`${name}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function siteCursor(site, cursor) {
  return Buffer.from(JSON.stringify({
    version: 1,
    site_cursors: { [site]: cursor }
  }), 'utf8').toString('base64url');
}

function item(number, site = 'poshmark', price = number + 1) {
  return {
    id: `${site}:${number}`,
    site,
    title: `RAM listing ${number}`,
    price,
    currency: 'USD',
    url: `https://fixtures.example/${site}/${number}`
  };
}

function page(items, nextCursor, site = 'poshmark') {
  return {
    status: 'success',
    query: 'ram',
    items,
    sources: [{
      key: site,
      count: items.length,
      normalized_count: items.length,
      visible_count: items.length,
      status: 'ready',
      warnings: [],
      errors: []
    }],
    pagination: { has_more: Boolean(nextCursor), next_cursor: nextCursor },
    summary: { item_count: items.length, source_count: items.length ? 1 : 0 },
    quality: {
      raw_count: items.length,
      normalized_count: items.length,
      merged_count: items.length,
      available_count: items.length,
      filtered_out_count: 0,
      warnings: []
    }
  };
}

const appSource = await readFile(new URL('../web-backend/public/app.js', import.meta.url), 'utf8');
const htmlSource = await readFile(new URL('../web-backend/public/index.html', import.meta.url), 'utf8');
const cssSource = await readFile(new URL('../web-backend/public/styles.css', import.meta.url), 'utf8');
const orchestratorSource = await readFile(new URL('../MCP/logic/orchestrator.ts', import.meta.url), 'utf8');

await checkContract('established page and session limits', () => {
  assert.equal(RESULT_PAGE_SIZE, 30, 'each visible page must contain 30 listings');
  assert.equal(RESULT_WINDOW_MAX, 1000, 'a search session must cap its loaded result window at 1000');
  assert.equal(resultPageCount(1000), 34);
  assert.match(appSource, /const SEARCH_SESSION_MAX_ITEMS = 1000;/);
  assert.match(appSource, /items\.slice\(start, start \+ RESULT_PAGE_SIZE\)/);
});

await checkContract('pagination assets are cache-busted and retain both direction controls', () => {
  assert.match(htmlSource, /\/global\/styles\.css\?v=global-pagination-v4/);
  assert.match(htmlSource, /\/global\/app\.js\?v=global-pagination-v6/);
  assert.doesNotMatch(cssSource, /body\s*\{[^}]*min-width:\s*320px/);
  assert.match(appSource, />Previous<\/button>/);
  assert.match(appSource, />Next<\/button>/);
});

await checkContract('pagination exposes loaded reachability, one next page, and a truthful locked continuation', () => {
  assert.deepEqual(
    paginationControlItems({ currentPage: 0, loadedPageCount: 3, canLoadNext: true }),
    [
      { type: 'page', page: 0, state: 'loaded' },
      { type: 'page', page: 1, state: 'loaded' },
      { type: 'page', page: 2, state: 'loaded' },
      { type: 'page', page: 3, state: 'next' },
      { type: 'continuation', state: 'locked' }
    ]
  );
  assert.deepEqual(
    paginationControlItems({ currentPage: 5, loadedPageCount: 12, canLoadNext: true }),
    [
      { type: 'page', page: 0, state: 'loaded' },
      { type: 'ellipsis' },
      { type: 'page', page: 4, state: 'loaded' },
      { type: 'page', page: 5, state: 'loaded' },
      { type: 'page', page: 6, state: 'loaded' },
      { type: 'ellipsis' },
      { type: 'page', page: 11, state: 'loaded' },
      { type: 'page', page: 12, state: 'next' },
      { type: 'continuation', state: 'locked' }
    ],
    'long sessions must keep first, last, current neighbors, and the reachable next page without rendering every number'
  );
  assert.deepEqual(
    paginationControlItems({ currentPage: 2, loadedPageCount: 3, canLoadNext: false }),
    [
      { type: 'page', page: 0, state: 'loaded' },
      { type: 'page', page: 1, state: 'loaded' },
      { type: 'page', page: 2, state: 'loaded' }
    ],
    'no speculative continuation is shown when the session cannot continue'
  );
});

await checkContract('additional pages accumulate, deduplicate, and stop at 1000', () => {
  const mergeStart = appSource.indexOf('function mergeSearchData(previous, next)');
  const mergeEnd = appSource.indexOf('\nrenderMarketProfile()', mergeStart);
  assert.ok(mergeStart >= 0 && mergeEnd > mergeStart, 'mergeSearchData implementation must exist');
  const mergeBlock = appSource.slice(mergeStart, mergeEnd);
  const mergeSearchData = Function(
    `'use strict'; const SEARCH_SESSION_MAX_ITEMS = 1000; ${mergeBlock}; return mergeSearchData;`
  )();

  const first = page(Array.from({ length: 30 }, (_, index) => item(index)), 'page:2');
  const second = page(Array.from({ length: 30 }, (_, index) => item(index + 25)), 'page:3');
  const accumulated = mergeSearchData(first, second);
  assert.equal(accumulated.items.length, 55, 'five cross-page duplicates must be removed');
  assert.equal(new Set(accumulated.items.map((entry) => entry.url)).size, 55);

  const largeContinuation = page(
    Array.from({ length: 1100 }, (_, index) => item(index + 55)),
    'page:4'
  );
  const capped = mergeSearchData(accumulated, largeContinuation);
  assert.equal(capped.items.length, 1000);
  assert.deepEqual(capped.pagination, { has_more: false, next_cursor: null });
});

await checkContract('cursor capability is declared per US source', () => {
  assert.equal(resolveBrowserSiteAdapter('ebay').searchPagination, 'offset');
  assert.equal(resolveBrowserSiteAdapter('vinted').searchPagination, 'page');
  assert.equal(resolveBrowserSiteAdapter('unclaimed_baggage').searchPagination, 'page');
  assert.equal(resolveBrowserSiteAdapter('poshmark').searchPagination, 'none');

  assert.equal(validateWebSearchRequest({
    ...TEST_SESSION,
    keyword: 'ram', sites: ['ebay'], cursor: siteCursor('ebay', 'offset:30')
  }).siteCursors.ebay, 'offset:30');
  assert.equal(validateWebSearchRequest({
    ...TEST_SESSION,
    keyword: 'ram', sites: ['vinted'], cursor: siteCursor('vinted', 'page:2')
  }).siteCursors.vinted, 'page:2');
  assert.throws(
    () => validateWebSearchRequest({
      ...TEST_SESSION,
      keyword: 'ram', sites: ['poshmark'], cursor: siteCursor('poshmark', 'page:2')
    }),
    /cursor is invalid or expired for poshmark/,
    'a source with searchPagination=none must reject synthetic page cursors'
  );
});

await checkContract('exhausted sources are not recollected', () => {
  const loopStart = orchestratorSource.indexOf('for (const siteKey of input.sites)');
  const searchStart = orchestratorSource.indexOf('const search = await this.search', loopStart);
  assert.ok(loopStart >= 0 && searchStart > loopStart, 'fullWorkflow source loop must exist');
  const beforeSearch = orchestratorSource.slice(loopStart, searchStart);
  assert.match(
    beforeSearch,
    /siteCursors\?\.\[siteKey\]\s*===\s*["']exhausted:v1["'][\s\S]{0,220}?continue;/,
    'exhausted:v1 must skip the source before any search call'
  );
});

await checkContract('sort and price filters reuse one loaded collection', async () => {
  let collectionCalls = 0;
  const runner = createWebSearchRunner({
    cacheTtlMs: 60_000,
    collect: async () => {
      collectionCalls += 1;
      return {
        status: 'success',
        data: page([item(1, 'poshmark', 30), item(2, 'poshmark', 10), item(3, 'poshmark', 20)], null)
      };
    }
  });

  await runner({
    keyword: 'ram', sites: ['poshmark'], sort: 'recommended', refresh_index: false
  });
  const filtered = await runner({
    keyword: 'ram', sites: ['poshmark'], sort: 'price_asc', min_price: 15, refresh_index: false
  });
  assert.equal(collectionCalls, 1, 'sort/filter changes must not recollect the same loaded session');
  assert.deepEqual(filtered.data.items.map((entry) => entry.price), [20, 30]);

  const sortHandlerStart = appSource.indexOf("$$('[data-sort]')");
  const sortHandlerEnd = appSource.indexOf("$('#result-list').addEventListener", sortHandlerStart);
  const sortHandler = appSource.slice(sortHandlerStart, sortHandlerEnd);
  assert.doesNotMatch(sortHandler, /executeSearch\(/);
  assert.match(sortHandler, /renderAll\(\)/);
  const filterStart = appSource.indexOf('function applyPriceFilter()');
  const filterEnd = appSource.indexOf("$('#apply-price-filter')", filterStart);
  const filterHandler = appSource.slice(filterStart, filterEnd);
  assert.doesNotMatch(filterHandler, /executeSearch\(/);
  assert.match(filterHandler, /renderAll\(\)/);
});

await checkContract('UI sends the server session view contract without replacing legacy search fields', () => {
  assert.match(appSource, /sessionId:\s*null/);
  assert.match(appSource, /sessionGeneration:\s*null/);
  assert.match(appSource, /collectionData:\s*null/);
  assert.match(appSource, /viewData:\s*new Map\(\)/);

  const requestStart = appSource.indexOf('async function requestSearchPage');
  const requestEnd = appSource.indexOf('\nfunction ', requestStart + 20);
  const requestSource = appSource.slice(requestStart, requestEnd);
  assert.match(requestSource, /session_id:\s*sessionId\s*\|\|\s*undefined/);
  assert.match(requestSource, /session_generation:\s*Number\.isInteger\(sessionGeneration\)\s*\?\s*sessionGeneration\s*:\s*undefined/);
  assert.match(requestSource, /session_page:\s*Number\.isInteger\(sessionPage\)\s*\?\s*sessionPage\s*:\s*undefined/);
  assert.match(requestSource, /session_only:\s*sessionOnly\s*\|\|\s*undefined/);
  assert.match(requestSource, /session_window:\s*Number\.isInteger\(sessionWindow\)\s*\?\s*sessionWindow\s*:\s*undefined/);
  assert.match(requestSource, /view_sites:\s*viewSites\.length\s*\?\s*viewSites\s*:\s*undefined/);
  assert.match(requestSource, /cursor:\s*cursor\s*\|\|\s*undefined/, 'legacy upstream continuation must remain available');
});

await checkContract('site tabs preview loaded rows and then request a collector-free session view', () => {
  const siteStart = appSource.indexOf('async function setActiveSite(site)');
  const siteEnd = appSource.indexOf('\nfunction ', siteStart + 20);
  assert.ok(siteStart >= 0 && siteEnd > siteStart, 'setActiveSite must be asynchronous');
  const siteHandler = appSource.slice(siteStart, siteEnd);
  const previewIndex = siteHandler.indexOf('previewDataForSite(site)');
  const renderIndex = siteHandler.indexOf('renderAll()', previewIndex);
  const sessionIndex = siteHandler.indexOf('loadSessionView', renderIndex);
  assert.ok(previewIndex >= 0 && renderIndex > previewIndex && sessionIndex > renderIndex,
    'loaded preview must render before the authoritative session-only site page');
  assert.match(siteHandler.slice(sessionIndex), /sessionOnly:\s*true/);
});

await checkContract('numbered pages and controls use the same server session without collection', () => {
  const pageStart = appSource.indexOf('async function loadResultPage(pageIndex)');
  const pageEnd = appSource.indexOf('\nfunction ', pageStart + 20);
  const pageHandler = appSource.slice(pageStart, pageEnd);
  assert.match(pageHandler, /state\.sessionId/);
  assert.match(pageHandler, /loadSessionView\(\{[\s\S]{0,220}?page:\s*targetPage[\s\S]{0,220}?sessionOnly:\s*true/);
  assert.match(pageHandler, /requestedPage\s*===\s*loadedPageCount[\s\S]{0,220}?loadNextSessionPage/,
    'the one page immediately beyond loaded rows must use the bounded next-page path');

  const nextStart = appSource.indexOf('async function loadNextSessionPage');
  const nextEnd = appSource.indexOf('\nfunction ', nextStart + 20);
  assert.ok(nextStart >= 0 && nextEnd > nextStart, 'loadNextSessionPage must exist');
  const nextHandler = appSource.slice(nextStart, nextEnd);
  const requestCalls = nextHandler.match(/requestSearchPage\(/g) || [];
  assert.equal(requestCalls.length, 1, 'the next page action must issue exactly one session/cursor request');
  assert.match(nextHandler, /sessionPage:\s*targetPage/);
  assert.match(nextHandler, /sessionWindow:\s*targetWindow/);
  assert.match(nextHandler, /sessionOnly:\s*hasBufferedRows/);
  assert.match(nextHandler, /cursor:\s*hasBufferedRows\s*\?\s*null\s*:\s*state\.data\?\.pagination\?\.next_cursor/);

  const refreshStart = appSource.indexOf('async function refreshSessionView');
  const refreshEnd = appSource.indexOf('\nfunction ', refreshStart + 20);
  assert.ok(refreshStart >= 0 && refreshEnd > refreshStart, 'refreshSessionView must exist');
  const refreshSource = appSource.slice(refreshStart, refreshEnd);
  assert.match(refreshSource, /loadSessionView\(\{[\s\S]{0,220}?page:\s*0[\s\S]{0,220}?sessionOnly:\s*true/);

  const controls = appSource.slice(appSource.indexOf('function applyPriceFilter()'), appSource.indexOf("$('#result-list').addEventListener"));
  assert.match(controls, /refreshSessionView\(\)/, 'price and sort controls must refresh the same server session');
  const resetStart = appSource.indexOf("$('#reset-filters').addEventListener");
  const resetEnd = appSource.indexOf("$('#apply-refresh-results')", resetStart);
  assert.match(appSource.slice(resetStart, resetEnd), /refreshSessionView\(\)/, 'reset must restore the same unfiltered session');
});

await checkContract('session totals drive 30-row paging while load-more remains bounded', () => {
  assert.match(appSource, /session\.available_count/);
  assert.match(appSource, /session\.source_totals/);
  assert.match(appSource, /sessionPageData[\s\S]{0,180}?return items;/);

  const expandStart = appSource.indexOf('async function expandResultWindow()');
  const expandEnd = appSource.indexOf('\nfunction ', expandStart + 20);
  const expandSource = appSource.slice(expandStart, expandEnd);
  assert.match(expandSource, /previousCount \+ SITE_RESULT_WINDOW_STEP/);
  assert.match(expandSource, /SITE_RESULT_WINDOW_MAX/);
  assert.match(expandSource, /SEARCH_SESSION_MAX_ITEMS/);
});

await checkContract('background refresh obeys session CAS and defers page-zero replacement', () => {
  const pollStart = appSource.indexOf('async function pollRefreshResult()');
  const pollEnd = appSource.indexOf('\nfunction trackSearchRefresh', pollStart);
  const pollSource = appSource.slice(pollStart, pollEnd);
  assert.match(pollSource, /acceptRefreshPayload\(payload\.data,\s*\{\s*assign:\s*state\.currentPage\s*===\s*0\s*\}\)/,
    'refresh polling must validate a session payload before storing or applying it');
  assert.doesNotMatch(pollSource, /state\.data\s*=\s*refreshedData/,
    'refresh polling must not bypass session generation checks');

  const helperStart = appSource.indexOf('function acceptRefreshPayload');
  const helperEnd = appSource.indexOf('\nfunction ', helperStart + 20);
  const helperSource = appSource.slice(helperStart, helperEnd);
  assert.match(helperSource, /hasSession\s*\?\s*adoptSessionData/,
    'session refreshes must pass through adoptSessionData');
  assert.match(helperSource, /if\s*\(!hasSession\)\s*clearSearchSession\(\)/,
    'legacy refreshes must clear any active session before assignment');

  const applyStart = appSource.indexOf("$('#apply-refresh-results').addEventListener");
  const applyEnd = appSource.indexOf("$('#pagination-controls').addEventListener", applyStart);
  const applySource = appSource.slice(applyStart, applyEnd);
  assert.match(applySource, /acceptRefreshPayload\(state\.pendingRefreshData,\s*\{\s*assign:\s*true\s*\}\)/,
    'a page>0 pending refresh must be adopted only when View update is selected');
  assert.doesNotMatch(applySource, /state\.data\s*=\s*state\.pendingRefreshData/);
});

await checkContract('site tabs reuse an already loaded aggregate collection', () => {
  const siteStart = appSource.indexOf('function setActiveSite(site)');
  const siteEnd = appSource.indexOf('\nfunction ', siteStart + 20);
  const siteHandler = appSource.slice(siteStart, siteEnd);
  const searchIndex = siteHandler.indexOf('executeSearch(');
  const reuseIndex = siteHandler.indexOf('loadedSourceKeys');
  assert.ok(reuseIndex >= 0 && reuseIndex < searchIndex, 'loaded source results must be reused before a new collection starts');
  assert.match(siteHandler.slice(reuseIndex, searchIndex), /renderAll\(\)[\s\S]{0,100}?return;/);
});

await checkContract('Poshmark ram failure reason is visible', () => {
  const summaryStart = appSource.indexOf('function renderSourceSummary()');
  const summaryEnd = appSource.indexOf('function renderResults()', summaryStart);
  assert.ok(summaryStart >= 0 && summaryEnd > summaryStart, 'source summary renderer must exist');
  const summarySource = appSource.slice(summaryStart, summaryEnd);
  assert.match(
    summarySource,
    /(?:source\.errors[\s\S]{0,1000}formatSourceMessage|formatSourceMessage[\s\S]{0,1000}source\.errors)/,
    'a Poshmark ram failure must show its formatted source error, not only a generic unavailable label'
  );
});

await checkContract('failed source renders a retry control', () => {
  const summaryStart = appSource.indexOf('function renderSourceSummary()');
  const summaryEnd = appSource.indexOf('function renderResults()', summaryStart);
  const summarySource = appSource.slice(summaryStart, summaryEnd);
  assert.match(summarySource, /data-retry-site/, 'a failed marketplace must render a source-scoped retry button');
});

await checkContract('retry preserves loaded results and keeps server session identity coherent', () => {
  const retryStart = appSource.indexOf('async function retrySource');
  const retryEnd = retryStart >= 0 ? appSource.indexOf('\nfunction ', retryStart + 20) : -1;
  assert.ok(retryStart >= 0 && retryEnd > retryStart, 'retrySource(site) must exist');
  const retrySource = appSource.slice(retryStart, retryEnd);
  assert.match(retrySource, /sites:\s*serverSessionMode\s*\?\s*sessionSites\s*:\s*\[site\]/,
    'session retry must refresh the full collection while legacy retry remains source-scoped');
  assert.match(retrySource, /sessionId:\s*serverSessionMode\s*\?\s*null\s*:\s*state\.sessionId/,
    'session retry must start a replacement session instead of mixing aggregate and source identities');
  assert.match(retrySource, /mergeSearchData\(state\.data,/, 'legacy retry must preserve and merge the loaded collection');
  assert.match(
    appSource,
    /#source-summary[\s\S]{0,180}?addEventListener\(['"]click['"][\s\S]{0,500}?data-retry-site/,
    'the source summary retry button must have a click handler'
  );
});

if (failures.length > 0) {
  console.error(`global search session policy contract RED (${failures.length}/${checks} failed)`);
  for (const failure of failures) console.error(`- ${failure}`);
  process.exitCode = 1;
} else {
  console.log(`global search session policy contract passed (${checks} checks)`);
}
