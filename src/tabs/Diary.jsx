import { Fragment, useEffect, useRef, useState } from 'react'
import { formatDate, newId, today, usePersistentState } from '../storage.js'
import {
  ENTRY_TYPES,
  TYPE_KEYS,
  defaultDetails,
  entryType,
  isOpen,
  isOverdue,
  typeKey,
} from '../diaryTypes.js'
import { useCollection } from '../useCollection.js'
import PeopleInput from '../components/PeopleInput.jsx'
import PeopleLinks from '../components/PeopleLinks.jsx'
import { fromRow, toRow } from '../diaryEntries.js'
import {
  connectDrive,
  driveFileUrl,
  driveFolderUrl,
  getDriveFolderId,
  getEntryFolderId,
  uploadFile,
  uploadPhoto,
} from '../drive.js'
import { connectCalendar, deleteEvent, entryHasEvent, syncEntryEvent } from '../calendar.js'
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

// Keeps the original file type in the Drive file name (".jpg", ".heic", …).
function extension(file) {
  const match = /\.[a-z0-9]+$/i.exec(file.name ?? '')
  return match ? match[0].toLowerCase() : '.jpg'
}

// Drive folder of an entry's photos and files: <kind>/<creation date>,
// e.g. ['Mangel', '2026_10_02'] (created now for a new entry).
function entryFolderPath(type, createdAt) {
  const created = createdAt ? new Date(createdAt) : new Date()
  const pad = (n) => String(n).padStart(2, '0')
  const day = `${created.getFullYear()}_${pad(created.getMonth() + 1)}_${pad(created.getDate())}`
  return [entryType(type).label, day]
}

// Uploads the photos and files not yet in Drive, one after another, into
// the folder at folderPath. onProgress(n) runs before the n-th upload,
// onProgress(n, uploaded) after it, with the form's photos and files as
// far as they are uploaded.
async function uploadPending({ photos, files, date }, folderPath, onProgress) {
  const uploaded = { photos: [...photos], files: [...files] }
  const jobs = [
    ...photos.map((item, index) => ({ item, index, list: 'photos' })),
    ...files.map((item, index) => ({ item, index, list: 'files' })),
  ].filter((job) => job.item.blob)
  // Progress by bytes, so one large photo on a slow connection still moves.
  const totalBytes = jobs.reduce((sum, job) => sum + job.item.blob.size, 0) || 1
  let doneBytes = 0
  for (const [n, { item, index, list }] of jobs.entries()) {
    const report = (loaded) =>
      onProgress({ current: n + 1, total: jobs.length, fraction: (doneBytes + loaded) / totalBytes })
    report(0)
    const folderId = await getEntryFolderId(folderPath)
    const { blob, ...rest } = item
    const fileId =
      list === 'photos'
        ? await uploadPhoto(blob, `${date} Bautagebuch ${newId()}${extension(blob)}`, folderId, report)
        : await uploadFile(blob, `${date} ${blob.name}`, folderId, report)
    doneBytes += blob.size
    uploaded[list] = uploaded[list].with(index, { ...rest, fileId })
    onProgress({ current: n + 1, total: jobs.length, fraction: doneBytes / totalBytes }, { ...uploaded })
  }
  return uploaded
}

