import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import worker from '../cloudflare/worker.mjs';
import { analyticsCsp, withHtmlAnalytics } from '../cloudflare/html-analytics.mjs';

const baseline = (await readFile(new URL('../web-backend/public/_headers', import.meta.url), 'utf8')).match(/Content-Security-Policy: (.+)/u)[1].trim();
const fixture = '<!doctype html><html><head><title>Test</title></head><body>page</body></html>';
const makeHtml = (body = fixture) => new Response(body, { headers: {
  'content-type': 'text/html; charset=utf-8', 'content-security-policy': baseline,
  etag: '"old"', 'content-length': '3', 'content-encoding': 'gzip', 'last-modified': 'Sun, 04 Oct 2026 00:00:00 GMT'
} });
const request = new Request('https://used-pick.com/');
const first = await withHtmlAnalytics(makeHtml(), request);
const html = await first.text();
assert.equal((html.match(/gtag\/js\?id=G-2L2ETG06B1/gu) || []).length, 1);
assert.equal((html.match(/src="\/analytics.js"/gu) || []).length, 1);
assert.equal(await (await withHtmlAnalytics(makeHtml(html), request)).text(), html);
for (const header of ['etag', 'content-length', 'content-encoding', 'last-modified']) assert.equal(first.headers.get(header), null);
assert.match(first.headers.get('cache-control'), /must-revalidate/u);
for (const directive of baseline.split(';').map((value) => value.trim())) {
  const [name, ...sources] = directive.split(/\s+/u);
  const result = first.headers.get('content-security-policy').split(';').find((value) => value.trim().startsWith(`${name} `));
  for (const source of sources) assert.ok(result.includes(source), `retain ${name} ${source}`);
}
assert.equal(analyticsCsp(first.headers.get('content-security-policy')), first.headers.get('content-security-policy'));
assert.match(analyticsCsp("default-src 'self'; script-src-elem 'self'; object-src 'none'"), /script-src-elem 'self' https:\/\/www.googletagmanager.com/u);
const installed = fixture.replace('</head>', '<script async src="https://www.googletagmanager.com/gtag/js?id=G-2L2ETG06B1"></script><script>gtag("config", "G-2L2ETG06B1");</script></head>');
assert.equal(await (await withHtmlAnalytics(makeHtml(installed), request)).text(), installed);
for (const response of [new Response('{}', { headers: { 'content-type': 'application/json', etag: 'keep' } }), new Response(new Uint8Array([0, 255]), { headers: { 'content-type': 'image/png' } }), new Response('error', { status: 500, headers: { 'content-type': 'text/html' } }), new Response(null, { status: 304 })]) {
  assert.equal(await withHtmlAnalytics(response, request), response);
}
const head = makeHtml();
assert.equal(await withHtmlAnalytics(head, new Request(request, { method: 'HEAD' })), head);
const api = makeHtml();
assert.equal(await withHtmlAnalytics(api, new Request('https://used-pick.com/api/example')), api);
const verificationBody = await readFile(new URL('../web-backend/public/google605c6edd3bd9a682.html', import.meta.url), 'utf8');
const verification = makeHtml(verificationBody);
assert.equal(await withHtmlAnalytics(verification, new Request('https://used-pick.com/google605c6edd3bd9a682.html')), verification);
assert.equal(await verification.text(), verificationBody);
for (const route of ['/', '/index.html', '/guide.html', '/price-analysis.html', '/categories', '/categories/gpu']) {
  const response = await worker.fetch(new Request(`https://used-pick.com${route}`, { headers: { 'if-none-match': '"old"' } }), {
    ASSETS: { fetch: async (assetRequest) => {
      assert.equal(assetRequest.headers.get('if-none-match'), null);
      return makeHtml();
    } }
  });
  assert.match(await response.text(), /G-2L2ETG06B1/u, route);
}
const context = vm.createContext({ window: {}, Date });
const bootstrap = await readFile(new URL('../web-backend/public/analytics.js', import.meta.url), 'utf8');
vm.runInContext(bootstrap, context);
vm.runInContext(bootstrap, context);
assert.equal(context.window.dataLayer.filter((entry) => entry[0] === 'config').length, 1);
assert.equal(context.window.dataLayer[1][1], 'G-2L2ETG06B1');
console.log('HTML analytics contract passed: HTML routes, idempotence, CSP preservation, validators, non-HTML, single initialization');
