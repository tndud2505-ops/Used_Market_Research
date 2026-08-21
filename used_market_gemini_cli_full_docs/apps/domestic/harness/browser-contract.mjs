import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const baseUrl = process.env.BROWSER_CONTRACT_URL || 'http://127.0.0.1:8787/';
const session = process.env.BROWSER_CONTRACT_SESSION || 'used-market-contract';
const npx = process.platform === 'win32' ? 'npx.cmd' : 'npx';

function cli(...args) {
  const result = spawnSync(npx, ['--yes', '--package', '@playwright/cli', 'playwright-cli', `-s=${session}`, ...args], {
    cwd: root,
    encoding: 'utf8',
    timeout: 180_000,
    shell: true,
    windowsHide: true
  });
  const output = `${result.stdout || ''}${result.stderr || ''}`;
  if (result.status !== 0) throw new Error(`playwright-cli failed (${result.status}): ${result.error?.message || ''} ${output}`);
  return output;
}

function runCode(code) {
  const path = resolve(tmpdir(), `used-market-browser-contract-${process.pid}.mjs`);
  writeFileSync(path, code, 'utf8');
  try {
    const output = cli('run-code', '--filename', path);
    const marker = '### Result\n';
    const start = output.indexOf(marker);
    if (start < 0) throw new Error(`playwright-cli did not return a result: ${output}`);
    const resultText = output.slice(start + marker.length).split('\n### Ran Playwright code')[0].trim();
    return JSON.parse(resultText);
  } finally {
    rmSync(path, { force: true });
  }
}

cli('open', baseUrl);
const result = runCode(`async (page) => {
  const consoleErrors = [];
  const consoleWarnings = [];
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text());
    if (message.type() === 'warning') consoleWarnings.push(message.text());
  });
  page.on('pageerror', (error) => consoleErrors.push(String(error)));

  const waitForResults = async () => {
    await page.waitForFunction(() => (
      document.querySelector('.results-section')?.getAttribute('aria-busy') === 'false'
      && (document.querySelectorAll('#result-list .item-title').length > 0
        || document.querySelector('#result-list .empty-state')
        || document.querySelector('#result-list .error-state'))
    ), null, { timeout: 90_000 });
  };
  const prices = async () => page.locator('#result-list .item-price strong').evaluateAll((nodes) => nodes
    .map((node) => Number((node.textContent || '').replace(/[^0-9]/g, '')))
    .filter((value) => Number.isFinite(value) && value > 0));
  const urls = async () => page.locator('#result-list .item-title').evaluateAll((nodes) => nodes.map((node) => node.href));

  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(${JSON.stringify(baseUrl)}, { waitUntil: 'domcontentloaded' });
  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil: 'domcontentloaded' });

  await page.locator('#keyword').fill('아이폰 15');
  await page.locator('#search-button').click();
  await waitForResults();
  const integratedUrls = await urls();
  const integratedUniqueUrls = [...new Set(integratedUrls)];
  const sourceSummary = await page.locator('#source-summary').textContent();
  const topGuideLinkAbsent = await page.locator('.site-tabs .site-tab-link').count() === 0;

  await page.locator('[data-sort="price_asc"]').click();
  await waitForResults();
  const lowPrices = await prices();
  const priceAscending = lowPrices.length < 2 || lowPrices.every((value, index) => index === 0 || value >= lowPrices[index - 1]);

  await page.locator('[data-sort="recent"]').click();
  await waitForResults();
  const recentDates = await page.locator('#result-list .item-row').evaluateAll((rows) => rows
    .map((row) => row.querySelector('.item-meta span:nth-child(2)')?.textContent || ''));

  await page.locator('[data-sort="price_asc"]').click();
  await waitForResults();
  await page.locator('#min-price').fill('300000');
  await page.locator('#max-price').fill('600000');
  await page.locator('#apply-price-filter').click();
  await waitForResults();
  const boundedPrices = await prices();
  const priceRangeApplied = boundedPrices.length > 0 && boundedPrices.every((value) => value >= 300000 && value <= 600000);
  const priceRangePage = await page.locator('#pagination-controls [aria-current="page"]').textContent().catch(() => '1');

  await page.locator('#min-price').fill('');
  await page.locator('#max-price').fill('');
  await page.locator('#keyword').fill('모자');
  await page.locator('#search-button').click();
  await waitForResults();
  const pageButtons = await page.locator('#pagination-controls .pagination-page').count();
  const firstPageUrls = await urls();
  const firstPageCount = firstPageUrls.length;
  let secondPageUrls = [];
  let firstPageRestored = true;
  if (pageButtons >= 2) {
    await page.locator('#pagination-controls .pagination-page').nth(1).click();
    await page.waitForFunction(() => (
      document.querySelector('.results-section')?.getAttribute('aria-busy') === 'false'
      && document.querySelector('#pagination-controls [aria-current="page"]')?.textContent?.trim() === '2'
    ), null, { timeout: 90_000 });
    secondPageUrls = await urls();
    await page.locator('#pagination-controls .pagination-page').first().click();
    await page.waitForFunction(() => document.querySelector('#pagination-controls [aria-current="page"]')?.textContent?.trim() === '1', null, { timeout: 10_000 });
    firstPageRestored = JSON.stringify(await urls()) === JSON.stringify(firstPageUrls);
  }
  const noCrossPageDuplicates = secondPageUrls.every((url) => !firstPageUrls.includes(url));
  const pageCountText = await page.locator('#result-count').textContent();
  const mediaCoverage = await page.locator('#result-list .item-row').evaluateAll((rows) => rows.every((row) => (
    Boolean(row.querySelector('.item-thumb:not([hidden])')) || Boolean(row.querySelector('.item-thumb-fallback:not([hidden])'))
  )));

  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(150);
  const mobileBefore = await page.evaluate(() => ({
    overflow: document.documentElement.scrollWidth > window.innerWidth,
    categoryExpanded: document.querySelector('#category-panel-toggle')?.getAttribute('aria-expanded'),
    categoryHidden: document.querySelector('#category-list')?.getAttribute('aria-hidden'),
    paginationOverflow: (() => {
      const node = document.querySelector('#pagination-controls');
      return Boolean(node && node.scrollWidth > node.clientWidth + 1);
    })()
  }));
  await page.locator('#category-panel-toggle').click();
  const categoryOpened = await page.locator('#category-panel-toggle').getAttribute('aria-expanded');
  const visibleCategoryButtons = await page.locator('#category-list button:visible').count();
  await page.locator('#category-panel-toggle').click();
  const categoryClosed = await page.locator('#category-panel-toggle').getAttribute('aria-expanded');

  return {
    integratedCount: integratedUrls.length,
    integratedUniqueCount: integratedUniqueUrls.length,
    sourceSummary,
    topGuideLinkAbsent,
    priceAscending,
    recentDates,
    priceRangeApplied,
    priceRangePage,
    pagination: {
      pageButtons,
      firstPageCount,
      secondPageCount: secondPageUrls.length,
      noCrossPageDuplicates,
      firstPageRestored,
      pageCountText
    },
    mediaCoverage,
    mobileBefore,
    categoryOpened,
    categoryClosed,
    visibleCategoryButtons,
    consoleErrors,
    consoleWarnings
  };
}`);

