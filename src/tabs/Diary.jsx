import { Fragment, useCallback, useEffect, useState } from 'react'
import { today, usePersistentState } from '../storage.js'
import { ENTRY_TYPES, TYPE_KEYS, entryType, isOpen, typeKey } from '../diaryTypes.js'
import { useCollection } from '../useCollection.js'
import { useDialogs } from '../dialogs.js'
import { byOrder as itemOrder, itemFromRow, itemToRow } from '../budgetItems.js'
import { fromRow, toRow } from '../diaryEntries.js'
import { checkDetails, compareEntries, emptyForm, formFromEntry } from '../diaryForm.js'
import { entryFolderPath, uploadPending } from '../diaryUploads.js'
import { inRange, matchesContact, matchesEntry, queryWords } from '../diarySearch.js'
import { connectDrive, driveFolderUrl, getDriveFolderId } from '../drive.js'
import { connectCalendar, deleteEvent, entryHasEvent, syncEntryEvent } from '../calendar.js'
import EntryForm from '../components/EntryForm.jsx'
import EntryCard from '../components/EntryCard.jsx'
import BusyOverlay from '../components/BusyOverlay.jsx'
import Lightbox from '../components/Lightbox.jsx'

// Open entries of kinds with sortByDue (to-dos, defects) come first, by due
// date, soonest first (without one at the end of them); everything else,
// done ones included, newest first.
function compareByDue(a, b) {
  const waiting = (e) => Boolean(entryType(e.type).sortByDue) && isOpen(e)
  if (waiting(a) !== waiting(b)) return waiting(b) - waiting(a)
  if (!waiting(a)) return compareEntries(a, b)
  const due = (e) => e.details[entryType(e.type).progress.due] || '9999'
  return due(a).localeCompare(due(b)) || compareEntries(a, b)
}

// Expense categories as kept on the Finanzen tab.
function categoryFromRow(row) {
  return { id: row.id, type: row.type, name: row.name, sortOrder: row.sort_order }
}

function categoryToRow(category) {
  return { type: category.type, name: category.name, sort_order: category.sortOrder }
}

function contactFromRow(row) {
  return {
    id: row.id,
    name: row.name,
    role: row.role ?? '',
    company: row.company ?? '',
    pinned: row.pinned ?? false,
  }
}

