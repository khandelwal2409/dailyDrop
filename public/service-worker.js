const CACHE_NAME = 'dailydrop-shell-v4';
const SHELL_FILES = [
  '/',
  '/seller',
  '/index.html',
  '/seller.html',
  '/styles.css',
  '/app.js',
  '/manifest.webmanifest',
  '/seller-manifest.webmanifest',
  '/icon.svg',
  '/seller-icon.svg',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  '/icons/apple-touch-icon.png',
  '/icons/seller-icon-192.png',
  '/icons/seller-icon-512.png',
  '/icons/seller-apple-touch-icon.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(SHELL_FILES)));
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(caches.keys().then((keys) => Promise.all(
    keys.filter((key) => key.startsWith('dailydrop-shell-') && key !== CACHE_NAME)
      .map((key) => caches.delete(key)),
  )));
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== self.location.origin || url.pathname.startsWith('/api/')) return;

  event.respondWith(fetch(request).then((response) => {
    if (response.ok) {
      const copy = response.clone();
      caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
    }
    return response;
  }).catch(async () => {
    const cached = await caches.match(request);
    if (cached) return cached;
    if (request.mode === 'navigate') return caches.match('/');
    return Response.error();
  }));
});