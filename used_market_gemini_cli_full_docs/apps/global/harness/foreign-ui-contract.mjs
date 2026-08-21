import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const baseUrl = process.env.FOREIGN_UI_URL || 'http://127.0.0.1:8788/global/';
const session = process.env.FOREIGN_UI_SESSION || `used-market-foreign-${process.pid}`;
const playwrightCli = fileURLToPath(new URL('../node_modules/@playwright/cli/playwright-cli.js', import.meta.url));

function cli(...args) {
  const result = spawnSync(process.execPath, [playwrightCli, `-s=${session}`, ...args], {
    cwd: root,
    encoding: 'utf8',
    timeout: 180_000,
    shell: false,
    windowsHide: true
  });
  const output = `${result.stdout || ''}${result.stderr || ''}`;
  if (result.status !== 0) throw new Error(`playwright-cli failed (${result.status}): ${result.error?.message || ''} ${output}`);
  return output;
}

function runCode(code) {
  const path = resolve(tmpdir(), `used-market-foreign-ui-${process.pid}.mjs`);
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
try {
  const result = runCode(`async (page) => {
    const requests = [];
    const consoleErrors = [];
    page.on('console', (message) => {
      if (message.type() === 'error') consoleErrors.push(message.text());
    });
    page.on('pageerror', (error) => consoleErrors.push(String(error)));
    await page.route('**/api/categories', async (route) => route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ status: 'success', data: { categories: [], site_plans: {} } })
    }));
    await page.route('**/api/search', async (route) => {
      const request = JSON.parse(route.request().postData() || '{}');
      requests.push(request);
      const us = request.sites?.some((site) => ['poshmark', 'vinted', 'unclaimed_baggage'].includes(site));
      const fixtures = us ? [
        { title: 'Apple iPhone 13 Midnight', price: 299, currency: 'USD', price_label: 'Sale price', site: 'poshmark', url: 'https://poshmark.com/listing/fixture', image_url: '', condition: 'Like New', shipping: '', posted_at: '2026-08-15T10:00:00Z' },
        { title: 'Apple iPhone 13 128GB', price: 163, currency: 'USD', price_label: 'Sale price', site: 'vinted', url: 'https://www.vinted.com/items/fixture', image_url: '', condition: 'Very good', shipping: '', posted_at: '2026-08-18T10:00:00Z' },
        { title: 'iPhone 13 AT&T 128GB', price: 204.99, currency: 'USD', price_label: 'Sale price', site: 'unclaimed_baggage', url: 'https://www.unclaimedbaggage.com/products/fixture', image_url: '', condition: 'Fair', shipping: 'Free Shipping', posted_at: '2026-08-16T10:00:00Z' }
      ] : [
        { title: 'Apple iPhone 13 本体', price: 283146, currency: 'KRW', price_label: 'Sale price', site: 'mercari_jp', url: 'https://jp.mercari.com/item/m-fixture', image_url: '', condition: '', shipping: '', posted_at: '' },
        { title: 'iPhone 13 Pro 128GB', price: 5751, currency: 'JPY', price_label: 'Current bid', site: 'yahoo_auction_jp', url: 'https://auctions.yahoo.co.jp/jp/auction/f-fixture', image_url: '', condition: '', shipping: '＋送料520円', posted_at: '2日' },
        { title: 'iPhone 13 256GB SIMフリー 本体', price: 57980, currency: 'JPY', price_label: 'Sale price', site: 'rakuma', url: 'https://item.fril.jp/fixture', image_url: '', condition: '', shipping: '', posted_at: '' }
      ];
      let items = fixtures.filter((item) => request.sites?.includes(item.site));
      const currencies = new Set(items.map((item) => item.currency));
      const mixedCurrency = currencies.size > 1;
      const hasRange = Number.isFinite(request.min_price) || Number.isFinite(request.max_price);
      const filterMeta = { requested: hasRange, applied: !hasRange || !mixedCurrency, reason: hasRange && mixedCurrency ? 'mixed_currency' : null };
      if (hasRange && !mixedCurrency) {
        items = items.filter((item) => (!Number.isFinite(request.min_price) || item.price >= request.min_price)
          && (!Number.isFinite(request.max_price) || item.price <= request.max_price));
      }
      const sortMeta = { requested: request.sort || 'recommended', applied: true, reason: null };
      if (['price_asc', 'price_desc'].includes(sortMeta.requested)) {
        if (mixedCurrency) {
          sortMeta.applied = false;
          sortMeta.reason = 'mixed_currency';
        } else {
          const direction = sortMeta.requested === 'price_desc' ? -1 : 1;
          items.sort((left, right) => (left.price - right.price) * direction);
        }
      }
      if (sortMeta.requested === 'recent') {
        const dated = items.filter((item) => Number.isFinite(Date.parse(item.posted_at)));
        if (!dated.length) {
          sortMeta.applied = false;
          sortMeta.reason = 'missing_dates';
        } else {
          items.sort((left, right) => (Date.parse(right.posted_at) || 0) - (Date.parse(left.posted_at) || 0));
        }
      }
      const sources = request.sites.map((site) => ({
        key: site,
        count: fixtures.filter((item) => item.site === site).length,
        visible_count: fixtures.filter((item) => item.site === site).length,
        extracted_count: 1,
        filtered_count: site === 'yahoo_auction_jp' ? 2 : 0,
        status: site === 'yahoo_auction_jp' ? 'warning' : 'ready',
        collection_state: site === 'yahoo_auction_jp' ? 'partial' : 'ready',
        warnings: site === 'yahoo_auction_jp' ? ['Dropped item due to weak keyword relevance: fixture'] : [],
        errors: []
      }));
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          status: 'success',
          data: {
            query: 'iphone 13',
            items,
            sources,
            quality: { available_count: items.length },
            pagination: { has_more: false, next_cursor: null },
            summary: { currency: mixedCurrency ? 'MIXED' : [...currencies][0] || 'USD', median_price: null, average_price: null, lowest_price: null, highest_price: null },
            sort_meta: sortMeta,
            filter_meta: filterMeta
          }
        })
      });
    });

    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(${JSON.stringify(baseUrl)}, { waitUntil: 'domcontentloaded' });
    await page.locator('#keyword').fill('iphone 13');
    await page.locator('#search-button').click();
    await page.waitForFunction(() => document.querySelectorAll('#result-list .item-row').length === 3);
    const countryTabs = await page.locator('[data-country-tab]').evaluateAll((nodes) => nodes.map((node) => node.textContent?.trim()));
    const japanTabs = await page.locator('[data-site-tab]').evaluateAll((nodes) => nodes.map((node) => node.textContent?.trim()));
    const japanPrices = await page.locator('.item-price strong').allTextContents();
    const japanHints = await page.locator('.item-price small').allTextContents();
    const japanResultText = await page.locator('#main').textContent();
    const japanOriginalLang = await page.locator('.item-title').first().getAttribute('lang');
    const japanCanonical = await page.locator('link[rel="canonical"]').getAttribute('href');
    const japanOgUrl = await page.locator('meta[property="og:url"]').getAttribute('content');
    const footerLinks = await page.locator('.site-footer nav a').evaluateAll((nodes) => nodes.map((node) => ({ text: node.textContent?.trim(), href: node.getAttribute('href') })));
    const globalCategoryHidden = await page.locator('.category-sidebar').evaluate((node) => getComputedStyle(node).display === 'none');
    await page.waitForFunction(() => document.querySelector('#control-notice')?.textContent?.includes('currencies'));
    const mixedCurrencyNotice = await page.locator('#control-notice').textContent();
    const japanPriceControlsDisabled = await page.locator('[data-sort="price_asc"], #min-price, #max-price').evaluateAll((nodes) => nodes.every((node) => node.disabled));
    const foreignExpandHidden = await page.locator('[data-expand-results]').count() === 0;
    const profileSwitchCount = await page.locator('.market-profile-switch').count();

    await page.locator('[data-site-tab="yahoo_auction_jp"]').click();
    await page.waitForFunction(() => document.querySelectorAll('#result-list .item-row').length === 1);
    await page.locator('[data-sort="price_desc"]').click();
    await page.waitForFunction(() => document.querySelector('[data-sort="price_desc"]')?.getAttribute('aria-pressed') === 'true');
    await page.locator('[data-site-tab="all"]').click();
    await page.waitForFunction(() => document.querySelectorAll('#result-list .item-row').length === 3
      && document.querySelector('[data-sort="recommended"]')?.getAttribute('aria-pressed') === 'true');
    const japanAggregateReset = {
      sort: await page.locator('[data-sort][aria-pressed="true"]').textContent(),
      min: await page.locator('#min-price').inputValue(),
      max: await page.locator('#max-price').inputValue(),
      request: requests.at(-1)
    };

    await page.locator('[data-country-tab="us"]').click();
    await page.waitForFunction(() => document.querySelector('[data-site-tab="poshmark"]') && document.querySelectorAll('#result-list .item-row').length === 3);
    const usTabs = await page.locator('[data-site-tab]').evaluateAll((nodes) => nodes.map((node) => node.textContent?.trim()));
    const ebayTab = await page.locator('[data-site-tab="ebay"]').evaluate((node) => ({
      tag: node.tagName,
      pressed: node.getAttribute('aria-pressed'),
      label: node.textContent?.trim()
    }));
    const usPrices = await page.locator('.item-price strong').allTextContents();
    const usResultText = await page.locator('#result-list').textContent();
    const usOriginalLang = await page.locator('.item-title').first().getAttribute('lang');
    const usCanonical = await page.locator('link[rel="canonical"]').getAttribute('href');
    const usOgUrl = await page.locator('meta[property="og:url"]').getAttribute('content');
    await page.locator('[data-sort="price_asc"]').click();
    await page.waitForFunction(() => document.querySelector('.item-price strong')?.textContent?.includes('163'));
    const priceAsc = await page.locator('.item-price strong').allTextContents();
    await page.locator('[data-sort="price_desc"]').click();
    await page.waitForFunction(() => document.querySelector('.item-price strong')?.textContent?.includes('299'));
    const priceDesc = await page.locator('.item-price strong').allTextContents();
    await page.locator('[data-sort="recent"]').click();
    await page.waitForFunction(() => document.querySelector('#result-list .item-title')?.textContent?.includes('128GB'));
    const recentTitles = await page.locator('#result-list .item-title').allTextContents();
    await page.locator('#min-price').fill('200');
    await page.locator('#max-price').fill('250');
    await page.locator('#apply-price-filter').click();
    await page.waitForFunction(() => document.querySelectorAll('#result-list .item-row').length === 1);
    const filteredCount = await page.locator('#result-count').textContent();
    const filteredPrices = await page.locator('.item-price strong').allTextContents();

    const requestCountBeforeSiteSwitch = requests.length;
    await page.locator('[data-site-tab="unclaimed_baggage"]').click();
    await page.waitForFunction(() => document.querySelectorAll('#result-list .item-row').length === 1);
    const unclaimedOnly = await page.locator('#result-list .item-title').allTextContents();
    const requestCountAfterSiteSwitch = requests.length;

    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForTimeout(150);
    const mobileOverflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);

    return { requests, countryTabs, japanTabs, japanPrices, japanHints, japanResultText, japanOriginalLang, japanCanonical, japanOgUrl, footerLinks, globalCategoryHidden, mixedCurrencyNotice, japanPriceControlsDisabled, foreignExpandHidden, japanAggregateReset, usTabs, ebayTab, usPrices, usResultText, usOriginalLang, usCanonical, usOgUrl, priceAsc, priceDesc, recentTitles, filteredCount, filteredPrices, profileSwitchCount, unclaimedOnly, requestCountBeforeSiteSwitch, requestCountAfterSiteSwitch, mobileOverflow, consoleErrors };
  }`);

  assert.deepEqual(result.countryTabs, ['Japan', 'United States']);
  assert.deepEqual(result.japanTabs, ['All', 'Mercari JP', 'Yahoo! Auctions', 'Rakuma']);
  assert.deepEqual(result.usTabs, ['All', 'eBay', 'Poshmark', 'Vinted US', 'Unclaimed Baggage']);
  assert.equal(result.ebayTab.tag, 'BUTTON');
  assert.equal(result.ebayTab.pressed, 'false');
  assert.equal(result.ebayTab.label, 'eBay');
  assert.deepEqual(result.requests[0].sites, ['mercari_jp', 'yahoo_auction_jp', 'rakuma']);
  assert.ok(result.requests.some((request) => request.sites?.join(',') === 'ebay,poshmark,vinted,unclaimed_baggage'));
  assert.equal(result.requestCountAfterSiteSwitch, result.requestCountBeforeSiteSwitch, 'site tabs must reuse the loaded aggregate session');
  assert.ok(result.japanPrices.some((price) => price.includes('283,146')));
  assert.ok(result.japanPrices.some((price) => price.includes('5,751')));
  assert.ok(result.usPrices.some((price) => price.includes('299')));
  assert.ok(result.usPrices.some((price) => price.includes('204.99')));
  assert.ok(result.japanHints.some((hint) => hint.includes('Current bid') && hint.includes('Final price may change')));
  assert.match(result.japanResultText, /Ends in 2 days/);
  assert.match(result.japanResultText, /Shipping ¥520/);
  assert.match(result.japanResultText, /Partial/);
  assert.equal(result.japanOriginalLang, 'ja');
  assert.equal(result.japanCanonical, 'https://global.used-pick.com/global/?country=jp');
  assert.equal(result.japanOgUrl, 'https://global.used-pick.com/global/?country=jp');
  assert.deepEqual(result.footerLinks, [
    { text: 'Japan Search', href: '/global/?country=jp' },
    { text: 'United States Search', href: '/global/?country=us' }
  ]);
  assert.equal(result.globalCategoryHidden, true);
  assert.match(result.mixedCurrencyNotice, /multiple currencies/);
  assert.equal(result.japanPriceControlsDisabled, true);
  assert.equal(result.foreignExpandHidden, true);
  assert.equal(result.japanAggregateReset.sort, 'Recommended');
  assert.equal(result.japanAggregateReset.min, '');
  assert.equal(result.japanAggregateReset.max, '');
  assert.equal(result.japanAggregateReset.request.sort, 'recommended');
  assert.match(result.usResultText, /Very good/);
  assert.match(result.usResultText, /Free Shipping/);
  assert.equal(result.usOriginalLang, null);
  assert.equal(result.usCanonical, 'https://global.used-pick.com/global/?country=us');
  assert.equal(result.usOgUrl, 'https://global.used-pick.com/global/?country=us');
  assert.deepEqual(result.priceAsc, ['$163.00', '$204.99', '$299.00']);
  assert.deepEqual(result.priceDesc, ['$299.00', '$204.99', '$163.00']);
  assert.equal(result.recentTitles[0], 'Apple iPhone 13 128GB');
  assert.match(result.filteredCount, /1 result/);
  assert.deepEqual(result.filteredPrices, ['$204.99']);
  assert.equal(result.profileSwitchCount, 0);
  assert.deepEqual(result.unclaimedOnly, ['iPhone 13 AT&T 128GB']);
  assert.equal(result.mobileOverflow, false);
  assert.deepEqual(result.consoleErrors, []);

  console.log(JSON.stringify({ status: 'passed', checks: 48, ...result }, null, 2));
} finally {
  cli('close');
}
