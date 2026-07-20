// Strongbox Service Worker
// One permanent cache name — you should NOT need to bump this on every release anymore.
// Only bump it if you deliberately want to force-clear everything (rare).
const CACHE_NAME = 'strongbox-cache';

// Core files to pre-cache on install so the app works offline immediately.
const ASSETS_TO_CACHE = [
  './',
  './index.html',
  './css/style.css',
  './js/script.js',
  './js/firebase-sync.js',
  './manifest.json',
  './assets/images/favicon.png',
  './assets/images/icon-192.png',
  './assets/images/icon-512.png'
];

// Files that should always be checked against the network first
// (the "shell" of the app — if these are stale, users see old features/UI).
const NETWORK_FIRST_FILES = ['./', './index.html', './manifest.json'];

// Install: pre-cache the core app shell
self.addEventListener('install', (event) => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS_TO_CACHE))
  );
});

// Activate: clean up any old versioned caches from before, take control immediately
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

// Helper: is this request one of our "always fresh if possible" files?
function isNetworkFirst(request) {
  const url = new URL(request.url);
  const path = './' + url.pathname.split('/').slice(-1)[0];
  return NETWORK_FIRST_FILES.some((f) => request.url.endsWith(f.replace('./', '')) || path === f) ||
         request.mode === 'navigate';
}

// Helper: notify any open clients that a fresh version was cached
function notifyClientsOfUpdate() {
  self.clients.matchAll().then((clients) => {
    clients.forEach((client) => client.postMessage({ type: 'SW_UPDATED' }));
  });
}

// Network-first strategy: try network, fall back to cache if offline
async function networkFirst(request) {
  try {
    const networkResponse = await fetch(request);
    if (networkResponse && networkResponse.status === 200 && networkResponse.type === 'basic') {
      const cache = await caches.open(CACHE_NAME);
      const cached = await cache.match(request);
      const isNew = !cached || (await cached.clone().text()) !== (await networkResponse.clone().text());
      cache.put(request, networkResponse.clone());
      if (isNew && cached) notifyClientsOfUpdate();
    }
    return networkResponse;
  } catch (err) {
    const cached = await caches.match(request);
    if (cached) return cached;
    throw err;
  }
}

// Stale-while-revalidate: return cache immediately, refresh cache in background
async function staleWhileRevalidate(request) {
  const cache = await caches.open(CACHE_NAME);
  const cachedResponse = await cache.match(request);

  const networkFetch = fetch(request)
    .then((networkResponse) => {
      if (networkResponse && networkResponse.status === 200 && networkResponse.type === 'basic') {
        cache.put(request, networkResponse.clone());
      }
      return networkResponse;
    })
    .catch(() => null);

  return cachedResponse || networkFetch;
}

// Cache-first: use cache if present, otherwise fetch and store
async function cacheFirst(request) {
  const cached = await caches.match(request);
  if (cached) return cached;
  try {
    const networkResponse = await fetch(request);
    if (networkResponse && networkResponse.status === 200 && networkResponse.type === 'basic') {
      const cache = await caches.open(CACHE_NAME);
      cache.put(request, networkResponse.clone());
    }
    return networkResponse;
  } catch (err) {
    return caches.match('./offline.html'); // optional, only if you add this file
  }
}

self.addEventListener('fetch', (event) => {
  // Only handle GET requests
  if (event.request.method !== 'GET') return;

  const isImage = event.request.destination === 'image';

  if (isNetworkFirst(event.request)) {
    event.respondWith(networkFirst(event.request));
  } else if (isImage) {
    event.respondWith(cacheFirst(event.request));
  } else {
    // CSS/JS and everything else: stale-while-revalidate
    event.respondWith(staleWhileRevalidate(event.request));
  }
});

// Allow the page to tell the SW to activate immediately (used by the update-prompt flow)
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});
