// Diary photos are stored in a shared Google Drive folder. Each family
// member uploads them with their own Google account, so the folder must be
// shared with everyone (as Editor). The folder itself stays private; each
// photo is shared as "Anyone with the link", so it loads without any
// Google permission while the folder cannot be browsed.

import { config } from './config.js'
import { googleReady } from './google.js'

const SCOPE = 'https://www.googleapis.com/auth/drive'
const TOKEN_KEY = 'bautagebuch.driveToken'
const PHOTO_CACHE = 'bautagebuch-photos-v1'
const API = 'https://www.googleapis.com/drive/v3/files'
const UPLOAD_API = 'https://www.googleapis.com/upload/drive/v3/files'

export const driveFolderUrl = `https://drive.google.com/drive/folders/${config.driveFolderId}`

// ---- access token ---------------------------------------------------------

let token = readStoredToken()

function readStoredToken() {
  try {
    const stored = JSON.parse(localStorage.getItem(TOKEN_KEY))
    return stored?.expiresAt > Date.now() ? stored : null
  } catch {
    return null
  }
}

function setToken(next) {
  token = next
  try {
    // localStorage, so a reload or a second tab keeps working until the
    // token runs out instead of asking for Drive access again.
    if (next) localStorage.setItem(TOKEN_KEY, JSON.stringify(next))
    else localStorage.removeItem(TOKEN_KEY)
  } catch {
    // Storage unavailable: keep the token in memory only.
  }
}

function validToken() {
  // Treat tokens as expired a minute early to avoid failing mid-upload.
  return token && token.expiresAt - 60_000 > Date.now() ? token.accessToken : null
}

// Called on sign-out: forgets the token and the photos kept on this device.
export function disconnectDrive() {
  setToken(null)
  photoCache.clear()
  if (window.caches) caches.delete(PHOTO_CACHE).catch(() => {})
}

// Opens Google's consent popup (it closes itself immediately once access
// was granted before). Must be called directly from a click handler, or
// the browser blocks the popup.
export function connectDrive(email) {
  const existing = validToken()
  if (existing) return Promise.resolve(existing)
  if (!googleReady()) {
    return Promise.reject(new Error('Google is still loading. Please try again in a moment.'))
  }
  return new Promise((resolve, reject) => {
    const client = window.google.accounts.oauth2.initTokenClient({
      client_id: config.googleClientId,
      scope: SCOPE,
      login_hint: email,
      callback: (response) => {
        if (response.error) {
          reject(new Error(`Google Drive access was not granted (${response.error}).`))
          return
        }
        if (!window.google.accounts.oauth2.hasGrantedAllScopes(response, SCOPE)) {
          reject(new Error('Please allow access to Google Drive to use photos.'))
          return
        }
        setToken({
          accessToken: response.access_token,
          expiresAt: Date.now() + Number(response.expires_in) * 1000,
        })
        resolve(response.access_token)
      },
      error_callback: (err) => {
        reject(
          new Error(
            err?.type === 'popup_failed_to_open'
              ? 'The Google popup was blocked. Please allow popups for this site.'
              : 'Google Drive sign-in was cancelled.',
          ),
        )
      },
    })
    client.requestAccessToken({ prompt: '' })
  })
}

// ---- API calls ------------------------------------------------------------

async function driveFetch(url, options = {}) {
  const accessToken = validToken()
  if (!accessToken) throw new Error('Not connected to Google Drive.')
  const response = await fetch(url, {
    ...options,
    headers: { ...options.headers, Authorization: `Bearer ${accessToken}` },
  })
  if (response.status === 401) {
    setToken(null)
    throw new Error('The Google Drive session expired. Please connect again.')
  }
  if (!response.ok) {
    let detail = ''
    try {
      detail = (await response.json()).error?.message ?? ''
    } catch {
      // Not JSON.
    }
    const error = new Error(detail || `Google Drive request failed (${response.status}).`)
    error.status = response.status
    throw error
  }
  return response
}

// Makes one photo viewable by anyone with its link (not the folder).
function shareByLink(fileId) {
  return driveFetch(`${API}/${encodeURIComponent(fileId)}/permissions?supportsAllDrives=true`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ role: 'reader', type: 'anyone' }),
  })
}

export async function uploadPhoto(blob, name) {
  const boundary = `bautagebuch-${Math.random().toString(36).slice(2)}`
  const metadata = {
    name,
    mimeType: blob.type || 'image/jpeg',
    parents: [config.driveFolderId],
  }
  const body = new Blob([
    `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n`,
    JSON.stringify(metadata),
    `\r\n--${boundary}\r\nContent-Type: ${metadata.mimeType}\r\n\r\n`,
    blob,
    `\r\n--${boundary}--`,
  ])
  const response = await driveFetch(
    `${UPLOAD_API}?uploadType=multipart&supportsAllDrives=true&fields=id`,
    {
      method: 'POST',
      headers: { 'Content-Type': `multipart/related; boundary=${boundary}` },
      body,
    },
  )
  const { id } = await response.json()
  await shareByLink(id).catch(() => {}) // still viewable via the fallback
  // The uploader already has the photo: keep it so it shows right away.
  photoCache.set(id, Promise.resolve(URL.createObjectURL(blob)))
  storeOnDevice(id, blob)
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
    super('Connect Google Drive to load this photo.')
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

// Public link for a photo shared by link. Plain <img> loading,
// no Google sign-in or permission needed.
export function publicPhotoUrl(fileId) {
  return `https://drive.google.com/thumbnail?id=${encodeURIComponent(fileId)}&sz=w2000`
}

// Fallback when the public link fails (e.g. an older photo not shared by
// link yet): download with the person's own Drive access, and share it by
// link so it loads for everyone from then on.
async function download(fileId) {
  for (let attempt = 0; ; attempt += 1) {
    if (!validToken()) throw new NeedsDriveError()
    try {
      const response = await driveFetch(
        `${API}/${encodeURIComponent(fileId)}?alt=media&supportsAllDrives=true`,
      )
      shareByLink(fileId).catch(() => {})
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