function contactToRow(contact) {
  return { name: contact.name, role: contact.role, company: contact.company, pinned: contact.pinned }
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
  const [lightbox, setLightbox] = useState(null)
  const closeLightbox = useCallback(() => setLightbox(null), [])
  const dialogs = useDialogs()
  const categoryStore = useCollection('finance_categories', {
    fromRow: categoryFromRow,
    toRow: categoryToRow,
  })
  const contactStore = useCollection('contacts', { fromRow: contactFromRow, toRow: contactToRow })
  const itemStore = useCollection('budget_items', { fromRow: itemFromRow, toRow: itemToRow })
  const [folderId, setFolderId] = useState(null)
  const [filter, setFilter] = usePersistentState('diary.filter', 'all')
  const [openOnly, setOpenOnly] = usePersistentState('diary.openOnly', false)
  // Search text and date range; not remembered, so the diary always opens
  // showing everything.
  const [query, setQuery] = useState('')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')

  const todayDate = today()
  const expenseCategoryRows = categoryStore.rows
    .filter((c) => c.type === 'expense')
    .sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name, 'de'))
  const lists = {
    expenseCategories: expenseCategoryRows.map((c) => c.name),
    // Budget items by category name (empty until the table exists).
    budgetItems: new Map(
      expenseCategoryRows.map((c) => [
        c.name,
        itemStore.rows.filter((item) => item.categoryId === c.id).sort(itemOrder),
      ]),
    ),
    contacts: contactStore.rows,
  }

  const words = queryWords(query)
  const searching = words.length > 0 || Boolean(from || to)
  const found = entries.filter((e) => inRange(e, from, to) && matchesEntry(e, words, lists))
  const foundContacts = contactStore.rows.filter((c) => matchesContact(c, words))
  const counts = Object.fromEntries(
    TYPE_KEYS.map((key) => [key, found.filter((e) => typeKey(e.type) === key).length]),
  )
  const activeFilter = filter === 'all' || TYPE_KEYS.includes(filter) ? filter : 'all'
  // Kinds that get done (defects, to-dos) can be narrowed to open ones.
  const canFilterOpen = Boolean(ENTRY_TYPES[activeFilter]?.progress)
  const ofFilter = found.filter((e) => activeFilter === 'all' || typeKey(e.type) === activeFilter)
  const openCount = ofFilter.filter(isOpen).length
  const sorted = ofFilter
    .filter((e) => !(canFilterOpen && openOnly && !isOpen(e)))
    .sort(compareByDue)

  function clearSearch() {
    setQuery('')
    setFrom('')
    setTo('')
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
    setForm(formFromEntry(entry))
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
        await dialogs.alert(`Gespeichert, aber der Google Kalender wurde nicht aktualisiert: ${calendarProblem}`)
      }
    } catch (err) {
      await dialogs.alert(err.message)
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
    const question = `Diesen Tagebucheintrag löschen?${calendarNote}${expenseNote}${photoNote}`
    if (!(await dialogs.confirm(question, { confirmLabel: 'Löschen', danger: true }))) return
    if (eventId) {
      try {
        await connectCalendar(user.email)
        await deleteEvent(eventId)
      } catch (err) {
        const retry =
          `Der Eintrag konnte nicht aus dem Google Kalender gelöscht werden (${err.message}). ` +
          'Den Eintrag trotzdem löschen?'
        if (!(await dialogs.confirm(retry, { confirmLabel: 'Löschen', danger: true }))) return
      }
    }
    try {
      await remove(entry.id)
      if (editingId === entry.id) resetForm()
    } catch (err) {
      await dialogs.alert(err.message)
    }
  }

  return (
    <section className="tab-content">
      {busy && <BusyOverlay message={busy} progress={uploadProgress} />}
      <EntryForm
        form={form}
        setForm={setForm}
        editing={Boolean(editingId)}
        busy={busy}
        error={error}
        onClearError={() => setError('')}
        lists={lists}
        onSubmit={handleSubmit}
        onCancel={resetForm}
      />

      {status === 'loading' && <p className="empty">Tagebuch wird geladen…</p>}
      {status === 'error' && (
        <p className="error" role="alert">
          {loadError}
        </p>
      )}
      {entries.length > 0 && (
        <div className="diary-search" role="search">
          <input
            type="search"
            className="search-input"
            placeholder="Tagebuch durchsuchen (Text, Person, Ort, Kategorie, …)"
            aria-label="Tagebuch durchsuchen"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <div className="search-range">
            <label>
              von
              <input type="date" value={from} max={to || undefined} onChange={(e) => setFrom(e.target.value)} />
            </label>
            <label>
              bis
              <input type="date" value={to} min={from || undefined} onChange={(e) => setTo(e.target.value)} />
            </label>
            {searching && (
              <button type="button" className="link" onClick={clearSearch}>
                Suche zurücksetzen
              </button>
            )}
          </div>
          {foundContacts.length > 0 && (
            <p className="search-contacts">
              <span className="muted">Kontakte: </span>
              {foundContacts.map((contact, i) => (
                <Fragment key={contact.id}>
                  {i > 0 && ', '}
                  <button type="button" className="link" onClick={() => onOpenContact(contact)}>
                    {contact.name}
                  </button>
                  {contact.role && <span className="muted"> ({contact.role})</span>}
                </Fragment>
              ))}
            </p>
          )}
        </div>
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
                <span className="chip-count">{key === 'all' ? found.length : counts[key]}</span>
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
        <p className="empty">
          {words.length > 0 ? `Keine Einträge passen zu „${query.trim()}“.` : 'Keine passenden Einträge.'}
        </p>
      )}

      {sorted.length > 0 && (
        <ul className="entry-list">
          {sorted.map((entry) => (
            <EntryCard
              key={entry.id}
              entry={entry}
              editing={entry.id === editingId}
              todayDate={todayDate}
              lists={lists}
              onOpenContact={onOpenContact}
              onOpenPhoto={setLightbox}
              onToggleDone={toggleDone}
              onEdit={startEdit}
              onDelete={handleDelete}
            />
          ))}
        </ul>
      )}

      {folderId && (
        <p className="muted drive-link">
          <a href={driveFolderUrl(folderId)} target="_blank" rel="noreferrer">
            Ordner in Google Drive öffnen ↗
          </a>
        </p>
      )}

      {lightbox && <Lightbox src={lightbox.src} alt={lightbox.alt} onClose={closeLightbox} />}
    </section>
  )
}

export default Diary
