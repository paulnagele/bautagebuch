// Diary photos are stored in a shared Google Drive folder. Each family
// member uploads them with their own Google account, so the folder must be
// shared with everyone (as Editor). Nothing is shared by link: photos load
// with the member's own Drive access and are then kept on the device.
// (Older versions shared each photo as "Anyone with the link";
// makePhotosPrivate takes that back.)

import { config } from './config.js'
import { createGoogleAccess } from './google.js'
import { getSetting, onSettingChange } from './settings.js'
import { supabase } from './supabase.js'

const PHOTO_CACHE = 'bautagebuch-photos-v1'
const API = 'https://www.googleapis.com/drive/v3/files'
const UPLOAD_API = 'https://www.googleapis.com/upload/drive/v3/files'

// ---- folders ---------------------------------------------------------------

// One Drive folder is configured (e.g. "Haus"). A diary entry's photos
// and files go into <kind>/<creation date> below it, e.g.
// Haus/Mangel/2026_10_02. The app finds or creates these folders on
// upload; they inherit the configured folder's sharing. The folder ID is
// stored in the database (app_settings), so only signed-in members can
// see it; it is not in the repository or the public site.
const FOLDER_TYPE = 'application/vnd.google-apps.folder'
const subfolderRequests = new Map()

export function getDriveFolderId() {
  return getSetting('drive_folder_id', 'der Google-Drive-Ordner')
}

async function findOrCreateFolder(parent, name) {
  const quoted = name.replace(/\\/g, '\\\\').replace(/'/g, "\\'")
  const query = `name = '${quoted}' and '${parent}' in parents and mimeType = '${FOLDER_TYPE}' and trashed = false`
  const found = await driveFetch(
    `${API}?q=${encodeURIComponent(query)}&fields=files(id)&supportsAllDrives=true&includeItemsFromAllDrives=true`,
  ).then((r) => r.json())
  if (found.files?.length) return found.files[0].id
  const created = await driveFetch(`${API}?fields=id&supportsAllDrives=true`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, mimeType: FOLDER_TYPE, parents: [parent] }),
  }).then((r) => r.json())
  return created.id
}

// The folder for one path below the configured folder, e.g.
// ['Mangel', '2026_10_02']. Needs Drive access, so it only runs when
// uploading. Remembered per path, so parallel uploads share one folder.
export function getEntryFolderId(path) {
  const key = path.join('/')
  if (!subfolderRequests.has(key)) {
    const request = (async () => {
      let folder = await getDriveFolderId()
      for (const name of path) folder = await findOrCreateFolder(folder, name)
      return folder
    })()
    request.catch(() => subfolderRequests.delete(key))
    subfolderRequests.set(key, request)
  }
  return subfolderRequests.get(key)
}

// A new folder in Einstellungen: find the subfolders there from now on.
onSettingChange((key) => {
  if (key === 'drive_folder_id') subfolderRequests.clear()
})

// The folder ID from a pasted Drive link (…/folders/<ID>, ?id=<ID>) or
// the bare ID; null if none is found.
export function folderIdFromText(text) {
  const value = text.trim()
  const fromPath = /\/folders\/([\w-]{10,})/.exec(value)
  if (fromPath) return fromPath[1]
  const fromQuery = /[?&]id=([\w-]{10,})/.exec(value)
  if (fromQuery) return fromQuery[1]
  return /^[\w-]{10,}$/.test(value) ? value : null
}

// Checks with the member's Drive access that the ID is a folder they can
// add files to. Resolves to { name }; throws with a German message.
export async function checkDriveFolder(folderId) {
  let file
  try {
    file = await driveFetch(
      `${API}/${encodeURIComponent(folderId)}?fields=name,mimeType,trashed,capabilities(canAddChildren)&supportsAllDrives=true`,
    ).then((r) => r.json())
  } catch (err) {
    if (err.status === 404) {
      throw new Error('Diesen Ordner gibt es nicht, oder er ist nicht mit dir geteilt.')
    }
    throw err
  }
  if (file.mimeType !== FOLDER_TYPE) throw new Error(`„${file.name}“ ist kein Ordner.`)
  if (file.trashed) throw new Error(`Der Ordner „${file.name}“ liegt im Papierkorb.`)
  if (!file.capabilities?.canAddChildren) {
    throw new Error(`Du darfst im Ordner „${file.name}“ nichts ablegen. Er muss mit dir als Bearbeiter geteilt sein.`)
  }
  return { name: file.name }
}

export function driveFileUrl(fileId) {
  return `https://drive.google.com/file/d/${encodeURIComponent(fileId)}/view`
}

