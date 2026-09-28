// Viste SMS service worker: only shows a branded offline page when a page cannot load.
// It never caches school data or API responses.
const CACHE = 'viste-offline-v1'
const OFFLINE_ASSETS = ['/offline.html', '/pwa/icon-192.png']

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(OFFLINE_ASSETS)))
  self.skipWaiting()
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  )
})

self.addEventListener('fetch', (event) => {
  const { request } = event
  // App downloads must reach the browser's download manager untouched.
  if (new URL(request.url).pathname.startsWith('/download/')) return
  if (request.mode === 'navigate') {
    event.respondWith(fetch(request).catch(() => caches.match('/offline.html')))
    return
  }
  if (OFFLINE_ASSETS.includes(new URL(request.url).pathname)) {
    event.respondWith(fetch(request).catch(() => caches.match(request)))
  }
})
