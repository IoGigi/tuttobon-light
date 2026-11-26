const CACHE_NAME = 'buoni-spesa-v2';
const ASSETS_TO_CACHE = [
  './',
  './index.html',
  './manifest.json',
  './icon.svg'
];

self.addEventListener('install', (event) => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS_TO_CACHE))
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // Intercetta la condivisione file (Web Share Target API)
  if (event.request.method === 'POST' && url.pathname.endsWith('index.html')) {
    event.respondWith(
      (async () => {
        const formData = await event.request.formData();
        const file = formData.get('buono');
        const client = await self.clients.get(event.resultingClientId || event.clientId);
        if (client && file) {
          setTimeout(() => {
            client.postMessage({ type: 'SHARED_FILE', file });
          }, 800);
        }
        return Response.redirect('./index.html?shared=1', 303);
      })()
    );
    return;
  }

  // Strategia Cache-First con aggiornamento per asset e worker OCR/PDF
  event.respondWith(
    caches.match(event.request).then((cachedResponse) => {
      if (cachedResponse) {
        return cachedResponse;
      }
      return fetch(event.request).then((networkResponse) => {
        if (
          event.request.method === 'GET' &&
          networkResponse &&
          networkResponse.status === 200
        ) {
          const responseToCache = networkResponse.clone();
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(event.request, responseToCache);
          });
        }
        return networkResponse;
      }).catch(() => caches.match('./index.html'));
    })
  );
});
