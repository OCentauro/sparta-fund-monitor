const CACHE_NAME = 'sparta-fund-monitor-v2'; // Mudou de v1 para v2
const urlsToCache = [
  '/sparta-fund-monitor/',
  '/sparta-fund-monitor/index.html'
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(urlsToCache))
  );
});

self.addEventListener('fetch', event => {
  event.respondWith(
    caches.match(event.request)
      .then(response => response || fetch(event.request))
  );
});