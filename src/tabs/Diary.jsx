import { useEffect, useRef, useState } from 'react'
import { formatDate, newId, today, usePersistentState } from '../storage.js'
import { compressImage, deleteImage, putImage } from '../imageStore.js'
import StoredImage from '../components/StoredImage.jsx'

const WEATHER_OPTIONS = ['Sunny', 'Cloudy', 'Rain', 'Snow', 'Wind', 'Frost']

function emptyForm() {
  return { date: today(), weather: 'Sunny', workers: '', work: '', notes: '', images: [] }
}

function Diary({ storageKey }) {
  const [entries, setEntries] = usePersistentState(storageKey, [])
  const [form, setForm] = useState(emptyForm)
  const [editingId, setEditingId] = useState(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [lightbox, setLightbox] = useState(null)
  const fileInput = useRef(null)

  const sorted = [...entries].sort((a, b) => b.date.localeCompare(a.date))

  useEffect(() => {
    if (!lightbox) return
    const close = (e) => e.key === 'Escape' && setLightbox(null)
    window.addEventListener('keydown', close)
    return () => window.removeEventListener('keydown', close)
  }, [lightbox])

  function update(field) {
    return (e) => setForm({ ...form, [field]: e.target.value })
  }

  async function addFiles(e) {
    const files = [...e.target.files].filter((f) => f.type.startsWith('image/'))
    e.target.value = ''
    if (files.length === 0) return
    setBusy(true)
    setError('')
    try {
      const added = []
      for (const file of files) {
        added.push({ id: newId(), blob: await compressImage(file) })
      }
      setForm((f) => ({ ...f, images: [...f.images, ...added] }))
    } catch {
      setError('One of the images could not be read. Please try a JPEG or PNG file.')
    } finally {
      setBusy(false)
    }
  }

  function removeFormImage(id) {
    setForm({ ...form, images: form.images.filter((img) => img.id !== id) })
  }

  async function handleSubmit(e) {
    e.preventDefault()
    if (!form.date || !form.work.trim()) {
      setError('Please enter a date and the work carried out.')
      return
    }

    setBusy(true)
    try {
      // Store new photos first so an entry never points at a missing image.
      for (const img of form.images) {
        if (img.blob) await putImage(img.id, img.blob)
      }
    } catch {
      setBusy(false)
      setError('The photos could not be saved. The browser storage may be full.')
      return
    }

    const imageIds = form.images.map((img) => img.id)
    const entry = {
      date: form.date,
      weather: form.weather,
      workers: form.workers === '' ? '' : Number(form.workers),
      work: form.work.trim(),
      notes: form.notes.trim(),
      images: imageIds,
    }

    if (editingId) {
      const previous = entries.find((x) => x.id === editingId)
      const removed = (previous?.images ?? []).filter((id) => !imageIds.includes(id))
      removed.forEach((id) => deleteImage(id).catch(() => {}))
      setEntries(entries.map((x) => (x.id === editingId ? { ...entry, id: editingId } : x)))
    } else {
      setEntries([...entries, { ...entry, id: newId() }])
    }
    setBusy(false)
    resetForm()
  }

  function resetForm() {
    setForm(emptyForm())
    setEditingId(null)
    setError('')
  }

  function startEdit(entry) {
    setForm({
      ...entry,
      workers: String(entry.workers ?? ''),
      images: (entry.images ?? []).map((id) => ({ id })),
    })
    setEditingId(entry.id)
    setError('')
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  function remove(entry) {
    if (!window.confirm('Delete this diary entry and its photos?')) return
    ;(entry.images ?? []).forEach((id) => deleteImage(id).catch(() => {}))
    setEntries(entries.filter((x) => x.id !== entry.id))
    if (editingId === entry.id) resetForm()
  }

  return (
    <section className="tab-content">
      <form className="card form-grid" onSubmit={handleSubmit} noValidate>
        <h2>{editingId ? 'Edit entry' : 'New diary entry'}</h2>

        <label>
          Date
          <input type="date" value={form.date} onChange={update('date')} />
        </label>
        <label>
          Weather
          <select value={form.weather} onChange={update('weather')}>
            {WEATHER_OPTIONS.map((w) => (
              <option key={w}>{w}</option>
            ))}
          </select>
        </label>
        <label>
          Workers on site
          <input
            type="number"
            min="0"
            value={form.workers}
            onChange={update('workers')}
          />
        </label>
        <label className="full">
          Work carried out
          <textarea rows="3" value={form.work} onChange={update('work')} />
        </label>
        <label className="full">
          Notes / incidents
          <textarea rows="2" value={form.notes} onChange={update('notes')} />
        </label>

        <div className="full photo-field">
          <span className="field-label">Photos</span>
          {form.images.length > 0 && (
            <ul className="thumb-grid">
              {form.images.map((img) => (
                <li key={img.id} className="thumb">
                  <StoredImage id={img.id} blob={img.blob} alt="" className="thumb-img" />
                  <button
                    type="button"
                    className="thumb-remove"
                    aria-label="Remove photo"
                    onClick={() => removeFormImage(img.id)}
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
            disabled={busy}
          >
            {busy ? 'Processing…' : 'Add photos'}
          </button>
        </div>

        {error && (
          <p className="error full" role="alert">
            {error}
          </p>
        )}

        <div className="form-actions full">
          <button type="submit" disabled={busy}>
            {editingId ? 'Save changes' : 'Add entry'}
          </button>
          {editingId && (
            <button type="button" className="secondary" onClick={resetForm}>
              Cancel
            </button>
          )}
        </div>
      </form>

      {sorted.length === 0 ? (
        <p className="empty">No diary entries yet.</p>
      ) : (
        <ul className="entry-list">
          {sorted.map((entry) => (
            <li key={entry.id} className="card entry">
              <div className="entry-head">
                <strong>{formatDate(entry.date)}</strong>
                <span className="muted">
                  {entry.weather}
                  {entry.workers !== '' && ` · ${entry.workers} workers`}
                </span>
              </div>
              <p className="entry-text">{entry.work}</p>
              {entry.notes && <p className="entry-text muted">{entry.notes}</p>}
              {entry.images?.length > 0 && (
                <ul className="thumb-grid entry-photos">
                  {entry.images.map((id, i) => (
                    <li key={id} className="thumb">
                      <StoredImage
                        id={id}
                        alt={`Photo ${i + 1} from ${formatDate(entry.date)}`}
                        className="thumb-img"
                        onClick={(src) =>
                          setLightbox({ src, alt: `Photo ${i + 1} from ${formatDate(entry.date)}` })
                        }
                      />
                    </li>
                  ))}
                </ul>
              )}
              <div className="entry-actions">
                <button type="button" className="link" onClick={() => startEdit(entry)}>
                  Edit
                </button>
                <button type="button" className="link danger" onClick={() => remove(entry)}>
                  Delete
                </button>
              </div>
            </li>
          ))}
        </ul>
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
