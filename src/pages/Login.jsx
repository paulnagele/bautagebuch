import { useEffect, useRef, useState } from 'react'
import { GOOGLE_CLIENT_ID, loadGoogleScript, userFromCredential } from '../googleAuth.js'

function Login({ onLogin }) {
  const buttonRef = useRef(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(Boolean(GOOGLE_CLIENT_ID))

  useEffect(() => {
    if (!GOOGLE_CLIENT_ID) return
    let cancelled = false

    loadGoogleScript()
      .then((google) => {
        if (cancelled || !buttonRef.current) return
        google.accounts.id.initialize({
          client_id: GOOGLE_CLIENT_ID,
          callback: (response) => {
            try {
              onLogin(userFromCredential(response.credential))
            } catch (err) {
              setError(err.message)
            }
          },
          ux_mode: 'popup',
        })
        google.accounts.id.renderButton(buttonRef.current, {
          type: 'standard',
          theme: 'outline',
          size: 'large',
          text: 'signin_with',
          shape: 'rectangular',
          width: 280,
        })
        setLoading(false)
      })
      .catch((err) => {
        if (cancelled) return
        setError(err.message)
        setLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [onLogin])

  return (
    <main className="login-page">
      <div className="login-card">
        <h1>Bautagebuch</h1>
        <p className="subtitle">Sign in to your account</p>

        {GOOGLE_CLIENT_ID ? (
          <>
            <div className="google-button" ref={buttonRef} />
            {loading && <p className="muted">Loading Google sign-in…</p>}
          </>
        ) : (
          <div className="notice">
            <p>
              Google sign-in is not configured yet. Set <code>VITE_GOOGLE_CLIENT_ID</code> (see
              the README).
            </p>
            <button
              type="button"
              className="secondary"
              onClick={() =>
                onLogin({ email: 'demo@example.com', name: 'Demo user', provider: 'demo' })
              }
            >
              Continue in demo mode
            </button>
          </div>
        )}

        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
      </div>
    </main>
  )
}

export default Login
