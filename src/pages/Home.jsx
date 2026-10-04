import { Suspense, lazy, useEffect, useState } from 'react'
import { newId, saveJSON } from '../storage.js'
import { useSwipeTabs } from '../useSwipeTabs.js'
import { loadGoogleScript } from '../google.js'
import { clearShareParam, doneWithShared, takeShared } from '../share.js'
import { emptyForm as emptyDiaryForm } from '../diaryForm.js'
import Overview from '../tabs/Overview.jsx'
import Diary from '../tabs/Diary.jsx'
import Contacts from '../tabs/Contacts.jsx'
import InstallHint from '../components/InstallHint.jsx'
import UpdateHint from '../components/UpdateHint.jsx'
import DialogProvider from '../components/DialogProvider.jsx'

// Finanzen, Zeitplan and Dokumente are loaded when first opened, so the
// app starts with less to download.
const Finances = lazyTab(() => import('../tabs/Finances.jsx'))
const Timetable = lazyTab(() => import('../tabs/Timetable.jsx'))
const Documents = lazyTab(() => import('../tabs/Documents.jsx'))

// A tab loaded on demand. If its file can't be fetched (offline, or the
// app was updated meanwhile and the old file is gone), the tab says so.
function lazyTab(load) {
  return lazy(() =>
    load().catch(() => ({
      default: function TabUnavailable() {
        return (
          <section className="tab-content">
            <p className="error" role="alert">
              Dieser Bereich konnte nicht geladen werden. Bitte die Internetverbindung prüfen und
              die App neu laden.
            </p>
            <button type="button" onClick={() => window.location.reload()}>
              Neu laden
            </button>
          </section>
        )
      },
    })),
  )
}

const TABS = [
  { id: 'overview', label: 'Home', component: Overview },
  { id: 'diary', label: 'Tagebuch', component: Diary },
  { id: 'finances', label: 'Finanzen', component: Finances },
  { id: 'timetable', label: 'Zeitplan', component: Timetable },
  { id: 'contacts', label: 'Kontakte', component: Contacts },
  { id: 'documents', label: 'Dokumente', component: Documents },
]

function Home({ user, onLogout }) {
  // The app always opens on the start page.
  const [activeTab, setActiveTab] = useState(TABS[0].id)
  const [focusEntryId, setFocusEntryId] = useState(null)
  const [focusContactId, setFocusContactId] = useState(null)
  // Which way the last swipe went, so the new tab slides in from that side.
  const [slide, setSlide] = useState(null)
  const current = TABS.find((tab) => tab.id === activeTab) ?? TABS[0]
  const ActiveComponent = current.component
  // The diary form's draft (new or edited entry) is kept here, so it is
  // still there after switching tabs, e.g. by an accidental swipe.
  const [diaryForm, setDiaryForm] = useState(emptyDiaryForm)
  const [diaryEditingId, setDiaryEditingId] = useState(null)
  // Whether the form is unfolded (it is folded behind "+ Neuer Eintrag").
  const [diaryFormOpen, setDiaryFormOpen] = useState(false)
  const diaryDraft = {
    form: diaryForm,
    setForm: setDiaryForm,
    editingId: diaryEditingId,
    setEditingId: setDiaryEditingId,
    open: diaryFormOpen,
    setOpen: setDiaryFormOpen,
  }

  // Opens the diary with a filter, or scrolled to one entry (shown among
  // the entries of its kind). The diary reads its filter from storage
  // when it opens.
  function openDiary({ filter, openOnly = false, entry }) {
    saveJSON('diary.filter', entry ? entry.type : filter)
    saveJSON('diary.openOnly', entry ? false : openOnly)
    setFocusEntryId(entry?.id ?? null)
    setSlide(null)
    setActiveTab('diary')
    window.scrollTo({ top: 0 })
  }

  // Opens the contacts, scrolled to one contact.
  function openContact(contact) {
    setFocusContactId(contact.id)
    setSlide(null)
    setActiveTab('contacts')
    window.scrollTo({ top: 0 })
  }

  function chooseTab(id) {
    setFocusEntryId(null)
    setFocusContactId(null)
    setSlide(null)
    setActiveTab(id)
  }

  // On phones, swiping left or right moves to the next or previous tab.
  useSwipeTabs((step) => {
    const next = TABS[TABS.indexOf(current) + step]
    if (!next) return
    chooseTab(next.id)
    setSlide(step > 0 ? 'next' : 'prev')
    window.scrollTo({ top: 0 })
  })

  // Google's script is needed to connect Google Drive for photos. Load it
  // early so the "connect" click can open the popup right away.
  useEffect(() => {
    loadGoogleScript().catch(() => {})
  }, [])

  // Shared from another app ("Teilen → Bautagebuch"): open a new diary
  // entry with the pictures as photos, the other files attached and any
  // shared text as its text. It starts as a Status entry; the kind can be
  // changed in the form (e.g. Ausgabe for an invoice).
  useEffect(() => {
    let cancelled = false
    takeShared().then((shared) => {
      clearShareParam()
      if (cancelled || !shared) return
      const photos = []
      const files = []
      for (const file of shared.files) {
        if (file.type.startsWith('image/')) photos.push({ key: newId(), blob: file })
        else files.push({ key: newId(), blob: file, name: file.name })
      }
      doneWithShared()
      // Added to the draft of a new entry (nothing is being edited yet, as
      // the app has just opened).
      setDiaryForm((form) => ({
        ...form,
        work: [form.work.trim(), shared.text].filter(Boolean).join('\n\n'),
        photos: [...form.photos, ...photos],
        files: [...form.files, ...files],
      }))
      setDiaryFormOpen(true)
      setFocusEntryId(null)
      setSlide(null)
      setActiveTab('diary')
    })
    return () => {
      cancelled = true
    }
  }, [])

  return (
    <DialogProvider>
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

        <UpdateHint />
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
          key={current.id}
          className={slide ? `tab-panel slide-${slide}` : 'tab-panel'}
          role="tabpanel"
          id={`panel-${current.id}`}
          aria-labelledby={`tab-${current.id}`}
        >
          <Suspense fallback={<p className="empty">Wird geladen…</p>}>
            <ActiveComponent
              user={user}
              onOpenDiary={openDiary}
              onOpenContact={openContact}
              onOpenTab={chooseTab}
              focusEntryId={focusEntryId}
              focusContactId={focusContactId}
              diaryDraft={diaryDraft}
              onFocused={() => {
                setFocusEntryId(null)
                setFocusContactId(null)
              }}
            />
          </Suspense>
        </main>
      </div>
    </DialogProvider>
  )
}

export default Home
