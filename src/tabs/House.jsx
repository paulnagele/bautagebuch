import { useCallback, useEffect, useRef, useState } from 'react'
import {
  addShareVersion,
  chatConfigured,
  createShare,
  deleteVersion,
  importHouse,
  listVersions,
  loadContext,
  listShares,
  loadModel,
  readImportFile,
  removeShareVersion,
  renameVersion,
  revokeShare,
  saveVersion,
  setCurrentVersion,
  watchVersions,
} from '../haus/houseStore.js'
import { mountViewer, showFailure } from '../haus/viewer.js'
import HouseChat from '../haus/HouseChat.jsx'
import CaptureDialog from '../components/CaptureDialog.jsx'
import { takeFullStart } from '../startLink.js'
import { loadJSON, saveJSON } from '../storage.js'

// How the model was shown when the app was last left (version, level,
// camera, Vollbild, display chips), so it opens the same way again.
const VIEW_KEY = 'haus.view'

const store = {
  list: listVersions,
  load: loadModel,
  save: saveVersion,
  rename: renameVersion,
  remove: deleteVersion,
  setCurrent: setCurrentVersion,
}

// Share links for the public page haus.html ("Teilen" behind the gear).
const shares = {
  list: listShares,
  create: createShare,
  add: addShareVersion,
  remove: removeShareVersion,
  revoke: revokeShare,
}

// The Haus tab: the 3D model of the house with its versions. Like
// Finanzen, it is loaded when first opened (three.js is large).
//   houseRequest   set when the Einrichtung tab asks for a view of a room:
//                  { roomId, room, spot?, title? }; the model opens walking
//                  there (Begehen), and "Aufnehmen" saves to that room
//   onOpenInterior opens the Einrichtung tab on a room (after saving)
function House({ user, houseRequest, onHouseRequestTaken, onOpenInterior }) {
  const [state, setState] = useState({ status: 'loading' })

  const load = useCallback(() => {
    fetchHouse().then(setState)
  }, [])

  useEffect(() => {
    load()
  }, [load])

  function retry() {
    setState({ status: 'loading' })
    load()
  }

  if (state.status === 'loading') return <p className="empty">Das Haus wird geladen…</p>
  if (state.status === 'error') {
    return (
      <section className="tab-content">
        <p className="error" role="alert">
          {state.error}
        </p>
        <button type="button" className="secondary" onClick={retry}>
          Erneut versuchen
        </button>
      </section>
    )
  }
  if (state.status === 'empty') return <ImportCard onImported={retry} />
  return (
    <HouseViewer
      view={state.view}
      user={user}
      request={houseRequest}
      onRequestTaken={onHouseRequestTaken}
      onOpenInterior={onOpenInterior}
    />
  )
}

// The version list, the current version's model and the site data.
async function fetchHouse() {
  try {
    const [versions, context] = await Promise.all([listVersions(), loadContext()])
    if (versions.length === 0) return { status: 'empty' }
    const saved = loadJSON(VIEW_KEY, null)
    const current =
      versions.find((version) => version.id === saved?.versionId) ??
      versions.find((version) => version.is_current) ??
      versions[0]
    const model = await loadModel(current.id)
    const restore = saved?.versionId === current.id ? saved : null
    return { status: 'ready', view: { versions, currentId: current.id, model, context, restore } }
  } catch (error) {
    return { status: 'error', error: error.message }
  }
}

// Remembered on this device once the GPU dropped the full view.
const LITE_KEY = 'haus3d-lite'

function readLite() {
  try {
    return localStorage.getItem(LITE_KEY) === '1'
  } catch {
    return false
  }
}

function keepView(viewer) {
  const state = (viewer ?? currentViewer)?.viewState?.()
  if (state) saveJSON(VIEW_KEY, state)
}
// The mounted viewer, for keepView() (there is only one Haus tab).
let currentViewer = null

