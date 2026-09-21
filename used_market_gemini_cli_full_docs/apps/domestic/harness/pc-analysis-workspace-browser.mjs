// Operator-run browser acceptance; --fixture uses synthetic price API responses.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright';

const argument = name => {
  const index = process.argv.indexOf(name);
  return index < 0 ? '' : process.argv[index + 1] || '';
};
const origin = (argument('--origin') || 'http://127.0.0.1:8787').replace(/\/$/, '');
const out = argument('--out') || path.join(os.tmpdir(), `used-pick-analysis-${Date.now()}`);
const fixture = process.argv.includes('--fixture');
await fs.mkdir(out, { recursive: true });

const catalogResponse = await fetch(`${origin}/api/pc/catalog`, { signal: AbortSignal.timeout(30_000) });
assert.equal(catalogResponse.status, 200, 'catalog must be available');
const catalogJson = await catalogResponse.json();
const catalog = catalogJson.data || catalogJson;
const products = catalog.tools_catalog?.products || catalog.public_catalog?.products || [];
const product = products.find(item => /GeForce GTX 950/i.test(item.canonical_display_name || item.name || ''))
  || products.find(item => item.category_code === 'GPU');
assert.ok(product, 'a GPU model is required');
const modelId = product.canonical_product_id || product.id;

const browserPath = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
].find(existsSync);
const browser = await chromium.launch({ headless: true, ...(browserPath ? { executablePath: browserPath } : {}) });
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, locale: 'ko-KR' });
const page = await context.newPage();
const pageErrors = [];
const responseErrors = [];
const priceRequests = [];
if (fixture) {
  await context.route('**/api/products/*/price-stats?**', async route => {
    const url = new URL(route.request().url());
    priceRequests.push(Object.fromEntries(url.searchParams));
    const requestedModelId = decodeURIComponent(url.pathname.match(/\/api\/products\/(.+)\/price-stats$/)?.[1] || modelId);
    const days = Number(url.searchParams.get('days') || 30);
    const usd = url.searchParams.get('currency') === 'USD';
    const to = url.searchParams.get('as_of') || '2026-09-21';
    const from = new Date(Date.parse(to) - (days - 1) * 86_400_000).toISOString().slice(0, 10);
    const metric = (value, sampleCount = 8) => sampleCount
      ? { sample_count: sampleCount, min: value - 5000, max: value + 5000, mean: value, median: value }
      : { sample_count: 0, min: null, max: null, mean: null, median: null };
    const daily = Array.from({ length: days }, (_, index) => {
      const date = new Date(Date.parse(from) + index * 86_400_000).toISOString().slice(0, 10);
      return { date, active: metric(40_000 + index * 200), sold: metric(35_000 + index * 100, index % 4 ? 8 : 0) };
    });
    const data = {
      canonical_product_id: requestedModelId,
      publication_id: 'browser-fixture-publication',
      window: { from, to, days }, published_window: { from, to, days }, as_of: `${to}T05:00:00Z`,
      versions: { normalization: 18 }, availability: 'ready',
      methodology: { currency: 'KRW', market_pool: 'KR_C2C_USED', condition: 'USED_WORKING', days },
      active: metric(43_000), sold: metric(36_000), confirmed_transactions: metric(0, 0), daily,
      by_source: [
        { source_id: 'bunjang', active: metric(45_000), sold: metric(37_000), daily: daily.map(row => ({
          ...row,
          active: metric(row.active.mean + 2_500, row.active.sample_count),
          sold: metric((row.sold.mean || 0) + 1_000, row.sold.sample_count),
        })) },
        { source_id: 'joonggonara', active: metric(41_000), sold: metric(0, 0), daily: daily.map(row => ({ ...row, active: metric(row.active.mean - 2_000), sold: metric(0, 0) })) },
        { source_id: 'hellomarket', active: metric(39_000), sold: metric(34_000), daily },
      ],
    };
    if (usd) {
      data.methodology = { ...data.methodology, currency: 'USD', market_pool: 'OVERSEAS_USED' };
      const usdMetric = value => ({ sample_count: 8, min: value - 5, max: value + 5, mean: value, median: value });
      data.active = usdMetric(45); data.sold = usdMetric(36);
      data.daily = daily.map((row, index) => ({ date: row.date, active: usdMetric(45 + index / 10), sold: usdMetric(36 + index / 10) }));
      data.by_source = [{ source_id: 'ebay', active: data.active, sold: data.sold, daily: data.daily }];
    }
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ status: 'success', data }) });
  });
}
page.on('pageerror', error => pageErrors.push(error.message));
page.on('response', response => {
  if (response.url().startsWith(origin) && response.status() >= 400) {
    responseErrors.push({ url: response.url(), status: response.status() });
  }
});

