import { useEffect, useRef, useState } from 'react'
import { formatDate, newId, today } from '../storage.js'
import { useCollection } from '../useCollection.js'
import { compressImage } from '../images.js'
import { connectDrive, driveFolderUrl, getDriveFolderId, uploadPhoto } from '../drive.js'
import DrivePhoto from '../components/DrivePhoto.jsx'

const WEATHER_OPTIONS = ['Sunny', 'Cloudy', 'Rain', 'Snow', 'Wind', 'Frost']

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

  async function addFiles(e) {
    const files = [...e.target.files].filter((f) => f.type.startsWith('image/'))
    e.target.value = ''
    if (files.length === 0) return
    setBusy('Preparing photos…')
    setError('')
    try {
      const added = []
      for (const file of files) {
        added.push({ key: newId(), blob: await compressImage(file) })
      }
      setForm((f) => ({ ...f, photos: [...f.photos, ...added] }))
    } catch {
      setError('One of the images could not be read. Please try a JPEG or PNG file.')
    } finally {
      setBusy('')
    }
  }

  function removeFormPhoto(key) {
    setForm({ ...form, photos: form.photos.filter((p) => p.key !== key) })
  }

  async function handleSubmit(e) {
    e.preventDefault()
    if (!form.date || !form.work.trim()) {
      setError('Please enter a date and the work carried out.')
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
          setBusy(`Uploading photo ${done} of ${pending.length}…`)
          const fileId = await uploadPhoto(photo.blob, `${form.date} Bautagebuch ${newId()}.jpg`)
          photos[index] = { key: photo.key, fileId }
          // Remember finished uploads so a retry does not upload them twice.
          setForm((f) => ({ ...f, photos: [...photos] }))
        }
      } catch (err) {
        setBusy('')
        setError(`Photo upload failed: ${err.message}`)
        return
      }
    }

    setBusy('Saving…')
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
    const photoNote = entry.photoIds.length > 0 ? ' Its photos stay in the Google Drive folder.' : ''
    if (!window.confirm(`Delete this diary entry?${photoNote}`)) return
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
        <h2>{editingId ? 'Edit entry' : 'New diary entry'}</h2>

        <label>
          Date
          <input type="date" value={form.date} onChange={setField('date')} />
        </label>
        <label>
          Weather
          <select value={form.weather} onChange={setField('weather')}>
            {WEATHER_OPTIONS.map((w) => (
              <option key={w}>{w}</option>
            ))}
          </select>
        </label>
        <label>
          Workers on site
          <input type="number" min="0" value={form.workers} onChange={setField('workers')} />
        </label>
        <label className="full">
          Work carried out
          <textarea rows="3" value={form.work} onChange={setField('work')} />
        </label>
        <label className="full">
          Notes / incidents
          <textarea rows="2" value={form.notes} onChange={setField('notes')} />
        </label>

        <div className="full photo-field">
          <span className="field-label">Photos</span>
          {form.photos.length > 0 && (
            <ul className="thumb-grid">
              {form.photos.map((photo) => (
                <li key={photo.key} className="thumb">
                  <DrivePhoto fileId={photo.fileId} blob={photo.blob} alt="" className="thumb-img" />
                  <button
                    type="button"
                    className="thumb-remove"
                    aria-label="Remove photo"
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
            Add photos
          </button>
        </div>

        {error && (
          <p className="error full" role="alert">
            {error}
          </p>
        )}

        <div className="form-actions full">
          <button type="submit" disabled={Boolean(busy)}>
            {busy || (editingId ? 'Save changes' : 'Add entry')}
          </button>
          {editingId && (
            <button type="button" className="secondary" onClick={resetForm} disabled={Boolean(busy)}>
              Cancel
            </button>
          )}
        </div>
      </form>

      {status === 'loading' && <p className="empty">Loading diary…</p>}
      {status === 'error' && (
        <p className="error" role="alert">
          {loadError}
        </p>
      )}
      {status === 'ready' && sorted.length === 0 && <p className="empty">No diary entries yet.</p>}

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
                  {entry.weather}
                  {entry.workers !== '' && ` · ${entry.workers} workers`}
                  {entry.author && ` · ${entry.author}`}
                </span>
              </div>
              <p className="entry-text">{entry.work}</p>
              {entry.notes && <p className="entry-text muted">{entry.notes}</p>}
              {entry.photoIds.length > 0 && (
                <ul className="thumb-grid entry-photos">
                  {entry.photoIds.map((fileId, i) => {
                    const alt = `Photo ${i + 1} from ${formatDate(entry.date)}`
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
                  Edit
                </button>
                <button type="button" className="link danger" onClick={() => handleDelete(entry)}>
                  Delete
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}

      {folderId && (
        <p className="muted drive-link">
          <a href={driveFolderUrl(folderId)} target="_blank" rel="noreferrer">
            Open the photo folder in Google Drive ↗
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
          <button type="button" className="lightbox-close" aria-label="Close">
            ×
          </button>
        </div>
      )}
    </section>
  )
}

export default Diary
