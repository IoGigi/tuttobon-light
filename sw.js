const CACHE_NAME = 'buoni-spesa-v2.2';

self.addEventListener('install', (event) => {
  self.skipWaiting();
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
  if (event.request.method === 'POST') {
    event.respondWith(
      (async () => {
        const formData = await event.request.formData();
        const file = formData.get('buono');
        const clientsList = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
        if (file && clientsList.length > 0) {
          clientsList[0].postMessage({ type: 'SHARED_FILE', file });
        }
        return Response.redirect('./', 303);
      })()
    );
    return;
  }

  if (event.request.method === 'GET' && event.request.url.startsWith('http')) {
    event.respondWith(
      caches.match(event.request).then((cached) => {
        const networkFetch = fetch(event.request)
          .then((response) => {
            if (response && response.status === 200) {
              const copy = response.clone();
              caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
            }
            return response;
          })
          .catch(() => cached);
        return cached || networkFetch;
      })
    );
  }
});
