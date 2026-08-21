import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const baseUrl = process.env.FOREIGN_ENGLISH_UI_URL || 'http://127.0.0.1:8788/global/?country=jp';
const session = process.env.FOREIGN_ENGLISH_UI_SESSION || `used-market-foreign-english-${process.pid}`;
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
  const path = resolve(tmpdir(), `used-market-foreign-english-ui-${process.pid}.mjs`);
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
    let fixtureSessionSequence = 0;
    let fixtureSessionId = '';
    let fixtureSessionGeneration = 1;
    let fixtureSessionLoadedCount = 60;
    let fixtureSessionWindow = 60;
    let fixtureSessionRefreshes = 0;
    page.on('console', (message) => {
      if (message.type() !== 'error') return;
      const text = message.text();
      if (/Failed to load resource:.*status of (?:429|500)\\b/i.test(text)) return;
      consoleErrors.push(text);
    });
    page.on('pageerror', (error) => consoleErrors.push(String(error)));
    await page.evaluate(() => localStorage.clear());
    await page.route('**/api/categories', async (route) => route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ status: 'success', data: { categories: [], site_plans: {} } })
    }));
    await page.route('**/api/search', async (route) => {
      const request = JSON.parse(route.request().postData() || '{}');
      requests.push(request);
      if (request.keyword === 'session-fixture' || request.keyword === 'session-new-fixture') {
        const collectionSites = Array.isArray(request.sites) && request.sites.length
          ? request.sites
          : ['ebay', 'poshmark', 'vinted', 'unclaimed_baggage'];
        if (!request.session_id) {
          fixtureSessionSequence += 1;
          fixtureSessionId = 'fixture-session-' + fixtureSessionSequence;
          fixtureSessionGeneration = 1;
          fixtureSessionLoadedCount = 60;
          fixtureSessionWindow = 60;
          if (request.refresh_index === true) {
            fixtureSessionRefreshes += 1;
            await page.waitForTimeout(120);
          }
        } else if (request.session_id !== fixtureSessionId
          || request.session_generation !== fixtureSessionGeneration) {
          await route.fulfill({
            status: 409,
            contentType: 'application/json',
            body: JSON.stringify({ status: 'error', error: 'SESSION_MISMATCH: fixture generation changed' })
          });
          return;
        }

        const requestedWindow = Number.isInteger(request.session_window)
          ? Math.min(Math.max(request.session_window, 30), 640)
          : fixtureSessionWindow;
        fixtureSessionWindow = requestedWindow;
        if (request.cursor && request.session_only !== true) {
          fixtureSessionGeneration += 1;
          fixtureSessionLoadedCount = Math.min(300, Math.max(fixtureSessionLoadedCount, requestedWindow));
        }

        const siteUrls = {
          ebay: 'https://www.ebay.com/itm/session-',
          poshmark: 'https://poshmark.com/listing/session-',
          vinted: 'https://www.vinted.com/items/session-',
          unclaimed_baggage: 'https://www.unclaimedbaggage.com/products/session-'
        };
        const allItems = Array.from({ length: fixtureSessionLoadedCount }, (_, index) => {
          const site = collectionSites[index % collectionSites.length];
          return {
            id: site + ':session:' + index,
            title: 'Session listing ' + String(index + 1).padStart(3, '0'),
            price: 100 + index,
            currency: 'USD',
            price_label: 'Sale price',
            site,
            url: (siteUrls[site] || siteUrls.ebay) + index,
            image_url: '',
            condition: 'Used',
            shipping: '',
            posted_at: new Date(Date.UTC(2026, 7, 20, 0, index % 60)).toISOString(),
            location: 'United States'
          };
        });
        const failedSite = fixtureSessionRefreshes === 0 && request.keyword === 'session-fixture' ? 'poshmark' : '';
        let controlledItems = allItems
          .slice(0, Math.min(fixtureSessionWindow, fixtureSessionLoadedCount))
          .filter((item) => item.site !== failedSite);
        const viewSites = Array.isArray(request.view_sites) ? request.view_sites : [];
        if (viewSites.length) controlledItems = controlledItems.filter((item) => viewSites.includes(item.site));
        if (Number.isFinite(request.min_price)) controlledItems = controlledItems.filter((item) => item.price >= request.min_price);
        if (Number.isFinite(request.max_price)) controlledItems = controlledItems.filter((item) => item.price <= request.max_price);
        if (request.sort === 'price_asc') controlledItems.sort((left, right) => left.price - right.price);
        if (request.sort === 'price_desc') controlledItems.sort((left, right) => right.price - left.price);
        if (request.sort === 'recent') controlledItems.sort((left, right) => Date.parse(right.posted_at) - Date.parse(left.posted_at));

        const pageIndex = Number.isInteger(request.session_page) ? request.session_page : 0;
        const pageItems = controlledItems.slice(pageIndex * 30, pageIndex * 30 + 30);
        const sourceTotals = Object.fromEntries(collectionSites.map((site) => [
          site,
          controlledItems.filter((item) => item.site === site).length
        ]));
        const summarySites = viewSites.length ? viewSites : collectionSites;
        const sources = summarySites.map((site) => ({
          key: site,
          count: sourceTotals[site] || 0,
          visible_count: sourceTotals[site] || 0,
          total_count: sourceTotals[site] || 0,
          status: site === failedSite ? 'failed' : sourceTotals[site] ? 'ready' : 'empty',
          collection_state: site === failedSite ? 'failed' : sourceTotals[site] ? 'ready' : 'empty',
          warnings: [],
          errors: site === failedSite ? ['BLOCKED_PAGE: fixture source unavailable'] : []
        }));
        const hasMore = fixtureSessionLoadedCount < 300;
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            status: 'success',
            data: {
              query: request.keyword,
              items: pageItems,
              sources,
              session: {
                id: fixtureSessionId,
                generation: fixtureSessionGeneration,
                page: pageIndex,
                page_size: 30,
                loaded_count: fixtureSessionLoadedCount,
                available_count: controlledItems.length,
                window: fixtureSessionWindow,
                source_totals: sourceTotals,
                expires_at: '2026-08-20T23:59:59.000Z'
              },
              quality: { available_count: controlledItems.length },
              pagination: { has_more: hasMore, next_cursor: hasMore ? 'fixture-cursor-' + fixtureSessionLoadedCount : null },
              summary: { currency: 'USD' },
              sort_meta: { requested: request.sort || 'recommended', applied: true, reason: null },
              filter_meta: { requested: Number.isFinite(request.min_price) || Number.isFinite(request.max_price), applied: true, reason: null }
            }
          })
        });
        return;
      }
      if (request.keyword === 'server-error') {
        await route.fulfill({
          status: 500,
          contentType: 'application/json',
          body: JSON.stringify({ status: 'error', error: 'Internal error' })
        });
        return;
      }
      if (request.keyword === 'busy-error') {
        await route.fulfill({
          status: 429,
          headers: { 'Retry-After': '7' },
          contentType: 'application/json',
          body: JSON.stringify({ status: 'error', error: 'Search capacity reached. Retry later.', code: 'SEARCH_BUSY', retry_after_seconds: 7 })
        });
        return;
      }
      const sites = Array.isArray(request.sites) ? request.sites : [];
      const us = sites.some((site) => ['poshmark', 'vinted', 'unclaimed_baggage'].includes(site));
      const empty = request.keyword === 'no-results';
      const paginationFixture = request.keyword === 'pagination-fixture';
      if (request.keyword === 'loading-fixture') await page.waitForTimeout(250);
      const baseItems = us ? [
        { title: 'Apple iPhone 13 Midnight', price: 299, currency: 'USD', price_label: 'Sale price', site: 'poshmark', url: 'https://poshmark.com/listing/fixture', image_url: '', condition: 'Like New', shipping: '', posted_at: '2026-08-15T10:00:00Z', location: 'Portland, OR' },
        { title: 'Apple iPhone 13 128GB', price: 163, currency: 'USD', price_label: 'Sale price', site: 'vinted', url: 'https://www.vinted.com/items/fixture', image_url: '', condition: 'Very good', shipping: '', posted_at: '2026-08-18T10:00:00Z', location: 'Chicago, IL' },
        { title: 'iPhone 13 AT&T 128GB', price: 204.99, currency: 'USD', price_label: 'Sale price', site: 'unclaimed_baggage', url: 'https://www.unclaimedbaggage.com/products/fixture', image_url: '', condition: 'Fair', shipping: 'Free Shipping', posted_at: '2026-08-16T10:00:00Z', location: 'Scottsboro, AL' }
      ] : [
        { title: 'Apple iPhone 13 本体', price: 283146, currency: 'KRW', price_label: 'Sale price', site: 'mercari_jp', url: 'https://jp.mercari.com/item/m-fixture', image_url: '', condition: 'Good', shipping: '', posted_at: '', location: 'Tokyo' },
        { title: 'iPhone 13 Pro 128GB', price: 5751, currency: 'JPY', price_label: 'Current bid', site: 'yahoo_auction_jp', url: 'https://auctions.yahoo.co.jp/jp/auction/f-fixture', image_url: '', condition: 'Used', shipping: '＋送料520円', posted_at: '2日', location: 'Osaka' },
        { title: 'iPhone 13 256GB SIMフリー 本体', price: 57980, currency: 'JPY', price_label: 'Sale price', site: 'rakuma', url: 'https://item.fril.jp/fixture', image_url: '', condition: 'Like New', shipping: '', posted_at: '', location: 'Kyoto' }
      ];
      const fixtureItems = request.keyword === 'security-fixture'
        ? [
            { ...baseItems[0], site: 'mercari_jp', title: 'Allowed marketplace URL', url: 'https://jp.mercari.com/item/m-safe', image_url: 'https://static.mercdn.net/thumb/item/webp/safe.jpg' },
            { ...baseItems[1], site: 'yahoo_auction_jp', title: 'Blocked URL scheme', url: 'javascript:alert(1)', image_url: 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" />' },
            { ...baseItems[2], site: 'rakuma', title: 'Blocked external host', url: 'https://attacker.example/listing', image_url: 'https://attacker.example/image.jpg' },
            { ...baseItems[2], site: 'rakuma', title: 'Blocked insecure URL', url: 'http://item.fril.jp/insecure', image_url: 'http://img.fril.jp/insecure.jpg' },
            { ...baseItems[2], site: 'rakuma', title: 'Blocked local file URL', url: 'file:///etc/passwd', image_url: 'file:///tmp/image.jpg' }
          ]
        : request.keyword === 'unclaimed-image-fixture'
          ? [{ ...baseItems[2], image_url: 'https://www.unclaimedbaggage.com/cdn/shop/files/iphone-fixture.jpg?width=300' }]
        : paginationFixture
        ? Array.from({ length: 31 }, (_, index) => ({
            ...baseItems[index % baseItems.length],
            title: index === 0 ? baseItems[0].title : 'Original listing ' + (index + 1),
            url: baseItems[index % baseItems.length].url + '-' + (index + 1),
            price: baseItems[index % baseItems.length].price + index
          }))
        : baseItems;
      let items = empty ? [] : fixtureItems.filter((item) => sites.includes(item.site));
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
      const sources = sites.map((site) => {
        const count = items.filter((item) => item.site === site).length;
        const partial = site === 'yahoo_auction_jp' && !empty;
        return {
          key: site,
          count,
          visible_count: count,
          extracted_count: count,
          filtered_count: partial ? 2 : 0,
          status: partial ? 'warning' : count ? 'ready' : 'empty',
          collection_state: partial ? 'partial' : count ? 'ready' : 'empty',
          warnings: partial ? ['Dropped item due to weak keyword relevance: fixture'] : [],
          errors: []
        };
      });
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          status: 'success',
          data: {
            query: request.keyword,
            items,
            sources,
            quality: { available_count: items.length },
            pagination: { has_more: false, next_cursor: null },
            summary: { currency: mixedCurrency ? 'MIXED' : [...currencies][0] || 'USD' },
            sort_meta: sortMeta,
            filter_meta: filterMeta
          }
        })
      });
    });

    const visibleEnglishLeaks = async () => page.evaluate(() => {
      const hangul = /[가-힣]/;
      const textLeaks = document.body.innerText.split(/\\n+/).map((line) => line.trim()).filter((line) => hangul.test(line));
      const attributeLeaks = [];
      for (const node of document.querySelectorAll('[aria-label], [placeholder], [title], img[alt]')) {
        if (node.closest('.item-title, .item-description')) continue;
        const style = getComputedStyle(node);
        const rect = node.getBoundingClientRect();
        if (style.display === 'none' || style.visibility === 'hidden' || !rect.width || !rect.height) continue;
        for (const name of ['aria-label', 'placeholder', 'title', 'alt']) {
          const value = node.getAttribute(name) || '';
          if (hangul.test(value)) attributeLeaks.push(name + ': ' + value);
        }
      }
      return [...new Set([...textLeaks, ...attributeLeaks])];
    });

    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(${JSON.stringify(baseUrl)}, { waitUntil: 'domcontentloaded' });
    const initial = {
      lang: await page.locator('html').getAttribute('lang'),
      title: await page.title(),
      description: await page.locator('meta[name="description"]').getAttribute('content'),
      canonical: await page.locator('link[rel="canonical"]').getAttribute('href'),
      favicon: await page.locator('link[rel="icon"]').getAttribute('href'),
      faviconStatus: await page.evaluate(() => fetch('/global/assets/mark.svg').then((response) => response.status)),
      ogLocale: await page.locator('meta[property="og:locale"]').getAttribute('content'),
      ogUrl: await page.locator('meta[property="og:url"]').getAttribute('content'),
      ogTitle: await page.locator('meta[property="og:title"]').getAttribute('content'),
      ogDescription: await page.locator('meta[property="og:description"]').getAttribute('content'),
      twitterTitle: await page.locator('meta[name="twitter:title"]').getAttribute('content'),
      twitterDescription: await page.locator('meta[name="twitter:description"]').getAttribute('content'),
      structuredData: await page.locator('script[type="application/ld+json"]').textContent(),
      structuredUrl: await page.locator('script[type="application/ld+json"]').evaluate((node) => JSON.parse(node.textContent || '{}').url),
      countryTabs: await page.locator('[data-country-tab]').allTextContents(),
      siteTabs: await page.locator('[data-site-tab]').allTextContents(),
      placeholder: await page.locator('#keyword').getAttribute('placeholder'),
      searchButton: (await page.locator('#search-button').textContent()).trim(),
      recentHeading: (await page.locator('#recent-searches-title').textContent()).trim(),
      recentViewed: (await page.locator('#recent-viewed').textContent()).replace(/\\s+/g, ' ').trim(),
      footer: (await page.locator('.site-footer').textContent()).replace(/\\s+/g, ' ').trim(),
      footerLinks: await page.locator('.site-footer nav a').evaluateAll((nodes) => nodes.map((node) => ({ text: node.textContent?.trim(), href: node.getAttribute('href') }))),
      switchCount: await page.locator('.market-profile-switch').count(),
      coupangHidden: await page.locator('.coupang-banner').isHidden(),
      leaks: await visibleEnglishLeaks()
    };

    await page.locator('#search-button').click();
    const validationText = (await page.locator('#search-status').textContent()).trim();

    await page.locator('#keyword').fill('loading-fixture');
    await page.locator('#search-button').click();
    await page.waitForSelector('#result-list .loading-state');
    const loadingState = {
      button: (await page.locator('#search-button').textContent()).trim(),
      result: (await page.locator('#result-list').textContent()).replace(/\\s+/g, ' ').trim(),
      leaks: await visibleEnglishLeaks()
    };
    await page.waitForFunction(() => document.querySelectorAll('#result-list .item-row').length === 3);

    await page.locator('#keyword').fill('pagination-fixture');
    await page.locator('#search-button').click();
    await page.waitForFunction(() => document.querySelectorAll('#result-list .item-row').length === 30);
    await page.locator('#keyword').focus();
    const japan = {
      sortLabels: await page.locator('[data-sort]').allTextContents(),
      filterLabels: {
        min: await page.locator('#min-price').getAttribute('placeholder'),
        max: await page.locator('#max-price').getAttribute('placeholder'),
        apply: (await page.locator('#apply-price-filter').textContent()).trim(),
        reset: (await page.locator('#reset-filters').textContent()).trim()
      },
      resultCount: (await page.locator('#result-count').textContent()).trim(),
      sourceSummary: (await page.locator('#source-summary').textContent()).replace(/\\s+/g, ' ').trim(),
      notice: (await page.locator('#control-notice').textContent()).trim(),
      priceControlsDisabled: await page.locator('[data-sort="price_asc"], [data-sort="price_desc"], #min-price, #max-price, #apply-price-filter').evaluateAll((nodes) => nodes.every((node) => node.disabled)),
      newestDisabled: await page.locator('[data-sort="recent"]').isDisabled(),
      recommendedEnabled: await page.locator('[data-sort="recommended"]').isEnabled(),
      rawTitle: (await page.locator('.item-title').first().textContent()).trim(),
      rawTitleLang: await page.locator('.item-title').first().getAttribute('lang'),
      resultText: (await page.locator('#result-list').textContent()).replace(/\\s+/g, ' ').trim(),
      paginationText: (await page.locator('#pagination-controls').textContent()).replace(/\\s+/g, ' ').trim(),
      paginationLabel: await page.locator('#pagination-controls').getAttribute('aria-label'),
      clearRecentText: (await page.locator('#clear-recent-searches').textContent()).trim(),
      clearRecentVisible: await page.locator('#clear-recent-searches').isVisible(),
      sortGeometry: await page.locator('[data-sort]').evaluateAll((nodes) => nodes.map((node) => {
        const rect = node.getBoundingClientRect();
        return { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom };
      })),
      leaks: await visibleEnglishLeaks()
    };

    await page.locator('.pagination-page[data-result-page="1"]').click();
    await page.waitForFunction(() => document.querySelectorAll('#result-list .item-row').length === 1);
    const pageTwo = {
      count: (await page.locator('#result-count').textContent()).trim(),
      rows: await page.locator('#result-list .item-row').count(),
      current: (await page.locator('[data-result-page][aria-current="page"]').textContent()).trim(),
      leaks: await visibleEnglishLeaks()
    };

    await page.locator('.pagination-page[data-result-page="0"]').click();
    await page.waitForFunction(() => document.querySelectorAll('#result-list .item-row').length === 30);
    await page.evaluate(() => {
      const prevent = (event) => event.preventDefault();
      document.addEventListener('click', prevent, { capture: true, once: true });
      document.querySelector('.item-title')?.click();
    });
    await page.waitForTimeout(50);
    const recentAfterClick = (await page.locator('#recent-viewed').textContent()).replace(/\\s+/g, ' ').trim();

    await page.locator('[data-site-tab="yahoo_auction_jp"]').click();
    await page.waitForFunction(() => document.querySelectorAll('#result-list .item-row').length > 0);
    await page.locator('[data-sort="price_desc"]').click();
    await page.waitForFunction(() => document.querySelector('[data-sort="price_desc"]')?.getAttribute('aria-pressed') === 'true');
    await page.locator('#min-price').fill('5000');
    await page.locator('#max-price').fill('6000');
    await page.locator('[data-country-tab="us"]').click();
    await page.waitForFunction(() => document.querySelector('[data-site-tab="poshmark"]') && document.querySelectorAll('#result-list .item-row').length === 30);
    await page.locator('#keyword').fill('sort-fixture');
    await page.locator('#search-button').click();
    await page.waitForFunction(() => document.querySelectorAll('#result-list .item-row').length === 3);
    const usInitial = {
      countryTabs: await page.locator('[data-country-tab]').allTextContents(),
      siteTabs: await page.locator('[data-site-tab]').allTextContents(),
      ebayTab: await page.locator('[data-site-tab="ebay"]').evaluate((node) => ({
        tag: node.tagName,
        pressed: node.getAttribute('aria-pressed'),
        label: node.textContent?.trim()
      })),
      activeSite: (await page.locator('[data-site-tab][aria-pressed="true"]').textContent()).trim(),
      activeSort: (await page.locator('[data-sort][aria-pressed="true"]').textContent()).trim(),
      min: await page.locator('#min-price').inputValue(),
      max: await page.locator('#max-price').inputValue(),
      priceControlsEnabled: await page.locator('[data-sort="price_asc"], [data-sort="price_desc"], #min-price, #max-price, #apply-price-filter').evaluateAll((nodes) => nodes.every((node) => !node.disabled)),
      newestEnabled: await page.locator('[data-sort="recent"]').isEnabled(),
      resultText: (await page.locator('#result-list').textContent()).replace(/\\s+/g, ' ').trim(),
      firstTitleLang: await page.locator('.item-title').first().getAttribute('lang'),
      canonical: await page.locator('link[rel="canonical"]').getAttribute('href'),
      ogUrl: await page.locator('meta[property="og:url"]').getAttribute('content'),
      structuredUrl: await page.locator('script[type="application/ld+json"]').evaluate((node) => JSON.parse(node.textContent || '{}').url),
      leaks: await visibleEnglishLeaks()
    };
    const controlRequestCountBefore = requests.length;
    await page.locator('[data-sort="price_asc"]').click();
    await page.waitForFunction(() => document.querySelector('.item-price strong')?.textContent?.includes('163'));
    const priceAsc = await page.locator('.item-price strong').allTextContents();
    await page.locator('[data-sort="price_desc"]').click();
    await page.waitForFunction(() => document.querySelector('.item-price strong')?.textContent?.includes('299'));
    const priceDesc = await page.locator('.item-price strong').allTextContents();
    await page.locator('[data-sort="recent"]').click();
    await page.waitForFunction(() => document.querySelector('#result-list .item-title')?.textContent?.includes('128GB'));
    const newestFirst = (await page.locator('#result-list .item-title').first().textContent()).trim();
    await page.locator('#min-price').fill('300');
    await page.locator('#max-price').fill('200');
    await page.locator('#apply-price-filter').click();
    const priceValidationText = (await page.locator('#search-status').textContent()).trim();
    await page.locator('#min-price').fill('200');
    await page.locator('#max-price').fill('250');
    await page.locator('#apply-price-filter').click();
    await page.waitForFunction(() => document.querySelectorAll('#result-list .item-row').length === 1);
    const filter = {
      count: (await page.locator('#result-count').textContent()).trim(),
      prices: await page.locator('.item-price strong').allTextContents(),
      requestCount: requests.length
    };
    await page.locator('#reset-filters').click();
    await page.waitForFunction(() => document.querySelectorAll('#result-list .item-row').length === 3);
    const reset = {
      min: await page.locator('#min-price').inputValue(),
      max: await page.locator('#max-price').inputValue(),
      requestCount: requests.length
    };
    const controlRequestCountAfter = requests.length;

    await page.locator('[data-sort="price_desc"]').click();
    await page.locator('[data-site-tab="poshmark"]').click();
    await page.waitForFunction(() => document.querySelectorAll('#result-list .item-row').length === 1);
    const singleSite = {
      active: (await page.locator('[data-site-tab][aria-pressed="true"]').textContent()).trim(),
      sort: (await page.locator('[data-sort][aria-pressed="true"]').textContent()).trim()
    };
    await page.locator('[data-site-tab="all"]').click();
    await page.waitForFunction(() => document.querySelectorAll('#result-list .item-row').length === 3);
    const aggregateReset = {
      active: (await page.locator('[data-site-tab][aria-pressed="true"]').textContent()).trim(),
      sort: (await page.locator('[data-sort][aria-pressed="true"]').textContent()).trim(),
      min: await page.locator('#min-price').inputValue(),
      max: await page.locator('#max-price').inputValue()
    };

    await page.locator('#keyword').fill('session-fixture');
    await page.locator('#search-button').click();
    await page.waitForFunction(() => document.querySelectorAll('#result-list .item-row').length === 30
      && /45 results/i.test(document.querySelector('#result-count')?.textContent || ''));
    const sessionInitialRequest = requests.at(-1);
    const sessionInitial = {
      rows: await page.locator('#result-list .item-row').count(),
      count: (await page.locator('#result-count').textContent()).trim(),
      retryVisible: await page.locator('[data-retry-site="poshmark"]').isVisible(),
      request: sessionInitialRequest
    };

    await page.locator('[data-retry-site="poshmark"]').click();
    await page.waitForFunction(() => document.querySelector('.results-section')?.getAttribute('aria-busy') === 'true');
    const sessionRetryRowsWhilePending = await page.locator('#result-list .item-row').count();
    await page.waitForFunction(() => /60 results/i.test(document.querySelector('#result-count')?.textContent || '')
      && document.querySelector('.results-section')?.getAttribute('aria-busy') === 'false');
    const sessionRetryRequest = requests.at(-1);

    await page.locator('.pagination-page[data-result-page="1"]').click();
    await page.waitForFunction(() => document.querySelector('[data-result-page="1"]')?.getAttribute('aria-current') === 'page'
      && document.querySelectorAll('#result-list .item-row').length === 30);
    const sessionPageTwoRequest = requests.at(-1);
    const sessionPageTwo = {
      rows: await page.locator('#result-list .item-row').count(),
      count: (await page.locator('#result-count').textContent()).trim(),
      request: sessionPageTwoRequest
    };

    await page.locator('[data-site-tab="poshmark"]').click();
    await page.waitForFunction(() => document.querySelector('[data-site-tab="poshmark"]')?.getAttribute('aria-pressed') === 'true'
      && document.querySelector('.results-section')?.getAttribute('aria-busy') === 'false'
      && document.querySelectorAll('#result-list .item-row').length === 15);
    const sessionSiteRequest = requests.at(-1);
    await page.locator('[data-sort="price_desc"]').click();
    await page.waitForFunction(() => document.querySelector('.results-section')?.getAttribute('aria-busy') === 'false'
      && document.querySelector('[data-sort="price_desc"]')?.getAttribute('aria-pressed') === 'true');
    const sessionSortRequest = requests.at(-1);
    await page.locator('#min-price').fill('130');
    await page.locator('#max-price').fill('150');
    await page.locator('#apply-price-filter').click();
    await page.waitForFunction(() => document.querySelector('.results-section')?.getAttribute('aria-busy') === 'false'
      && /5 results/i.test(document.querySelector('#result-count')?.textContent || ''));
    const sessionFilterRequest = requests.at(-1);
    await page.locator('#reset-filters').click();
    await page.waitForFunction(() => document.querySelector('.results-section')?.getAttribute('aria-busy') === 'false'
      && /15 results/i.test(document.querySelector('#result-count')?.textContent || ''));
    const sessionResetRequest = requests.at(-1);

    await page.locator('[data-site-tab="all"]').click();
    await page.waitForFunction(() => document.querySelector('[data-site-tab="all"]')?.getAttribute('aria-pressed') === 'true'
      && document.querySelector('.results-section')?.getAttribute('aria-busy') === 'false'
      && /60 results/i.test(document.querySelector('#result-count')?.textContent || ''));
    await page.locator('.pagination-page[data-result-page="1"]').click();
    await page.waitForFunction(() => document.querySelector('[data-result-page="1"]')?.getAttribute('aria-current') === 'page');
    const expansionRequestStart = requests.length;
    await page.locator('[data-expand-results]').click();
    await page.waitForFunction(() => /220 results/i.test(document.querySelector('#result-count')?.textContent || '')
      && document.querySelector('[data-result-page="2"]')?.getAttribute('aria-current') === 'page'
      && document.querySelectorAll('#result-list .item-row').length === 30);
    const sessionExpansionRequests = requests.slice(expansionRequestStart);
    const sessionExpanded = {
      rows: await page.locator('#result-list .item-row').count(),
      count: (await page.locator('#result-count').textContent()).trim(),
      requests: sessionExpansionRequests
    };

    await page.locator('#keyword').fill('session-new-fixture');
    await page.locator('#search-button').click();
    await page.waitForFunction(() => /60 results/i.test(document.querySelector('#result-count')?.textContent || '')
      && document.querySelectorAll('#result-list .item-row').length === 30);
    const sessionNewSearchRequest = requests.at(-1);
    const sessionFlow = {
      initial: sessionInitial,
      retryRowsWhilePending: sessionRetryRowsWhilePending,
      retryRequest: sessionRetryRequest,
      pageTwo: sessionPageTwo,
      siteRequest: sessionSiteRequest,
      sortRequest: sessionSortRequest,
      filterRequest: sessionFilterRequest,
      resetRequest: sessionResetRequest,
      expanded: sessionExpanded,
      newSearchRequest: sessionNewSearchRequest
    };

    await page.locator('#keyword').fill('no-results');
    await page.locator('#search-button').click();
    await page.waitForSelector('#result-list .empty-state[role="status"]');
    const emptyState = {
      text: (await page.locator('#result-list').textContent()).trim(),
      count: (await page.locator('#result-count').textContent()).trim(),
      leaks: await visibleEnglishLeaks()
    };
    await page.locator('#keyword').fill('server-error');
    await page.locator('#search-button').click();
    await page.waitForSelector('#result-list .error-state[role="alert"]');
    const errorState = {
      text: (await page.locator('#result-list').textContent()).trim(),
      leaks: await visibleEnglishLeaks()
    };
    await page.locator('#keyword').fill('unclaimed-image-fixture');
    await page.locator('#search-button').click();
    await page.waitForFunction(() => document.querySelectorAll('#result-list .item-row').length === 1);
    const unclaimedImageSource = await page.locator('#result-list .item-thumb').getAttribute('src');
    await page.locator('#keyword').fill('busy-error');
    await page.locator('#search-button').click();
    await page.waitForSelector('#result-list .error-state[role="alert"]');
    const busyState = {
      text: (await page.locator('#result-list').textContent()).trim(),
      leaks: await visibleEnglishLeaks()
    };

    await page.locator('[data-country-tab="jp"]').click();
    await page.locator('#keyword').fill('security-fixture');
    await page.locator('#search-button').click();
    await page.waitForFunction(() => document.querySelectorAll('#result-list .item-row').length === 5);
    const urlSafety = await page.evaluate(() => ({
      titleNodes: [...document.querySelectorAll('#result-list .item-title')].map((node) => ({
        text: node.textContent?.trim(),
        tag: node.tagName,
        href: node.getAttribute('href')
      })),
      thumbnailLinks: [...document.querySelectorAll('#result-list a.item-thumb-link[href]')].map((node) => node.getAttribute('href')),
      imageSources: [...document.querySelectorAll('#result-list img')].map((node) => node.getAttribute('src')),
      unsafeAttributeValues: [...document.querySelectorAll('#result-list [href], #result-list [src]')]
        .flatMap((node) => ['href', 'src'].map((name) => node.getAttribute(name)).filter(Boolean))
        .filter((value) => /^(?:javascript|data|file):/i.test(value) || /^http:/i.test(value) || /attacker\.example/i.test(value))
    }));

    await page.locator('#keyword').fill('sort-fixture');
    await page.locator('#search-button').click();
    await page.waitForFunction(() => document.querySelectorAll('#result-list .item-row').length === 3);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForTimeout(100);
    const mobile = await page.evaluate(() => ({
      overflow: document.documentElement.scrollWidth > window.innerWidth,
      sortVisible: [...document.querySelectorAll('[data-sort]')].every((node) => {
        const rect = node.getBoundingClientRect();
        return rect.width > 0 && rect.left >= 0 && rect.right <= window.innerWidth + 1;
      }),
      sortBoxes: [...document.querySelectorAll('[data-sort]')].map((node) => {
        const rect = node.getBoundingClientRect();
        return { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom, fontSize: parseFloat(getComputedStyle(node).fontSize) };
      }),
      filterVisible: ['#min-price', '#max-price', '#apply-price-filter', '#reset-filters'].every((selector) => {
        const rect = document.querySelector(selector)?.getBoundingClientRect();
        return rect && rect.width > 0 && rect.left >= 0 && rect.right <= window.innerWidth + 1;
      })
    }));

    return { initial, validationText, loadingState, japan, pageTwo, recentAfterClick, usInitial, priceAsc, priceDesc, newestFirst, priceValidationText, filter, reset, controlRequestCountBefore, controlRequestCountAfter, singleSite, aggregateReset, sessionFlow, emptyState, errorState, unclaimedImageSource, busyState, urlSafety, mobile, requests, consoleErrors };
  }`);

  assert.equal(result.initial.lang, 'en');
  assert.match(result.initial.title, /Global|International|Overseas/i);
  assert.doesNotMatch(result.initial.title, /[가-힣]/);
  assert.doesNotMatch(result.initial.description, /[가-힣]/);
  assert.equal(result.initial.canonical, 'https://global.used-pick.com/global/?country=jp');
  assert.equal(result.initial.favicon, '/global/assets/mark.svg');
  assert.equal(result.initial.faviconStatus, 200);
  assert.equal(result.initial.ogLocale, 'en_US');
  assert.equal(result.initial.ogUrl, 'https://global.used-pick.com/global/?country=jp');
  assert.doesNotMatch(result.initial.ogTitle, /[가-힣]/);
  assert.doesNotMatch(result.initial.ogDescription, /[가-힣]/);
  assert.doesNotMatch(result.initial.twitterTitle, /[가-힣]/);
  assert.doesNotMatch(result.initial.twitterDescription, /[가-힣]/);
  assert.match(result.initial.structuredData, /"inLanguage"\s*:\s*"en-US"/);
  assert.doesNotMatch(result.initial.structuredData, /[가-힣]/);
  assert.equal(result.initial.structuredUrl, 'https://global.used-pick.com/global/?country=jp');
  assert.deepEqual(result.initial.countryTabs, ['Japan', 'United States']);
  assert.deepEqual(result.initial.siteTabs, ['All', 'Mercari JP', 'Yahoo! Auctions', 'Rakuma']);
  assert.match(result.initial.placeholder, /Search/i);
  assert.match(result.initial.searchButton, /^Search/);
  assert.equal(result.initial.recentHeading, 'Recent Searches');
  assert.match(result.initial.recentViewed, /Recently Viewed/);
  assert.match(result.initial.recentViewed, /No recently viewed items/i);
  assert.match(result.initial.footer, /Public used listings/i);
  assert.deepEqual(result.initial.footerLinks, [
    { text: 'Japan Search', href: '/global/?country=jp' },
    { text: 'United States Search', href: '/global/?country=us' }
  ]);
  assert.equal(result.initial.switchCount, 0);
  assert.equal(result.initial.coupangHidden, true);
  assert.deepEqual(result.initial.leaks, []);
  assert.equal(result.validationText, 'Enter a search term.');
  assert.match(result.loadingState.button, /Searching/i);
  assert.match(result.loadingState.result, /Searching/i);
  assert.deepEqual(result.loadingState.leaks, []);

  assert.deepEqual(result.japan.sortLabels, ['Recommended', 'Price: Low to High', 'Price: High to Low', 'Newest']);
  assert.match(result.japan.filterLabels.min, /Minimum/i);
  assert.match(result.japan.filterLabels.max, /Maximum/i);
  assert.equal(result.japan.filterLabels.apply, 'Apply');
  assert.equal(result.japan.filterLabels.reset, 'Reset');
  assert.match(result.japan.resultCount, /31 results/i);
  assert.match(result.japan.resultCount, /1\s*\/\s*2|Page 1 of 2/i);
  assert.match(result.japan.sourceSummary, /Partial/i);
  assert.match(result.japan.notice, /multiple currencies/i);
  assert.equal(result.japan.priceControlsDisabled, true);
  assert.equal(result.japan.newestDisabled, true);
  assert.equal(result.japan.recommendedEnabled, true);
  assert.equal(result.japan.rawTitle, 'Apple iPhone 13 本体');
  assert.equal(result.japan.rawTitleLang, 'ja');
  assert.match(result.japan.resultText, /Current bid/i);
  assert.match(result.japan.resultText, /Final price may change/i);
  assert.match(result.japan.resultText, /Ends in 2 days/i);
  assert.match(result.japan.resultText, /Shipping.*520/i);
  assert.equal(result.japan.sortGeometry.length, 4);
  result.japan.sortGeometry.forEach((box, index, boxes) => {
    assert.ok(box.right > box.left && box.bottom > box.top, `sort control ${index + 1} must have a visible box`);
    if (index) assert.ok(box.left >= boxes[index - 1].right - 1, `sort control ${index + 1} must not overlap the preceding control`);
  });
  assert.deepEqual(result.japan.leaks, []);
  assert.match(result.japan.paginationText, /Previous/i);
  assert.match(result.japan.paginationText, /Next/i);
  assert.equal(result.japan.paginationLabel, 'Search result pages');
  assert.match(result.japan.clearRecentText, /^Clear all$/i);
  assert.equal(result.japan.clearRecentVisible, true);
  assert.equal(result.pageTwo.rows, 1);
  assert.match(result.pageTwo.count, /31 results/i);
  assert.match(result.pageTwo.count, /2\s*\/\s*2|Page 2 of 2/i);
  assert.equal(result.pageTwo.current, '2');
  assert.deepEqual(result.pageTwo.leaks, []);
  assert.match(result.recentAfterClick, /Recently Viewed/);
  assert.match(result.recentAfterClick, /Apple iPhone 13 本体/);

  assert.deepEqual(result.usInitial.countryTabs, ['Japan', 'United States']);
  assert.deepEqual(result.usInitial.siteTabs, ['All', 'eBay', 'Poshmark', 'Vinted US', 'Unclaimed Baggage']);
  assert.equal(result.usInitial.ebayTab.tag, 'BUTTON');
  assert.equal(result.usInitial.ebayTab.pressed, 'false');
  assert.equal(result.usInitial.ebayTab.label, 'eBay');
  assert.equal(result.usInitial.activeSite, 'All');
  assert.equal(result.usInitial.activeSort, 'Recommended');
  assert.equal(result.usInitial.min, '');
  assert.equal(result.usInitial.max, '');
  assert.equal(result.usInitial.priceControlsEnabled, true);
  assert.equal(result.usInitial.newestEnabled, true);
  assert.match(result.usInitial.resultText, /Very good/i);
  assert.match(result.usInitial.resultText, /Free Shipping/i);
  assert.match(result.usInitial.resultText, /Buyer protection fee may apply/i);
  assert.equal(result.usInitial.firstTitleLang, null);
  assert.equal(result.usInitial.canonical, 'https://global.used-pick.com/global/?country=us');
  assert.equal(result.usInitial.ogUrl, 'https://global.used-pick.com/global/?country=us');
  assert.equal(result.usInitial.structuredUrl, 'https://global.used-pick.com/global/?country=us');
  assert.deepEqual(result.usInitial.leaks, []);
  assert.deepEqual(result.priceAsc, ['$163.00', '$204.99', '$299.00']);
  assert.deepEqual(result.priceDesc, ['$299.00', '$204.99', '$163.00']);
  assert.equal(result.newestFirst, 'Apple iPhone 13 128GB');
  assert.equal(result.priceValidationText, 'Check the price range.');
  assert.match(result.filter.count, /1 result(?!s)/i);
  assert.deepEqual(result.filter.prices, ['$204.99']);
  assert.equal(result.filter.requestCount, result.controlRequestCountBefore);
  assert.equal(result.reset.min, '');
  assert.equal(result.reset.max, '');
  assert.equal(result.reset.requestCount, result.controlRequestCountBefore);
  assert.equal(result.controlRequestCountAfter, result.controlRequestCountBefore, 'sort and price controls must reuse the loaded collection without another source request');
  assert.equal(result.singleSite.active, 'Poshmark');
  assert.equal(result.singleSite.sort, 'Price: High to Low');
  assert.equal(result.aggregateReset.active, 'All');
  assert.equal(result.aggregateReset.sort, 'Price: High to Low');
  assert.equal(result.aggregateReset.min, '');
  assert.equal(result.aggregateReset.max, '');

  assert.equal(result.sessionFlow.initial.rows, 30);
  assert.match(result.sessionFlow.initial.count, /45 results/i);
  assert.equal(result.sessionFlow.initial.retryVisible, true);
  assert.equal(result.sessionFlow.initial.request.session_id, undefined);
  assert.equal(result.sessionFlow.initial.request.session_generation, undefined);
  assert.equal(result.sessionFlow.initial.request.session_only, undefined);
  assert.equal(result.sessionFlow.retryRowsWhilePending, 30, 'a full-session source retry must keep the old page visible until success');
  assert.deepEqual(result.sessionFlow.retryRequest.sites, ['ebay', 'poshmark', 'vinted', 'unclaimed_baggage']);
  assert.equal(result.sessionFlow.retryRequest.session_id, undefined, 'retry must start a replacement aggregate session');
  assert.equal(result.sessionFlow.retryRequest.session_generation, undefined);
  assert.equal(result.sessionFlow.retryRequest.refresh_index, true);

  const replacementSessionId = result.sessionFlow.pageTwo.request.session_id;
  assert.match(replacementSessionId, /^fixture-session-/);
  assert.equal(result.sessionFlow.pageTwo.rows, 30);
  assert.match(result.sessionFlow.pageTwo.count, /60 results/i);
  assert.equal(result.sessionFlow.pageTwo.request.session_page, 1);
  assert.equal(result.sessionFlow.pageTwo.request.session_only, true);
  assert.equal(result.sessionFlow.pageTwo.request.session_generation, 1);
  assert.equal(result.sessionFlow.pageTwo.request.session_window, 60);
  assert.equal(result.sessionFlow.pageTwo.request.view_sites, undefined);

  assert.equal(result.sessionFlow.siteRequest.session_id, replacementSessionId);
  assert.equal(result.sessionFlow.siteRequest.session_page, 0);
  assert.equal(result.sessionFlow.siteRequest.session_only, true);
  assert.equal(result.sessionFlow.siteRequest.session_generation, 1);
  assert.deepEqual(result.sessionFlow.siteRequest.view_sites, ['poshmark']);
  assert.equal(result.sessionFlow.sortRequest.session_id, replacementSessionId);
  assert.equal(result.sessionFlow.sortRequest.session_only, true);
  assert.equal(result.sessionFlow.sortRequest.sort, 'price_desc');
  assert.deepEqual(result.sessionFlow.sortRequest.view_sites, ['poshmark']);
  assert.equal(result.sessionFlow.filterRequest.session_id, replacementSessionId);
  assert.equal(result.sessionFlow.filterRequest.session_only, true);
  assert.equal(result.sessionFlow.filterRequest.min_price, 130);
  assert.equal(result.sessionFlow.filterRequest.max_price, 150);
  assert.equal(result.sessionFlow.resetRequest.session_id, replacementSessionId);
  assert.equal(result.sessionFlow.resetRequest.session_only, true);
  assert.equal(result.sessionFlow.resetRequest.min_price, undefined);
  assert.equal(result.sessionFlow.resetRequest.max_price, undefined);

  assert.equal(result.sessionFlow.expanded.rows, 30);
  assert.match(result.sessionFlow.expanded.count, /220 results/i);
  assert.equal(result.sessionFlow.expanded.requests.length, 3);
  const [exposeRequest, continuationRequest, expandedPageRequest] = result.sessionFlow.expanded.requests;
  assert.equal(exposeRequest.session_id, replacementSessionId);
  assert.equal(exposeRequest.session_generation, 1);
  assert.equal(exposeRequest.session_page, 0);
  assert.equal(exposeRequest.session_only, true);
  assert.equal(exposeRequest.session_window, 220, 'one load-more action must expand the session window by exactly 160');
  assert.equal(continuationRequest.session_id, replacementSessionId);
  assert.equal(continuationRequest.session_generation, 1);
  assert.equal(continuationRequest.session_only, undefined);
  assert.equal(continuationRequest.session_window, 220);
  assert.match(continuationRequest.cursor, /^fixture-cursor-/);
  assert.equal(expandedPageRequest.session_id, replacementSessionId);
  assert.equal(expandedPageRequest.session_generation, 2, 'the final page request must use the generation returned by continuation');
  assert.equal(expandedPageRequest.session_page, 2);
  assert.equal(expandedPageRequest.session_only, true);
  assert.equal(expandedPageRequest.session_window, 220);
  assert.equal(result.sessionFlow.newSearchRequest.session_id, undefined, 'a new keyword must not inherit the previous search session');
  assert.equal(result.sessionFlow.newSearchRequest.session_generation, undefined);
  assert.equal(result.sessionFlow.newSearchRequest.session_only, undefined);

  assert.equal(result.emptyState.text, 'No results');
  assert.match(result.emptyState.count, /0 results/i);
  assert.deepEqual(result.emptyState.leaks, []);
  assert.match(result.errorState.text, /search server|try again/i);
  assert.deepEqual(result.errorState.leaks, []);
  assert.equal(result.unclaimedImageSource, 'https://www.unclaimedbaggage.com/cdn/shop/files/iphone-fixture.jpg?width=300');
  assert.match(result.busyState.text, /busy/i);
  assert.match(result.busyState.text, /try again/i);
  assert.match(result.busyState.text, /7\s*seconds?/i);
  assert.doesNotMatch(result.busyState.text, /server encountered an error/i);
  assert.deepEqual(result.busyState.leaks, []);
  assert.deepEqual(result.urlSafety.titleNodes, [
    { text: 'Allowed marketplace URL', tag: 'A', href: 'https://jp.mercari.com/item/m-safe' },
    { text: 'Blocked URL scheme', tag: 'SPAN', href: null },
    { text: 'Blocked external host', tag: 'SPAN', href: null },
    { text: 'Blocked insecure URL', tag: 'SPAN', href: null },
    { text: 'Blocked local file URL', tag: 'SPAN', href: null }
  ]);
  assert.deepEqual(result.urlSafety.thumbnailLinks, ['https://jp.mercari.com/item/m-safe']);
  assert.deepEqual(result.urlSafety.imageSources, ['https://static.mercdn.net/thumb/item/webp/safe.jpg']);
  assert.deepEqual(result.urlSafety.unsafeAttributeValues, []);
  assert.equal(result.mobile.overflow, false);
  assert.equal(result.mobile.sortVisible, true);
  assert.equal(result.mobile.sortBoxes.length, 4);
  assert.ok(Math.abs(result.mobile.sortBoxes[0].top - result.mobile.sortBoxes[1].top) < 1, 'the first two sort controls must share row one');
  assert.ok(Math.abs(result.mobile.sortBoxes[2].top - result.mobile.sortBoxes[3].top) < 1, 'the last two sort controls must share row two');
  assert.ok(result.mobile.sortBoxes[2].top >= result.mobile.sortBoxes[0].bottom - 1, `sort row two must not overlap row one: ${JSON.stringify(result.mobile.sortBoxes)}`);
  assert.ok(result.mobile.sortBoxes[0].right <= result.mobile.sortBoxes[1].left + 1, 'sort controls in row one must not overlap');
  assert.ok(result.mobile.sortBoxes[2].right <= result.mobile.sortBoxes[3].left + 1, 'sort controls in row two must not overlap');
  assert.ok(result.mobile.sortBoxes.every((box) => box.fontSize >= 11), 'mobile sort labels must be at least 11px');
  assert.equal(result.mobile.filterVisible, true);
  assert.deepEqual(result.consoleErrors, []);

  const globalRequests = result.requests.filter((request) => Array.isArray(request.sites)
    && request.sites.some((site) => ['mercari_jp', 'yahoo_auction_jp', 'rakuma', 'ebay', 'poshmark', 'vinted', 'unclaimed_baggage'].includes(site)));
  assert.ok(globalRequests.length > 0);
  assert.ok(globalRequests.some((request) => request.sites.includes('ebay')), 'United States aggregate search must include eBay');
  assert.ok(globalRequests.filter((request) => !(request.keyword === 'session-fixture' && request.refresh_index === true))
    .every((request) => request.refresh_index === false), 'ordinary global searches must honor the short server cache');

  console.log(JSON.stringify({ status: 'passed', checks: 132, ...result }, null, 2));
} finally {
  cli('close');
}
