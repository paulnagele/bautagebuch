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

// ---- new versions ---------------------------------------------------------
//
// An installed app can stay open in the background for days and keep
// running the old code after a new version was published. When the app
// comes back to the foreground, check (at most every few minutes) whether
// the published page still loads this very script file; its name changes
// with every build. If not, a newer version is out.

const UPDATE_CHECK_GAP_MS = 5 * 60 * 1000

async function newerVersionOut() {
  const script = new URL(import.meta.url).pathname
  const name = script.slice(script.lastIndexOf('/') + 1)
  // The query keeps the service worker from answering with its stored copy.
  const response = await fetch(`${import.meta.env.BASE_URL}?version-check=${Date.now()}`, {
    cache: 'no-store',
  })
  if (!response.ok) return false
  const html = await response.text()
  return html.includes('/assets/') && !html.includes(name)
}

// Calls onUpdate() once a newer version is out; returns a function that
// stops watching. Only in the built app.
export function watchForUpdates(onUpdate) {
  if (!import.meta.env.PROD) return () => {}
  let lastCheck = Date.now()
  let found = false
  const check = () => {
    if (found || document.visibilityState !== 'visible') return
    if (Date.now() - lastCheck < UPDATE_CHECK_GAP_MS) return
    lastCheck = Date.now()
    newerVersionOut().then(
      (newer) => {
        if (newer) {
          found = true
          onUpdate()
        }
      },
      () => {}, // Offline: try again next time.
    )
  }
  document.addEventListener('visibilitychange', check)
  window.addEventListener('focus', check)
  const timer = setInterval(check, UPDATE_CHECK_GAP_MS)
  return () => {
    document.removeEventListener('visibilitychange', check)
    window.removeEventListener('focus', check)
    clearInterval(timer)
  }
}
