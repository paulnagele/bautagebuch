// "Sign in with Google" via Google Identity Services.
// https://developers.google.com/identity/gsi/web
//
// The Client ID is not a secret; it is set at build time through the
// VITE_GOOGLE_CLIENT_ID environment variable (see README).

export const GOOGLE_CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID ?? ''

// Optional comma-separated allowlist, e.g. "anna@gmail.com,ben@gmail.com".
// Without a backend this is only a front-door check, not real security.
const ALLOWED_EMAILS = (import.meta.env.VITE_ALLOWED_EMAILS ?? '')
  .split(',')
  .map((e) => e.trim().toLowerCase())
  .filter(Boolean)

const SCRIPT_URL = 'https://accounts.google.com/gsi/client'
let scriptPromise = null

export function loadGoogleScript() {
  if (window.google?.accounts?.id) return Promise.resolve(window.google)
  if (!scriptPromise) {
    scriptPromise = new Promise((resolve, reject) => {
      const script = document.createElement('script')
      script.src = SCRIPT_URL
      script.async = true
      script.onload = () => resolve(window.google)
      script.onerror = () => {
        scriptPromise = null
        script.remove()
        reject(new Error('Could not load Google sign-in. Check your internet connection.'))
      }
      document.head.appendChild(script)
    })
  }
  return scriptPromise
}

function decodeJwtPayload(token) {
  const part = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')
  const json = decodeURIComponent(
    atob(part)
      .split('')
      .map((c) => '%' + c.charCodeAt(0).toString(16).padStart(2, '0'))
      .join(''),
  )
  return JSON.parse(json)
}

// Turns the credential Google hands back into the app's user object.
// Throws with a readable message if the account may not sign in.
export function userFromCredential(credential) {
  const claims = decodeJwtPayload(credential)
  const email = String(claims.email ?? '').toLowerCase()
  if (!email || !claims.email_verified) {
    throw new Error('Your Google account has no verified email address.')
  }
  if (ALLOWED_EMAILS.length > 0 && !ALLOWED_EMAILS.includes(email)) {
    throw new Error(`${email} does not have access to this Bautagebuch.`)
  }
  return {
    email,
    name: claims.name ?? email,
    picture: claims.picture ?? null,
    provider: 'google',
  }
}
