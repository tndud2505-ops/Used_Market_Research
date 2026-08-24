import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { collectOne, resetEbayAccessTokenCacheForTests } from '../cloudflare/live-search.mjs';

const read = (relative) => readFile(new URL(`../${relative}`, import.meta.url), 'utf8');
const [html, app, targets, liveSearch, worker, sites, adapters, envExample, runnerEnv] = await Promise.all([
  read('web-backend/public/index.html'),
  read('web-backend/public/app.js'),
  read('cloudflare/target-sites.mjs'),
  read('cloudflare/live-search.mjs'),
  read('cloudflare/worker.mjs'),
  read('collector/logic/sites.ts'),
  read('collector/logic/sites/index.ts'),
  read('.env.example'),
  read('aws-runner/.env.example')
]);

assert.match(html, /data-site-tab="ebay">eBay</u);
assert.match(app, /ebay:\s*\['ebay\.com'\]/u);
assert.match(targets, /"ebay"/u);
assert.match(targets, /ebay:\s*"eBay"/u);
assert.match(liveSearch, /SUPPORTED_LIVE_SITES[^\n]+"ebay"/u);
assert.match(liveSearch, /async function collectEbay/u);
assert.match(liveSearch, /EBAY_CLIENT_ID/u);
assert.match(liveSearch, /EBAY_CLIENT_SECRET/u);
assert.match(worker, /"www\.ebay\.com"/u);
assert.match(worker, /"ebay"/u);
assert.match(sites, /key:\s*"ebay"[\s\S]{0,160}currency:\s*"USD"/u);
assert.match(adapters, /import \{ ebayAdapter \}/u);
assert.match(adapters, /\b[\s\S]*ebayAdapter/u);
for (const source of [envExample, runnerEnv]) {
  assert.match(source, /^EBAY_CLIENT_ID=$/mu);
  assert.match(source, /^EBAY_CLIENT_SECRET=$/mu);
}

const previousFetch = globalThis.fetch;
const previousClientId = process.env.EBAY_CLIENT_ID;
const previousClientSecret = process.env.EBAY_CLIENT_SECRET;
const previousToken = process.env.EBAY_BROWSE_API_TOKEN;
try {
  process.env.EBAY_CLIENT_ID = 'fixture-client-id';
  process.env.EBAY_CLIENT_SECRET = 'fixture-client-secret';
  delete process.env.EBAY_BROWSE_API_TOKEN;
  resetEbayAccessTokenCacheForTests();
  const requests = [];
  globalThis.fetch = async (url, init = {}) => {
    requests.push({ url: String(url), init });
    if (String(url).includes('/identity/v1/oauth2/token')) {
      return new Response(JSON.stringify({ access_token: 'runner-oauth-token', expires_in: 7200 }), { status: 200 });
    }
    return new Response(JSON.stringify({
      total: 1,
      itemSummaries: [{
        itemId: 'v1|runner-fixture|0',
        title: 'RTX 3070 eBay fixture',
        price: { value: '249.99', currency: 'USD' },
        itemWebUrl: 'https://www.ebay.com/itm/runner-fixture',
        image: { imageUrl: 'https://i.ebayimg.com/images/g/fixture/s-l1600.jpg' },
        seller: { username: 'fixture-seller' }
      }]
    }), { status: 200 });
  };

  const items = await collectOne('ebay', 'RTX 3070', 'all', 10);
  assert.equal(items.length, 1);
  assert.equal(items[0].site, 'ebay');
  assert.equal(items[0].currency, 'USD');
  assert.equal(items[0].price, 249.99);
  assert.match(requests[0].url, /\/identity\/v1\/oauth2\/token/u);
  assert.match(String(requests[0].init.headers.authorization), /^Basic /u);
  assert.equal(requests[1].init.headers.authorization, 'Bearer runner-oauth-token');
} finally {
  globalThis.fetch = previousFetch;
  resetEbayAccessTokenCacheForTests();
  if (previousClientId === undefined) delete process.env.EBAY_CLIENT_ID;
  else process.env.EBAY_CLIENT_ID = previousClientId;
  if (previousClientSecret === undefined) delete process.env.EBAY_CLIENT_SECRET;
  else process.env.EBAY_CLIENT_SECRET = previousClientSecret;
  if (previousToken === undefined) delete process.env.EBAY_BROWSE_API_TOKEN;
  else process.env.EBAY_BROWSE_API_TOKEN = previousToken;
}

console.log(JSON.stringify({ status: 'passed', checks: 24 }, null, 2));
