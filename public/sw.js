const CACHE_NAME = 'lvp-cache-v2';
const urlsToCache = [
  '/',
  '/index.html',
  '/favicon.png',
  '/manifest.json'
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(urlsToCache))
  );
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    )
  );
  self.clients.claim().then(() => {
    self.clients.matchAll({ type: 'window' }).then(windowClients => {
      for (let client of windowClients) {
        // Force reload to bypass old cached index.html
        client.navigate(client.url);
      }
    });
  });
});

self.addEventListener('fetch', event => {
  // For HTML requests, go to the network first, fallback to cache
  if (event.request.mode === 'navigate' || event.request.headers.get('accept').includes('text/html')) {
    event.respondWith(
      fetch(event.request).catch(() => caches.match(event.request))
    );
    return;
  }

  // For other requests, go to cache first, fallback to network
  event.respondWith(
    caches.match(event.request).then(cached => {
      return cached || fetch(event.request);
    })
  );
});
