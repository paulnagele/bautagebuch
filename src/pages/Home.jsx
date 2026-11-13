import { Suspense, lazy, useCallback, useEffect, useRef, useState } from 'react'
import { newId, saveJSON } from '../storage.js'
import { useSwipeTabs } from '../useSwipeTabs.js'
import { loadGoogleScript } from '../google.js'
import { clearShareParam, doneWithShared, takeShared } from '../share.js'
import { emptyForm as emptyDiaryForm } from '../diaryForm.js'
import { loadDraft, saveDraft } from '../diaryDraft.js'
import Overview from '../tabs/Overview.jsx'
import Diary from '../tabs/Diary.jsx'
import Contacts from '../tabs/Contacts.jsx'
import InstallHint from '../components/InstallHint.jsx'
import SetupHint from '../components/SetupHint.jsx'
import UpdateHint from '../components/UpdateHint.jsx'
import DialogProvider from '../components/DialogProvider.jsx'
import { startSettings, startTab } from '../startLink.js'

// Finanzen, Zeitplan, Haus, Einrichtung, Dokumente and Heizwärme are loaded when first opened, so
// the app starts with less to download.
const Finances = lazyTab(() => import('../tabs/Finances.jsx'))
const Timetable = lazyTab(() => import('../tabs/Timetable.jsx'))
const House = lazyTab(() => import('../tabs/House.jsx'))
const Documents = lazyTab(() => import('../tabs/Documents.jsx'))
const Energy = lazyTab(() => import('../tabs/Energy.jsx'))
const Interior = lazyTab(() => import('../tabs/Interior.jsx'))
const Settings = lazyTab(() => import('./Settings.jsx'))

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
  { id: 'house', label: 'Haus', component: House },
  { id: 'interior', label: 'Einrichtung', component: Interior },
  { id: 'contacts', label: 'Kontakte', component: Contacts },
  { id: 'documents', label: 'Dokumente', component: Documents },
  { id: 'energy', label: 'Heizwärme', component: Energy },
]

