import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const root = resolve(new URL('..', import.meta.url).pathname.replace(/^\/(\w):/, '$1:'));

const baseUrl = (process.env.HARNESS_BASE_URL || 'http://127.0.0.1:8787').replace(/\/$/, '');
const TARGET_SITES = ['bunjang', 'joonggonara', 'hellomarket', 'rethinkmall'];
const CATEGORY_LIMIT = 4;
const REQUEST_TIMEOUT_MS = Number(process.env.CATEGORY_LIVE_TIMEOUT_MS || 30_000);
const CASE_CONCURRENCY = Number(process.env.CATEGORY_LIVE_CONCURRENCY || 6);
const ROOT_CATEGORY_ID = 'all';
const ROOT_CATEGORY_KEYWORD = 'galaxy';
const ROOT_SITES = ['bunjang', 'joonggonara'];

async function requestJson(path, options = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(`${baseUrl}${path}`, {
      ...options,
      signal: controller.signal
    });
    const text = await response.text();
    let payload;
    try {
      payload = JSON.parse(text);
    } catch {
      throw new Error(`non-JSON response from ${path}: ${text.slice(0, 240)}`);
    }
    return { response, payload };
  } finally {
    clearTimeout(timeout);
  }
}

async function search(body) {
  return requestJson('/api/search', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body)
  });
}

async function loadPublicCatalog() {
  const result = await requestJson('/api/categories');
  assert.equal(result.response.status, 200, 'category catalog should return HTTP 200');
  assert.equal(result.payload.status, 'success', 'category catalog should return success');
  const categories = result.payload.data?.categories;
  assert.ok(Array.isArray(categories) && categories.length > 0, 'category catalog should expose public categories');

  const categoryIds = categories.map((category) => category?.id);
  assert.ok(categoryIds.every((categoryId) => typeof categoryId === 'string' && categoryId.length > 0), 'public categories need non-empty IDs');
  assert.equal(new Set(categoryIds).size, categoryIds.length, 'public category IDs must not duplicate');

  return { categories, categoryIds, sitePlans: result.payload.data?.site_plans || {} };
}

function categoryRequestBody(categoryId, sites) {
  return {
    ...(categoryId === ROOT_CATEGORY_ID ? { keyword: ROOT_CATEGORY_KEYWORD } : {}),
    category_id: categoryId,
    sites,
    limit: CATEGORY_LIMIT
  };
}

function multiRequestBody(categoryIds, sites) {
  return {
    category_ids: categoryIds,
    sites,
    limit: CATEGORY_LIMIT
  };
}

