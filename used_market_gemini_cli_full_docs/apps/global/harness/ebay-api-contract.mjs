import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

process.env.EBAY_CLIENT_ID = 'fixture-client-id';
process.env.EBAY_CLIENT_SECRET = 'fixture-client-secret';
delete process.env.EBAY_BROWSE_API_TOKEN;

const originalFetch = globalThis.fetch;
const calls = [];

globalThis.fetch = async (input, init = {}) => {
  const request = input instanceof Request ? input : new Request(input, init);
  calls.push(request);
  const url = new URL(request.url);

  if (url.pathname === '/identity/v1/oauth2/token') {
    assert.equal(request.method, 'POST');
    assert.equal(request.headers.get('content-type'), 'application/x-www-form-urlencoded');
    const basic = request.headers.get('authorization')?.replace(/^Basic\s+/i, '') || '';
    assert.equal(Buffer.from(basic, 'base64').toString('utf8'), 'fixture-client-id:fixture-client-secret');
    const body = new URLSearchParams(await request.text());
    assert.equal(body.get('grant_type'), 'client_credentials');
    assert.equal(body.get('scope'), 'https://api.ebay.com/oauth/api_scope');
    return Response.json({ access_token: 'fixture-application-token', expires_in: 7200, token_type: 'Application Access Token' });
  }

  if (url.pathname === '/buy/browse/v1/item_summary/search') {
    assert.equal(request.headers.get('authorization'), 'Bearer fixture-application-token');
    assert.equal(request.headers.get('x-ebay-c-marketplace-id'), 'EBAY_US');
    assert.equal(url.searchParams.get('q'), 'iphone 13');
    assert.equal(url.searchParams.get('limit'), '2');
    return Response.json({
      total: 3,
      itemSummaries: [
        {
          itemId: 'v1|fixture-1|0',
          title: 'Apple iPhone 13 128GB Unlocked',
          price: { value: '289.99', currency: 'USD' },
          seller: { username: 'fixture-seller' },
          itemWebUrl: 'https://www.ebay.com/itm/fixture-1',
          image: { imageUrl: 'https://i.ebayimg.com/images/g/fixture/s-l500.jpg' },
          itemLocation: { city: 'Austin', stateOrProvince: 'TX', country: 'US' },
          condition: 'Pre-Owned',
          itemOriginDate: '2026-08-20T00:00:00.000Z'
        }
      ]
    });
  }

  throw new Error(`unexpected eBay request: ${request.url}`);
};

try {
  const { resolveBrowserSiteAdapter } = await import('../dist/collector/logic/sites/index.js');
  const { tryExtractPublicSearchResult, resetEbayTokenCacheForTests } = await import('../dist/collector/logic/publicSearchExtractors.js');
  resetEbayTokenCacheForTests();
  const adapter = resolveBrowserSiteAdapter('ebay');
  const input = { site: 'ebay', keyword: 'iphone 13', keywordIsExplicit: true, limit: 2 };
  const first = await tryExtractPublicSearchResult(adapter, input, '');
  const second = await tryExtractPublicSearchResult(adapter, input, '');

  assert.equal(adapter.countryCode, 'US');
  assert.equal(first.site, 'ebay');
  assert.equal(first.items.length, 1);
  assert.deepEqual(first.items[0], {
    ...first.items[0],
    title: 'Apple iPhone 13 128GB Unlocked',
    price: 289.99,
    currency: 'USD',
    seller: '',
    url: 'https://www.ebay.com/itm/fixture-1',
    image_url: 'https://i.ebayimg.com/images/g/fixture/s-l500.jpg',
    condition: 'Pre-Owned',
    location: 'Austin, TX, US'
  });
  assert.equal(first.pagination.has_more, true);
  assert.equal(first.pagination.next_cursor, 'offset:1');
  assert.equal(second.items.length, 1);
  assert.equal(calls.filter((request) => new URL(request.url).pathname === '/identity/v1/oauth2/token').length, 1, 'application token should be cached');
  assert.equal(calls.filter((request) => new URL(request.url).pathname === '/buy/browse/v1/item_summary/search').length, 2);
  assert.doesNotMatch(JSON.stringify(first), /fixture-client-secret/);
  assert.doesNotMatch(JSON.stringify(first), /fixture-seller/);
  const searchService = await readFile(new URL('../web-backend/logic/search-service.ts', import.meta.url), 'utf8');
  assert.match(searchService, /persistMarketResult:\s*!request\.sites\.includes\('ebay'\)/);
  console.log('global eBay Browse API contract passed');
} finally {
  globalThis.fetch = originalFetch;
  delete process.env.EBAY_CLIENT_ID;
  delete process.env.EBAY_CLIENT_SECRET;
}