function Home({ user, onLogout }) {
  // The app opens on the start page, unless a link asks for a tab
  // (e.g. ?tab=haus&vollbild, see startLink.js).
  const [activeTab, setActiveTab] = useState(() => startTab(TABS) ?? TABS[0].id)
  // Einstellungen cover the tabs while open: null, or { section }.
  const [settings, setSettings] = useState(() => (startSettings() ? { section: null } : null))
  const [focusEntryId, setFocusEntryId] = useState(null)
  const [focusContactId, setFocusContactId] = useState(null)
  // Einrichtung: the room to open, pictures shared to the app waiting for
  // a room, and a view of a room the Haus tab should open (see House.jsx).
  const [focusRoomId, setFocusRoomId] = useState(null)
  const [interiorInbox, setInteriorInbox] = useState(null)
  const [houseRequest, setHouseRequest] = useState(null)
  // Shared pictures: ask first whether they go to the diary or Einrichtung.
  const [shareChoice, setShareChoice] = useState(null)
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

  // Opens the Haus tab walking in a room, to take a view for Einrichtung.
  function openHouse(request) {
    setHouseRequest(request)
    setSlide(null)
    setActiveTab('house')
    window.scrollTo({ top: 0 })
  }

  // Opens Einrichtung on one room.
  function openInterior(roomId) {
    setFocusRoomId(roomId ?? null)
    setSlide(null)
    setActiveTab('interior')
    window.scrollTo({ top: 0 })
  }

  // Opening Einstellungen adds a history step, so the phone's back
  // gesture closes them instead of leaving the app.
  function openSettings(section = null) {
    if (!window.history.state?.bautagebuchSettings) {
      window.history.pushState({ ...window.history.state, bautagebuchSettings: true }, '')
    }
    setSettings({ section })
  }

  function closeSettings() {
    if (window.history.state?.bautagebuchSettings) window.history.back()
    else setSettings(null)
  }

  useEffect(() => {
    const onPop = () => {
      if (!window.history.state?.bautagebuchSettings) setSettings(null)
    }
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [])

  const onFocused = useCallback(() => {
    setFocusEntryId(null)
    setFocusContactId(null)
    setFocusRoomId(null)
  }, [])
  const onInboxTaken = useCallback(() => setInteriorInbox(null), [])
  const onHouseRequestTaken = useCallback(() => setHouseRequest(null), [])

  function chooseTab(id) {
    if (settings) closeSettings()
    setFocusEntryId(null)
    setFocusContactId(null)
    setSlide(null)
    setActiveTab(id)
  }

  // On phones, swiping left or right moves to the next or previous tab.
  useSwipeTabs((step) => {
    if (settings) return
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

  // The draft is also kept on the device (diaryDraft.js), so it is still
  // there when the phone ended the app in the background, e.g. while the
  // camera was open. It is restored first, then anything shared added.
  const [draftRestored, setDraftRestored] = useState(false)

  // Shared from another app ("Teilen → Bautagebuch"): pictures can go to
  // Einrichtung (a room's board) or the diary, so that is asked first.
  // In the diary they open a new entry with the pictures as photos, the
  // other files attached and any shared text as its text. It starts as a
  // Status entry; the kind can be changed in the form (e.g. Ausgabe for an
  // invoice). A draft restored from before keeps what it had and gets the
  // shared things added.
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const draft = await loadDraft()
      const shared = await takeShared()
      clearShareParam()
      if (cancelled) return
      if (draft) {
        setDiaryForm(draft.form)
        setDiaryEditingId(draft.editingId)
        setDiaryFormOpen(draft.open)
      }
      setDraftRestored(true)
      if (!shared) return
      doneWithShared()
      // Pictures can go to Einrichtung instead; ask. Anything else
      // (documents, text) goes to the diary as before.
      if (shared.files.some((file) => file.type.startsWith('image/'))) setShareChoice(shared)
      else shareToDiary(shared)
    })()
    return () => {
      cancelled = true
    }
  }, [])

  // Shared things into a new diary entry: pictures as photos, other files
  // attached, text as the entry's text.
  function shareToDiary(shared) {
    const photos = []
    const files = []
    for (const file of shared.files) {
      if (file.type.startsWith('image/')) photos.push({ key: newId(), blob: file })
      else files.push({ key: newId(), blob: file, name: file.name })
    }
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
  }

  // Shared pictures into Einrichtung: the tab asks for the room.
  function shareToInterior(shared) {
    setInteriorInbox({ files: shared.files.filter((file) => file.type.startsWith('image/')) })
    openInterior(null)
  }

  // Save the draft shortly after each change, and right away when the app
  // goes to the background (it may not come back). Not before the saved
  // draft was restored, or an empty form would replace it.
  const latestDraft = useRef(null)
  useEffect(() => {
    if (!draftRestored) return
    const draft = { form: diaryForm, editingId: diaryEditingId, open: diaryFormOpen }
    latestDraft.current = draft
    const timer = setTimeout(() => saveDraft(draft), 500)
    return () => clearTimeout(timer)
  }, [draftRestored, diaryForm, diaryEditingId, diaryFormOpen])
  useEffect(() => {
    if (!draftRestored) return
    const saveNow = () => {
      if (document.visibilityState === 'hidden' && latestDraft.current) {
        saveDraft(latestDraft.current)
      }
    }
    document.addEventListener('visibilitychange', saveNow)
    window.addEventListener('pagehide', saveNow)
    return () => {
      document.removeEventListener('visibilitychange', saveNow)
      window.removeEventListener('pagehide', saveNow)
    }
  }, [draftRestored])

  return (
    <DialogProvider>
      <div className="app-shell">
        <header className="app-header">
          <h1>Bautagebuch</h1>
          <button
            type="button"
            className="user-menu"
            onClick={() => (settings ? closeSettings() : openSettings())}
            aria-label="Einstellungen"
            aria-expanded={Boolean(settings)}
          >
            {user.picture && (
              <img className="avatar" src={user.picture} alt="" referrerPolicy="no-referrer" />
            )}
            <span className="user-email" title={user.email}>
              {user.name ?? user.email}
            </span>
            <span className="settings-gear" aria-hidden="true">
              ⚙
            </span>
          </button>
        </header>

        <UpdateHint />
        <InstallHint />
        {!settings && <SetupHint onSetup={openSettings} />}

        {settings ? (
          <main className="tab-panel">
            <Suspense fallback={<p className="empty">Wird geladen…</p>}>
              <Settings
                user={user}
                section={settings.section}
                onClose={closeSettings}
                onLogout={onLogout}
              />
            </Suspense>
          </main>
        ) : (
          <>
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
                  onOpenSettings={openSettings}
                  focusEntryId={focusEntryId}
                  focusContactId={focusContactId}
                  diaryDraft={diaryDraft}
                  onFocused={onFocused}
                  focusRoomId={focusRoomId}
                  inbox={interiorInbox}
                  onInboxTaken={onInboxTaken}
                  onOpenHouse={openHouse}
                  onOpenInterior={openInterior}
                  houseRequest={houseRequest}
                  onHouseRequestTaken={onHouseRequestTaken}
                />
              </Suspense>
            </main>
          </>
        )}
        {shareChoice && (
          <div className="share-choice" role="dialog" aria-modal="true" aria-labelledby="share-choice-title">
            <div className="share-choice-box">
              <p id="share-choice-title">
                {shareChoice.files.length === 1 ? 'Wohin mit dem geteilten Bild?' : 'Wohin mit den geteilten Bildern?'}
              </p>
              <div className="form-actions">
                <button
                  type="button"
                  onClick={() => {
                    shareToDiary(shareChoice)
                    setShareChoice(null)
                  }}
                >
                  Tagebuch
                </button>
                <button
                  type="button"
                  onClick={() => {
                    shareToInterior(shareChoice)
                    setShareChoice(null)
                  }}
                >
                  Einrichtung
                </button>
              </div>
              {shareChoice.files.some((file) => !file.type.startsWith('image/')) && (
                <p className="muted">Einrichtung nimmt nur die Bilder.</p>
              )}
            </div>
          </div>
        )}
      </div>
    </DialogProvider>
  )
}

export default Home
