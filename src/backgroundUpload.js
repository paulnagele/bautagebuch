// Uploads that keep going when the app is closed or the phone is locked,
// through the browser's Background Fetch (Chrome and Edge on Android and
// desktop; not Safari/iPhone, not Firefox). The browser sends the files
// itself and shows a notification with the progress. Background Fetch
// cannot send Drive's PUT to another site, so each file goes to the app's
// own relay (functions/api/drive-upload.js, Cloudflare Pages), which
// passes it on to Drive; sites without the relay upload from the page.
// The service worker (public/sw.js) keeps what Drive answered; the app
// reads it when it is open again (uploadQueue.js), and adds the files to
// their entries.
//
// Where Background Fetch is missing, uploadQueue.js uploads from the page
// as before, which pauses while the app is in the background.

const RESULTS_CACHE = 'bautagebuch-upload-results'
const RELAY = 'api/drive-upload'

let registration // undefined: not checked yet; null: not available

// The service worker registration if it offers Background Fetch, else null.
export async function backgroundFetchAvailable() {
  if (registration !== undefined) return registration
  try {
    const reg = await navigator.serviceWorker?.getRegistration()
    if (!reg?.active || !('backgroundFetch' in reg)) {
      registration = null
      return registration
    }
    const check = await fetch(relayUrl(reg), { cache: 'no-store' })
    const answer = check.ok ? await check.json().catch(() => null) : null
    registration = answer?.relay ? reg : null
  } catch {
    registration = null
  }
  return registration
}

function relayUrl(reg, target) {
  const url = new URL(RELAY, reg.scope)
  if (target) url.searchParams.set('target', target)
  return url.href
}

// Hands uploads to the browser: jobs [{ url, blob, mimeType }], where url
// is an open resumable upload session (drive.js startUpload). Resolves to
// the address each job is sent to, which backgroundResult answers by.
export async function sendInBackground(id, jobs, title) {
  const reg = await backgroundFetchAvailable()
  if (!reg) throw new Error('Background Fetch ist nicht verfügbar.')
  const addresses = jobs.map((job) => relayUrl(reg, job.url))
  const requests = jobs.map(
    ({ blob, mimeType }, i) =>
      new Request(addresses[i], { method: 'PUT', body: blob, headers: { 'Content-Type': mimeType } }),
  )
  const base = new URL('./', reg.scope).href
  await reg.backgroundFetch.fetch(id, requests, {
    title,
    uploadTotal: jobs.reduce((sum, job) => sum + job.blob.size, 0),
    icons: [{ src: `${base}icon-192.png`, sizes: '192x192', type: 'image/png' }],
  })
  return addresses
}

// What Drive answered for a finished background upload: { [url]: fileId
// or null }, or null while it is still running. 'lost' when the browser
// no longer knows it (e.g. cancelled before it was noted).
export async function backgroundResult(id) {
  const cache = await caches.open(RESULTS_CACHE).catch(() => null)
  const response = await cache?.match(resultKey(id)).catch(() => null)
  if (response) return response.json().catch(() => ({}))
  const reg = await backgroundFetchAvailable()
  const running = await reg?.backgroundFetch.get(id).catch(() => null)
  return running ? null : 'lost'
}

export async function forgetBackgroundResult(id) {
  const cache = await caches.open(RESULTS_CACHE).catch(() => null)
  await cache?.delete(resultKey(id)).catch(() => {})
}

function resultKey(id) {
  return `results/${encodeURIComponent(id)}`
}

// Bytes sent so far by a running background upload; listener(bytes) on
// progress. Returns an unsubscribe function.
export async function watchBackgroundUpload(id, listener) {
  const reg = await backgroundFetchAvailable()
  const running = await reg?.backgroundFetch.get(id).catch(() => null)
  if (!running) return () => {}
  const onProgress = () => listener(running.uploaded)
  running.addEventListener('progress', onProgress)
  listener(running.uploaded)
  return () => running.removeEventListener('progress', onProgress)
}

// Stops background uploads (on sign-out).
export async function abortBackgroundUploads(ids) {
  const reg = await backgroundFetchAvailable()
  for (const id of ids) {
    const running = await reg?.backgroundFetch.get(id).catch(() => null)
    await running?.abort().catch(() => {})
    await forgetBackgroundResult(id)
  }
}

// listener() when the service worker reports a finished background upload.
export function onBackgroundUploadDone(listener) {
  if (typeof navigator === 'undefined' || !navigator.serviceWorker) return () => {}
  const onMessage = (event) => {
    if (event.data?.type === 'background-upload-done') listener(event.data.id)
  }
  navigator.serviceWorker.addEventListener('message', onMessage)
  return () => navigator.serviceWorker.removeEventListener('message', onMessage)
}
