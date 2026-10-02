// Diary photos are stored in a shared Google Drive folder. Each family
// member uploads and views them with their own Google account, so the
// folder must be shared with everyone (as Editor).

import { useSyncExternalStore } from 'react'
import { config } from './config.js'
import { googleReady } from './google.js'

const SCOPE = 'https://www.googleapis.com/auth/drive'
const TOKEN_KEY = 'bautagebuch.driveToken'
const API = 'https://www.googleapis.com/drive/v3/files'
const UPLOAD_API = 'https://www.googleapis.com/upload/drive/v3/files'

export const driveFolderUrl = `https://drive.google.com/drive/folders/${config.driveFolderId}`

// ---- access token ---------------------------------------------------------

let token = readStoredToken()
const listeners = new Set()

function readStoredToken() {
  try {
    const stored = JSON.parse(sessionStorage.getItem(TOKEN_KEY))
    return stored?.expiresAt > Date.now() ? stored : null
  } catch {
    return null
  }
}

function setToken(next) {
  token = next
  try {
    if (next) sessionStorage.setItem(TOKEN_KEY, JSON.stringify(next))
    else sessionStorage.removeItem(TOKEN_KEY)
  } catch {
    // Storage unavailable: keep the token in memory only.
  }
  listeners.forEach((listener) => listener())
}

function validToken() {
  // Treat tokens as expired a minute early to avoid failing mid-upload.
  return token && token.expiresAt - 60_000 > Date.now() ? token.accessToken : null
}

export function disconnectDrive() {
  setToken(null)
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

function subscribe(listener) {
  listeners.add(listener)
  // Re-render when the token runs out.
  const timer = setInterval(listener, 30_000)
  return () => {
    listeners.delete(listener)
    clearInterval(timer)
  }
}

export function useDriveConnected() {
  return useSyncExternalStore(subscribe, () => Boolean(validToken()))
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
  return id
}

// Photos are cached for the lifetime of the page so switching tabs does
// not download them again.
const photoCache = new Map()

export function loadPhoto(fileId) {
  if (!photoCache.has(fileId)) {
    const request = driveFetch(`${API}/${encodeURIComponent(fileId)}?alt=media&supportsAllDrives=true`)
      .then((response) => response.blob())
      .then((blob) => URL.createObjectURL(blob))
    request.catch(() => photoCache.delete(fileId))
    photoCache.set(fileId, request)
  }
  return photoCache.get(fileId)
}
