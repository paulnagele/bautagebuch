import { useCallback, useEffect, useState } from 'react'
import Login from './pages/Login.jsx'
import Home from './pages/Home.jsx'
import SetupNeeded from './pages/SetupNeeded.jsx'
import { missingConfig } from './config.js'
import { supabase } from './supabase.js'
import { disconnectDrive } from './drive.js'
import { disconnectCalendar } from './calendar.js'
import { forgetSettings } from './settings.js'
import { forgetCollections } from './useCollection.js'

function userFromSession(session) {
  const { id, email, user_metadata: meta = {} } = session.user
  return {
    id,
    email,
    name: meta.full_name || meta.name || email,
    picture: meta.avatar_url || meta.picture || null,
  }
}

function App() {
  if (missingConfig.length > 0) {
    return <SetupNeeded missing={missingConfig} />
  }
  return <AuthGate />
}

function AuthGate() {
  // undefined = still restoring a saved session, null = signed out
  const [session, setSession] = useState(undefined)
  const [checkedUserId, setCheckedUserId] = useState(null)
  const [notice, setNotice] = useState('')
  const userId = session?.user.id ?? null
  const clearNotice = useCallback(() => setNotice(''), [])

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session))
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, next) => {
      // Signed out, also when the session ran out: drop the loaded data.
      if (!next) forgetCollections()
      setSession(next)
    })
    return () => subscription.unsubscribe()
  }, [])

  // Only members (public.members) may use the app. The database enforces
  // this anyway; checking here gives a clear message instead of empty tabs.
  useEffect(() => {
    if (!userId) return
    let cancelled = false
    supabase.rpc('is_member').then(({ data, error }) => {
      if (cancelled) return
      if (!error && data === false) {
        setNotice(
          `${session.user.email} ist noch kein Mitglied dieses Bautagebuchs. ` +
            'Bitte den Projektinhaber, deine E-Mail-Adresse hinzuzufügen.',
        )
        supabase.auth.signOut()
        return
      }
      // On a network error, continue: the tabs show their own errors.
      setCheckedUserId(userId)
    })
    return () => {
      cancelled = true
    }
  }, [userId, session])

  async function handleLogout() {
    disconnectDrive()
    disconnectCalendar()
    forgetSettings()
    await supabase.auth.signOut()
  }

  if (session === undefined || (session && checkedUserId !== userId)) {
    return <p className="loading-screen">Wird geladen…</p>
  }
  if (!session) {
    return <Login notice={notice} onSignIn={clearNotice} />
  }
  return <Home user={userFromSession(session)} onLogout={handleLogout} />
}

export default App
