import { useEffect, useState } from 'react'
import { listVersions, loadModel } from '../../haus/houseStore.js'
import { defaultHeatedLevels, deriveFromModel } from '../../energy/fromModel.js'
import { formatDate } from '../../storage.js'

// Takes the areas of walls, windows, roof and floor, the floor area and
// the volume from a version of the house model (Haus tab).
function ModelImport({ source, empty, onImport }) {
  const [versions, setVersions] = useState(null)
  const [versionId, setVersionId] = useState('')
  // The loaded model, with the version it belongs to.
  const [loaded, setLoaded] = useState(null)
  const model = loaded?.id === versionId ? loaded.model : null
  const [levels, setLevels] = useState([])
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [open, setOpen] = useState(empty)

  useEffect(() => {
    if (!open || versions) return
    listVersions()
      .then((list) => {
        setVersions(list)
        const known = list.find((version) => version.id === source?.versionId)
        const current = list.find((version) => version.is_current) ?? list[0]
        setVersionId((known ?? current)?.id ?? '')
      })
      .catch((err) => setError(err.message))
  }, [open, versions, source])

  useEffect(() => {
    if (!versionId) return
    let cancelled = false
    loadModel(versionId)
      .then((next) => {
        if (cancelled) return
        setLoaded({ id: versionId, model: next })
        const ids = (next.levels ?? []).map((level) => level.id)
        const saved = source?.versionId === versionId ? source.levels?.filter((id) => ids.includes(id)) : null
        setLevels(saved?.length ? saved : defaultHeatedLevels(next))
      })
      .catch((err) => !cancelled && setError(err.message))
    return () => {
      cancelled = true
    }
  }, [versionId, source])

  function toggleLevel(id) {
    setLevels(levels.includes(id) ? levels.filter((level) => level !== id) : [...levels, id])
  }

  async function take() {
    setError('')
    setBusy(true)
    try {
      const derived = deriveFromModel(model, levels)
      const version = versions.find((item) => item.id === versionId)
      const done = await onImport({
        ...derived,
        source: { versionId, versionName: version?.name ?? '', levels, importedAt: new Date().toISOString() },
      })
      if (done) setOpen(false)
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  if (!open) {
    return (
      <div className="card energy-source">
        <p>
          {source ? (
            <>
              Flächen aus dem Hausmodell „{source.versionName}“ ({source.levels.join(', ')} beheizt), übernommen am{' '}
              {formatDate(source.importedAt.slice(0, 10))}.
            </>
          ) : (
            'Flächen von Hand eingegeben.'
          )}
        </p>
        <button type="button" className="secondary" onClick={() => setOpen(true)}>
          Aus dem Hausmodell übernehmen…
        </button>
      </div>
    )
  }

  return (
    <div className="card form-grid energy-import">
      <h2>Aus dem Hausmodell übernehmen</h2>
      <p className="form-hint muted full">
        Außenwände, Fenster und Türen je Geschoss und Himmelsrichtung, Dach bzw. oberste Decke und der Boden der
        beheizten Geschosse, dazu Bruttogrundfläche und beheiztes Volumen (Außenmaße). Bitte danach prüfen: Treppen zu
        unbeheizten Geschossen und kleine Details fehlen.
      </p>
      {versions && versions.length === 0 && <p className="muted full">Im Haus-Tab gibt es noch kein Modell.</p>}
      {versions && versions.length > 0 && (
        <label>
          Version
          <select value={versionId} onChange={(e) => setVersionId(e.target.value)}>
            {versions.map((version) => (
              <option key={version.id} value={version.id}>
                {version.name}
                {version.is_current ? ' (aktuell)' : ''}
              </option>
            ))}
          </select>
        </label>
      )}
      {model && (
        <fieldset className="energy-levels">
          <legend>Beheizte Geschosse</legend>
          {[...(model.levels ?? [])]
            .sort((a, b) => b.floor - a.floor)
            .map((level) => (
              <label key={level.id} className="energy-check">
                <input type="checkbox" checked={levels.includes(level.id)} onChange={() => toggleLevel(level.id)} />
                {level.name ?? level.id}
              </label>
            ))}
        </fieldset>
      )}
      {!versions && !error && <p className="muted full">Das Hausmodell wird geladen…</p>}
      {error && (
        <p className="error full" role="alert">
          {error}
        </p>
      )}
      <div className="form-actions full">
        <button type="button" onClick={take} disabled={!model || busy || levels.length === 0}>
          Flächen übernehmen
        </button>
        {!empty && (
          <button type="button" className="secondary" onClick={() => setOpen(false)}>
            Abbrechen
          </button>
        )}
      </div>
    </div>
  )
}

export default ModelImport
