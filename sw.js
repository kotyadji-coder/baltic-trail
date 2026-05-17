/* Service worker: app shell precache + runtime tile cache (offline-in-the-forest) */
const APP_CACHE = 'tropa-app-v17';
const TILE_CACHE = 'tropa-tiles-v1';
const MAX_TILES = 4000; // rough cap so we don't fill the disk

const APP_SHELL = [
  './',
  './index.html',
  './css/style.css',
  './js/app.js',
  './manifest.webmanifest',
  './vendor/leaflet/leaflet.js',
  './vendor/leaflet/leaflet.css',
  './vendor/leaflet/images/marker-icon.png',
  './vendor/leaflet/images/marker-icon-2x.png',
  './vendor/leaflet/images/marker-shadow.png',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-512-maskable.png',
  './icons/apple-touch-icon.png',
  './icons/favicon-32.png',
  './data/track.gpx',
  './data/points.geojson',
  './help.html',
  './about.html',
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(APP_CACHE).then(c => c.addAll(APP_SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys => Promise.all(
      keys.filter(k => k !== APP_CACHE && k !== TILE_CACHE).map(k => caches.delete(k))
    )).then(() => self.clients.claim())
  );
});

function isTile(href){
  return (/(^|\.)tile\.openstreetmap\.org\//.test(href) || /(^|\.)tile\.opentopomap\.org\//.test(href))
         && /\/\d+\/\d+\/\d+\.png(\?|$)/.test(href);
}

async function trimTiles(cache){
  const keys = await cache.keys();
  if (keys.length <= MAX_TILES) return;
  // delete oldest ~10%
  const drop = Math.ceil(keys.length * 0.1);
  for (let i = 0; i < drop; i++) await cache.delete(keys[i]);
}

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  // Map tiles: cache-first, then network (and store).
  if (isTile(url.href)){
    e.respondWith((async () => {
      const cache = await caches.open(TILE_CACHE);
      const hit = await cache.match(req);
      if (hit) return hit;
      try {
        const res = await fetch(req);
        if (res && res.ok){ cache.put(req, res.clone()); trimTiles(cache); }
        return res;
      } catch {
        return hit || Response.error();
      }
    })());
    return;
  }

  // Same-origin app files: cache-first with background update.
  if (url.origin === self.location.origin){
    e.respondWith((async () => {
      const cache = await caches.open(APP_CACHE);
      const hit = await cache.match(req);
      const network = fetch(req).then(res => {
        if (res && res.ok && (res.type === 'basic' || res.type === 'default')) cache.put(req, res.clone());
        return res;
      }).catch(() => null);
      if (hit){ e.waitUntil(network); return hit; }
      const net = await network;
      if (net) return net;
      if (req.mode === 'navigate') return cache.match('./index.html');
      return Response.error();
    })());
    return;
  }
  // Everything else: network, fall back to cache if present.
  e.respondWith(fetch(req).catch(() => caches.match(req)));
});
