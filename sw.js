/*
 * sw.js — offline cache
 * ---------------------
 * Caches the application shell so the app opens with no network at all.
 * Records never pass through here; they live in IndexedDB.
 *
 * Bump CACHE whenever index.html is rebuilt, or browsers will keep
 * serving the previous version.
 */

const CACHE = 'concrete-lab-v3';
/* index.html is self-contained (see build.js), so the shell is just this. */
const FILES = [
  './',
  './index.html',
  './manifest.webmanifest',
  './assets/icon.svg'
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE)
      .then(c => c.addAll(FILES))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

/* Cache first: the shell rarely changes and the lab may have no network. */
self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;
  event.respondWith(
    caches.match(event.request).then(hit => hit || fetch(event.request)
      .then(res => {
        if (res && res.status === 200 && res.type === 'basic') {
          const copy = res.clone();
          caches.open(CACHE).then(c => c.put(event.request, copy));
        }
        return res;
      })
      .catch(() => caches.match('./index.html')))
  );
});
