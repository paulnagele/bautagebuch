import { useCallback, useEffect, useRef, useState } from 'react'
import {
  createShare,
  deleteVersion,
  importHouse,
  listVersions,
  loadContext,
  listShares,
  loadModel,
  moveShare,
  readImportFile,
  renameVersion,
  revokeShare,
  saveVersion,
  setCurrentVersion,
} from '../haus/houseStore.js'
import { mountViewer, showFailure } from '../haus/viewer.js'

const store = {
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
  move: moveShare,
  revoke: revokeShare,
}

// The Haus tab: the 3D model of the house with its versions. Like
// Finanzen, it is loaded when first opened (three.js is large).
function House() {
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
  return <HouseViewer view={state.view} />
}

// The version list, the current version's model and the site data.
async function fetchHouse() {
  try {
    const [versions, context] = await Promise.all([listVersions(), loadContext()])
    if (versions.length === 0) return { status: 'empty' }
    const current = versions.find((version) => version.is_current) ?? versions[0]
    const model = await loadModel(current.id)
    return { status: 'ready', view: { versions, currentId: current.id, model, context } }
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

function HouseViewer({ view }) {
  const hostRef = useRef(null)
  const [lite, setLite] = useState(readLite)

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
    mountViewer(host, { ...view, store, shares, lite, onLost })
      .then((done) => {
        if (left) done?.()
        else dispose = done
      })
      .catch((error) => {
        console.error(error)
        // Instead of the loading text for ever: the reason, on screen.
        if (!left) showFailure(host, error)
      })
    return () => {
      left = true
      dispose?.()
    }
  }, [view, lite])

  // data-no-swipe: dragging turns the model instead of switching tabs.
  return <div ref={hostRef} className="haus3d" data-no-swipe />
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
