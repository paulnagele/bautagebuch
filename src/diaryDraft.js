// Keeps the diary form's draft on the device, so it survives the app being
// closed: phones often end an app in the background, e.g. while the
// camera is open for "Foto aufnehmen", and "Neu laden" restarts it too.
// The form's text and choices go to localStorage; photos and files not
// uploaded yet go to a cache (Cache API), one entry per picked file.
// If storage is unavailable, the draft simply lives in memory as before.

const DRAFT_KEY = 'bautagebuch.diaryDraft'
const FILE_CACHE = 'bautagebuch-draft'
// Files already in the cache, so each one is stored only once.
const stored = new Set()
// Saves run one after another, so an older one cannot finish last.
let queue = Promise.resolve()

function inTurn(task) {
  queue = queue.then(task, task)
  return queue
}

function fileUrl(key) {
  return `https://bautagebuch.draft/${encodeURIComponent(key)}`
}

async function openCache() {
  try {
    return window.caches ? await caches.open(FILE_CACHE) : null
  } catch {
    return null
  }
}

// Whether there is anything worth keeping: something typed or picked, an
// entry being edited, or the form unfolded.
function worthKeeping({ form, editingId, open }) {
  return Boolean(
    editingId || open || form.work.trim() || form.photos.length > 0 || form.files.length > 0,
  )
}

// A photo or file as stored: new ones ({ key, blob }) keep their file
// name and type here, the file itself goes to the cache.
function withoutBlob({ blob, ...rest }) {
  return blob ? { ...rest, pending: true, fileName: blob.name ?? '', fileType: blob.type } : rest
}

// Saves the draft ({ form, editingId, open }), or forgets it once the
// form is empty and folded.
export function saveDraft(draft) {
  return inTurn(() => (worthKeeping(draft) ? write(draft) : forget()))
}

async function write(draft) {
  const { form } = draft
  const pending = [...form.photos, ...form.files].filter((item) => item.blob)
  const cache = await openCache()
  if (cache) {
    for (const item of pending) {
      if (stored.has(item.key)) continue
      try {
        await cache.put(fileUrl(item.key), new Response(item.blob))
        stored.add(item.key)
      } catch {
        // Storage full: this file is only kept in memory.
      }
    }
    // Drop files removed from the form or uploaded since.
    const keep = new Set(pending.map((item) => fileUrl(item.key)))
    for (const request of await cache.keys().catch(() => [])) {
      if (!keep.has(request.url)) {
        cache.delete(request).catch(() => {})
        stored.delete(decodeURIComponent(request.url.slice(request.url.lastIndexOf('/') + 1)))
      }
    }
  }
  const saved = {
    form: { ...form, photos: form.photos.map(withoutBlob), files: form.files.map(withoutBlob) },
    editingId: draft.editingId,
    open: draft.open,
  }
  try {
    localStorage.setItem(DRAFT_KEY, JSON.stringify(saved))
  } catch {
    // Storage unavailable: the draft stays in memory only.
  }
}

// The saved draft ({ form, editingId, open }) or null. Photos and files
// whose stored copy is gone are left out.
export async function loadDraft() {
  let saved
  try {
    saved = JSON.parse(localStorage.getItem(DRAFT_KEY))
  } catch {
    return null
  }
  if (!saved?.form) return null
  const cache = await openCache()
  async function restore(item) {
    if (!item.pending) return item
    const { pending: _pending, fileName, fileType, ...rest } = item
    try {
      const response = await cache?.match(fileUrl(item.key))
      if (!response) return null
      const blob = await response.blob()
      stored.add(item.key)
      return { ...rest, blob: new File([blob], fileName, { type: fileType || blob.type }) }
    } catch {
      return null
    }
  }
  const [photos, files] = await Promise.all(
    [saved.form.photos ?? [], saved.form.files ?? []].map(async (items) =>
      (await Promise.all(items.map(restore))).filter(Boolean),
    ),
  )
  return {
    form: { ...saved.form, photos, files },
    editingId: saved.editingId ?? null,
    open: Boolean(saved.open),
  }
}

// Forgets the draft, e.g. on sign-out.
export function clearDraft() {
  return inTurn(forget)
}

async function forget() {
  try {
    localStorage.removeItem(DRAFT_KEY)
  } catch {
    // Nothing stored.
  }
  stored.clear()
  if (window.caches) await caches.delete(FILE_CACHE).catch(() => {})
}
