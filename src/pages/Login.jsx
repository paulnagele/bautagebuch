import { useEffect, useRef, useState } from 'react'
import { config } from '../config.js'
import { loadGoogleScript } from '../google.js'
import { supabase } from '../supabase.js'

function Login({ notice, onSignIn }) {
  const buttonRef = useRef(null)
  const [error, setError] = useState('')
  const [status, setStatus] = useState('loading') // loading | ready | signing-in

  useEffect(() => {
    let cancelled = false

    async function handleCredential(response) {
      setError('')
      setStatus('signing-in')
      onSignIn()
      const { error: signInError } = await supabase.auth.signInWithIdToken({
        provider: 'google',
        token: response.credential,
      })
      if (signInError) {
        setError(`Anmeldung fehlgeschlagen: ${signInError.message}`)
        setStatus('ready')
      }
      // On success the session listener in App takes over.
    }

    loadGoogleScript()
      .then((google) => {
        if (cancelled || !buttonRef.current) return
        google.accounts.id.initialize({
          client_id: config.googleClientId,
          callback: handleCredential,
          ux_mode: 'popup',
        })
        google.accounts.id.renderButton(buttonRef.current, {
          type: 'standard',
          theme: 'outline',
          size: 'large',
          text: 'signin_with',
          shape: 'rectangular',
          locale: 'de',
          width: 280,
        })
        setStatus('ready')
      })
      .catch((err) => {
        if (cancelled) return
        setError(err.message)
        setStatus('ready')
      })

    return () => {
      cancelled = true
    }
  }, [onSignIn])

  return (
    <main className="login-page">
      <div className="login-card">
        <h1>Bautagebuch</h1>
        <p className="subtitle">Mit deinem Google-Konto anmelden</p>

        <div className="google-button" ref={buttonRef} hidden={status === 'signing-in'} />
        {status === 'loading' && <p className="muted">Google-Anmeldung wird geladen…</p>}
        {status === 'signing-in' && <p className="muted">Anmeldung läuft…</p>}

        {(error || notice) && (
          <p className="error" role="alert">
            {error || notice}
          </p>
        )}
      </div>
    </main>
  )
}

export default Login
