// App-shell cache. Forecast data lives in localStorage, so the API is never cached here.
// Bump VERSION whenever a shell file changes.
const VERSION = 'sw-v31';
const SHELL = [
  './',
  'index.html',
  'styles.css',
  'logic.js',
  'app.js',
  'vendor/suncalc.js',
  'fonts/manrope.woff2',
  'manifest.json',
  'icons/apple-touch-icon.png',
  'icons/icon-192.png',
  'icons/icon-512.png',
  // Painted skies: ~220 KB in all, so every scene works offline.
  ...['light', 'dark'].flatMap(theme => ['day', 'night'].flatMap(time =>
    ['clear', 'partly', 'cloudy', 'fog', 'rain', 'snow'].map(g => `img/sky/${theme}-${time}-${g}.webp`)))
];

self.addEventListener('install', event => {
  // cache: 'reload' skips the browser's HTTP cache (GitHub Pages allows 10 minutes),
  // so a new version never gets filled with the previous version's files.
  event.waitUntil(caches.open(VERSION)
    .then(c => c.addAll(SHELL.map(url => new Request(url, { cache: 'reload' }))))
    .then(() => self.skipWaiting()));
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== VERSION).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// Same-origin GETs: answer from cache instantly, refresh the cache in the background.
self.addEventListener('fetch', event => {
  const req = event.request;
  const url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== self.location.origin) return;
  const key = req.mode === 'navigate' ? 'index.html' : req;
  event.respondWith(
    caches.open(VERSION).then(async cache => {
      const hit = await cache.match(key, { ignoreSearch: true });
      const fresh = fetch(req).then(res => {
        if (res && res.ok) cache.put(key, res.clone());
        return res;
      }).catch(() => hit);
      if (hit) { event.waitUntil(fresh); return hit; }
      return fresh;
    })
  );
});
