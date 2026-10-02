// Loads Google Identity Services, used for "Sign in with Google" and for
// getting a Google Drive access token. https://developers.google.com/identity/gsi/web

const SCRIPT_URL = 'https://accounts.google.com/gsi/client'
let scriptPromise = null

export function googleReady() {
  return Boolean(window.google?.accounts?.id && window.google?.accounts?.oauth2)
}

export function loadGoogleScript() {
  if (googleReady()) return Promise.resolve(window.google)
  if (!scriptPromise) {
    scriptPromise = new Promise((resolve, reject) => {
      const script = document.createElement('script')
      script.src = SCRIPT_URL
      script.async = true
      script.onload = () => resolve(window.google)
      script.onerror = () => {
        scriptPromise = null
        script.remove()
        reject(new Error('Google-Anmeldung konnte nicht geladen werden. Bitte die Internetverbindung prüfen.'))
      }
      document.head.appendChild(script)
    })
  }
  return scriptPromise
}
