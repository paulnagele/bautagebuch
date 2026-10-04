import { Fragment, useCallback, useEffect, useRef, useState } from 'react'
import { today, usePersistentState } from '../storage.js'
import { ENTRY_TYPES, TYPE_KEYS, entryType, isOpen, typeKey } from '../diaryTypes.js'
import { useCollection } from '../useCollection.js'
import { useDialogs } from '../dialogs.js'
import { byOrder as itemOrder, itemFromRow, itemToRow } from '../budgetItems.js'
import { fromRow, toRow } from '../diaryEntries.js'
import { checkDetails, emptyForm, formFromEntry } from '../diaryForm.js'
import { diarySections } from '../diarySections.js'
import { entryFolderPath, uploadPending } from '../diaryUploads.js'
import { inRange, matchesContact, matchesEntry, queryWords } from '../diarySearch.js'
import { connectDrive, driveFolderUrl, getDriveFolderId } from '../drive.js'
import { assignDocument, assignmentFromRow, assignmentToRow, unmarkDocument } from '../documents.js'
import { connectCalendar, deleteEvent, entryHasEvent, syncEntryEvent } from '../calendar.js'
import EntryForm from '../components/EntryForm.jsx'
import EntryCard from '../components/EntryCard.jsx'
import BusyOverlay from '../components/BusyOverlay.jsx'
import Lightbox from '../components/Lightbox.jsx'

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

// An entry's details with its calendar event's ID set, or removed (null).
function withEventId(details, eventId) {
  const next = { ...details }
  if (eventId) next.calendarEventId = eventId
  else delete next.calendarEventId
  return next
}