function assertCategoryResponse(result, { categoryIds, sites, scope }) {
  assert.equal(result.response.status, 200, `${scope} should return HTTP 200`);
  assert.equal(result.payload.status, 'success', `${scope} should return success`);

  const data = result.payload.data;
  assert.ok(data && Array.isArray(data.items), `${scope} should return an items array`);
  const categorySummary = Array.isArray(data.categories)
    ? data.categories
    : data.category && typeof data.category === 'object'
      ? [data.category]
      : [];
  assert.ok(Array.isArray(data.sources), `${scope} should return a sources array`);

  const expectedCategoryIds = [...categoryIds];
  const returnedCategoryIds = categorySummary.map((category) => category?.id);
  if (categoryIds.length === 1 && categoryIds[0] === ROOT_CATEGORY_ID) {
    assert.ok(
      returnedCategoryIds.length === 0 || (returnedCategoryIds.length === 1 && returnedCategoryIds[0] === ROOT_CATEGORY_ID),
      `${scope} root search should not expose a non-root category summary`
    );
  } else {
    assert.deepEqual(returnedCategoryIds, expectedCategoryIds, `${scope} should expose exactly the requested categories`);
  }

  const sourceKeys = data.sources.map((source) => source?.key);
  assert.equal(new Set(sourceKeys).size, sourceKeys.length, `${scope} source summaries must not duplicate`);
  assert.deepEqual(sourceKeys.slice().sort(), sites.slice().sort(), `${scope} should expose exactly the requested sources`);

  const expectedCategorySet = new Set(categoryIds);
  const expectedSiteSet = new Set(sites);
  if (!(categoryIds.length === 1 && categoryIds[0] === ROOT_CATEGORY_ID)) {
    assert.ok(
      data.items.every((item) => expectedCategorySet.has(item?.category_id)),
      `${scope} items must stay inside the requested category_id range`
    );
  }
  assert.ok(
    data.items.every((item) => expectedSiteSet.has(item?.site)),
    `${scope} items must not leak outside the requested sites`
  );
  assert.ok(
    data.items.every((item) => typeof item?.url === 'string' && /^https?:\/\//.test(item.url)),
    `${scope} items need original HTTP(S) URLs`
  );
  assert.equal(
    new Set(data.items.map((item) => item.url)).size,
    data.items.length,
    `${scope} items must not duplicate URLs`
  );

  return {
    item_count: data.items.length,
    source_counts: Object.fromEntries(data.sources.map((source) => [source.key, source.visible_count ?? source.count ?? 0]))
  };
}

async function runCase(testCase) {
  try {
    const result = await search(testCase.body);
    if (testCase.expected_status && result.response.status !== testCase.expected_status) {
      throw new Error(`expected HTTP ${testCase.expected_status}, received HTTP ${result.response.status}: ${result.payload?.error || 'no error'}`);
    }
    if (testCase.expected_status && testCase.expected_status !== 200 && result.response.status === testCase.expected_status) {
      return {
        ...testCase.summary,
        status: 'passed',
        http_status: result.response.status,
        error: result.payload?.error || null
      };
    }
    const summary = assertCategoryResponse(result, testCase);
    return { ...testCase.summary, ...summary, status: 'passed' };
  } catch (error) {
    return {
      ...testCase.summary,
      status: 'failed',
      error: error instanceof Error ? error.message : String(error)
    };
  }
}

async function runWithConcurrency(items, concurrency, worker) {
  const results = new Array(items.length);
  let nextIndex = 0;
  async function consume() {
    while (true) {
      const index = nextIndex++;
      if (index >= items.length) return;
      results[index] = await worker(items[index], index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, consume));
  return results;
}

const { categories, categoryIds, sitePlans } = await loadPublicCatalog();
const searchableCategories = categories.filter((category) => category.id !== ROOT_CATEGORY_ID);
assert.ok(searchableCategories.length > 0, 'public catalog should expose at least one searchable category');

function integratedSitesFor(categoryIdsForCase) {
  return TARGET_SITES.filter((site) => categoryIdsForCase.every((categoryId) => (
    sitePlans?.[site]?.[categoryId]?.selectable === true
  )));
}

const cases = [];
cases.push({
  body: categoryRequestBody(ROOT_CATEGORY_ID, ROOT_SITES),
  categoryIds: [ROOT_CATEGORY_ID],
  sites: ROOT_SITES,
  scope: 'root keyword search',
  summary: { category_id: ROOT_CATEGORY_ID, case: 'root' }
});

for (const category of searchableCategories) {
  const categoryId = category.id;
  const integratedSites = integratedSitesFor([categoryId]);
  assert.ok(integratedSites.length > 0, `${categoryId} must have at least one verified source path`);
  cases.push({
    body: categoryRequestBody(categoryId, integratedSites),
    categoryIds: [categoryId],
    sites: integratedSites,
    scope: `integrated ${categoryId}`,
    summary: { category_id: categoryId, case: 'integrated', sites: integratedSites }
  });

  for (const site of TARGET_SITES) {
    const supported = sitePlans?.[site]?.[categoryId]?.selectable === true;
    cases.push({
      body: categoryRequestBody(categoryId, [site]),
      categoryIds: [categoryId],
      sites: [site],
      scope: `individual ${site} ${categoryId}`,
      expected_status: supported ? 200 : 400,
      summary: { category_id: categoryId, case: supported ? 'individual' : 'unavailable', site }
    });
  }
}

// The API intentionally rejects `all` combined with another category, so every
// searchable category participates in one two-category request instead.
const multiCategoryPairs = searchableCategories.map((category, index) => [
  category.id,
  searchableCategories[(index + 1) % searchableCategories.length].id
]);
for (const categoryIdsForCase of multiCategoryPairs) {
  const integratedSites = integratedSitesFor(categoryIdsForCase);
  assert.ok(integratedSites.length > 0, `${categoryIdsForCase.join('+')} must have a verified source intersection`);
  cases.push({
    body: multiRequestBody(categoryIdsForCase, integratedSites),
    categoryIds: categoryIdsForCase,
    sites: integratedSites,
    scope: `multi ${categoryIdsForCase.join('+')}`,
    summary: { category_ids: categoryIdsForCase, case: 'multi', sites: integratedSites }
  });
}

const results = await runWithConcurrency(cases, CASE_CONCURRENCY, runCase);
const failedCases = results.filter((result) => result.status === 'failed');
const perCategory = Object.fromEntries(categoryIds.map((categoryId) => {
  const rows = results.filter((result) => (
    result.category_id === categoryId || result.category_ids?.includes(categoryId)
  ));
  return [categoryId, {
    case_count: rows.length,
    passed_case_count: rows.filter((row) => row.status === 'passed').length,
    item_counts: rows.map((row) => ({ case: row.case, site: row.site ?? null, item_count: row.item_count ?? null }))
  }];
}));

const report = {
  status: failedCases.length === 0 ? 'passed' : 'failed',
  base_url: baseUrl,
  target_sites: TARGET_SITES,
  catalog_category_count: categories.length,
  catalog_category_ids: categoryIds,
  searchable_category_count: searchableCategories.length,
  multi_category_pair_count: multiCategoryPairs.length,
  root_category_multi_skipped: ROOT_CATEGORY_ID,
  request_count: cases.length,
  passed_case_count: results.length - failedCases.length,
  failed_case_count: failedCases.length,
  checks: [
    'HTTP 200 and success for integrated, individual, and multi-category cases',
    'requested category_id range on every returned item',
    'duplicate category/source IDs and item URLs',
    'site leakage in source summaries and returned items',
    'original HTTP(S) item URLs',
    'unavailable category/site combinations are rejected instead of keyword-fallback merged'
  ],
  policy: 'joongna-primary-v1: only sites with official paths for every requested category are integrated',
  per_category: perCategory,
  failed_cases: failedCases
};

const outputDir = resolve(root, 'merge/result/harness/category-live');
await mkdir(outputDir, { recursive: true });
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const outputPath = resolve(outputDir, `${stamp}.json`);
const latestPath = resolve(outputDir, 'latest.json');
await writeFile(outputPath, JSON.stringify(report, null, 2), 'utf8');
await writeFile(latestPath, JSON.stringify(report, null, 2), 'utf8');

console.log(JSON.stringify({ ...report, output_path: outputPath, latest_path: latestPath }, null, 2));
if (failedCases.length > 0) process.exitCode = 1;