export function driveFolderUrl(folderId) {
  return `https://drive.google.com/drive/folders/${encodeURIComponent(folderId)}`
}

// ---- access token ---------------------------------------------------------

const drive = createGoogleAccess({
  scope: 'https://www.googleapis.com/auth/drive',
  storageKey: 'bautagebuch.driveToken',
  name: 'Google Drive',
  clientId: config.googleClientId,
})

// For connecting Drive together with another Google API (connectTogether).
export const driveAccess = drive

const validToken = drive.connected
const driveFetch = drive.fetch

// Called on sign-out: forgets the token and the photos kept on this device.
export function disconnectDrive() {
  drive.disconnect()
  subfolderRequests.clear()
  photoCache.clear()
  if (window.caches) caches.delete(PHOTO_CACHE).catch(() => {})
}

// Opens Google's consent popup; must be called directly from a click
// handler, or the browser blocks the popup.
export function connectDrive(email) {
  return drive.connect(email)
}

// Runs listener whenever Drive access is granted (e.g. so photos waiting
// for it load); returns an unsubscribe function.
export function onDriveConnected(listener) {
  return drive.onConnect(listener)
}

// ---- API calls ------------------------------------------------------------

// Takes back "Anyone with the link" from one file, if it has it.
async function unshareByLink(fileId) {
  const id = encodeURIComponent(fileId)
  let permissions
  try {
    const response = await driveFetch(
      `${API}/${id}/permissions?fields=permissions(id,type)&supportsAllDrives=true`,
    )
    permissions = (await response.json()).permissions ?? []
  } catch (err) {
    if (err.status === 404) return // deleted, or not visible to this member
    throw err
  }
  for (const permission of permissions.filter((p) => p.type === 'anyone')) {
    await driveFetch(
      `${API}/${id}/permissions/${encodeURIComponent(permission.id)}?supportsAllDrives=true`,
      { method: 'DELETE' },
    ).catch((err) => {
      if (err.status !== 404) throw err
    })
  }
}

// Resumable upload, so full-size photos and large files go through
// (simple multipart uploads are limited to 5 MB).
// Sends the file to a resumable upload session. XMLHttpRequest instead of
// fetch because only it reports upload progress. The session URL itself
// authorizes the upload, so no access token is needed here.
function sendWithProgress(url, blob, mimeType, onBytes) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    xhr.open('PUT', url)
    xhr.setRequestHeader('Content-Type', mimeType)
    xhr.responseType = 'json'
    xhr.upload.onprogress = (e) => onBytes?.(e.loaded)
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300 && xhr.response?.id) {
        onBytes?.(blob.size)
        resolve(xhr.response.id)
        return
      }
      const detail = xhr.response?.error?.message
      reject(new Error(detail || `Google-Drive-Upload fehlgeschlagen (${xhr.status}).`))
    }
    xhr.onerror = () => reject(new Error('Keine Verbindung. Bitte Internetverbindung prüfen.'))
    xhr.send(blob)
  })
}

async function upload(blob, name, mimeType, folderId, onBytes) {
  const session = await driveFetch(`${UPLOAD_API}?uploadType=resumable&supportsAllDrives=true`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json; charset=UTF-8',
      'X-Upload-Content-Type': mimeType,
    },
    body: JSON.stringify({ name, mimeType, parents: [folderId] }),
  })
  const uploadUrl = session.headers.get('Location')
  if (!uploadUrl) throw new Error('Google Drive hat keine Upload-Adresse geliefert.')
  return sendWithProgress(`${uploadUrl}&fields=id`, blob, mimeType, onBytes)
}

// onBytes(loaded) reports how many bytes of the file are sent so far.
export function uploadFile(file, name, folderId, onBytes) {
  return upload(file, name, file.type || 'application/octet-stream', folderId, onBytes)
}

export async function uploadPhoto(blob, name, folderId, onBytes) {
  const id = await upload(blob, name, blob.type || 'image/jpeg', folderId, onBytes)
  // The uploader already has the photo: keep it so it shows right away.
  photoCache.set(id, Promise.resolve(URL.createObjectURL(blob)))
  return id
}

// ---- loading photos -------------------------------------------------------
//
// Photos are kept on the device (Cache API), so once seen they show
// instantly, offline and without Drive access. Only photos not on the
// device yet are downloaded from Drive, a few at a time, with retries.

// Thrown when a photo can only be loaded with the person's own Drive access.
export class NeedsDriveError extends Error {
  constructor() {
    super('Google Drive verbinden, um dieses Foto zu laden.')
    this.needsDrive = true
  }
}

