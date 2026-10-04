// Photos, files and text shared to the app from another app ("Teilen →
// Bautagebuch", Android). The service worker (public/sw.js) keeps them in
// a cache; the app takes them once, for a new diary entry.

const SHARE_CACHE = 'bautagebuch-share'

// { text, files: File[] } or null when nothing was shared. Reads the cache
// once per page load and empties it, so the same share is not added twice;
// call doneWithShared() once it is used.
let request = null

export function takeShared() {
  if (!request) request = readShared()
  return request
}

export function doneWithShared() {
  request = Promise.resolve(null)
}

async function readShared() {
  if (!window.caches) return null
  try {
    if (!(await caches.has(SHARE_CACHE))) return null
    const cache = await caches.open(SHARE_CACHE)
    const keys = await cache.keys()
    let text = ''
    const files = []
    for (const key of keys) {
      const response = await cache.match(key)
      if (key.url.endsWith('/shared/info')) {
        text = (await response.json()).text ?? ''
        continue
      }
      const blob = await response.blob()
      const name = decodeURIComponent(response.headers.get('X-File-Name') ?? 'Datei')
      files.push({ order: key.url, file: new File([blob], name, { type: blob.type }) })
    }
    await caches.delete(SHARE_CACHE)
    files.sort((a, b) => a.order.localeCompare(b.order, undefined, { numeric: true }))
    if (!text && files.length === 0) return null
    return { text, files: files.map((f) => f.file) }
  } catch {
    return null
  }
}

// Removes the "?shared=1" the service worker opened the app with.
export function clearShareParam() {
  const url = new URL(window.location.href)
  if (!url.searchParams.has('shared')) return
  url.searchParams.delete('shared')
  window.history.replaceState(null, '', url)
}
