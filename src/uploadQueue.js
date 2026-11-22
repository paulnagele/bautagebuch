// Uploads a diary entry's new photos and files to Google Drive in the
// background, after the entry is saved, so nobody has to wait for them.
//
// Saving an entry puts its new photos and files here (enqueue). Three
// uploads run at a time; each finished one is added to its entry in the
// database, in the order they were picked. The queue is kept on the
// device (the list in localStorage, the files in the Cache API), so
// uploads that did not finish continue when the app is opened again.
// Photos stay in full size.
//
// When Drive access has run out, the queue waits until Drive is connected
// again (one tap, see UploadStatus). On other errors (e.g. no network) it
// tries again a little later, and as soon as the phone is back online.

import { getEntryFolderId, onDriveConnected, driveAccess, uploadFile, uploadPhoto } from './drive.js'
import { newId } from './storage.js'
import { supabase } from './supabase.js'
import { applyRow, friendlyError } from './useCollection.js'

const LIST_KEY = 'bautagebuch.uploadQueue'
const FILE_CACHE = 'bautagebuch-uploads'
export const PARALLEL_UPLOADS = 3
// Waits before trying again after an error: 10 s, 30 s, 1 min, then 5 min.
const RETRY_DELAYS = [10_000, 30_000, 60_000, 300_000]

// item: { id, entryId, list: 'photos' | 'files', name (files), driveName,
// folderPath, fileName, fileType, size, fileId (once uploaded) }
let items = []
const blobs = new Map() // item id -> Blob
const loaded = new Map() // item id -> bytes sent so far
const busy = new Set() // item ids uploading right now
let snapshot = { items: [], status: 'idle', error: '', fraction: 0 }
let status = 'idle' // idle | uploading | needs-drive | retrying
let lastError = ''
let failures = 0
let retryTimer = null
let workers = 0
let attaching = Promise.resolve()
const listeners = new Set()

// ---- state for the UI ------------------------------------------------------

function publish() {
  const total = items.reduce((sum, item) => sum + item.size, 0)
  const sent = items.reduce(
    (sum, item) => sum + (item.fileId ? item.size : Math.min(item.size, loaded.get(item.id) ?? 0)),
    0,
  )
  // Uploaded files still being added to their entries count as uploading.
  const shown = items.length === 0 ? 'idle' : status === 'idle' ? 'uploading' : status
  snapshot = {
    items: items.map((item) => ({ ...item, blob: blobs.get(item.id) })),
    status: shown,
    error: shown === 'retrying' ? lastError : '',
    fraction: total ? sent / total : 0,
  }
  listeners.forEach((listener) => listener())
}

export function subscribeUploads(listener) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function getUploads() {
  return snapshot
}

// Photos and files of one entry that are not in Drive and the entry yet.
export function pendingFor(entryId) {
  return snapshot.items.filter((item) => item.entryId === entryId)
}

// ---- kept on the device ----------------------------------------------------

function fileUrl(id) {
  return `https://bautagebuch.upload/${encodeURIComponent(id)}`
}

async function openCache() {
  try {
    return window.caches ? await caches.open(FILE_CACHE) : null
  } catch {
    return null
  }
}

function saveList() {
  try {
    if (items.length) localStorage.setItem(LIST_KEY, JSON.stringify(items))
    else localStorage.removeItem(LIST_KEY)
  } catch {
    // Storage unavailable: the queue lives in memory only.
  }
}

async function forgetFiles(ids) {
  ids.forEach((id) => {
    blobs.delete(id)
    loaded.delete(id)
  })
  const cache = await openCache()
  await Promise.all(ids.map((id) => cache?.delete(fileUrl(id)).catch(() => {})))
}

// ---- adding --------------------------------------------------------------

// Queues the photos and files of a saved entry that still need uploading
// ({ key, blob } items of the form), into the Drive folder at folderPath.
// Resolves once they are kept on the device.
export async function enqueue(entryId, { photos, files, date }, folderPath) {
  const added = [
    ...photos.filter((p) => p.blob).map((p) => ({ list: 'photos', blob: p.blob })),
    ...files.filter((f) => f.blob).map((f) => ({ list: 'files', blob: f.blob, name: f.name ?? f.blob.name })),
  ].map(({ list, blob, name }) => {
    const item = {
      id: newId(),
      entryId,
      list,
      folderPath,
      driveName:
        list === 'photos' ? `${date} Bautagebuch ${newId()}${extension(blob)}` : `${date} ${blob.name ?? name}`,
      fileName: blob.name ?? '',
      fileType: blob.type ?? '',
      size: blob.size,
      ...(list === 'files' ? { name } : {}),
    }
    blobs.set(item.id, blob)
    return item
  })
  if (added.length === 0) return
  const cache = await openCache()
  for (const item of added) {
    try {
      await cache?.put(fileUrl(item.id), new Response(blobs.get(item.id)))
    } catch {
      // Storage full: this one is only kept while the app is open.
    }
  }
  items = [...items, ...added]
  saveList()
  publish()
  start()
}

// Keeps the original file type in the Drive file name (".jpg", ".heic", …).
function extension(file) {
  const match = /\.[a-z0-9]+$/i.exec(file.name ?? '')
  return match ? match[0].toLowerCase() : '.jpg'
}

