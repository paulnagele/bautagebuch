import { useEffect, useState } from 'react'
import { driveAccess } from '../drive.js'
import { connectTogether } from '../google.js'
import { uploadRoomPicture } from '../interior.js'
import { createDraft } from '../interiorAi.js'
import DrivePhoto from './DrivePhoto.jsx'

const MAX_REFS = 8

// "KI-Entwurf" in a room's board: pick the view of the room (a render from
// the model, or a photo), the pictures of things wanted in it (favourites
// ticked) and an optional wish; an image model furnishes the room. The
// result is kept as a new picture in the room only when saved.
function AiDraftDialog({ user, room, items, itemStore, model, onClose }) {
  const views = [...items].sort((a, b) => Number(Boolean(b.view)) - Number(Boolean(a.view)))
  const [baseId, setBaseId] = useState(views[0]?.id ?? null)
  const [refIds, setRefIds] = useState(() =>
    items.filter((item) => item.favorite && item.id !== views[0]?.id).slice(0, MAX_REFS).map((item) => item.id),
  )
  const [note, setNote] = useState('')
  const [step, setStep] = useState('pick') // pick | working | result | saving
  const [result, setResult] = useState(null) // Blob
  const [error, setError] = useState('')

  const base = items.find((item) => item.id === baseId) ?? null
  const refs = refIds.filter((id) => id !== baseId)

  useEffect(() => {
    const close = (e) => e.key === 'Escape' && step === 'pick' && onClose()
    window.addEventListener('keydown', close)
    return () => window.removeEventListener('keydown', close)
  }, [onClose, step])

  function toggleRef(id) {
    setRefIds((current) =>
      current.includes(id) ? current.filter((x) => x !== id) : current.length >= MAX_REFS ? current : [...current, id],
    )
  }

  async function create() {
    if (!base) return
    setError('')
    // Pictures not on this device yet are loaded with Drive access.
    const [problem] = await connectTogether([driveAccess], user.email)
    if (problem) {
      setError(problem)
      return
    }
    setStep('working')
    try {
      const pictures = items
        .filter((item) => refs.includes(item.id))
        .map((item) => ({ photoId: item.photoId, title: item.title, note: item.note }))
      setResult(await createDraft({ baseId: base.photoId, refs: pictures, note: note.trim() }))
      setStep('result')
    } catch (err) {
      setError(err.message)
      setStep('pick')
    }
  }

  async function save() {
    setStep('saving')
    setError('')
    try {
      const [problem] = await connectTogether([driveAccess], user.email)
      if (problem) throw new Error(problem)
      const photoId = await uploadRoomPicture(room, result)
      await itemStore.insert({
        roomId: room.id,
        photoId,
        title: 'KI-Entwurf',
        note: note.trim(),
        favorite: false,
        view: base?.view ?? null,
      })
      onClose()
    } catch (err) {
      setError(err.message)
      setStep('result')
    }
  }

  return (
    <div className="interior-sheet" role="dialog" aria-modal="true" aria-label="KI-Entwurf">
      <div className="interior-sheet-box form-grid ai-draft">
        <h2>KI-Entwurf: {room.name}</h2>
        {step === 'pick' && (
          <>
            {items.length === 0 ? (
              <p className="full muted">
                Füge zuerst ein Bild des Raums hinzu, am besten mit „Ansicht aus Modell“.
              </p>
            ) : (
              <>
                <p className="full muted ai-label">1. Raumbild (wird eingerichtet)</p>
                <ul className="full ai-picks">
                  {views.map((item) => (
                    <li key={item.id}>
                      <button
                        type="button"
                        className={item.id === baseId ? 'ai-pick chosen' : 'ai-pick'}
                        aria-pressed={item.id === baseId}
                        onClick={() => setBaseId(item.id)}
                      >
                        <DrivePhoto fileId={item.photoId} alt={item.title} className="ai-pick-img" />
                      </button>
                    </li>
                  ))}
                </ul>
                <p className="full muted ai-label">
                  2. Was hinein soll ({refs.length} von höchstens {MAX_REFS})
                </p>
                <ul className="full ai-picks">
                  {items
                    .filter((item) => item.id !== baseId)
                    .map((item) => (
                      <li key={item.id}>
                        <button
                          type="button"
                          className={refs.includes(item.id) ? 'ai-pick chosen' : 'ai-pick'}
                          aria-pressed={refs.includes(item.id)}
                          onClick={() => toggleRef(item.id)}
                        >
                          <DrivePhoto fileId={item.photoId} alt={item.title} className="ai-pick-img" />
                          {refs.includes(item.id) && <span className="ai-check" aria-hidden="true">✓</span>}
                        </button>
                      </li>
                    ))}
                </ul>
                <label className="full">
                  3. Wünsche (optional)
                  <textarea
                    rows={2}
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                    placeholder="z. B. Sofa an die Fensterwand, helles Holz, warmes Licht"
                  />
                </label>
                <p className="full muted interior-hint">
                  Die Bilder samt Titel und Notiz gehen an OpenRouter ({model || 'Bildmodell'}). Ein Entwurf kostet ein paar Cent
                  und dauert bis zu einer Minute. Die KI hält den Raum ungefähr, nicht maßgenau.
                </p>
              </>
            )}
          </>
        )}
        {step === 'working' && (
          <div className="full ai-working">
            <span className="spinner busy-spinner" aria-hidden="true" />
            <p>Die KI richtet den Raum ein… das dauert bis zu einer Minute.</p>
          </div>
        )}
        {(step === 'result' || step === 'saving') && result && (
          <DrivePhoto blob={result} alt="KI-Entwurf" className="interior-sheet-img full" />
        )}
        {error && (
          <p className="error full" role="alert">
            {error}
          </p>
        )}
        <div className="form-actions full interior-sheet-actions">
          {step === 'pick' && (
            <>
              <button type="button" onClick={create} disabled={!base}>
                Entwurf erstellen
              </button>
              <button type="button" className="secondary" onClick={onClose}>
                Abbrechen
              </button>
            </>
          )}
          {(step === 'result' || step === 'saving') && (
            <>
              <button type="button" onClick={save} disabled={step === 'saving'}>
                {step === 'saving' ? 'Wird gespeichert…' : 'Speichern'}
              </button>
              <button type="button" className="secondary" onClick={create} disabled={step === 'saving'}>
                Nochmal
              </button>
              <button type="button" className="secondary" onClick={() => setStep('pick')} disabled={step === 'saving'}>
                Ändern
              </button>
              <button type="button" className="link danger" onClick={onClose} disabled={step === 'saving'}>
                Verwerfen
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

export default AiDraftDialog
