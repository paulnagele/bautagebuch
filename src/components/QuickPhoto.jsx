import { useRef, useState } from 'react'
import Icon from './Icon.jsx'
import BusyOverlay from './BusyOverlay.jsx'
import { useCollection } from '../useCollection.js'
import { useDialogs } from '../dialogs.js'
import { fromRow, toRow } from '../diaryEntries.js'
import { defaultDetails } from '../diaryTypes.js'
import { entryFolderPath, uploadPending } from '../diaryUploads.js'
import { driveAccess } from '../drive.js'
import { connectTogether } from '../google.js'
import { siteWeather } from '../weather.js'
import { newId, today } from '../storage.js'

// "Foto aufnehmen" on Home: opens the camera and saves the photos right
// away as a status entry of today, with the day's weather. The text only
// says that photos were taken; it can be written later in the diary.
// Without a Drive connection it asks once first, because Google's popup
// needs a tap to open.
function QuickPhoto({ user, onOpenEntry }) {
  const { insert } = useCollection('diary_entries', { fromRow, toRow })
  const dialogs = useDialogs()
  const input = useRef(null)
  const [busy, setBusy] = useState('')
  const [progress, setProgress] = useState(null)
  const [error, setError] = useState('')
  // Photos that could not be saved, kept so nothing taken is lost.
  const [failed, setFailed] = useState(null)
  const [saved, setSaved] = useState(null)

  function pick() {
    setError('')
    setSaved(null)
    input.current?.click()
  }

  async function save(files, tapped = false) {
    setError('')
    setSaved(null)
    // tapped: started by a tap here, which already lets Google's popup open.
    const count = files.length
    const what = count === 1 ? 'Das Foto' : `Die ${count} Fotos`
    if (!tapped && !driveAccess.connected()) {
      const question = `${what} als Status-Eintrag von heute speichern? Dafür wird einmal Google Drive verbunden.`
      if (!(await dialogs.confirm(question, { confirmLabel: 'Speichern' }))) {
        setFailed(files)
        return
      }
    }
    const [problem] = await connectTogether([driveAccess], user.email)
    if (problem) {
      setFailed(files)
      setError(problem)
      return
    }

    const date = today()
    setBusy(count === 1 ? 'Foto wird hochgeladen…' : `${count} Fotos werden hochgeladen…`)
    try {
      const weatherRequest = siteWeather(date).catch(() => null)
      const { photos } = await uploadPending(
        { photos: files.map((blob) => ({ key: newId(), blob })), files: [], date },
        entryFolderPath('status', null),
        (step) => {
          setProgress(step)
          if (count > 1) setBusy(`Foto ${step.current} von ${step.total} wird hochgeladen…`)
        },
      )
      setProgress(null)
      setBusy('Wird gespeichert…')
      const weather = (await weatherRequest)?.weather ?? 'Sunny'
      const entry = await insert({
        type: 'status',
        date,
        weather,
        workers: '',
        work: count === 1 ? 'Foto von der Baustelle' : `${count} Fotos von der Baustelle`,
        details: defaultDetails('status'),
        photoIds: photos.map((p) => p.fileId),
        files: [],
      })
      setFailed(null)
      setSaved(entry)
    } catch (err) {
      setFailed(files)
      setError(`Nicht gespeichert: ${err.message}`)
    } finally {
      setProgress(null)
      setBusy('')
    }
  }

  async function discard() {
    const question = 'Diese Fotos verwerfen? Fotos direkt aus der Kamera sind nicht in der Galerie gespeichert.'
    if (await dialogs.confirm(question, { confirmLabel: 'Verwerfen', danger: true })) {
      setFailed(null)
      setError('')
    }
  }

  function onPicked(e) {
    const files = [...e.target.files]
    e.target.value = ''
    if (files.length > 0) save(files)
  }

  return (
    <div className="quick-photo">
      <input
        ref={input}
        type="file"
        accept="image/*"
        capture="environment"
        multiple
        hidden
        onChange={onPicked}
      />
      <button type="button" className="quick-photo-button" onClick={pick}>
        <Icon name="camera" size={22} />
        Foto aufnehmen
      </button>
      {saved && (
        <p className="quick-photo-note" role="status">
          Gespeichert als Status-Eintrag von heute.{' '}
          <button type="button" className="link" onClick={() => onOpenEntry(saved)}>
            Im Tagebuch zeigen
          </button>
        </p>
      )}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {failed && (
        <p className="quick-photo-note">
          {failed.length === 1 ? '1 Foto' : `${failed.length} Fotos`} noch nicht gespeichert.{' '}
          <button type="button" className="link" onClick={() => save(failed, true)}>
            Jetzt speichern
          </button>{' '}
          <button type="button" className="link" onClick={discard}>
            Verwerfen
          </button>
        </p>
      )}
      {busy && <BusyOverlay message={busy} progress={progress} />}
    </div>
  )
}

export default QuickPhoto
