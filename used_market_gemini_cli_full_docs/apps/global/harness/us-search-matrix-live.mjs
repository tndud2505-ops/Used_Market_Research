import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const root = resolve(new URL('..', import.meta.url).pathname.replace(/^\/(\w):/, '$1:'));
const endpoint = new URL('/global/api/search', process.env.GLOBAL_SEARCH_BASE_URL || 'https://global.used-pick.com').toString();
const sites = ['ebay', 'poshmark', 'vinted', 'unclaimed_baggage'];
const paginatedSites = new Set(['ebay', 'vinted', 'unclaimed_baggage']);
const keywords = (process.env.US_MATRIX_KEYWORDS || 'iphone 13|nike shoes|pokemon cards')
  .split('|')
  .map((value) => value.trim())
  .filter(Boolean);
const limit = boundedInteger(process.env.US_MATRIX_LIMIT, 12, 1, 30);
const delayMs = boundedInteger(process.env.US_MATRIX_DELAY_MS, 2500, 0, 60_000);
const timeoutMs = boundedInteger(process.env.US_MATRIX_TIMEOUT_MS, 70_000, 5_000, 180_000);
const results = [];

for (const keyword of keywords) {
  for (const site of sites) {
    if (results.length > 0 && delayMs > 0) await delay(delayMs);
    results.push(await checkSearch(site, keyword));
  }
}

if (results.length > 0 && delayMs > 0) await delay(delayMs);
const aggregateSession = await checkAggregateSession();

const sourceSummary = Object.fromEntries(sites.map((site) => [
  site,
  summarize(results.filter((result) => result.site === site))
]));
const report = {
  mode: 'live-aggregate-only',
  generated_at: new Date().toISOString(),
  endpoint_origin: new URL(endpoint).origin,
  source_scope: sites,
  keyword_count: keywords.length,
  keywords,
  item_data_persisted: false,
  source_summary: sourceSummary,
  aggregate_session: aggregateSession,
  results
};
const runId = `${new Date().toISOString().replace(/[:.]/g, '-')}__us-search-matrix__live`;
const outputDir = resolve(root, 'merge', 'result', 'harness', runId);
await mkdir(outputDir, { recursive: true });
await writeFile(resolve(outputDir, 'output.json'), JSON.stringify(report, null, 2), 'utf8');

const failed = results.filter((result) => result.status === 'fail').length;
const unusableSources = sites.filter((site) => {
  const summary = sourceSummary[site];
  return summary.with_results === 0
    || summary.fail > 0
    || (paginatedSites.has(site) && summary.pagination_followups === 0);
});
console.log(JSON.stringify({
  status: failed > 0 || unusableSources.length > 0 || aggregateSession.status !== 'pass' ? 'completed_with_failures' : 'completed',
  keyword_count: keywords.length,
  request_count: results.length,
  source_summary: sourceSummary,
  aggregate_session: aggregateSession,
  unusable_sources: unusableSources,
  output_dir: outputDir
}, null, 2));
if (failed > 0 || unusableSources.length > 0 || aggregateSession.status !== 'pass') process.exitCode = 1;