const ready = async () => {
  await page.waitForFunction(() => {
    const chart = document.querySelector('#price-chart');
    return chart?.getAttribute('aria-busy') === 'false' && ['ready', 'unavailable', 'error'].includes(chart.dataset.priceState);
  }, null, { timeout: 45_000 });
  assert.equal(await page.locator('#price-chart').getAttribute('data-price-state'), 'ready', await page.locator('#chart-coverage').textContent());
};

try {
  await page.goto(`${origin}/price-analysis.html?model=${encodeURIComponent(modelId)}`, { waitUntil: 'domcontentloaded' });
  await ready();

  const tabs = await page.locator('#chart-sources [data-action="chart-source"]').allTextContents();
  assert.ok(tabs.includes('전체'));
  assert.ok(tabs.includes('중고나라'));
  assert.ok(tabs.includes('번개장터'));
  assert.ok(tabs.includes('eBay (USD)'));
  assert.equal(tabs.some(text => /헬로마켓/i.test(text)), false);

  await page.locator('#analysis-model-select').click();
  await page.locator('#analysis-model-dialog').waitFor({ state: 'visible' });
  const currentModelButton = page.locator('#analysis-model-dialog tr.is-selected button[data-action="analyze"]');
  assert.equal(await currentModelButton.innerText(), '현재 모델');
  assert.equal(await currentModelButton.isDisabled(), true);
  await page.screenshot({ path: path.join(out, 'analysis-picker-current.png'), fullPage: false });
  const nextModelButton = page.locator('#analysis-model-dialog tr:not(.is-selected) button[data-action="analyze"]').first();
  const nextModelName = await nextModelButton.locator('xpath=ancestor::tr/td[1]').innerText();
  await nextModelButton.click();
  await page.locator('#analysis-model-dialog').waitFor({ state: 'hidden' });
  assert.match(await page.locator('#analysis-model-select').innerText(), new RegExp(nextModelName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  await ready();
  await page.locator('#analysis-model-select').click();
  await page.locator(`#analysis-model-dialog button[data-action="analyze"][data-id="${modelId}"]`).click();
  await page.locator('#analysis-model-dialog').waitFor({ state: 'hidden' });
  await ready();
  await page.locator('#analysis-model-select').click();
  await page.locator('#analysis-categories [data-action="category"][data-category="CPU"]').click();
  const visiblePageNumbers = (await page.locator('#model-pages button[data-action="page"]').allTextContents())
    .filter(text => /^\d+$/.test(text));
  assert.deepEqual(visiblePageNumbers, ['1', '2', '3', '4', '5', '6', '7', '8', '9', '10']);
  assert.match(await page.locator('#tool-sort option[value="price"]').innerText(), /낮은가격순 \(전체\)/);
  await page.screenshot({ path: path.join(out, 'analysis-pagination-10.png'), fullPage: false });
  await page.setViewportSize({ width: 390, height: 844 });
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  await page.locator('#model-pages').scrollIntoViewIfNeeded();
  await page.screenshot({ path: path.join(out, 'analysis-pagination-10-mobile.png'), fullPage: false });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.locator('[data-action="close-analysis-picker"]').click();
  await page.goto(`${origin}/price-analysis.html?model=${encodeURIComponent(modelId)}`, { waitUntil: 'domcontentloaded' });
  await ready();

  const overallLegend = await page.locator('#price-chart .tools-chart-legend').innerText();
  assert.match(overallLegend, /(중고나라|번개장터) · 판매중 대표가격/);
  assert.doesNotMatch(overallLegend, /헬로마켓/i);
  if (fixture) assert.match(overallLegend, /eBay · 판매중 대표가격 \(USD\)/);
  assert.deepEqual(await page.locator('#analysis-source-comparison tbody tr').evaluateAll(rows => rows.map(row => row.dataset.source)), ['ebay', 'joonggonara', 'bunjang']);
  const legendColors = await page.locator('#price-chart .tools-chart-legend > button').evaluateAll(items => items.map(item => ({
    label: item.textContent,
    color: getComputedStyle(item).color,
  })));
  const activeColors = legendColors.filter(item => item.label.includes('판매중 대표가격')).map(item => item.color);
  assert.equal(new Set(activeColors).size, activeColors.length, 'aggregate and marketplace active lines must have distinct colors');

  await page.locator('[data-action="chart-source"][data-source="bunjang"]').click();
  await ready();
  const bunjangLegend = await page.locator('#price-chart .tools-chart-legend').innerText();
  assert.match(bunjangLegend, /번개장터 · 판매중 대표가격/);
  assert.doesNotMatch(bunjangLegend, /전체|중고나라|eBay|헬로마켓/i);

  await page.locator('[data-action="chart-source"][data-source=""]').click();
  await ready();
  const workspace = page.locator('#analysis-workspace');
  assert.equal(await workspace.getAttribute('data-layout'), 'split');
  await page.locator('[data-action="analysis-pane"][data-pane="table"]').click();
  assert.equal(await workspace.getAttribute('data-layout'), 'chart');
  assert.equal(await page.locator('#analysis-table-pane').isHidden(), true);
  await page.locator('[data-action="analysis-pane"][data-pane="table"]').click();
  await page.locator('[data-action="analysis-pane"][data-pane="chart"]').click();
  assert.equal(await workspace.getAttribute('data-layout'), 'table');
  assert.equal(await page.locator('#analysis-chart-pane').isHidden(), true);
  await page.locator('[data-action="analysis-pane"][data-pane="chart"]').click();

  const beforeZoom = await page.locator('#chart-window-status').innerText();
  const zoomX = page.locator('[data-zoom-axis="x"]');
  if (await zoomX.count()) {
    for (let i = 0; i < 6; i++) { await zoomX.hover(); await page.mouse.wheel(0, -120); }
    const zoomY = page.locator('[data-zoom-axis="y"]').first();
    for (let i = 0; i < 4; i++) { await zoomY.hover(); await page.mouse.wheel(0, -120); }
    assert.notEqual(await page.locator('#chart-window-status').innerText(), beforeZoom);
    const viewport = page.locator('#price-chart .tools-chart-viewport');
    await viewport.hover(); await page.mouse.wheel(200, 160);
    await page.waitForFunction(() => {
      const node = document.querySelector('#price-chart .tools-chart-viewport');
      return node.scrollLeft > 0 && node.scrollTop > 0;
    });
    const axes = page.locator('.tools-chart-fixed-axes');
    const axisBox = await axes.boundingBox();
    await viewport.hover(); await page.mouse.wheel(100, 100);
    assert.deepEqual(await axes.boundingBox(), axisBox, 'date and price axes stay fixed while the plot pans');
    const toggle = page.locator('.tools-chart-legend button').first();
    const seriesId = await toggle.getAttribute('data-series');
    await toggle.click();
    assert.equal(await toggle.getAttribute('aria-pressed'), 'false');
    assert.equal(await page.locator(`g[data-series="${seriesId}"]`).isVisible(), false);
    await toggle.click();
    assert.equal(await toggle.getAttribute('aria-pressed'), 'true');
    await zoomX.dblclick(); await zoomY.dblclick();
  }
  const tableScroll = page.locator('#analysis-source-comparison');
  assert.equal(await tableScroll.evaluate(node => getComputedStyle(node).overflowX), 'auto');
  assert.ok(await tableScroll.evaluate(node => node.scrollWidth >= node.clientWidth));
  await page.screenshot({ path: path.join(out, 'analysis-desktop.png'), fullPage: true });

  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator('[data-action="analysis-pane"][data-pane="table"]').click();
  assert.equal(await workspace.getAttribute('data-layout'), 'table');
  assert.equal(await page.locator('#analysis-chart-pane').isHidden(), true);
  await page.locator('[data-action="analysis-pane"][data-pane="chart"]').click();
  assert.equal(await workspace.getAttribute('data-layout'), 'chart');
  assert.equal(await page.locator('#analysis-table-pane').isHidden(), true);
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  await page.screenshot({ path: path.join(out, 'analysis-mobile.png'), fullPage: true });

  assert.deepEqual(pageErrors, []);
  assert.deepEqual(responseErrors, []);
  if (fixture) assert.ok(priceRequests.length && priceRequests.every(query => !('as_of' in query)), 'the current default range must not send as_of');
  console.log(JSON.stringify({ status: 'passed', mode: fixture ? 'synthetic price API' : 'live API', origin, model_id: modelId, tabs, overall_legend: overallLegend, legend_colors: legendColors, bunjang_legend: bunjangLegend, price_requests: priceRequests, screenshots: out }, null, 2));
} finally {
  await context.close();
  await browser.close();
}
