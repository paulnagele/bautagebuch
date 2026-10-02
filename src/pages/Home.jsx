import { useEffect } from 'react'
import { usePersistentState } from '../storage.js'
import { loadGoogleScript } from '../google.js'
import Diary from '../tabs/Diary.jsx'
import Finances from '../tabs/Finances.jsx'
import Timetable from '../tabs/Timetable.jsx'
import Contacts from '../tabs/Contacts.jsx'
import InstallHint from '../components/InstallHint.jsx'

const TABS = [
  { id: 'diary', label: 'Tagebuch', component: Diary },
  { id: 'finances', label: 'Finanzen', component: Finances },
  { id: 'timetable', label: 'Zeitplan', component: Timetable },
  { id: 'contacts', label: 'Kontakte', component: Contacts },
]

function Home({ user, onLogout }) {
  const [activeTab, setActiveTab] = usePersistentState(
    'bautagebuch.activeTab',
    TABS[0].id,
  )
  const current = TABS.find((tab) => tab.id === activeTab) ?? TABS[0]
  const ActiveComponent = current.component

  // Google's script is needed to connect Google Drive for photos. Load it
  // early so the "connect" click can open the popup right away.
  useEffect(() => {
    loadGoogleScript().catch(() => {})
  }, [])

  return (
    <div className="app-shell">
      <header className="app-header">
        <h1>Bautagebuch</h1>
        <div className="user-menu">
          {user.picture && (
            <img className="avatar" src={user.picture} alt="" referrerPolicy="no-referrer" />
          )}
          <span className="user-email" title={user.email}>
            {user.name ?? user.email}
          </span>
          <button type="button" className="secondary" onClick={onLogout}>
            Abmelden
          </button>
        </div>
      </header>

      <InstallHint />

      <nav className="tabs" role="tablist">
        {TABS.map((tab) => (
          <button
            key={tab.id}
            type="button"
            role="tab"
            id={`tab-${tab.id}`}
            aria-selected={tab.id === current.id}
            aria-controls={`panel-${tab.id}`}
            className={tab.id === current.id ? 'tab active' : 'tab'}
            onClick={() => setActiveTab(tab.id)}
          >
            {tab.label}
          </button>
        ))}
      </nav>

      <main
        className="tab-panel"
        role="tabpanel"
        id={`panel-${current.id}`}
        aria-labelledby={`tab-${current.id}`}
      >
        <ActiveComponent user={user} />
      </main>
    </div>
  )
}

export default Home
