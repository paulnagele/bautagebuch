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
// Photos and files shared to the app (see the manifest's share_target),
// kept until the app picks them up (src/share.js).
const SHARE_CACHE = 'bautagebuch-share'

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
  await keepAssets(cache, html)
}

// Caches every built file the page uses: the ones it names, and the ones
// its scripts load later (the tabs loaded when first opened). Returns
// their file names.
async function keepAssets(cache, html) {
  const paths = [...html.matchAll(/(?:src|href)="\.?\/?(assets\/[^"]+)"/g)].map((match) => match[1])
  const names = new Set()
  while (paths.length > 0) {
    const path = paths.shift()
    const name = path.slice(path.lastIndexOf('/') + 1)
    if (names.has(name)) continue
    names.add(name)
    let response = await cache.match(path)
    if (!response) {
      response = await fetch(path)
      if (!response.ok) continue
      await cache.put(path, response.clone())
    }
    if (!name.endsWith('.js')) continue
    // Scripts name the built files they load relative to themselves
    // ("./Finances-1a2B3c4D.js"; the part after the dash is a hash).
    const script = await response.text()
    for (const match of script.matchAll(/["'`]\.\/([\w.-]+-[\w-]{8}\.(?:js|css))["'`]/g)) {
      paths.push(`assets/${match[1]}`)
    }
  }
  return names
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
  const url = new URL(request.url)
  if (request.method === 'POST' && url.href === new URL('share-target', self.registration.scope).href) {
    event.respondWith(receiveShare(request))
    return
  }
  if (request.method !== 'GET') return
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

// Fetch the files of a new deploy, so they work offline too, and drop
// those of earlier deploys that the current page no longer uses.
async function pruneAssets(cache, html) {
  const used = await keepAssets(cache, html)
  for (const request of await cache.keys()) {
    const path = new URL(request.url).pathname
    const name = path.slice(path.lastIndexOf('/') + 1)
    if (path.includes('/assets/') && !used.has(name)) {
      cache.delete(request)
    }
  }
}

// "Teilen → Bautagebuch" on the phone: keep what was shared and open the
// app, which puts it into a new diary entry.
async function receiveShare(request) {
  try {
    const form = await request.formData()
    const cache = await caches.open(SHARE_CACHE)
    for (const key of await cache.keys()) await cache.delete(key)
    const files = form.getAll('files').filter((file) => file instanceof File && file.size > 0)
    await Promise.all(
      files.map((file, i) =>
        cache.put(
          `shared/file-${i}`,
          new Response(file, {
            headers: {
              'Content-Type': file.type || 'application/octet-stream',
              'X-File-Name': encodeURIComponent(file.name || `Datei ${i + 1}`),
            },
          }),
        ),
      ),
    )
    // Apps often send the same words as title and text; keep them once.
    const parts = ['title', 'text', 'url']
      .map((name) => form.get(name))
      .filter((value) => typeof value === 'string' && value.trim())
      .map((value) => value.trim())
    const text = [...new Set(parts)].join('\n')
    await cache.put('shared/info', Response.json({ text, files: files.length, at: Date.now() }))
  } catch {
    // Nothing kept: the app just opens.
  }
  return Response.redirect(new URL('./?shared=1', self.registration.scope).href, 303)
}
