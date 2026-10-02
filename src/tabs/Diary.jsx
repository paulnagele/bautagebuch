import { useEffect, useRef, useState } from 'react'
import { formatDate, newId, today } from '../storage.js'
import { useCollection } from '../useCollection.js'
import { connectDrive, driveFolderUrl, getDriveFolderId, uploadPhoto } from '../drive.js'
import DrivePhoto from '../components/DrivePhoto.jsx'

// Stored in English so existing entries keep working; shown in German.
const WEATHER_LABELS = {
  Sunny: 'Sonnig',
  Cloudy: 'Bewölkt',
  Rain: 'Regen',
  Snow: 'Schnee',
  Wind: 'Wind',
  Frost: 'Frost',
}
const WEATHER_OPTIONS = Object.keys(WEATHER_LABELS)

function fromRow(row) {
  return {
    id: row.id,
    date: row.entry_date,
    weather: row.weather,
    workers: row.workers ?? '',
    work: row.work,
    notes: row.notes,
    photoIds: row.photo_ids ?? [],
    author: row.author_name,
  }
}

function toRow(entry) {
  return {
    entry_date: entry.date,
    weather: entry.weather,
    workers: entry.workers === '' ? null : Number(entry.workers),
    work: entry.work,
    notes: entry.notes,
    photo_ids: entry.photoIds,
    updated_at: new Date().toISOString(),
  }
}

// Keeps the original file type in the Drive file name (".jpg", ".heic", …).
function extension(file) {
  const match = /\.[a-z0-9]+$/i.exec(file.name ?? '')
  return match ? match[0].toLowerCase() : '.jpg'
}

function emptyForm() {
  // photos: { key, fileId } for photos already in Drive,
  //         { key, blob } for new ones that still need uploading.
  return { date: today(), weather: 'Sunny', workers: '', work: '', notes: '', photos: [] }
}

