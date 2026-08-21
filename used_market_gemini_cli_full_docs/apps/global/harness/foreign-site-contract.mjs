import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { extractSearchListingsFromHtml, listingTitleSignals } from '../dist/collector/logic/browserCollector.js';
import { resolveBrowserSiteAdapter } from '../dist/collector/logic/sites/index.js';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const cases = [
  {
    site: 'mercari_jp',
    country: 'JP',
    fixture: 'mercari-jp-search.html',
    pageUrl: 'https://jp.mercari.com/search?keyword=iphone%2013',
    rendering: 'dynamic',
    expected: {
      title: 'Apple iPhone 13 본체 128GB',
      price: 283146,
      currency: 'KRW',
      url: 'https://jp.mercari.com/item/m-fixture-mercari',
      priceLabel: 'Sale price'
    }
  },
  {
    site: 'yahoo_auction_jp',
    country: 'JP',
    fixture: 'yahoo-auctions-jp-search.html',
    pageUrl: 'https://auctions.yahoo.co.jp/search/search?p=iphone+13',
    rendering: 'dynamic',
    expected: {
      title: '【ジャンク】iPhone 13 Pro 128GB 그래파이트',
      price: 5751,
      currency: 'JPY',
      url: 'https://auctions.yahoo.co.jp/jp/auction/f-fixture-yahoo',
      priceLabel: 'Current bid',
      shipping: '＋送料520円',
      postedAt: '2日',
      condition: 'For parts / Not working',
      notesIncludes: ['Title signals:', 'Japanese junk/parts signal']
    }
  },
  {
    site: 'rakuma',
    country: 'JP',
    fixture: 'rakuma-search.html',
    pageUrl: 'https://fril.jp/s?query=iphone%2013%20%E6%9C%AC%E4%BD%93',
    rendering: 'static',
    expected: {
      title: 'iPhone 13 256GB SIMフリー 本体',
      price: 57980,
      currency: 'JPY',
      url: 'https://item.fril.jp/fixture-rakuma-iphone-13',
      priceLabel: 'Sale price',
      filteredCount: 1
    }
  },
  {
    site: 'poshmark',
    country: 'US',
    fixture: 'poshmark-search.html',
    pageUrl: 'https://poshmark.com/search?query=iphone%2013&type=listings&src=dir',
    rendering: 'static',
    expected: {
      title: 'Apple iPhone 13 Midnight 128GB',
      price: 299,
      currency: 'USD',
      url: 'https://poshmark.com/listing/fixture-poshmark-iphone-13',
      priceLabel: 'Sale price',
      condition: 'Like New',
      filteredCount: 2
    }
  },
  {
    site: 'vinted',
    country: 'US',
    fixture: 'vinted-search.html',
    pageUrl: 'https://www.vinted.com/catalog?search_text=iphone%2013',
    rendering: 'static',
    expected: {
      title: 'Apple iPhone 13 128GB',
      price: 163,
      currency: 'USD',
      url: 'https://www.vinted.com/items/fixture-vinted-iphone-13-for-parts-no-power-icloud-locked',
      priceLabel: 'Sale price',
      condition: 'For parts / Not working',
      notesIncludes: ['URL signals:', 'for parts', 'no power', 'iCloud locked'],
      filteredCount: 2
    }
  },
  {
    site: 'unclaimed_baggage',
    country: 'US',
    fixture: 'unclaimed-baggage-search.html',
    pageUrl: 'https://www.unclaimedbaggage.com/search?q=iphone%2013&type=product',
    rendering: 'static',
    expected: {
      title: 'iPhone 13 AT&T 128GB Midnight',
      price: 204.99,
      currency: 'USD',
      url: 'https://www.unclaimedbaggage.com/products/fixture-unclaimed-iphone-13',
      priceLabel: 'Sale price',
      condition: 'Fair',
      shipping: 'Free Shipping'
    }
  }
];