async function checkSearch(site, keyword) {
  const startedAt = Date.now();
  try {
    const requestBody = {
      keyword,
      sites: [site],
      sort: 'recommended',
      limit,
      refresh_index: true
    };
    const { response, payload } = await requestWithBusyRetry(requestBody);
    if (!response.ok || payload?.status !== 'success') {
      return failure(site, keyword, startedAt, response.status, codeOf(payload?.code || payload?.error));
    }

    const firstData = record(payload.data);
    const firstSession = record(firstData.session);
    const firstSource = array(firstData.sources).map(record).find((candidate) => candidate.key === site) || {};
    const firstItems = array(firstData.items).map(record).filter((item) => item.site === site);
    const firstCursor = string(record(firstData.pagination).next_cursor, '');
    let secondData = {};
    let secondSource = {};
    let secondItems = [];
    let paginationFollowed = false;
    let cursorAdvanced = false;
    let pageTwoHttpStatus = null;

    if (paginatedSites.has(site) && firstCursor) {
      if (delayMs > 0) await delay(delayMs);
      paginationFollowed = true;
      const second = await requestWithBusyRetry({
        ...requestBody,
        cursor: firstCursor,
        session_id: string(firstSession.id, ''),
        session_generation: number(firstSession.generation, 0),
        session_page: 0,
        session_window: Math.min(number(firstSession.window, firstItems.length) + 160, 640),
        refresh_index: false
      });
      pageTwoHttpStatus = second.response.status;
      if (!second.response.ok || second.payload?.status !== 'success') {
        return failure(site, keyword, startedAt, second.response.status, codeOf(second.payload?.code || second.payload?.error), {
          pagination_followed: true,
          page_two_http_status: second.response.status
        });
      }
      secondData = record(second.payload.data);
      secondSource = array(secondData.sources).map(record).find((candidate) => candidate.key === site) || {};
      const accumulatedItems = array(secondData.items).map(record).filter((item) => item.site === site);
      const firstKeys = new Set(firstItems.map((item) => canonicalListingKey(site, item)));
      secondItems = accumulatedItems.filter((item) => !firstKeys.has(canonicalListingKey(site, item)));
      const secondCursor = string(record(secondData.pagination).next_cursor, '');
      const secondSession = record(secondData.session);
      cursorAdvanced = (!secondCursor || secondCursor !== firstCursor)
        && string(secondSession.id, '') === string(firstSession.id, '')
        && number(secondSession.generation, 0) === number(firstSession.generation, 0) + 1
        && number(secondSession.loaded_count, 0) >= number(firstSession.loaded_count, firstItems.length)
        && number(secondSession.available_count, 0) === number(record(secondData.quality).available_count, -1)
        && array(secondData.items).length <= 30;
    }

    const items = [...firstItems, ...secondItems];
    const sourceErrors = [...array(firstSource.errors), ...array(secondSource.errors)].map(codeOf).filter(Boolean);
    const sourceWarnings = [...array(firstSource.warnings), ...array(secondSource.warnings)].map(codeOf).filter(Boolean);
    const uniqueItemKeys = new Set(items.map((item) => canonicalListingKey(site, item)).filter(Boolean));
    const duplicateCount = items.length - uniqueItemKeys.size;
    const validPrices = items.filter((item) => typeof item.price === 'number' && Number.isFinite(item.price)).length;
    const validUrls = items.filter((item) => isAllowedListingUrl(site, item.url)).length;
    const images = items.filter((item) => isHttpUrl(item.image_url)).length;
    const visibleCount = items.length;
    const collectionState = string(secondSource.collection_state, string(firstSource.collection_state, visibleCount > 0 ? 'ready' : 'empty'));
    const paginationFailed = paginationFollowed && (!cursorAdvanced || duplicateCount > 0);
    return {
      site,
      keyword,
      status: sourceErrors.length > 0 || paginationFailed ? 'fail' : visibleCount > 0 ? 'pass' : 'warn',
      http_status: response.status,
      page_two_http_status: pageTwoHttpStatus,
      latency_ms: Date.now() - startedAt,
      collection_state: collectionState,
      extracted_count: number(firstSource.extracted_count, firstItems.length) + number(secondSource.extracted_count, secondItems.length),
      visible_count: visibleCount,
      filtered_count: number(firstSource.filtered_count, 0) + number(secondSource.filtered_count, 0),
      pagination_followed: paginationFollowed,
      cursor_advanced: paginationFollowed ? cursorAdvanced : null,
      cross_page_duplicate_count: duplicateCount,
      valid_price_rate: rate(validPrices, items.length),
      valid_url_rate: rate(validUrls, items.length),
      image_rate: rate(images, items.length),
      warning_codes: [...new Set(sourceWarnings)],
      error_codes: [...new Set(sourceErrors)]
    };
  } catch (error) {
    return failure(site, keyword, startedAt, 0, codeOf(error instanceof Error ? error.message : String(error)));
  }
}

async function checkAggregateSession() {
  const startedAt = Date.now();
  try {
    const requestBody = {
      keyword: 'iphone 13',
      sites,
      sort: 'recommended',
      limit: 30,
      refresh_index: true
    };
    const first = await requestWithBusyRetry(requestBody);
    if (!first.response.ok || first.payload?.status !== 'success') {
      return { status: 'fail', error_code: codeOf(first.payload?.code || first.payload?.error), latency_ms: Date.now() - startedAt };
    }
    const firstData = record(first.payload.data);
    const firstSession = record(firstData.session);
    const firstItems = array(firstData.items).map(record);
    if (!string(firstSession.id, '') || number(firstSession.generation, 0) < 1 || firstItems.length > 30) {
      return { status: 'fail', error_code: 'INVALID_INITIAL_SESSION', latency_ms: Date.now() - startedAt };
    }

    if (delayMs > 0) await delay(delayMs);
    const selectedSite = sites.find((site) => number(record(firstSession.source_totals)[site], 0) > 0) || 'ebay';
    const view = await requestWithBusyRetry({
      ...requestBody,
      refresh_index: false,
      session_id: firstSession.id,
      session_generation: firstSession.generation,
      session_page: 0,
      session_only: true,
      session_window: firstSession.window,
      view_sites: [selectedSite]
    });
    if (!view.response.ok || view.payload?.status !== 'success') {
      return { status: 'fail', error_code: codeOf(view.payload?.code || view.payload?.error), latency_ms: Date.now() - startedAt };
    }
    const viewData = record(view.payload.data);
    const viewSession = record(viewData.session);
    const viewItems = array(viewData.items).map(record);
    const sourceTotals = record(viewSession.source_totals);
    const invariant = string(viewSession.id, '') === string(firstSession.id, '')
      && number(viewSession.generation, 0) === number(firstSession.generation, 0)
      && viewItems.length <= 30
      && viewItems.every((item) => item.site === selectedSite)
      && number(viewSession.available_count, -1) === number(record(viewData.quality).available_count, -2)
      && Object.entries(sourceTotals).every(([site, count]) => site === selectedSite || Number(count) === 0);
    return {
      status: invariant ? 'pass' : 'fail',
      selected_site: selectedSite,
      page_rows: viewItems.length,
      available_count: number(viewSession.available_count, 0),
      generation_stable: number(viewSession.generation, 0) === number(firstSession.generation, 0),
      collector_free_view: true,
      latency_ms: Date.now() - startedAt,
      ...(invariant ? {} : { error_code: 'SESSION_VIEW_INVARIANT' })
    };
  } catch (error) {
    return { status: 'fail', error_code: codeOf(error instanceof Error ? error.message : String(error)), latency_ms: Date.now() - startedAt };
  }
}

