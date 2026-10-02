import Login from './pages/Login.jsx'
import Home from './pages/Home.jsx'
import { usePersistentState } from './storage.js'

function App() {
  const [user, setUser] = usePersistentState('bautagebuch.session', null)

  if (!user) {
    return <Login onLogin={setUser} />
  }

  return <Home user={user} onLogout={() => setUser(null)} />
}

export default App
