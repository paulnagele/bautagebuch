import { useEffect, useState } from 'react'
import { saveJSON } from '../storage.js'
import { loadGoogleScript } from '../google.js'
import Overview from '../tabs/Overview.jsx'
import Diary from '../tabs/Diary.jsx'
import Finances from '../tabs/Finances.jsx'
import Timetable from '../tabs/Timetable.jsx'
import Contacts from '../tabs/Contacts.jsx'
import InstallHint from '../components/InstallHint.jsx'

const TABS = [
  { id: 'overview', label: 'Start', component: Overview },
  { id: 'diary', label: 'Tagebuch', component: Diary },
  { id: 'finances', label: 'Finanzen', component: Finances },
  { id: 'timetable', label: 'Zeitplan', component: Timetable },
  { id: 'contacts', label: 'Kontakte', component: Contacts },
]

function Home({ user, onLogout }) {
  // The app always opens on the start page.
  const [activeTab, setActiveTab] = useState(TABS[0].id)
  const [focusEntryId, setFocusEntryId] = useState(null)
  const [focusContactId, setFocusContactId] = useState(null)
  const current = TABS.find((tab) => tab.id === activeTab) ?? TABS[0]
  const ActiveComponent = current.component

  // Opens the diary with a filter, or scrolled to one entry (shown among
  // the entries of its kind). The diary reads its filter from storage
  // when it opens.
  function openDiary({ filter, openOnly = false, entry }) {
    saveJSON('diary.filter', entry ? entry.type : filter)
    saveJSON('diary.openOnly', entry ? false : openOnly)
    setFocusEntryId(entry?.id ?? null)
    setActiveTab('diary')
    window.scrollTo({ top: 0 })
  }

  // Opens the contacts, scrolled to one contact.
  function openContact(contact) {
    setFocusContactId(contact.id)
    setActiveTab('contacts')
    window.scrollTo({ top: 0 })
  }

  function chooseTab(id) {
    setFocusEntryId(null)
    setFocusContactId(null)
    setActiveTab(id)
  }

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
            onClick={() => chooseTab(tab.id)}
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
        <ActiveComponent
          user={user}
          onOpenDiary={openDiary}
          onOpenContact={openContact}
          focusEntryId={focusEntryId}
          focusContactId={focusContactId}
          onFocused={() => {
            setFocusEntryId(null)
            setFocusContactId(null)
          }}
        />
      </main>
    </div>
  )
}

export default Home
