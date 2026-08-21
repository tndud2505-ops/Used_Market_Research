import assert from 'node:assert/strict';
import { once } from 'node:events';

const previousToken = process.env.CLOUDFLARE_RUNNER_TOKEN;
process.env.CLOUDFLARE_RUNNER_TOKEN = 'global-runner-contract-token';

const { createServer } = await import('../dist/web-backend/logic/server.js');
let searchCalls = 0;
const server = createServer(0, {
  host: '127.0.0.1',
  initializeStorage: false,
  publicApiOnly: true,
  runWebSearch: async () => {
    searchCalls += 1;
    return { status: 'success', data: { items: [] } };
  }
});

try {
  if (!server.listening) await once(server, 'listening');
  const address = server.address();
  assert(address && typeof address === 'object', 'test server exposes an ephemeral port');
  const origin = `http://127.0.0.1:${address.port}`;

  const health = await fetch(`${origin}/global/health`);
  assert.equal(health.status, 200, 'runner health remains available to Tunnel health checks');

  const page = await fetch(`${origin}/global/?country=jp`);
  assert.equal(page.status, 401, 'runner static UI is not exposed directly through the origin hostname');

  const redirect = await fetch(`${origin}/global`, { redirect: 'manual' });
  assert.equal(redirect.status, 401, 'runner redirect path cannot bypass the shared Worker token');

  const categories = await fetch(`${origin}/global/api/categories`);
  assert.equal(categories.status, 401, 'runner category API requires the shared Worker token');

  const payload = {
    keyword: 'iphone 13',
    country: 'jp',
    sites: ['rakuma'],
    limit: 1
  };
  const unauthenticatedSearch = await fetch(`${origin}/global/api/search`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload)
  });
  assert.equal(unauthenticatedSearch.status, 401, 'runner search rejects a missing token');
  assert.equal(searchCalls, 0, 'unauthenticated search never reaches a collector');

  const authenticatedSearch = await fetch(`${origin}/global/api/search`, {
    method: 'POST',
    headers: {
      authorization: 'Bearer global-runner-contract-token',
      'content-type': 'application/json'
    },
    body: JSON.stringify(payload)
  });
  assert.equal(authenticatedSearch.status, 200, 'Worker token unlocks the runner search API');
  assert.equal(searchCalls, 1, 'authenticated search reaches the collector exactly once');

  console.log('cloudflare runner boundary contract: 9 checks passed');
} finally {
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  if (previousToken === undefined) delete process.env.CLOUDFLARE_RUNNER_TOKEN;
  else process.env.CLOUDFLARE_RUNNER_TOKEN = previousToken;
}
