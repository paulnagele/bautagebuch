import { useEffect, useRef, useState } from 'react'
import {
  calendarEmbedUrl,
  connectCalendar,
  deleteEvent,
  getCalendarId,
  syncMilestoneEvent,
} from '../calendar.js'
import { formatDate, today } from '../storage.js'
import { useCollection } from '../useCollection.js'
import { useDialogs } from '../dialogs.js'

function fromRow(row) {
  return {
    id: row.id,
    name: row.name,
    date: row.due_date,
    reached: row.reached,
    eventId: row.calendar_event_id,
  }
}

function toRow(milestone) {
  return {
    name: milestone.name,
    due_date: milestone.date,
    reached: milestone.reached,
    calendar_event_id: milestone.eventId ?? null,
  }
}

function emptyForm() {
  return { name: '', date: today() }
}

// Each milestone is also an all-day event in the Google Calendar. Connect
// first, while the click still counts as user action, otherwise the
// browser blocks Google's popup. Returns a message if that failed.
async function connectFirst(email) {
  try {
    await connectCalendar(email)
    return ''
  } catch (err) {
    return err.message
  }
}

// Once the milestone is saved (so a failed save leaves no event behind),
// its event is changed to match and a new event ID stored. Returns a
// message if the calendar could not be updated (it is saved anyway).
async function syncSaved(saved, update) {
  try {
    const eventId = await syncMilestoneEvent(saved, saved.eventId)
    if (eventId !== (saved.eventId ?? null)) await update(saved.id, { ...saved, eventId })
    return ''
  } catch (err) {
    return err.message
  }
}

function calendarWarning(problem) {
  return `Gespeichert, aber der Google Kalender wurde nicht aktualisiert: ${problem}`
}