function deviceKey(fileId) {
  return `https://bautagebuch.photos/${encodeURIComponent(fileId)}`
}

async function openDeviceCache() {
  try {
    return window.caches ? await caches.open(PHOTO_CACHE) : null
  } catch {
    return null // e.g. private browsing
  }
}

async function readFromDevice(fileId) {
  try {
    const response = await (await openDeviceCache())?.match(deviceKey(fileId))
    return response ? await response.blob() : null
  } catch {
    return null
  }
}

async function storeOnDevice(fileId, blob) {
  try {
    await (await openDeviceCache())?.put(
      deviceKey(fileId),
      new Response(blob, { headers: { 'Content-Type': blob.type || 'image/jpeg' } }),
    )
  } catch {
    // Storage full or unavailable: the photo just is not kept.
  }
}

// At most a few downloads at once, so a long diary does not stall them all.
const MAX_DOWNLOADS = 4
let running = 0
const waiting = []

async function limited(task) {
  if (running >= MAX_DOWNLOADS) await new Promise((resolve) => waiting.push(resolve))
  running += 1
  try {
    return await task()
  } finally {
    running -= 1
    waiting.shift()?.()
  }
}

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

// Downloads a photo with the person's own Drive access.
async function download(fileId) {
  for (let attempt = 0; ; attempt += 1) {
    if (!validToken()) throw new NeedsDriveError()
    try {
      const response = await driveFetch(
        `${API}/${encodeURIComponent(fileId)}?alt=media&supportsAllDrives=true`,
      )
      return await response.blob()
    } catch (err) {
      if (!validToken()) throw new NeedsDriveError() // token expired meanwhile
      // Network errors, rate limits and server errors are usually temporary.
      const temporary = !err.status || err.status === 429 || err.status >= 500
      if (!temporary || attempt >= 2) throw err
      await wait(1000 * 2 ** attempt)
    }
  }
}

// Object URLs for the lifetime of the page, so switching tabs or opening
// the lightbox does not read the photo again.
const photoCache = new Map()

export function loadPhoto(fileId) {
  if (!photoCache.has(fileId)) {
    const request = (async () => {
      let blob = await readFromDevice(fileId)
      if (!blob) {
        blob = await limited(() => download(fileId))
        storeOnDevice(fileId, blob)
      }
      return URL.createObjectURL(blob)
    })()
    // Failures are not cached, so the next attempt tries again.
    request.catch(() => photoCache.delete(fileId))
    photoCache.set(fileId, request)
  }
  return photoCache.get(fileId)
}

// ---- taking back old photo links -------------------------------------------
//
// Older versions shared every diary photo as "Anyone with the link". Once
// per device, as soon as Drive is connected, this removes that sharing from
// all photos of the diary. Photos already private cost one request each.
const PRIVATE_KEY = 'bautagebuch.photosPrivate'
let sweep = null

async function allPhotoIds() {
  // Without a session the diary reads as empty, which would look "done".
  const { data: auth } = await supabase.auth.getSession()
  if (!auth.session) throw new Error('Nicht angemeldet.')
  const ids = new Set()
  const PAGE = 1000
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from('diary_entries')
      .select('id, photo_ids')
      .order('id')
      .range(from, from + PAGE - 1)
    if (error) throw error
    for (const row of data) for (const id of row.photo_ids ?? []) ids.add(id)
    if (data.length < PAGE) return [...ids]
  }
}

function sweepDone() {
  try {
    return localStorage.getItem(PRIVATE_KEY) === '1'
  } catch {
    return false
  }
}

export function makePhotosPrivate() {
  if (sweep || sweepDone() || !supabase || !validToken()) return sweep
  sweep = (async () => {
    const ids = await allPhotoIds()
    let failed = 0
    let next = 0
    const worker = async () => {
      while (next < ids.length) {
        const id = ids[next++]
        await unshareByLink(id).catch(() => {
          failed += 1
        })
      }
    }
    await Promise.all(Array.from({ length: MAX_DOWNLOADS }, worker))
    if (failed === 0) {
      try {
        localStorage.setItem(PRIVATE_KEY, '1')
      } catch {
        // Storage unavailable: it runs again next time, which is harmless.
      }
    }
    return { total: ids.length, failed }
  })()
  // Not remembered when it failed or stopped part-way, so it runs again.
  sweep.then(
    (result) => {
      if (result.failed) sweep = null
    },
    () => {
      sweep = null
    },
  )
  return sweep
}

drive.onConnect(() => {
  makePhotosPrivate()?.catch(() => {})
})
