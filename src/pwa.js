// Registers the service worker that makes the app installable on phones
// (see public/sw.js). Only in the built app: in `vite dev` a cached page
// would get in the way.

export function registerServiceWorker() {
  if (!import.meta.env.PROD || !('serviceWorker' in navigator)) return
  window.addEventListener('load', () => {
    navigator.serviceWorker
      .register(`${import.meta.env.BASE_URL}sw.js`)
      .catch(() => {
        // Not fatal: the app works the same, it just can't be installed.
      })
  })
}

// Chrome/Android fire `beforeinstallprompt` once, possibly before React
// has mounted, so keep the event here until the hint asks for it.
let installPrompt = null
const listeners = new Set()

if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault()
    installPrompt = event
    listeners.forEach((listener) => listener())
  })
  window.addEventListener('appinstalled', () => {
    installPrompt = null
    listeners.forEach((listener) => listener())
  })
}

export function getInstallPrompt() {
  return installPrompt
}

export function onInstallPromptChange(listener) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export async function promptInstall() {
  const event = installPrompt
  if (!event) return
  installPrompt = null
  listeners.forEach((listener) => listener())
  event.prompt()
  await event.userChoice.catch(() => {})
}

export function isInstalled() {
  return (
    window.matchMedia?.('(display-mode: standalone)').matches ||
    window.navigator.standalone === true
  )
}

// iPhone/iPad Safari has no install prompt; people add the app via the
// share menu instead. (iPadOS reports itself as a Mac with touch.)
export function isIos() {
  const ua = window.navigator.userAgent
  return (
    /iPhone|iPad|iPod/.test(ua) ||
    (/Macintosh/.test(ua) && window.navigator.maxTouchPoints > 1)
  )
}