// Which entries also go into the Google Calendar (see calendar.js).
const CALENDAR_HINTS = {
  appointment: 'Termine werden auch im Google Kalender (Zeitplan) eingetragen.',
  todo: 'Aufgaben werden am Tag „Erledigen bis“ im Google Kalender (Zeitplan) eingetragen.',
  defect: 'Mängel mit „Zu beheben bis“ werden an diesem Tag im Google Kalender (Zeitplan) eingetragen.',
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
    details: defaultDetails(type),
    photos: [],
    // files: { key, fileId, name } in Drive, or { key, blob, name } new.
    files: [],
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

// Expense categories as kept on the Finanzen tab.
function categoryFromRow(row) {
  return { id: row.id, type: row.type, name: row.name, sortOrder: row.sort_order }
}

function categoryToRow(category) {
  return { type: category.type, name: category.name, sort_order: category.sortOrder }
}

function contactFromRow(row) {
  return { id: row.id, name: row.name, role: row.role ?? '', company: row.company ?? '' }
}

function contactToRow(contact) {
  return { name: contact.name, role: contact.role, company: contact.company }
}

function DetailField({ field, value, options, lists, onChange }) {
  if (field.suggestFrom) {
    return <PeopleInput value={value} onChange={onChange} contacts={lists[field.suggestFrom] ?? []} />
  }
  if (field.kind === 'amount') {
    return (
      <input type="number" min="0" step="0.01" inputMode="decimal" value={value} onChange={onChange} />
    )
  }
  if (field.kind === 'select') {
    return (
      <select value={value} onChange={onChange}>
        {Object.entries(options).map(([key, label]) => (
          <option key={key} value={key}>
            {label}
          </option>
        ))}
      </select>
    )
  }
  return <input type={field.kind} value={value} onChange={onChange} />
}

// A select's choices; a value no longer in its list stays selectable.
function fieldOptions(field, value, lists) {
  if (field.options) return field.options
  const names = lists[field.optionsFrom] ?? []
  const all = !value || names.includes(value) ? names : [...names, value]
  return Object.fromEntries(all.map((name) => [name, name]))
}

// The extra fields as they are saved, or why they cannot be.
// An empty select means its first choice, as shown in the form.
function checkDetails(type, formDetails, lists) {
  const details = defaultDetails(type, formDetails)
  for (const field of entryType(type).fields) {
    if (field.kind === 'select' && !details[field.key]) {
      details[field.key] = Object.keys(fieldOptions(field, '', lists))[0] ?? ''
    }
    if (field.suggestFrom) {
      // Drop the ", " left after picking the last suggestion.
      details[field.key] = details[field.key].replace(/[\s,]+$/, '')
    }
    if (field.kind === 'amount' && details[field.key] !== '') {
      details[field.key] = Math.round(Number(details[field.key]) * 100) / 100
      if (!(details[field.key] > 0)) return { error: 'Bitte einen Betrag größer als 0 eingeben.' }
    }
    if (field.required && !details[field.key]) {
      return {
        error:
          field.optionsFrom === 'expenseCategories'
            ? 'Bitte zuerst in den Finanzen eine Ausgabenkategorie anlegen.'
            : `Bitte „${field.label}“ ausfüllen.`,
      }
    }
  }
  return { details }
}

// The extra fields of an entry as short texts for the list ("14:00 Uhr", …).
// People who are contacts link to them.
function detailSummaries(entry, lists, onOpenContact) {
  return entryType(entry.type)
    .fields.filter((field) => !field.pill && entry.details[field.key])
    .map((field) => {
      let value = entry.details[field.key]
      if (field.suggestFrom) {
        value = (
          <PeopleLinks text={value} contacts={lists[field.suggestFrom] ?? []} onOpen={onOpenContact} />
        )
      }
      if (field.summary) return field.summary(value)
      return field.kind === 'select' ? (field.options?.[value] ?? value) : value
    })
}

function Diary({ user, focusEntryId, onFocused, onOpenContact }) {
  const { rows: entries, status, error: loadError, insert, update, remove } = useCollection(
    'diary_entries',
    { fromRow, toRow },
  )
  const [form, setForm] = useState(emptyForm)
  const [editingId, setEditingId] = useState(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState('')
  const [uploadProgress, setUploadProgress] = useState(null)
  const errorRef = useRef(null)
  const [lightbox, setLightbox] = useState(null)
  const categoryStore = useCollection('finance_categories', {
    fromRow: categoryFromRow,
    toRow: categoryToRow,
  })
  const contactStore = useCollection('contacts', { fromRow: contactFromRow, toRow: contactToRow })
  const [folderId, setFolderId] = useState(null)
  const [filter, setFilter] = usePersistentState('diary.filter', 'all')
  const [openOnly, setOpenOnly] = usePersistentState('diary.openOnly', false)
  const fileInput = useRef(null)
  const cameraInput = useRef(null)
  const attachInput = useRef(null)

  const counts = Object.fromEntries(
    TYPE_KEYS.map((key) => [key, entries.filter((e) => typeKey(e.type) === key).length]),
  )
  const activeFilter = filter === 'all' || TYPE_KEYS.includes(filter) ? filter : 'all'
  // Kinds that get done (defects, to-dos) can be narrowed to open ones.
  const canFilterOpen = Boolean(ENTRY_TYPES[activeFilter]?.progress)
  const ofFilter = entries.filter((e) => activeFilter === 'all' || typeKey(e.type) === activeFilter)
  const openCount = ofFilter.filter(isOpen).length
  const sorted = ofFilter
    .filter((e) => !(canFilterOpen && openOnly && !isOpen(e)))
    .sort(compareEntries)
  const todayDate = today()
  const formType = entryType(form.type)
  const lists = {
    expenseCategories: categoryStore.rows
      .filter((c) => c.type === 'expense')
      .sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name, 'de'))
      .map((c) => c.name),
    contacts: contactStore.rows,
  }


  useEffect(() => {
    getDriveFolderId().then(setFolderId, () => {})
  }, [])

  // Opened from the start page: scroll to that entry and flash it.
  useEffect(() => {
    if (!focusEntryId || status !== 'ready') return
    const element = document.getElementById(`entry-${focusEntryId}`)
    if (element) {
      element.scrollIntoView({ block: 'center' })
      const accent = getComputedStyle(element).getPropertyValue('--accent')
      element.animate(
        [{ boxShadow: `0 0 0 3px ${accent}` }, { boxShadow: '0 0 0 3px transparent' }],
        { duration: 2500, easing: 'ease-in' },
      )
    }
    onFocused()
  }, [focusEntryId, status, onFocused])

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

  // Any kind of file (PDF, plan, offer, …), kept in Drive's file folder.
  function addAttachments(e) {
    const picked = [...e.target.files]
    e.target.value = ''
    if (picked.length === 0) return
    setError('')
    const added = picked.map((file) => ({ key: newId(), blob: file, name: file.name }))
    setForm((f) => ({ ...f, files: [...f.files, ...added] }))
  }

  function removeFormFile(key) {
    setForm({ ...form, files: form.files.filter((f) => f.key !== key) })
  }

  function removeFormPhoto(key) {
    setForm({ ...form, photos: form.photos.filter((p) => p.key !== key) })
  }

  // Bring a failed upload's message into view once the overlay closes.
  useEffect(() => {
    if (error) errorRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' })
  }, [error])

  // While saving, warn before the page is closed or reloaded, which would
  // cancel the upload.
  useEffect(() => {
    if (!busy) return
    const warn = (e) => e.preventDefault()
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [busy])

  async function handleSubmit(e) {
    e.preventDefault()
    if (!form.date || !form.work.trim()) {
      const { dateLabel, textLabel } = entryType(form.type)
      setError(`Bitte ${dateLabel} und „${textLabel}“ ausfüllen.`)
      return
    }
    const { details, error: detailsError } = checkDetails(form.type, form.details, lists)
    if (detailsError) {
      setError(detailsError)
      return
    }
    setError('')

    // Appointments, and to-dos and defects with a due date, also go into
    // the Google Calendar (Zeitplan). Connect first, while the click still
    // counts as user action, otherwise the browser blocks Google's popup.
    // If the calendar fails, the entry is still saved, with a note.
    const original = entries.find((e) => e.id === editingId)
    const oldEventId = original?.details.calendarEventId
    const calendarEntry = { type: form.type, date: form.date, work: form.work.trim(), details }
    const hasEvent = entryHasEvent(calendarEntry)
    let calendarProblem = ''
    let calendarConnected = false
    if (hasEvent || oldEventId) {
      try {
        await connectCalendar(user.email)
        calendarConnected = true
      } catch (err) {
        calendarProblem = err.message
      }
    }

    const pending = [...form.photos, ...form.files].filter((p) => p.blob).length
    let uploaded = { photos: form.photos, files: form.files }
    if (pending > 0) {
      try {
        // Must run first, while the click still counts as user action,
        // otherwise the browser blocks Google's popup.
        await connectDrive(user.email)
        const createdAt = original?.createdAt
        const folderPath = entryFolderPath(form.type, editingId ? createdAt : null)
        uploaded = await uploadPending(form, folderPath, (progress, sofar) => {
          setUploadProgress(progress)
          setBusy(
            pending === 1
              ? 'Wird hochgeladen…'
              : `Datei ${progress.current} von ${progress.total} wird hochgeladen…`,
          )
          // Remember finished uploads so a retry does not upload them twice.
          if (sofar) setForm((f) => ({ ...f, ...sofar }))
        })
        setUploadProgress(null)
      } catch (err) {
        setUploadProgress(null)
        setBusy('')
        setError(`Upload fehlgeschlagen: ${err.message}`)
        return
      }
    }

    setBusy('Wird gespeichert…')
    let calendarEventId = hasEvent ? oldEventId : null
    if (calendarConnected) {
      try {
        calendarEventId = await syncEntryEvent(calendarEntry, oldEventId)
      } catch (err) {
        calendarProblem = err.message
      }
    }
    const entry = {
      type: form.type,
      date: form.date,
      weather: form.weather,
      workers: form.workers,
      work: form.work.trim(),
      details: calendarEventId ? { ...details, calendarEventId } : details,
      photoIds: uploaded.photos.map((p) => p.fileId),
      files: uploaded.files.map((f) => ({ id: f.fileId, name: f.name })),
    }
    try {
      if (editingId) {
        await update(editingId, entry)
      } else {
        await insert(entry)
      }
      resetForm()
      if (calendarProblem) {
        setError(`Gespeichert, aber der Google Kalender wurde nicht aktualisiert: ${calendarProblem}`)
      }
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
      details: defaultDetails(entry.type, entry.details),
      photos: entry.photoIds.map((fileId) => ({ key: fileId, fileId })),
      files: entry.files.map((f) => ({ key: f.id, fileId: f.id, name: f.name })),
    })
    setEditingId(entry.id)
    setError('')
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  async function toggleDone(entry) {
    const { field, done } = entryType(entry.type).progress
    const details = { ...entry.details, [field]: isOpen(entry) ? done : 'open' }
    // The calendar event shows "✓" once done.
    let calendarProblem = ''
    if (entryHasEvent({ ...entry, details }) || details.calendarEventId) {
      try {
        await connectCalendar(user.email)
        const eventId = await syncEntryEvent({ ...entry, details }, details.calendarEventId)
        if (eventId) details.calendarEventId = eventId
        else delete details.calendarEventId
      } catch (err) {
        calendarProblem = err.message
      }
    }
    try {
      await update(entry.id, { ...entry, details })
      if (calendarProblem) {
        window.alert(`Gespeichert, aber der Google Kalender wurde nicht aktualisiert: ${calendarProblem}`)
      }
    } catch (err) {
      window.alert(err.message)
    }
  }

  async function handleDelete(entry) {
    const photoNote =
      entry.photoIds.length > 0 || entry.files.length > 0
        ? ' Fotos und Dateien bleiben in Google Drive.'
        : ''
    const expenseNote =
      typeKey(entry.type) === 'expense' ? ' Die Ausgabe wird auch aus den Finanzen gelöscht.' : ''
    const eventId = entry.details.calendarEventId
    const calendarNote = eventId ? ' Er wird auch aus dem Google Kalender gelöscht.' : ''
    if (!window.confirm(`Diesen Tagebucheintrag löschen?${calendarNote}${expenseNote}${photoNote}`)) return
    if (eventId) {
      try {
        await connectCalendar(user.email)
        await deleteEvent(eventId)
      } catch (err) {
        const question =
          `Der Eintrag konnte nicht aus dem Google Kalender gelöscht werden (${err.message}). ` +
          'Den Eintrag trotzdem löschen?'
        if (!window.confirm(question)) return
      }
    }
    try {
      await remove(entry.id)
      if (editingId === entry.id) resetForm()
    } catch (err) {
      window.alert(err.message)
    }
  }

  return (
    <section className="tab-content">
      {busy && (
        <div className="busy-overlay" role="alertdialog" aria-modal="true" aria-live="polite" aria-label={busy}>
          <div className="busy-box">
            <span className="spinner busy-spinner" aria-hidden="true" />
            <p>{busy}</p>
            {uploadProgress && (
              <div className="busy-bar" aria-hidden="true">
                <div style={{ width: `${Math.round(uploadProgress.fraction * 100)}%` }} />
              </div>
            )}
            <p className="muted busy-note">Bitte die Seite nicht schließen.</p>
          </div>
        </div>
      )}
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
              options={field.kind === 'select' ? fieldOptions(field, form.details[field.key], lists) : null}
              lists={lists}
              onChange={setDetail(field.key)}
            />
          </label>
        ))}
        <label className="full">
          {formType.textLabel}
          <textarea rows="4" value={form.work} onChange={setField('work')} />
        </label>

        <div className="full photo-field">
          <span className="field-label">Fotos und Dateien</span>
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
          {form.files.length > 0 && (
            <ul className="file-list">
              {form.files.map((file) => (
                <li key={file.key} className="file-chip">
                  <span className="file-name">{file.name}</span>
                  <button
                    type="button"
                    className="link danger"
                    aria-label={`${file.name} entfernen`}
                    onClick={() => removeFormFile(file.key)}
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
          {/* Opens the camera directly; the gallery picker on some phones has no camera option. */}
          <input
            ref={cameraInput}
            type="file"
            accept="image/*"
            capture="environment"
            hidden
            onChange={addFiles}
          />
          <input ref={attachInput} type="file" multiple hidden onChange={addAttachments} />
          <div className="upload-buttons">
            <button
              type="button"
              className="secondary camera-button"
              onClick={() => cameraInput.current.click()}
              disabled={Boolean(busy)}
            >
              Foto aufnehmen
            </button>
            <button
              type="button"
              className="secondary"
              onClick={() => fileInput.current.click()}
              disabled={Boolean(busy)}
            >
              Fotos hinzufügen
            </button>
            <button
              type="button"
              className="secondary"
              onClick={() => attachInput.current.click()}
              disabled={Boolean(busy)}
            >
              Dateien hinzufügen
            </button>
          </div>
        </div>

        {CALENDAR_HINTS[form.type] && (
          <p className="form-hint muted full">{CALENDAR_HINTS[form.type]}</p>
        )}

        {error && (
          <p ref={errorRef} className="error full" role="alert">
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
          {canFilterOpen && (
            <label className="open-only">
              <input
                type="checkbox"
                checked={openOnly}
                onChange={(e) => setOpenOnly(e.target.checked)}
              />
              Nur offene ({openCount})
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
              ...detailSummaries(entry, lists, onOpenContact),
              entry.author,
            ].filter(Boolean)
            const pills = type.fields.filter((f) => f.pill && entry.details[f.key])
            return (
            <li
              key={entry.id}
              id={`entry-${entry.id}`}
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
                  {isOverdue(entry, todayDate) && (
                    <span className="state-pill state-overdue">Überfällig</span>
                  )}
                  {key === 'appointment' && entry.date >= todayDate && (
                    <span className="state-pill state-upcoming">Bevorstehend</span>
                  )}
                </span>
                <span className="muted">
                  {meta.map((part, i) => (
                    <Fragment key={i}>
                      {i > 0 && ' · '}
                      {part}
                    </Fragment>
                  ))}
                </span>
              </div>
              <p className="entry-text">{entry.work}</p>
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
              {entry.files.length > 0 && (
                <ul className="file-list entry-files">
                  {entry.files.map((file) => (
                    <li key={file.id}>
                      <a
                        className="file-chip"
                        href={driveFileUrl(file.id)}
                        target="_blank"
                        rel="noreferrer"
                      >
                        <span aria-hidden="true">📄</span>
                        <span className="file-name">{file.name}</span>
                      </a>
                    </li>
                  ))}
                </ul>
              )}
              <div className="entry-actions">
                {type.progress && (
                  <button type="button" className="link" onClick={() => toggleDone(entry)}>
                    {isOpen(entry) ? type.progress.markDone : type.progress.reopen}
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
            Ordner in Google Drive öffnen ↗
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
