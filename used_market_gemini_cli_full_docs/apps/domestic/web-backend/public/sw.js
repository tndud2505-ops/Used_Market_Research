// Cache only the offline notice. Listings, prices, HTML and ads always use
// the network/browser's existing HTTP policy, never a service-worker snapshot.
const OFFLINE_CACHE = 'used-pick-offline-v1';
const OFFLINE_URL = '/offline.html';

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(OFFLINE_CACHE).then((cache) => cache.add(OFFLINE_URL)));
});
self.addEventListener('activate', (event) => {
  event.waitUntil(caches.keys().then((keys) => Promise.all(keys
    .filter((key) => key.startsWith('used-pick-offline-') && key !== OFFLINE_CACHE)
    .map((key) => caches.delete(key)))));
});
self.addEventListener('fetch', (event) => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== 'GET' || request.mode !== 'navigate'
      || url.origin !== self.location.origin || url.pathname.startsWith('/api/')) return;
  event.respondWith(fetch(request).catch(async () => {
    const notice = await caches.match(OFFLINE_URL, { cacheName: OFFLINE_CACHE });
    return notice || new Response('인터넷 연결을 확인한 뒤 다시 시도해 주세요.', {
      status: 503, headers: { 'Content-Type': 'text/plain; charset=utf-8' },
    });
  }));
});
