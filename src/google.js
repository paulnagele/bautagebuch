// Loads Google Identity Services, used for "Sign in with Google" and for
// getting access tokens for Google Drive and Calendar.
// https://developers.google.com/identity/gsi/web

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

// ---- access tokens ---------------------------------------------------------
//
// Access to one Google API (Drive, Calendar) with the person's own Google
// account. Each API asks for its own permission, so connecting the
// calendar does not ask for Drive access and the other way round.
// `name` is used in messages, e.g. "Google Drive".
export function createGoogleAccess({ scope, storageKey, name, clientId }) {
  let token = readStoredToken()

  function readStoredToken() {
    try {
      const stored = JSON.parse(localStorage.getItem(storageKey))
      return stored?.expiresAt > Date.now() ? stored : null
    } catch {
      return null
    }
  }

  function setToken(next) {
    token = next
    try {
      // localStorage, so a reload or a second tab keeps working until the
      // token runs out instead of asking for access again.
      if (next) localStorage.setItem(storageKey, JSON.stringify(next))
      else localStorage.removeItem(storageKey)
    } catch {
      // Storage unavailable: keep the token in memory only.
    }
  }

  function validToken() {
    // Treat tokens as expired a minute early to avoid failing mid-request.
    return token && token.expiresAt - 60_000 > Date.now() ? token.accessToken : null
  }

  // Opens Google's consent popup (it closes itself immediately once access
  // was granted before). Must be called directly from a click handler, or
  // the browser blocks the popup.
  function connect(email) {
    const existing = validToken()
    if (existing) return Promise.resolve(existing)
    if (!googleReady()) {
      return Promise.reject(new Error('Google wird noch geladen. Bitte gleich noch einmal versuchen.'))
    }
    return new Promise((resolve, reject) => {
      const client = window.google.accounts.oauth2.initTokenClient({
        client_id: clientId,
        scope,
        login_hint: email,
        callback: (response) => {
          if (response.error) {
            reject(new Error(`Der Zugriff auf ${name} wurde nicht erlaubt (${response.error}).`))
            return
          }
          if (!window.google.accounts.oauth2.hasGrantedAllScopes(response, scope)) {
            reject(new Error(`Bitte den Zugriff auf ${name} erlauben.`))
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
                ? 'Das Google-Fenster wurde blockiert. Bitte Pop-ups für diese Seite erlauben.'
                : `Die Anmeldung bei ${name} wurde abgebrochen.`,
            ),
          )
        },
      })
      client.requestAccessToken({ prompt: '' })
    })
  }

  async function apiFetch(url, options = {}) {
    const accessToken = validToken()
    if (!accessToken) throw new Error(`Nicht mit ${name} verbunden.`)
    const response = await fetch(url, {
      ...options,
      headers: { ...options.headers, Authorization: `Bearer ${accessToken}` },
    })
    if (response.status === 401) {
      setToken(null)
      throw new Error(`Die Sitzung bei ${name} ist abgelaufen. Bitte erneut verbinden.`)
    }
    if (!response.ok) {
      let detail = ''
      try {
        detail = (await response.json()).error?.message ?? ''
      } catch {
        // Not JSON.
      }
      const error = new Error(detail || `${name}-Anfrage fehlgeschlagen (${response.status}).`)
      error.status = response.status
      throw error
    }
    return response
  }

  // Takes a token from a consent popup that asked for several APIs at
  // once (connectTogether); false if this API's access was not granted.
  function adopt(response) {
    if (!window.google.accounts.oauth2.hasGrantedAllScopes(response, scope)) return false
    setToken({
      accessToken: response.access_token,
      expiresAt: Date.now() + Number(response.expires_in) * 1000,
    })
    return true
  }

  return {
    name,
    scope,
    clientId,
    adopt,
    connect,
    fetch: apiFetch,
    connected: () => Boolean(validToken()),
    disconnect: () => setToken(null),
  }
}

// Connects several Google APIs (e.g. Calendar and Drive) with one consent
// popup. Opening a second popup right after the first fails, because the
// browser counts only the first one as caused by the click. Must be called
// directly from a click handler. Resolves to one error message per API
// ('' when connected), in the order given; never rejects.
export async function connectTogether(accesses, email) {
  const missing = accesses.filter((access) => !access.connected())
  if (missing.length <= 1) {
    return Promise.all(
      accesses.map((access) => access.connect(email).then(() => '', (err) => err.message)),
    )
  }
  if (!googleReady()) {
    const message = 'Google wird noch geladen. Bitte gleich noch einmal versuchen.'
    return accesses.map((access) => (access.connected() ? '' : message))
  }
  const failure = await new Promise((resolve) => {
    const client = window.google.accounts.oauth2.initTokenClient({
      client_id: missing[0].clientId,
      scope: missing.map((access) => access.scope).join(' '),
      login_hint: email,
      callback: (response) => {
        if (response.error) {
          resolve((name) => `Der Zugriff auf ${name} wurde nicht erlaubt (${response.error}).`)
          return
        }
        const refused = missing.filter((access) => !access.adopt(response))
        resolve(refused.length ? (name) => `Bitte den Zugriff auf ${name} erlauben.` : null)
      },
      error_callback: (err) => {
        resolve(
          err?.type === 'popup_failed_to_open'
            ? () => 'Das Google-Fenster wurde blockiert. Bitte Pop-ups für diese Seite erlauben.'
            : (name) => `Die Anmeldung bei ${name} wurde abgebrochen.`,
        )
      },
    })
    client.requestAccessToken({ prompt: '' })
  })
  return accesses.map((access) =>
    access.connected() ? '' : failure ? failure(access.name) : `Nicht mit ${access.name} verbunden.`,
  )
}