function HouseViewer({ view, user, request, onRequestTaken, onOpenInterior }) {
  const hostRef = useRef(null)
  // The Einrichtung tab's request, taken once when the model opens.
  const [asked] = useState(request ?? null)
  const [shot, setShot] = useState(null)
  const [savedNote, setSavedNote] = useState('')
  useEffect(() => {
    if (request) onRequestTaken?.()
  }, [request, onRequestTaken])
  useEffect(() => {
    if (!savedNote) return
    const timer = setTimeout(() => setSavedNote(''), 3000)
    return () => clearTimeout(timer)
  }, [savedNote])
  const [lite, setLite] = useState(readLite)
  const [chatOpen, setChatOpen] = useState(false)
  const [version, setVersion] = useState(null)
  const viewerRef = useRef(null)
  // The saved view is applied once; a remount (e.g. light mode) keeps the
  // live view the viewer had instead.
  const restored = useRef(false)
  const closeChat = useCallback(() => setChatOpen(false), [])

  useEffect(() => {
    const host = hostRef.current
    let dispose = null
    let left = false
    function onLost() {
      try {
        localStorage.setItem(LITE_KEY, '1')
      } catch {
        // Not remembered; light mode still applies until the app is reloaded.
      }
      setLite(true)
    }
    const onChat = () => setChatOpen(true)
    // First mount: the view saved when the app was last left. A remount
    // (light mode): the view just kept by the cleanup below.
    const restore = restored.current ? loadJSON(VIEW_KEY, null) : view.restore
    const onVersion = (row) => setVersion(row ? { id: row.id, name: row.name } : null)
    mountViewer(host, {
      ...view,
      store,
      shares,
      lite,
      onLost,
      onChat,
      chatReady: chatConfigured(),
      onVersion,
      restore,
      full: takeFullStart() || Boolean(asked) || Boolean(restore?.full),
      onCapture: setShot,
      walkTo: asked ? { spot: asked.spot, room: asked.room } : undefined,
    })
      .then((done) => {
        if (left) done?.()
        else viewerRef.current = currentViewer = dispose = done
      })
      .catch((error) => {
        console.error(error)
        // Instead of the loading text for ever: the reason, on screen.
        if (!left) showFailure(host, error)
      })
    return () => {
      left = true
      keepView(dispose)
      restored.current = true
      if (currentViewer === dispose) currentViewer = null
      viewerRef.current = null
      dispose?.()
    }
  }, [view, lite, asked])

  // Changes from elsewhere (Haus chat, Claude's login, another phone) show
  // up live; a burst of events is fetched once.
  useEffect(() => {
    let timer = 0
    const stop = watchVersions(() => {
      clearTimeout(timer)
      timer = setTimeout(() => viewerRef.current?.refresh?.(), 300)
    })
    return () => {
      clearTimeout(timer)
      stop()
    }
  }, [])

  // Keep the view when the app goes to the background (it may be closed
  // there) and when the tab is left.
  useEffect(() => {
    const onHide = () => {
      if (document.visibilityState === 'hidden') keepView()
    }
    // Not keepView itself: the browser would pass the event as the viewer.
    const onPageHide = () => keepView()
    document.addEventListener('visibilitychange', onHide)
    window.addEventListener('pagehide', onPageHide)
    return () => {
      document.removeEventListener('visibilitychange', onHide)
      window.removeEventListener('pagehide', onPageHide)
    }
  }, [])

  // data-no-swipe: dragging turns the model instead of switching tabs.
  return (
    <>
      <div ref={hostRef} className="haus3d" data-no-swipe />
      <HouseChat
        open={chatOpen}
        onClose={closeChat}
        version={version}
        onOpenVersion={(id) => viewerRef.current?.openVersion?.(id)}
      />
      {shot && (
        <CaptureDialog
          user={user}
          shot={shot}
          request={asked}
          onClose={() => setShot(null)}
          onSaved={(room) => {
            setShot(null)
            if (asked && onOpenInterior) onOpenInterior(room.id)
            else setSavedNote(`Gespeichert in „${room.name}“ (Einrichtung)`)
          }}
        />
      )}
      {savedNote && (
        <p className="capture-toast" role="status">
          {savedNote}
        </p>
      )}
    </>
  )
}

// No model yet: import the export file of the Haus3D page once.
function ImportCard({ onImported }) {
  const [file, setFile] = useState(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function submit(event) {
    event.preventDefault()
    if (!file) return
    setBusy(true)
    setError('')
    try {
      await importHouse(await readImportFile(file))
      onImported()
    } catch (importError) {
      setError(importError.message)
      setBusy(false)
    }
  }

  return (
    <section className="tab-content">
      <form className="card form-grid haus-import" onSubmit={submit}>
        <h2>Hausmodell importieren</h2>
        <p className="full">
          Hier gibt es noch kein 3D-Modell. Wähle die Exportdatei aus Haus3D
          (haus3d-export.json). Sie bringt alle Versionen und die Umgebung mit; danach
          lebt das Modell hier im Bautagebuch.
        </p>
        <label className="full">
          Exportdatei
          <input
            type="file"
            accept=".json,application/json"
            onChange={(event) => setFile(event.target.files[0] ?? null)}
          />
        </label>
        {error && (
          <p className="error full" role="alert">
            {error}
          </p>
        )}
        <div className="form-actions full">
          <button type="submit" disabled={!file || busy}>
            {busy ? 'Wird importiert…' : 'Importieren'}
          </button>
        </div>
      </form>
    </section>
  )
}

export default House
