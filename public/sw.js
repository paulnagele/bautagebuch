// Service worker for the installable app (PWA).
//
// It only handles this site's own files, so Supabase (auth, data,
// Realtime), Google sign-in and Drive photos always go straight to the
// network. The photo cache in drive.js ('bautagebuch-photos-*') is left
// alone.
//
// - Page loads: network first, so a new deploy shows up on the next
//   start; the last good copy is used only when offline.
// - Built assets (hashed file names) and icons: cache first, since a
//   given file name never changes.

const CACHE = 'bautagebuch-app-v1'

self.addEventListener('install', (event) => {
  event.waitUntil(
    precache()
      .catch(() => {})
      .then(() => self.skipWaiting()),
  )
})

// Keep the current page and the files it loads, so the app also opens
// without a connection.
async function precache() {
  const cache = await caches.open(CACHE)
  const response = await fetch('./', { cache: 'no-cache' })
  if (!response.ok) return
  const html = await response.clone().text()
  await cache.put('./', response)
  const assets = [...html.matchAll(/(?:src|href)="\.?\/?(assets\/[^"]+)"/g)]
  await cache.addAll(assets.map((match) => match[1]))
}

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => key.startsWith('bautagebuch-app-') && key !== CACHE)
            .map((key) => caches.delete(key)),
        ),
      )
      .then(() => self.clients.claim()),
  )
})

self.addEventListener('fetch', (event) => {
  const { request } = event
  if (request.method !== 'GET') return
  const url = new URL(request.url)
  if (url.origin !== self.location.origin) return
  if (!url.pathname.startsWith(new URL(self.registration.scope).pathname)) return

  if (request.mode === 'navigate') {
    event.respondWith(networkFirst(event))
  } else {
    event.respondWith(cacheFirst(request))
  }
})

async function networkFirst(event) {
  const cache = await caches.open(CACHE)
  try {
    const response = await fetch(event.request)
    if (response.ok) {
      const copy = response.clone()
      event.waitUntil(
        cache
          .put('./', copy.clone())
          .then(() => copy.text())
          .then((html) => pruneAssets(cache, html)),
      )
    }
    return response
  } catch (error) {
    const cached = await cache.match('./')
    if (cached) return cached
    throw error
  }
}

async function cacheFirst(request) {
  const cache = await caches.open(CACHE)
  const cached = await cache.match(request)
  if (cached) return cached
  const response = await fetch(request)
  if (response.ok && request.url.includes('/assets/')) {
    cache.put(request, response.clone())
  }
  return response
}

// Drop assets of earlier deploys that the current page no longer uses.
async function pruneAssets(cache, html) {
  for (const request of await cache.keys()) {
    const path = new URL(request.url).pathname
    const name = path.slice(path.lastIndexOf('/') + 1)
    if (path.includes('/assets/') && !html.includes(name)) {
      cache.delete(request)
    }
  }
}
