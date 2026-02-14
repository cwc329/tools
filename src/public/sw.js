const CACHE_NAME = 'exiftool-wasm-v1'
const WASM_FILE = 'zeroperl.wasm'

self.addEventListener('install', (event) => {
  self.skipWaiting()
})

self.addEventListener('activate', (event) => {
  // Clean up old caches
  event.waitUntil(
    caches.keys().then((names) =>
      Promise.all(
        names
          .filter((name) => name !== CACHE_NAME)
          .map((name) => caches.delete(name)),
      ),
    ),
  )
})

self.addEventListener('fetch', (event) => {
  // Only intercept WASM file requests
  if (!event.request.url.endsWith(WASM_FILE)) return

  event.respondWith(
    caches.open(CACHE_NAME).then((cache) =>
      cache.match(event.request).then((cached) => {
        if (cached) return cached
        return fetch(event.request).then((response) => {
          cache.put(event.request, response.clone())
          return response
        })
      }),
    ),
  )
})
