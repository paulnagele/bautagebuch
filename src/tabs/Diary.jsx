import { useEffect, useRef, useState } from 'react'
import { formatDate, newId, today, usePersistentState } from '../storage.js'
import { ENTRY_TYPES, TYPE_KEYS, defaultDetails, entryType, typeKey } from '../diaryTypes.js'
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
    type: row.entry_type ?? 'status',
    date: row.entry_date,
    weather: row.weather,
    workers: row.workers ?? '',
    work: row.work,
    notes: row.notes,
    details: row.details ?? {},
    photoIds: row.photo_ids ?? [],
    author: row.author_name,
  }
}

function toRow(entry) {
  const siteInfo = entryType(entry.type).siteInfo
  return {
    entry_type: entry.type,
    entry_date: entry.date,
    weather: siteInfo ? entry.weather : '',
    workers: !siteInfo || entry.workers === '' ? null : Number(entry.workers),
    work: entry.work,
    notes: entry.notes,
    details: entry.details,
    photo_ids: entry.photoIds,
    updated_at: new Date().toISOString(),
  }
}

// Keeps the original file type in the Drive file name (".jpg", ".heic", …).
function extension(file) {
  const match = /\.[a-z0-9]+$/i.exec(file.name ?? '')
  return match ? match[0].toLowerCase() : '.jpg'
}

function emptyForm(type = 'status') {
  // photos: { key, fileId } for photos already in Drive,
  //         { key, blob } for new ones that still need uploading.
  return {
    type,
    date: today(),
    weather: 'Sunny',
    workers: '',
    work: '',
    notes: '',
    details: defaultDetails(type),
    photos: [],
  }
}

// Newest first; entries on the same day by time (appointments), then by
// when they were written.
function compareEntries(a, b) {
  return (
    b.date.localeCompare(a.date) ||
    (b.details.time ?? '').localeCompare(a.details.time ?? '')
  )
}

function DetailField({ field, value, onChange }) {
  if (field.kind === 'select') {
    return (
      <select value={value} onChange={onChange}>
        {Object.entries(field.options).map(([key, label]) => (
          <option key={key} value={key}>
            {label}
          </option>
        ))}
      </select>
    )
  }
  return <input type={field.kind} value={value} onChange={onChange} />
}

