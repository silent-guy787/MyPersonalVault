// Strongbox Service Worker
// Bump this version string any time you change cached files, so old caches get replaced.
const CACHE_NAME = 'strongbox-cache-v1';

// Only list files that exist in your repo. Keep paths relative (no leading slash)
// so this works whether the site is hosted at the root or in a /repo-name/ subfolder
// (which is how GitHub Pages serves project sites).
const ASSETS_TO_CACHE = [
  './',
  './index.html',
  './css/style.css',
  './js/script.js',
  './manifest.json',
  './assets/images/favicon.png',
  './assets/images/icon-192.png',
  './assets/images/icon-512.png'
];

// Install: pre-cache the core app shell
self.addEventListener('install', (event) => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS_TO_CACHE))
  );
});

// Activate: clean up old caches
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys.map((key) => {
          if (key !== CACHE_NAME) {
            return caches.delete(key);
          }
        })
      )
    )
  );
  self.clients.claim();
});

// Fetch: serve from cache first, fall back to network, and cache new requests as they come in
self.addEventListener('fetch', (event) => {
  // Only handle GET requests
  if (event.request.method !== 'GET') return;

  event.respondWith(
    caches.match(event.request).then((cachedResponse) => {
      if (cachedResponse) {
        return cachedResponse;
      }
      return fetch(event.request)
        .then((networkResponse) => {
          // Cache a copy of newly fetched files for next time (only successful, basic responses)
          if (networkResponse && networkResponse.status === 200 && networkResponse.type === 'basic') {
            const responseClone = networkResponse.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, responseClone));
          }
          return networkResponse;
        })
        .catch(() => {
          // Optional: return a fallback page here if you add one, e.g. caches.match('./offline.html')
        });
    })
  );
});