for (const testCase of cases) {
  const html = await readFile(resolve(root, 'harness', 'fixtures', testCase.fixture), 'utf8');
  const adapter = resolveBrowserSiteAdapter(testCase.site);
  const result = await extractSearchListingsFromHtml({
    site: testCase.site,
    keyword: testCase.site === 'vinted' ? '아이폰 13' : 'iphone 13',
    keywordIsExplicit: true,
    limit: 10
  }, html, testCase.pageUrl);

  assert.equal(adapter.searchRendering, testCase.rendering);
  assert.equal(adapter.countryCode, testCase.country);
  assert.equal(result.errors.length, 0, `${testCase.site} must extract without errors`);
  assert.equal(result.items.length, 1, `${testCase.site} must expose one fixture item`);
  if (testCase.expected.filteredCount !== undefined) {
    assert.equal(result.quality_meta.filtered_count, testCase.expected.filteredCount);
  }
  const [item] = result.items;
  assert.equal(item.title, testCase.expected.title);
  assert.equal(item.price, testCase.expected.price);
  assert.equal(item.currency, testCase.expected.currency);
  assert.equal(item.url, testCase.expected.url);
  assert.equal(item.price_label, testCase.expected.priceLabel);
  if (testCase.expected.shipping) assert.equal(item.shipping, testCase.expected.shipping);
  if (testCase.expected.postedAt) assert.equal(item.posted_at, testCase.expected.postedAt);
  if (testCase.expected.condition) assert.equal(item.condition, testCase.expected.condition);
  for (const noteText of testCase.expected.notesIncludes ?? []) {
    assert.match(item.notes, new RegExp(noteText, 'i'));
  }
}

const vintedHtml = await readFile(resolve(root, 'harness', 'fixtures', 'vinted-search.html'), 'utf8');
const airpodsResult = await extractSearchListingsFromHtml({
  site: 'vinted',
  keyword: '에어팟 프로',
  keywordIsExplicit: true,
  limit: 10
}, vintedHtml, 'https://www.vinted.com/catalog?search_text=airpods%20pro');
assert.equal(airpodsResult.errors.length, 0);
assert.deepEqual(airpodsResult.items.map((item) => item.title), ['Apple AirPods Pro']);

const aliasCases = [
  { site: 'vinted', keyword: '아이폰 13', expected: 'iphone 13' },
  { site: 'poshmark', keyword: '갤럭시 s23', expected: 'galaxy s23' },
  { site: 'unclaimed_baggage', keyword: '맥북 프로', expected: 'macbook 프로' },
  { site: 'mercari_jp', keyword: '에어팟 프로', expected: 'airpods 프로' }
];

for (const aliasCase of aliasCases) {
  const adapter = resolveBrowserSiteAdapter(aliasCase.site);
  const decodedUrl = decodeURIComponent(adapter.searchUrl(aliasCase.keyword, 10));
  assert.match(decodedUrl.toLowerCase(), new RegExp(aliasCase.expected));
}

const rakumaUrl = decodeURIComponent(resolveBrowserSiteAdapter('rakuma').searchUrl('아이폰 13', 10));
assert.match(rakumaUrl.toLowerCase(), /iphone 13/);
assert.match(rakumaUrl, /本体/);

assert.equal(listingTitleSignals('SIMロック iPhone 13').conditionOverride, 'Locked / Restricted');
assert.equal(listingTitleSignals('SIMロック解除済 iPhone 13').conditionOverride, '');
assert.equal(listingTitleSignals('デモ機 Apple iPhone 13').conditionOverride, 'Demo / Display unit');
assert.equal(listingTitleSignals('動作未確認 iPhone 13').conditionOverride, 'For parts / Not working');

console.log(JSON.stringify({
  status: 'passed',
  sites: cases.map((testCase) => testCase.site),
  checks: cases.length * 8 + 19
}, null, 2));
