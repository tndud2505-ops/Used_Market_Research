import assert from 'node:assert/strict';
import { resetEbayTokenCacheForTests, tryExtractPublicSearchResult } from '../dist/collector/logic/publicSearchExtractors.js';
import { ebayAdapter } from '../dist/collector/logic/sites/ebay.js';
import { bunjangAdapter } from '../dist/collector/logic/sites/bunjang.js';

const previousFetch = globalThis.fetch;
const previousToken = process.env.EBAY_BROWSE_API_TOKEN;
const previousClientId = process.env.EBAY_CLIENT_ID;
const previousClientSecret = process.env.EBAY_CLIENT_SECRET;
let requestedUrl = '';
let requestedHeaders = {};

try {
  process.env.EBAY_BROWSE_API_TOKEN = 'fixture-token';
  globalThis.fetch = async (url, init = {}) => {
    requestedUrl = String(url);
    requestedHeaders = init.headers ?? {};
    return new Response(JSON.stringify({
      itemSummaries: [
        {
          itemId: 'v1|fixture-1|0',
          title: 'RTX 3070 Used GPU',
          price: { value: '499.99', currency: 'USD' },
          seller: { username: 'fixture-seller' },
          itemWebUrl: 'https://www.ebay.com/itm/fixture-1',
          image: { imageUrl: 'https://i.ebayimg.com/images/g/fixture/s-l1600.jpg' },
          itemLocation: { city: 'Austin', stateOrProvince: 'TX', country: 'US' },
          condition: 'Used',
          itemOriginDate: '2026-08-12T00:00:00.000Z'
        }
      ]
    }), { status: 200, headers: { 'content-type': 'application/json' } });
  };

  const result = await tryExtractPublicSearchResult(
    ebayAdapter,
    { site: 'ebay', keyword: 'RTX 3070', limit: 2 },
    ''
  );

  assert.equal(result?.items.length, 1);
  assert.equal(result?.items[0].price, 499.99);
  assert.equal(result?.items[0].currency, 'USD');
  assert.equal(result?.items[0].url, 'https://www.ebay.com/itm/fixture-1');
  assert.equal(result?.items[0].image_url.includes('ebayimg.com'), true);
  assert.equal(result?.items[0].status, 'unknown');
  assert.ok(result?.items[0].warnings.includes('SALE_STATUS_UNAVAILABLE'));
  assert.ok(result?.warnings.includes('EBAY_SALE_STATUS_UNAVAILABLE'));
  assert.equal(result?.items[0].category_mapping_confidence, 'unknown');
  assert.equal(new URL(requestedUrl).pathname, '/buy/browse/v1/item_summary/search');
  assert.equal(requestedHeaders.authorization, 'Bearer fixture-token');
  assert.equal(requestedHeaders['x-ebay-c-marketplace-id'], 'EBAY_US');

  globalThis.fetch = async (url, init = {}) => {
    requestedUrl = String(url);
    requestedHeaders = init.headers ?? {};
    return new Response(JSON.stringify({
      total: 5,
      itemSummaries: [
        { itemId: 'v1|fixture-2|0', title: 'RTX 3070 Used GPU 2', price: { value: '499.99', currency: 'USD' }, itemWebUrl: 'https://www.ebay.com/itm/fixture-2' },
        { itemId: 'v1|fixture-3|0', title: 'RTX 3070 Used GPU 3', price: { value: '599.99', currency: 'USD' }, itemWebUrl: 'https://www.ebay.com/itm/fixture-3' }
      ]
    }), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  const paginatedEbayResult = await tryExtractPublicSearchResult(
    ebayAdapter,
    { site: 'ebay', keyword: 'RTX 3070', limit: 2, cursor: 'offset:2' },
    ''
  );
  assert.equal(new URL(requestedUrl).searchParams.get('offset'), '2');
  assert.equal(paginatedEbayResult?.pagination.has_more, true);
  assert.equal(paginatedEbayResult?.pagination.next_cursor, 'offset:4');

  globalThis.fetch = async (url) => {
    requestedUrl = String(url);
    return new Response(JSON.stringify({
      list: Array.from({ length: 6 }, (_, index) => ({
        pid: String(index + 1),
        name: 'RTX 3070 GPU',
        price: '500000',
        uid: 'fixture-seller',
        update_time: 1_755_000_000,
        used: 1,
        product_image: 'https://img.bunjang.co.kr/fixture.jpg'
      }))
    }), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  const bunjangResult = await tryExtractPublicSearchResult(
    bunjangAdapter,
    { site: 'bunjang', keyword: 'RTX 3070', limit: 2, cursor: 'page:2' },
    ''
  );
  assert.equal(new URL(requestedUrl).searchParams.get('page'), '2');
  assert.equal(bunjangResult?.pagination.has_more, true);
  assert.equal(bunjangResult?.pagination.next_cursor, 'page:3');

  globalThis.fetch = async (url) => {
    requestedUrl = String(url);
    return new Response(JSON.stringify({
      list: Array.from({ length: 6 }, (_, index) => ({
        pid: String(index + 1),
        name: 'iPhone 15',
        price: '500000',
        uid: 'fixture-seller',
        update_time: 1_755_000_000,
        used: 1,
        product_image: 'https://img.bunjang.co.kr/fixture.jpg'
      }))
    }), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  const filteredBunjangResult = await tryExtractPublicSearchResult(
    bunjangAdapter,
    { site: 'bunjang', keyword: 'RTX 3070', limit: 2 },
    ''
  );
  assert.equal(filteredBunjangResult?.items.length, 0);
  assert.equal(filteredBunjangResult?.pagination.has_more, true);
  assert.equal(filteredBunjangResult?.pagination.next_cursor, 'page:1');

  globalThis.fetch = async () => new Response('', { status: 503 });
  const failedBunjangResult = await tryExtractPublicSearchResult(
    bunjangAdapter,
    { site: 'bunjang', keyword: 'RTX 3070', limit: 2 },
    ''
  );
  assert.ok(failedBunjangResult?.errors.some((error) => error.startsWith('BUNJANG_SEARCH_API_ERROR:')));

  delete process.env.EBAY_BROWSE_API_TOKEN;
  process.env.EBAY_CLIENT_ID = 'fixture-client-id';
  process.env.EBAY_CLIENT_SECRET = 'fixture-client-secret';
  resetEbayTokenCacheForTests();
  const oauthRequests = [];
  globalThis.fetch = async (url, init = {}) => {
    oauthRequests.push({ url: String(url), init });
    if (String(url).includes('/identity/v1/oauth2/token')) {
      return new Response(JSON.stringify({ access_token: 'oauth-token', expires_in: 7200 }), {
        status: 200,
        headers: { 'content-type': 'application/json' }
      });
    }
    return new Response(JSON.stringify({
      total: 1,
      itemSummaries: [
        { itemId: 'v1|oauth-fixture|0', title: 'OAuth eBay item', price: { value: '99.99', currency: 'USD' }, itemWebUrl: 'https://www.ebay.com/itm/oauth-fixture' }
      ]
    }), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  const oauthResult = await tryExtractPublicSearchResult(
    ebayAdapter,
    { site: 'ebay', keyword: 'RTX 3070', limit: 2 },
    ''
  );
  assert.equal(oauthResult?.items.length, 1);
  assert.equal(oauthRequests.length, 2);
  assert.match(oauthRequests[0].url, /\/identity\/v1\/oauth2\/token/u);
  assert.match(String(oauthRequests[0].init.headers.authorization), /^Basic /u);
  assert.equal(oauthRequests[1].init.headers.authorization, 'Bearer oauth-token');

  delete process.env.EBAY_CLIENT_ID;
  delete process.env.EBAY_CLIENT_SECRET;
  resetEbayTokenCacheForTests();
  const tokenlessResult = await tryExtractPublicSearchResult(
    ebayAdapter,
    { site: 'ebay', keyword: 'RTX 3070', limit: 2 },
    ''
  );
  assert.equal(tokenlessResult?.items.length, 0);
  assert.equal(tokenlessResult?.errors.length, 0);
  assert.ok(tokenlessResult?.warnings.some((warning) => warning.startsWith('EBAY_CREDENTIALS_REQUIRED:')));
  assert.equal(tokenlessResult?.next_action, 'configure_ebay_credentials');
} finally {
  globalThis.fetch = previousFetch;
  resetEbayTokenCacheForTests();
  if (previousToken === undefined) delete process.env.EBAY_BROWSE_API_TOKEN;
  else process.env.EBAY_BROWSE_API_TOKEN = previousToken;
  if (previousClientId === undefined) delete process.env.EBAY_CLIENT_ID;
  else process.env.EBAY_CLIENT_ID = previousClientId;
  if (previousClientSecret === undefined) delete process.env.EBAY_CLIENT_SECRET;
  else process.env.EBAY_CLIENT_SECRET = previousClientSecret;
}

console.log(JSON.stringify({
  status: 'passed',
  api_mapping: true,
  auth_header_contract: true,
  oauth_client_credentials: true
}, null, 2));
