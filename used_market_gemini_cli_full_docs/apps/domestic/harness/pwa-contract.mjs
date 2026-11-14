import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { appSurface, verifiedPlayStoreUrl } from '../web-backend/public/app-settings.mjs';

// App presentation must not depend on a copyable source=app query parameter.
const web = { matchMedia: () => ({ matches: false }), navigator: {}, location: { search: '?source=app' } };
assert.equal(appSurface(web, { referrer: '' }), 'web');
assert.equal(appSurface(web, { referrer: 'android-app://com.usedpick.app/' }), 'installed');
assert.equal(appSurface(web, { referrer: 'android-app://com.usedpick.app.attacker/' }), 'web');
assert.equal(verifiedPlayStoreUrl('https://play.google.com/store/apps/details?id=wrong.app'), null);
assert.equal(verifiedPlayStoreUrl('https://play.google.com.attacker/store/apps/details?id=com.usedpick.app'), null);
assert.ok(verifiedPlayStoreUrl('https://play.google.com/store/apps/details?id=com.usedpick.app'));

// Native ad requests require an origin-bound MessagePort; ordinary tabs cannot
// trigger them, and hidden documents do not send opportunities.
{
  const events = new Map(), sent = [];
  const browser = { addEventListener: (type, listener) => events.set(type, listener) };
  browser.top = browser;
  const page = { visibilityState: 'visible', querySelector: () => null };
  const bridgeContext = vm.createContext({ window: browser, document: page, location: { origin: 'https://used-pick.com' } });
  const source = await readFile(new URL('../web-backend/public/app-ad-bridge.mjs', import.meta.url), 'utf8');
  vm.runInContext(source.replace('export function notifyAnalysisComplete', 'function notifyAnalysisComplete'), bridgeContext);
  const channel = { postMessage: data => sent.push(JSON.parse(data)), start() {}, close() {} };
  const hello = { source: null, ports: [channel], data: JSON.stringify({ type: 'used-pick:native-ready', version: 1, nonce: '0123456789abcdefghijklmnop' }) };
  events.get('message')({ ...hello, origin: 'https://used-pick.com.attacker' });
  vm.runInContext('notifyAnalysisComplete()', bridgeContext);
  assert.equal(sent.length, 0, 'foreign origin must not establish a native channel');
  events.get('message')({ ...hello, data: '', origin: 'android-app://used-pick.com/com.usedpick.app' });
  vm.runInContext('notifyAnalysisComplete()', bridgeContext);
  assert.equal(sent.length, 0, 'a transferred port alone does not authorize an opportunity');
  channel.onmessage({ data: hello.data });
  vm.runInContext('notifyAnalysisComplete()', bridgeContext);
  assert.deepEqual(sent.map(({ type, sequence }) => [type, sequence]), [['used-pick:bridge-ready', 1], ['used-pick:analysis-complete', 2]]);
  page.visibilityState = 'hidden';
  vm.runInContext('notifyAnalysisComplete()', bridgeContext);
  assert.equal(sent.length, 2, 'a background document cannot request an ad');
}

const listeners = new Map();
let fetches = 0;
const context = vm.createContext({
  self: { location: { origin: 'https://used-pick.com' }, addEventListener: (type, fn) => listeners.set(type, fn) },
  URL, Response,
  fetch: async () => { fetches++; throw new Error('offline'); },
  caches: { match: async () => new Response('offline notice') },
});
vm.runInContext(await readFile(new URL('../web-backend/public/sw.js', import.meta.url), 'utf8'), context);
const navigate = (url, method = 'GET', mode = 'navigate') => {
  let response;
  listeners.get('fetch')({ request: { url, method, mode }, respondWith: (value) => { response = value; } });
  return response;
};
for (const url of ['/api/pc/listings', '/api/products/example/price-stats', '/api/pc/catalog']) {
  assert.equal(navigate(`https://used-pick.com${url}`), undefined, 'API is never served from offline cache');
}
assert.equal(navigate('https://used-pick.com/app.js', 'GET', 'cors'), undefined);
assert.equal(navigate('https://other.example/'), undefined);
assert.equal(navigate('https://used-pick.com/', 'POST'), undefined);
assert.equal(fetches, 0);
assert.equal(await (await navigate('https://used-pick.com/price-analysis.html')).text(), 'offline notice');
console.log('PWA contract passed: API bypass, network-only pages, offline notice, app hints and exact download target');