// After the app starts (signed in): continues what did not finish before.
export async function resumeUploads() {
  let saved
  try {
    saved = JSON.parse(localStorage.getItem(LIST_KEY)) ?? []
  } catch {
    saved = []
  }
  const known = new Set(items.map((item) => item.id))
  const cache = await openCache()
  const restored = []
  for (const item of saved) {
    if (known.has(item.id)) continue
    if (!item.fileId) {
      const response = await cache?.match(fileUrl(item.id)).catch(() => null)
      if (!response) continue // the file is gone; nothing to upload
      const blob = await response.blob()
      blobs.set(item.id, new File([blob], item.fileName, { type: item.fileType || blob.type }))
    }
    restored.push(item)
  }
  if (restored.length === 0) return
  items = [...items, ...restored]
  saveList()
  publish()
  start()
}

// On sign-out: the next person on this device starts with an empty queue.
export async function clearUploads() {
  const ids = items.map((item) => item.id)
  items = []
  status = 'idle'
  clearTimeout(retryTimer)
  saveList()
  publish()
  await forgetFiles(ids)
  if (window.caches) await caches.delete(FILE_CACHE).catch(() => {})
}

// ---- uploading -----------------------------------------------------------

function nextItem() {
  return items.find((item) => !item.fileId && !busy.has(item.id) && blobs.has(item.id))
}

// Starts uploading (again), e.g. after Drive was connected or the phone
// is back online.
export function start() {
  clearTimeout(retryTimer)
  // Uploaded before (e.g. before the app closed or an error), but not yet
  // added to the entry.
  new Set(items.filter((item) => item.fileId).map((item) => item.entryId)).forEach(attach)
  if (!nextItem()) {
    if (status !== 'needs-drive') status = 'idle'
    publish()
    return
  }
  if (!driveAccess.connected()) {
    status = 'needs-drive'
    publish()
    return
  }
  status = 'uploading'
  publish()
  while (workers < PARALLEL_UPLOADS && nextItem()) {
    workers++
    work().finally(() => {
      workers--
      if (workers === 0 && status === 'uploading') {
        status = 'idle'
        publish()
      }
    })
  }
}

async function work() {
  for (let item = nextItem(); item && status === 'uploading'; item = nextItem()) {
    busy.add(item.id)
    try {
      const blob = blobs.get(item.id)
      const onBytes = (bytes) => {
        loaded.set(item.id, bytes)
        publish()
      }
      const folderId = await getEntryFolderId(item.folderPath)
      const fileId =
        item.list === 'photos'
          ? await uploadPhoto(blob, item.driveName, folderId, onBytes)
          : await uploadFile(blob, item.driveName, folderId, onBytes)
      // Remembered at once, so it is not uploaded twice if the app closes.
      items = items.map((i) => (i.id === item.id ? { ...i, fileId } : i))
      saveList()
      failures = 0
      publish()
      attach(item.entryId)
    } catch (err) {
      failed(err)
    } finally {
      busy.delete(item.id)
    }
  }
}

function failed(err) {
  lastError = err?.message ?? String(err)
  if (status === 'retrying' || status === 'needs-drive') {
    publish()
    return
  }
  if (!driveAccess.connected()) {
    status = 'needs-drive'
  } else {
    status = 'retrying'
    const delay = RETRY_DELAYS[Math.min(failures, RETRY_DELAYS.length - 1)]
    failures++
    retryTimer = setTimeout(start, delay)
  }
  publish()
}

// Adds an entry's uploaded photos and files to it in the database, in the
// order they were picked: only those uploaded without a gap before them.
// One entry at a time, so two cannot overwrite each other's additions.
function attach(entryId) {
  attaching = attaching.then(() => attachNow(entryId)).catch((err) => {
    failed(new Error(friendlyError(err)))
  })
  return attaching
}

async function attachNow(entryId) {
  const own = items.filter((item) => item.entryId === entryId)
  const firstMissing = own.findIndex((item) => !item.fileId)
  const ready = firstMissing === -1 ? own : own.slice(0, firstMissing)
  if (ready.length === 0) return
  const { data: row, error } = await supabase
    .from('diary_entries')
    .select('id, photo_ids, files')
    .eq('id', entryId)
    .maybeSingle()
  if (error) throw error
  if (row) {
    const photoIds = [...(row.photo_ids ?? [])]
    const files = [...(row.files ?? [])]
    for (const item of ready) {
      if (item.list === 'photos') {
        if (!photoIds.includes(item.fileId)) photoIds.push(item.fileId)
      } else if (!files.some((f) => f.id === item.fileId)) {
        files.push({ id: item.fileId, name: item.name })
      }
    }
    const { data: saved, error: saveError } = await supabase
      .from('diary_entries')
      .update({ photo_ids: photoIds, files, updated_at: new Date().toISOString() })
      .eq('id', entryId)
      .select()
      .single()
    if (saveError) throw saveError
    applyRow('diary_entries', saved)
  }
  // Done, or the entry was deleted meanwhile: nothing more to do for these.
  const doneIds = new Set((row ? ready : own).map((item) => item.id))
  items = items.filter((item) => !doneIds.has(item.id))
  saveList()
  publish()
  await forgetFiles([...doneIds])
}

// ---- triggers --------------------------------------------------------------

if (typeof window !== 'undefined') {
  window.addEventListener('online', () => {
    if (status === 'retrying') start()
  })
  onDriveConnected(() => start())
}