assert.ok(result.integratedCount > 0, 'integrated search must return visible results');
assert.equal(result.integratedCount, result.integratedUniqueCount, 'integrated results must not duplicate URLs');
assert.ok(result.sourceSummary, 'source summary must be rendered');
assert.equal(result.topGuideLinkAbsent, true, 'top navigation must not contain the guide link');
assert.equal(result.priceAscending, true, 'low-price sort must keep price as the primary ordering key');
assert.ok(result.recentDates.length > 0, 'recent sort must return visible dated rows');
assert.equal(result.priceRangeApplied, true, 'server price range must constrain returned listings');
assert.equal(String(result.priceRangePage).trim(), '1', 'changing the price range must reset pagination');
assert.ok(result.pagination.pageButtons >= 2 && result.pagination.pageButtons <= 4, 'numbered pagination must expose two to four bounded pages');
assert.equal(result.pagination.firstPageCount, 16, 'desktop result pages must contain 16 listings');
assert.ok(result.pagination.secondPageCount > 0 && result.pagination.secondPageCount <= 16, 'second page must load on demand');
assert.equal(result.pagination.noCrossPageDuplicates, true, 'result pages must not duplicate URLs');
assert.equal(result.pagination.firstPageRestored, true, 'returning to page one must use the stable cached result window');
assert.match(result.pagination.pageCountText, /1\/[2-4]페이지/);
assert.equal(result.mediaCoverage, true, 'every listing must show an image or an explicit image fallback');
assert.equal(result.mobileBefore.overflow, false, 'mobile page must not overflow horizontally');
assert.equal(result.mobileBefore.categoryExpanded, 'false', 'mobile category panel must start collapsed');
assert.equal(result.mobileBefore.categoryHidden, 'true', 'collapsed mobile category list must be hidden from assistive navigation');
assert.equal(result.mobileBefore.paginationOverflow, false, 'mobile pagination must fit the viewport');
assert.equal(result.categoryOpened, 'true', 'mobile category panel must open');
assert.ok(result.visibleCategoryButtons > 0, 'mobile category controls must remain reachable');
assert.equal(result.categoryClosed, 'false', 'mobile category panel must close again');
assert.deepEqual(result.consoleErrors, []);
assert.deepEqual(result.consoleWarnings, []);
console.log(JSON.stringify({ status: 'passed', checks: 23, ...result }, null, 2));