// The extra fields of an entry as short texts for the list ("14:00 Uhr", …).
function detailSummaries(entry) {
  return entryType(entry.type)
    .fields.filter((field) => !field.pill && entry.details[field.key])
    .map((field) => {
      const value = entry.details[field.key]
      if (field.summary) return field.summary(value)
      return field.kind === 'select' ? (field.options[value] ?? value) : value
    })
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
  const [filter, setFilter] = usePersistentState('diary.filter', 'all')
  const [openOnly, setOpenOnly] = usePersistentState('diary.openDefectsOnly', false)
  const fileInput = useRef(null)

  const counts = Object.fromEntries(
    TYPE_KEYS.map((key) => [key, entries.filter((e) => typeKey(e.type) === key).length]),
  )
  const openDefects = entries.filter((e) => e.type === 'defect' && e.details.state !== 'fixed').length
  const activeFilter = filter === 'all' || TYPE_KEYS.includes(filter) ? filter : 'all'
  const sorted = entries
    .filter((e) => activeFilter === 'all' || typeKey(e.type) === activeFilter)
    .filter((e) => !(activeFilter === 'defect' && openOnly && e.details.state === 'fixed'))
    .sort(compareEntries)
  const formType = entryType(form.type)

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

  function setDetail(key) {
    return (e) => setForm({ ...form, details: { ...form.details, [key]: e.target.value } })
  }

  function chooseType(type) {
    setForm({
      ...form,
      type,
      weather: form.weather || 'Sunny',
      details: defaultDetails(type, form.details),
    })
    setError('')
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
      const { dateLabel, textLabel } = entryType(form.type)
      setError(`Bitte ${dateLabel} und „${textLabel}“ ausfüllen.`)
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
      type: form.type,
      date: form.date,
      weather: form.weather,
      workers: form.workers,
      work: form.work.trim(),
      notes: form.notes.trim(),
      details: defaultDetails(form.type, form.details),
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
    // Keep the chosen kind: several defects are often noted in a row.
    setForm(emptyForm(form.type))
    setEditingId(null)
    setError('')
  }

  function startEdit(entry) {
    setForm({
      type: typeKey(entry.type),
      date: entry.date,
      weather: entry.weather || 'Sunny',
      workers: String(entry.workers),
      work: entry.work,
      notes: entry.notes,
      details: defaultDetails(entry.type, entry.details),
      photos: entry.photoIds.map((fileId) => ({ key: fileId, fileId })),
    })
    setEditingId(entry.id)
    setError('')
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  async function toggleDefect(entry) {
    const fixed = entry.details.state === 'fixed'
    try {
      await update(entry.id, {
        ...entry,
        details: { ...entry.details, state: fixed ? 'open' : 'fixed' },
      })
    } catch (err) {
      window.alert(err.message)
    }
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

        <div className="full type-picker" role="radiogroup" aria-label="Art des Eintrags">
          {TYPE_KEYS.map((key) => (
            <button
              key={key}
              type="button"
              role="radio"
              aria-checked={form.type === key}
              className={`type-option type-${key}${form.type === key ? ' selected' : ''}`}
              onClick={() => chooseType(key)}
              disabled={Boolean(busy)}
            >
              {ENTRY_TYPES[key].label}
            </button>
          ))}
        </div>

        <label>
          {formType.dateLabel}
          <input type="date" value={form.date} onChange={setField('date')} />
        </label>
        {formType.siteInfo && (
          <>
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
          </>
        )}
        {formType.fields.map((field) => (
          <label key={field.key}>
            {field.label}
            <DetailField
              field={field}
              value={form.details[field.key] ?? ''}
              onChange={setDetail(field.key)}
            />
          </label>
        ))}
        <label className="full">
          {formType.textLabel}
          <textarea rows="3" value={form.work} onChange={setField('work')} />
        </label>
        <label className="full">
          {formType.notesLabel}
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
      {entries.length > 0 && (
        <div className="diary-filter">
          <div className="filter-chips" role="group" aria-label="Einträge filtern">
            {['all', ...TYPE_KEYS].map((key) => (
              <button
                key={key}
                type="button"
                aria-pressed={activeFilter === key}
                className={activeFilter === key ? 'chip active' : 'chip'}
                onClick={() => setFilter(key)}
              >
                {key === 'all' ? 'Alle' : ENTRY_TYPES[key].plural}{' '}
                <span className="chip-count">{key === 'all' ? entries.length : counts[key]}</span>
              </button>
            ))}
          </div>
          {activeFilter === 'defect' && (
            <label className="open-only">
              <input
                type="checkbox"
                checked={openOnly}
                onChange={(e) => setOpenOnly(e.target.checked)}
              />
              Nur offene ({openDefects})
            </label>
          )}
        </div>
      )}

      {status === 'ready' && entries.length === 0 && <p className="empty">Noch keine Tagebucheinträge.</p>}
      {status === 'ready' && entries.length > 0 && sorted.length === 0 && (
        <p className="empty">Keine passenden Einträge.</p>
      )}

      {sorted.length > 0 && (
        <ul className="entry-list">
          {sorted.map((entry) => {
            const type = entryType(entry.type)
            const key = typeKey(entry.type)
            const meta = [
              ...(type.siteInfo
                ? [
                    WEATHER_LABELS[entry.weather] ?? entry.weather,
                    entry.workers !== '' && `${entry.workers} Arbeiter`,
                  ]
                : []),
              ...detailSummaries(entry),
              entry.author,
            ].filter(Boolean)
            const pills = type.fields.filter((f) => f.pill && entry.details[f.key])
            return (
            <li
              key={entry.id}
              className={`card entry type-${key}${entry.id === editingId ? ' editing' : ''}`}
            >
              <div className="entry-head">
                <span className="entry-title">
                  <span className={`type-badge type-${key}`}>{type.label}</span>
                  <strong>{formatDate(entry.date)}</strong>
                  {pills.map((f) => (
                    <span key={f.key} className={`state-pill state-${entry.details[f.key]}`}>
                      {f.options[entry.details[f.key]] ?? entry.details[f.key]}
                    </span>
                  ))}
                  {key === 'appointment' && entry.date >= today() && (
                    <span className="state-pill state-upcoming">Bevorstehend</span>
                  )}
                </span>
                <span className="muted">{meta.join(' · ')}</span>
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
                {key === 'defect' && (
                  <button type="button" className="link" onClick={() => toggleDefect(entry)}>
                    {entry.details.state === 'fixed' ? 'Wieder öffnen' : 'Als behoben markieren'}
                  </button>
                )}
                <button type="button" className="link" onClick={() => startEdit(entry)}>
                  Bearbeiten
                </button>
                <button type="button" className="link danger" onClick={() => handleDelete(entry)}>
                  Löschen
                </button>
              </div>
            </li>
            )
          })}
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
