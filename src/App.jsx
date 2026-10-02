import Login from './pages/Login.jsx'
import Home from './pages/Home.jsx'
import { usePersistentState } from './storage.js'
import { GOOGLE_CLIENT_ID } from './googleAuth.js'

function App() {
  const [user, setUser] = usePersistentState('bautagebuch.session', null)

  // Once Google sign-in is configured, sessions from the old
  // email/password placeholder or demo mode are no longer valid.
  const signedIn = user && (!GOOGLE_CLIENT_ID || user.provider === 'google')

  if (!signedIn) {
    return <Login onLogin={setUser} />
  }

  return <Home user={user} onLogout={() => setUser(null)} />
}

export default App
