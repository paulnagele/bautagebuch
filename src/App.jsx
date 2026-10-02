import { useState } from 'react'
import Login from './pages/Login.jsx'
import Home from './pages/Home.jsx'

function App() {
  const [user, setUser] = useState(null)

  if (!user) {
    return <Login onLogin={setUser} />
  }

  return <Home user={user} onLogout={() => setUser(null)} />
}

export default App