function Milestones({ user, onCalendarChange }) {
  const { rows, status, error: loadError, insert, update, remove } = useCollection('milestones', {
    fromRow,
    toRow,
  })
  const [form, setForm] = useState(emptyForm)
  const [editingId, setEditingId] = useState(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const formRef = useRef(null)
  const dialogs = useDialogs()

  const sorted = [...rows].sort((a, b) => a.date.localeCompare(b.date) || a.name.localeCompare(b.name, 'de'))

  function setField(field) {
    return (e) => setForm({ ...form, [field]: e.target.value })
  }

  function resetForm() {
    setForm(emptyForm())
    setEditingId(null)
    setError('')
  }

  async function handleSubmit(e) {
    e.preventDefault()
    const name = form.name.trim()
    if (!name || !form.date) {
      setError('Bitte Name und Datum angeben.')
      return
    }
    setError('')
    setBusy(true)
    const original = rows.find((m) => m.id === editingId)
    const milestone = {
      name,
      date: form.date,
      reached: original?.reached ?? false,
      eventId: original?.eventId ?? null,
    }
    let problem = await connectFirst(user.email)
    let saved
    try {
      saved = editingId ? await update(editingId, milestone) : await insert(milestone)
    } catch (err) {
      setError(err.message)
      setBusy(false)
      return
    }
    resetForm()
    if (!problem) problem = await syncSaved(saved, update)
    setBusy(false)
    if (problem) setError(calendarWarning(problem))
    onCalendarChange()
  }

  function startEdit(milestone) {
    setForm({ name: milestone.name, date: milestone.date })
    setEditingId(milestone.id)
    setError('')
    formRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
  }

  async function toggleReached(original) {
    let problem = await connectFirst(user.email)
    let saved
    try {
      saved = await update(original.id, { ...original, reached: !original.reached })
    } catch (err) {
      await dialogs.alert(err.message)
      return
    }
    if (!problem) problem = await syncSaved(saved, update)
    if (problem) await dialogs.alert(calendarWarning(problem))
    onCalendarChange()
  }

  async function handleDelete(milestone) {
    const calendarNote = milestone.eventId ? ' Er wird auch aus dem Google Kalender gelöscht.' : ''
    const question = `Den Meilenstein „${milestone.name}“ löschen?${calendarNote}`
    if (!(await dialogs.confirm(question, { confirmLabel: 'Löschen', danger: true }))) return
    if (milestone.eventId) {
      try {
        await connectCalendar(user.email)
        await deleteEvent(milestone.eventId)
      } catch (err) {
        const question =
          `Der Meilenstein konnte nicht aus dem Google Kalender gelöscht werden (${err.message}). ` +
          'Trotzdem löschen?'
        if (!(await dialogs.confirm(question, { confirmLabel: 'Löschen', danger: true }))) return
      }
    }
    try {
      await remove(milestone.id)
      if (editingId === milestone.id) resetForm()
      onCalendarChange()
    } catch (err) {
      await dialogs.alert(err.message)
    }
  }

  return (
    <div className="card milestones">
      <h2>Meilensteine</h2>
      {status === 'loading' && <p className="muted">Meilensteine werden geladen…</p>}
      {status === 'error' && (
        <p className="error" role="alert">
          {loadError}
        </p>
      )}
      {status === 'ready' && rows.length === 0 && (
        <p className="muted">Noch keine Meilensteine, z. B. „Rohbau fertig“ oder „Einzug“.</p>
      )}
      {sorted.length > 0 && (
        <ul className="milestone-list">
          {sorted.map((milestone) => (
            <li
              key={milestone.id}
              className={[
                'milestone',
                milestone.reached && 'reached',
                milestone.id === editingId && 'editing',
              ]
                .filter(Boolean)
                .join(' ')}
            >
              <label className="milestone-check">
                <input
                  type="checkbox"
                  checked={milestone.reached}
                  onChange={() => toggleReached(milestone)}
                  aria-label={`${milestone.name} erreicht`}
                />
                <span className="milestone-name">{milestone.name}</span>
              </label>
              <span className="milestone-date muted">{formatDate(milestone.date)}</span>
              <div className="entry-actions">
                <button type="button" className="link" onClick={() => startEdit(milestone)}>
                  Bearbeiten
                </button>
                <button type="button" className="link danger" onClick={() => handleDelete(milestone)}>
                  Löschen
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}

      <form ref={formRef} className="form-grid milestone-form" onSubmit={handleSubmit} noValidate>
        <label>
          {editingId ? 'Meilenstein bearbeiten' : 'Neuer Meilenstein'}
          <input
            type="text"
            placeholder="z. B. Rohbau fertig"
            value={form.name}
            onChange={setField('name')}
            autoComplete="off"
          />
        </label>
        <label>
          Datum
          <input type="date" value={form.date} onChange={setField('date')} />
        </label>
        {error && (
          <p className="error full" role="alert">
            {error}
          </p>
        )}
        <div className="form-actions full">
          <button type="submit" disabled={busy}>
            {busy ? 'Wird gespeichert…' : editingId ? 'Änderungen speichern' : 'Meilenstein hinzufügen'}
          </button>
          {editingId && (
            <button type="button" className="secondary" onClick={resetForm} disabled={busy}>
              Abbrechen
            </button>
          )}
        </div>
      </form>
      <p className="form-hint muted">Meilensteine stehen auch ganztägig im Google Kalender.</p>
    </div>
  )
}

function Timetable({ user }) {
  const [calendarId, setCalendarId] = useState(null)
  const [error, setError] = useState('')
  // Changing the key reloads the embedded calendar after a change.
  const [frameKey, setFrameKey] = useState(0)

  useEffect(() => {
    getCalendarId().then(setCalendarId, (err) => setError(err.message))
  }, [])

  const embedUrl = calendarId && calendarEmbedUrl(calendarId)
  return (
    <section className="tab-content">
      <Milestones user={user} onCalendarChange={() => setFrameKey((k) => k + 1)} />
      {error && <p className="card error">{error}</p>}
      {calendarId && (
        <div className="card calendar-card">
          <div className="calendar-head">
            <h2>Bauzeitplan</h2>
            <a href={embedUrl} target="_blank" rel="noreferrer">
              In Google Kalender öffnen ↗
            </a>
          </div>
          {/* Month view on wide screens, agenda list on phones. */}
          <iframe
            key={`month-${frameKey}`}
            className="calendar-frame calendar-month"
            title="Bauzeitplan (Monatsansicht)"
            src={embedUrl}
            loading="lazy"
          />
          <iframe
            key={`agenda-${frameKey}`}
            className="calendar-frame calendar-agenda"
            title="Bauzeitplan (Terminübersicht)"
            src={calendarEmbedUrl(calendarId, 'AGENDA')}
            loading="lazy"
          />
        </div>
      )}
    </section>
  )
}

export default Timetable
