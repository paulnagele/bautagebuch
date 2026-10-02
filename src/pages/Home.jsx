import { usePersistentState } from '../storage.js'
import Diary from '../tabs/Diary.jsx'
import Finances from '../tabs/Finances.jsx'
import Timetable from '../tabs/Timetable.jsx'

const TABS = [
  { id: 'diary', label: 'Diary', component: Diary },
  { id: 'finances', label: 'Finances', component: Finances },
  { id: 'timetable', label: 'Timetable', component: Timetable },
]

function Home({ user, onLogout }) {
  const [activeTab, setActiveTab] = usePersistentState(
    'bautagebuch.activeTab',
    TABS[0].id,
  )
  const current = TABS.find((tab) => tab.id === activeTab) ?? TABS[0]
  const ActiveComponent = current.component
  // Keep each user's data separate.
  const storagePrefix = `bautagebuch.${user.email}`

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
            Sign out
          </button>
        </div>
      </header>

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
        <ActiveComponent storageKey={`${storagePrefix}.${current.id}`} />
      </main>
    </div>
  )
}

export default Home