function Diary({ user, focusEntryId, onFocused, onOpenContact, diaryDraft }) {
  const { rows: entries, status, error: loadError, insert, update, remove } = useCollection(
    'diary_entries',
    { fromRow, toRow },
  )
  // The draft lives in Home, so it survives switching tabs.
  const { form, setForm, editingId, setEditingId, open: formOpen, setOpen: setFormOpen } = diaryDraft
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
  // Photos of status entries marked as documents (shown on Dokumente).
  const assignmentStore = useCollection('document_assignments', {
    fromRow: assignmentFromRow,
    toRow: assignmentToRow,
  })
  const documentIds = new Set(assignmentStore.rows.map((a) => a.fileId))
  const [folderId, setFolderId] = useState(null)
  const [filter, setFilter] = usePersistentState('diary.filter', 'all')
  const [openOnly, setOpenOnly] = usePersistentState('diary.openOnly', false)
  // Keys of the list parts (Offen, Demnächst, Verlauf) folded away.
  const [collapsed, setCollapsed] = usePersistentState('diary.collapsed', [])
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
  const shown = ofFilter.filter((e) => !(canFilterOpen && openOnly && !isOpen(e)))
  const sections = diarySections(shown, todayDate)
  const focusSection = sections.find((section) =>
    section.entries.some((entry) => entry.id === focusEntryId),
  )?.key
  // A lone part has no heading, so it cannot be folded away; the part
  // holding an entry opened from the start page is unfolded.
  const isCollapsed = (key) =>
    sections.length > 1 && key !== focusSection && collapsed.includes(key)

  function toggleSection(key) {
    setCollapsed((keys) => (keys.includes(key) ? keys.filter((k) => k !== key) : [...keys, key]))
  }

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
    if (focusSection) setCollapsed((keys) => keys.filter((k) => k !== focusSection))
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
  }, [focusEntryId, focusSection, status, onFocused, setCollapsed])

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

    // The entry is saved before the calendar is changed, so a failed save
    // leaves no event behind. It keeps its event's ID until the calendar
    // is updated, so an event that could not be deleted is tried again on
    // the next save, and deleted with the entry.
    setBusy('Wird gespeichert…')
    const entry = {
      type: form.type,
      date: form.date,
      weather: form.weather,
      workers: form.workers,
      work: form.work.trim(),
      details: withEventId(details, oldEventId),
      photoIds: uploaded.photos.map((p) => p.fileId),
      files: uploaded.files.map((f) => ({ id: f.fileId, name: f.name })),
    }
    let saved
    try {
      saved = editingId ? await update(editingId, entry) : await insert(entry)
    } catch (err) {
      setError(err.message)
      setBusy('')
      return
    }
    resetForm()
    if (calendarConnected) {
      try {
        const eventId = await syncEntryEvent(calendarEntry, oldEventId)
        if (eventId !== (oldEventId ?? null)) {
          await update(saved.id, { ...saved, details: withEventId(saved.details, eventId) })
        }
      } catch (err) {
        calendarProblem = err.message
      }
    }
    setBusy('')
    if (calendarProblem) {
      setError(`Gespeichert, aber der Google Kalender wurde nicht aktualisiert: ${calendarProblem}`)
    }
  }

  function resetForm() {
    // Keep the chosen kind: several defects are often noted in a row.
    setForm(emptyForm(form.type))
    setEditingId(null)
    setError('')
    setFormOpen(false)
  }

  // The round "+" (phones) only shows once the big button is scrolled away.
  const newEntryButton = useRef(null)
  const [buttonInView, setButtonInView] = useState(true)
  useEffect(() => {
    const button = newEntryButton.current
    if (!button || !window.IntersectionObserver) return
    const observer = new IntersectionObserver(([item]) => setButtonInView(item.isIntersecting))
    observer.observe(button)
    return () => observer.disconnect()
  }, [formOpen])

  // Something typed or picked in the folded form.
  const hasDraft = Boolean(form.work.trim()) || form.photos.length > 0 || form.files.length > 0

  function openForm() {
    setFormOpen(true)
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  function startEdit(entry) {
    setForm(formFromEntry(entry))
    setEditingId(entry.id)
    setError('')
    openForm()
  }

  async function toggleDone(entry) {
    const { field, done } = entryType(entry.type).progress
    const details = { ...entry.details, [field]: isOpen(entry) ? done : 'open' }
    // The calendar event shows "✓" once done. Connect first, while the
    // click still counts as user action; change the event once saved.
    const oldEventId = details.calendarEventId
    let calendarProblem = ''
    let calendarConnected = false
    if (entryHasEvent({ ...entry, details }) || oldEventId) {
      try {
        await connectCalendar(user.email)
        calendarConnected = true
      } catch (err) {
        calendarProblem = err.message
      }
    }
    let saved
    try {
      saved = await update(entry.id, { ...entry, details })
    } catch (err) {
      await dialogs.alert(err.message)
      return
    }
    if (calendarConnected) {
      try {
        const eventId = await syncEntryEvent(saved, oldEventId)
        if (eventId !== (oldEventId ?? null)) {
          await update(saved.id, { ...saved, details: withEventId(saved.details, eventId) })
        }
      } catch (err) {
        calendarProblem = err.message
      }
    }
    if (calendarProblem) {
      await dialogs.alert(`Gespeichert, aber der Google Kalender wurde nicht aktualisiert: ${calendarProblem}`)
    }
  }

  async function toggleDocument(fileId) {
    try {
      if (documentIds.has(fileId)) await unmarkDocument(fileId)
      else await assignDocument(fileId, null)
      await assignmentStore.reload()
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
      {formOpen ? (
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
          onFold={() => setFormOpen(false)}
        />
      ) : (
        <button ref={newEntryButton} type="button" className="new-entry" onClick={openForm}>
          {hasDraft ? '+ Entwurf fortsetzen' : '+ Neuer Eintrag'}
        </button>
      )}
      {/* On phones, also at hand further down the list. */}
      {!formOpen && !buttonInView && (
        <button type="button" className="new-entry-fab" aria-label="Neuer Eintrag" onClick={openForm}>
          +
        </button>
      )}

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
      {status === 'ready' && entries.length > 0 && shown.length === 0 && (
        <p className="empty">
          {words.length > 0 ? `Keine Einträge passen zu „${query.trim()}“.` : 'Keine passenden Einträge.'}
        </p>
      )}

      {sections.map((section) => {
        const folded = isCollapsed(section.key)
        return (
          <section key={section.key} className="entry-section">
            {sections.length > 1 && (
              <h2 className="entry-section-title">
                <button
                  type="button"
                  aria-expanded={!folded}
                  onClick={() => toggleSection(section.key)}
                >
                  <span className="section-chevron" aria-hidden="true">
                    {folded ? '▸' : '▾'}
                  </span>
                  {section.title} <span className="chip-count">{section.entries.length}</span>
                </button>
              </h2>
            )}
            {!folded && (
              <ul className="entry-list">
                {section.entries.map((entry) => (
                  <EntryCard
                    key={entry.id}
                    entry={entry}
                    editing={entry.id === editingId}
                    todayDate={todayDate}
                    lists={lists}
                    onOpenContact={onOpenContact}
                    onOpenPhoto={setLightbox}
                    onToggleDone={toggleDone}
                    documentIds={documentIds}
                    onToggleDocument={toggleDocument}
                    onEdit={startEdit}
                    onDelete={handleDelete}
                  />
                ))}
              </ul>
            )}
          </section>
        )
      })}

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