function Diary({ user }) {
  const { rows: entries, status, error: loadError, insert, update, remove } = useCollection(
    'diary_entries',
    { fromRow, toRow },
  )
  const [form, setForm] = useState(emptyForm)
  const [editingId, setEditingId] = useState(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState('')
  const [lightbox, setLightbox] = useState(null)
  const [folderId, setFolderId] = useState(null)
  const fileInput = useRef(null)

  const sorted = [...entries].sort((a, b) => b.date.localeCompare(a.date))

  useEffect(() => {
    getDriveFolderId().then(setFolderId, () => {})
  }, [])

  useEffect(() => {
    if (!lightbox) return
    const close = (e) => e.key === 'Escape' && setLightbox(null)
    window.addEventListener('keydown', close)
    return () => window.removeEventListener('keydown', close)
  }, [lightbox])

  function setField(field) {
    return (e) => setForm({ ...form, [field]: e.target.value })
  }

  // Photos are uploaded as picked, in full size and quality.
  function addFiles(e) {
    const files = [...e.target.files].filter((f) => f.type.startsWith('image/'))
    e.target.value = ''
    if (files.length === 0) return
    setError('')
    const added = files.map((file) => ({ key: newId(), blob: file }))
    setForm((f) => ({ ...f, photos: [...f.photos, ...added] }))
  }

  function removeFormPhoto(key) {
    setForm({ ...form, photos: form.photos.filter((p) => p.key !== key) })
  }

  async function handleSubmit(e) {
    e.preventDefault()
    if (!form.date || !form.work.trim()) {
      setError('Bitte Datum und ausgeführte Arbeiten eingeben.')
      return
    }
    setError('')

    const pending = form.photos.filter((p) => p.blob)
    let photos = form.photos
    if (pending.length > 0) {
      try {
        // Must run first, while the click still counts as user action,
        // otherwise the browser blocks Google's popup.
        await connectDrive(user.email)
        photos = [...form.photos]
        let done = 0
        for (const [index, photo] of photos.entries()) {
          if (!photo.blob) continue
          done += 1
          setBusy(`Foto ${done} von ${pending.length} wird hochgeladen…`)
          const fileId = await uploadPhoto(photo.blob, `${form.date} Bautagebuch ${newId()}${extension(photo.blob)}`)
          photos[index] = { key: photo.key, fileId }
          // Remember finished uploads so a retry does not upload them twice.
          setForm((f) => ({ ...f, photos: [...photos] }))
        }
      } catch (err) {
        setBusy('')
        setError(`Foto-Upload fehlgeschlagen: ${err.message}`)
        return
      }
    }

    setBusy('Wird gespeichert…')
    const entry = {
      date: form.date,
      weather: form.weather,
      workers: form.workers,
      work: form.work.trim(),
      notes: form.notes.trim(),
      photoIds: photos.map((p) => p.fileId),
    }
    try {
      if (editingId) {
        await update(editingId, entry)
      } else {
        await insert(entry)
      }
      resetForm()
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy('')
    }
  }

  function resetForm() {
    setForm(emptyForm())
    setEditingId(null)
    setError('')
  }

  function startEdit(entry) {
    setForm({
      date: entry.date,
      weather: entry.weather,
      workers: String(entry.workers),
      work: entry.work,
      notes: entry.notes,
      photos: entry.photoIds.map((fileId) => ({ key: fileId, fileId })),
    })
    setEditingId(entry.id)
    setError('')
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  async function handleDelete(entry) {
    const photoNote = entry.photoIds.length > 0 ? ' Die Fotos bleiben im Google-Drive-Ordner.' : ''
    if (!window.confirm(`Diesen Tagebucheintrag löschen?${photoNote}`)) return
    try {
      await remove(entry.id)
      if (editingId === entry.id) resetForm()
    } catch (err) {
      window.alert(err.message)
    }
  }

  return (
    <section className="tab-content">
      <form className="card form-grid" onSubmit={handleSubmit} noValidate>
        <h2>{editingId ? 'Eintrag bearbeiten' : 'Neuer Tagebucheintrag'}</h2>

        <label>
          Datum
          <input type="date" value={form.date} onChange={setField('date')} />
        </label>
        <label>
          Wetter
          <select value={form.weather} onChange={setField('weather')}>
            {WEATHER_OPTIONS.map((w) => (
              <option key={w} value={w}>
                {WEATHER_LABELS[w]}
              </option>
            ))}
          </select>
        </label>
        <label>
          Arbeiter vor Ort
          <input type="number" min="0" value={form.workers} onChange={setField('workers')} />
        </label>
        <label className="full">
          Ausgeführte Arbeiten
          <textarea rows="3" value={form.work} onChange={setField('work')} />
        </label>
        <label className="full">
          Notizen / Vorkommnisse
          <textarea rows="2" value={form.notes} onChange={setField('notes')} />
        </label>

        <div className="full photo-field">
          <span className="field-label">Fotos</span>
          {form.photos.length > 0 && (
            <ul className="thumb-grid">
              {form.photos.map((photo) => (
                <li key={photo.key} className="thumb">
                  <DrivePhoto fileId={photo.fileId} blob={photo.blob} alt="" className="thumb-img" />
                  <button
                    type="button"
                    className="thumb-remove"
                    aria-label="Foto entfernen"
                    onClick={() => removeFormPhoto(photo.key)}
                    disabled={Boolean(busy)}
                  >
                    ×
                  </button>
                </li>
              ))}
            </ul>
          )}
          <input
            ref={fileInput}
            type="file"
            accept="image/*"
            multiple
            hidden
            onChange={addFiles}
          />
          <button
            type="button"
            className="secondary"
            onClick={() => fileInput.current.click()}
            disabled={Boolean(busy)}
          >
            Fotos hinzufügen
          </button>
        </div>

        {error && (
          <p className="error full" role="alert">
            {error}
          </p>
        )}

        <div className="form-actions full">
          <button type="submit" disabled={Boolean(busy)}>
            {busy || (editingId ? 'Änderungen speichern' : 'Eintrag hinzufügen')}
          </button>
          {editingId && (
            <button type="button" className="secondary" onClick={resetForm} disabled={Boolean(busy)}>
              Abbrechen
            </button>
          )}
        </div>
      </form>

      {status === 'loading' && <p className="empty">Tagebuch wird geladen…</p>}
      {status === 'error' && (
        <p className="error" role="alert">
          {loadError}
        </p>
      )}
      {status === 'ready' && sorted.length === 0 && <p className="empty">Noch keine Tagebucheinträge.</p>}

      {sorted.length > 0 && (
        <ul className="entry-list">
          {sorted.map((entry) => (
            <li
              key={entry.id}
              className={entry.id === editingId ? 'card entry editing' : 'card entry'}
            >
              <div className="entry-head">
                <strong>{formatDate(entry.date)}</strong>
                <span className="muted">
                  {WEATHER_LABELS[entry.weather] ?? entry.weather}
                  {entry.workers !== '' && ` · ${entry.workers} Arbeiter`}
                  {entry.author && ` · ${entry.author}`}
                </span>
              </div>
              <p className="entry-text">{entry.work}</p>
              {entry.notes && <p className="entry-text muted">{entry.notes}</p>}
              {entry.photoIds.length > 0 && (
                <ul className="thumb-grid entry-photos">
                  {entry.photoIds.map((fileId, i) => {
                    const alt = `Foto ${i + 1} vom ${formatDate(entry.date)}`
                    return (
                      <li key={fileId} className="thumb">
                        <DrivePhoto
                          fileId={fileId}
                          alt={alt}
                          className="thumb-img"
                          onOpen={(src) => setLightbox({ src, alt })}
                        />
                      </li>
                    )
                  })}
                </ul>
              )}
              <div className="entry-actions">
                <button type="button" className="link" onClick={() => startEdit(entry)}>
                  Bearbeiten
                </button>
                <button type="button" className="link danger" onClick={() => handleDelete(entry)}>
                  Löschen
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}

      {folderId && (
        <p className="muted drive-link">
          <a href={driveFolderUrl(folderId)} target="_blank" rel="noreferrer">
            Fotoordner in Google Drive öffnen ↗
          </a>
        </p>
      )}

      {lightbox && (
        <div
          className="lightbox"
          role="dialog"
          aria-modal="true"
          aria-label={lightbox.alt}
          onClick={() => setLightbox(null)}
        >
          <img src={lightbox.src} alt={lightbox.alt} />
          <button type="button" className="lightbox-close" aria-label="Schließen">
            ×
          </button>
        </div>
      )}
    </section>
  )
}

export default Diary