async function requestWithBusyRetry(body) {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
        signal: controller.signal
      });
      const payload = await response.json().catch(() => null);
      if (response.status !== 429 || attempt === 1) return { response, payload };
      const retryAfter = Math.min(60, Math.max(1, Number(response.headers.get('retry-after')) || 5));
      await delay(retryAfter * 1000);
    } finally {
      clearTimeout(timer);
    }
  }
  throw new Error('SEARCH_BUSY');
}

function failure(site, keyword, startedAt, httpStatus, errorCode, extra = {}) {
  return {
    site,
    keyword,
    status: 'fail',
    http_status: httpStatus,
    latency_ms: Date.now() - startedAt,
    collection_state: 'failed',
    extracted_count: 0,
    visible_count: 0,
    filtered_count: 0,
    valid_price_rate: 0,
    valid_url_rate: 0,
    image_rate: 0,
    warning_codes: [],
    error_codes: [errorCode || 'UNKNOWN_ERROR'],
    ...extra
  };
}

function summarize(rows) {
  const totalVisible = rows.reduce((sum, row) => sum + row.visible_count, 0);
  return {
    checked_keywords: rows.length,
    with_results: rows.filter((row) => row.visible_count > 0).length,
    total_visible_items: totalVisible,
    pass: rows.filter((row) => row.status === 'pass').length,
    warn: rows.filter((row) => row.status === 'warn').length,
    fail: rows.filter((row) => row.status === 'fail').length,
    pagination_followups: rows.filter((row) => row.pagination_followed === true).length,
    pagination_failures: rows.filter((row) => row.pagination_followed === true && (row.cursor_advanced !== true || row.cross_page_duplicate_count > 0)).length,
    average_latency_ms: rows.length ? Math.round(rows.reduce((sum, row) => sum + row.latency_ms, 0) / rows.length) : 0,
    weighted_valid_price_rate: weightedRate(rows, 'valid_price_rate'),
    weighted_valid_url_rate: weightedRate(rows, 'valid_url_rate'),
    weighted_image_rate: weightedRate(rows, 'image_rate')
  };
}

function canonicalListingKey(site, item) {
  try {
    const url = new URL(String(item.url || ''));
    url.hash = '';
    for (const key of [...url.searchParams.keys()]) {
      if (/^(?:utm_|campid$|mkcid$|mkevt$|toolid$|customid$|var$)/i.test(key)) url.searchParams.delete(key);
    }
    return `${site}:${url.toString()}`;
  } catch {
    return `${site}:${String(item.id || '')}:${String(item.title || '')}:${String(item.price ?? '')}`;
  }
}

function weightedRate(rows, key) {
  const total = rows.reduce((sum, row) => sum + row.visible_count, 0);
  if (total === 0) return 0;
  return Number((rows.reduce((sum, row) => sum + row[key] * row.visible_count, 0) / total).toFixed(3));
}

function isAllowedListingUrl(site, value) {
  const allowed = {
    ebay: ['ebay.com'],
    poshmark: ['poshmark.com'],
    vinted: ['vinted.com'],
    unclaimed_baggage: ['unclaimedbaggage.com']
  }[site] || [];
  try {
    const url = new URL(String(value || ''));
    return url.protocol === 'https:' && allowed.some((host) => url.hostname === host || url.hostname.endsWith(`.${host}`));
  } catch {
    return false;
  }
}

function isHttpUrl(value) {
  try {
    return ['http:', 'https:'].includes(new URL(String(value || '')).protocol);
  } catch {
    return false;
  }
}

function codeOf(value) {
  const text = String(value || '').trim();
  const prefixedCode = text.match(/^([A-Z][A-Z0-9_]{2,})(?::|$)/)?.[1];
  if (prefixedCode) return prefixedCode;
  if (/HIGH_FILTER_RATE/i.test(text)) return 'HIGH_FILTER_RATE';
  return text ? 'SOURCE_MESSAGE' : '';
}

function boundedInteger(value, fallback, min, max) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= min && parsed <= max ? parsed : fallback;
}

function record(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function array(value) {
  return Array.isArray(value) ? value : [];
}

function string(value, fallback) {
  return typeof value === 'string' && value ? value : fallback;
}

function number(value, fallback) {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function rate(numerator, denominator) {
  return denominator > 0 ? Number((numerator / denominator).toFixed(3)) : 0;
}

function delay(ms) {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, ms));
}
