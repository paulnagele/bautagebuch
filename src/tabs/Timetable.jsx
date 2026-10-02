import { useCallback, useEffect, useRef, useState } from 'react'
import {
  calendarConnected,
  calendarEmbedUrl,
  connectCalendar,
  createEvent,
  deleteEvent,
  getCalendarId,
  listUpcomingEvents,
  todayDate,
  updateEvent,
} from '../calendar.js'

function emptyForm() {
  const today = todayDate()
  return {
    title: '',
    allDay: false,
    startDate: today,
    startTime: '08:00',
    endDate: today,
    endTime: '09:00',
    location: '',
    description: '',
  }
}

const dayFormat = new Intl.DateTimeFormat('de-DE', {
  weekday: 'short',
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  timeZone: 'UTC',
})

function formatDay(date) {
  return dayFormat.format(new Date(`${date}T12:00:00Z`))
}

function formatWhen(event) {
  const sameDay = event.startDate === event.endDate
  if (event.allDay) {
    return sameDay ? `${formatDay(event.startDate)}, ganztägig` : `${formatDay(event.startDate)} – ${formatDay(event.endDate)}`
  }
  return sameDay
    ? `${formatDay(event.startDate)}, ${event.startTime}–${event.endTime}`
    : `${formatDay(event.startDate)}, ${event.startTime} – ${formatDay(event.endDate)}, ${event.endTime}`
}

function checkForm(form) {
  if (!form.title.trim()) return 'Bitte einen Titel eingeben.'
  if (!form.startDate || !form.endDate) return 'Bitte Beginn und Ende angeben.'
  if (!form.allDay && (!form.startTime || !form.endTime)) return 'Bitte die Uhrzeiten angeben.'
  const start = `${form.startDate}T${form.allDay ? '' : form.startTime}`
  const end = `${form.endDate}T${form.allDay ? '' : form.endTime}`
  if (end < start || (!form.allDay && end === start)) return 'Das Ende muss nach dem Beginn liegen.'
  return ''
}

function Timetable({ user }) {
  const [calendarId, setCalendarId] = useState(null)
  const [setupError, setSetupError] = useState('')
  const [events, setEvents] = useState([])
  const [listState, setListState] = useState(calendarConnected() ? 'loading' : 'disconnected')
  const [listError, setListError] = useState('')
  const [form, setForm] = useState(emptyForm)
  const [editingId, setEditingId] = useState(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState('')
  // Changing the key reloads the embedded calendar after a change.
  const [frameKey, setFrameKey] = useState(0)
  const formRef = useRef(null)

  useEffect(() => {
    getCalendarId().then(setCalendarId, (err) => setSetupError(err.message))
  }, [])

  const loadEvents = useCallback(
    () =>
      listUpcomingEvents().then(
        (list) => {
          setEvents(list)
          setListError('')
          setListState('ready')
        },
        (err) => {
          setListError(err.message)
          setListState(calendarConnected() ? 'error' : 'disconnected')
        },
      ),
    [],
  )

  useEffect(() => {
    // Only when access was given before: connecting opens a popup, which
    // needs a click.
    if (calendarConnected()) loadEvents()
  }, [loadEvents])

  function retry() {
    setListState('loading')
    setListError('')
    loadEvents()
  }

  async function connect() {
    setListError('')
    try {
      await connectCalendar(user.email)
    } catch (err) {
      setListError(err.message)
      return
    }
    setListState('loading')
    await loadEvents()
  }

  function setField(field) {
    return (e) => {
      const value = e.target.type === 'checkbox' ? e.target.checked : e.target.value
      setForm((f) => {
        const next = { ...f, [field]: value }
        // Keep the end from falling before the start.
        if (field === 'startDate' && next.endDate < value) next.endDate = value
        return next
      })
    }
  }

  async function handleSubmit(e) {
    e.preventDefault()
    const formError = checkForm(form)
    if (formError) {
      setError(formError)
      return
    }
    setError('')
    try {
      // Must run first, while the click still counts as user action,
      // otherwise the browser blocks Google's popup.
      await connectCalendar(user.email)
    } catch (err) {
      setError(err.message)
      return
    }
    setBusy('Wird gespeichert…')
    const values = { ...form, title: form.title.trim(), location: form.location.trim(), description: form.description.trim() }
    try {
      if (editingId) await updateEvent(editingId, values)
      else await createEvent(values)
      resetForm()
      setFrameKey((k) => k + 1)
      await loadEvents()
    } catch (err) {
      setError(`Speichern fehlgeschlagen: ${err.message}`)
    } finally {
      setBusy('')
    }
  }

  function resetForm() {
    setForm(emptyForm())
    setEditingId(null)
    setError('')
  }

  function startEdit(event) {
    setForm({
      title: event.title,
      allDay: event.allDay,
      startDate: event.startDate,
      startTime: event.startTime || '08:00',
      endDate: event.endDate,
      endTime: event.endTime || '09:00',
      location: event.location,
      description: event.description,
    })
    setEditingId(event.id)
    setError('')
    formRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  async function handleDelete(event) {
    const which = event.recurring ? 'Diesen Termin (nur diesen einen der Serie)' : 'Diesen Termin'
    if (!window.confirm(`${which} „${event.title || 'Ohne Titel'}“ aus dem Kalender löschen?`)) return
    try {
      await connectCalendar(user.email)
      await deleteEvent(event.id)
      if (editingId === event.id) resetForm()
      setFrameKey((k) => k + 1)
      await loadEvents()
    } catch (err) {
      window.alert(`Löschen fehlgeschlagen: ${err.message}`)
    }
  }

  const editingEvent = events.find((ev) => ev.id === editingId)
  const embedUrl = calendarId && calendarEmbedUrl(calendarId)

  if (setupError) {
    return (
      <section className="tab-content">
        <p className="card error">{setupError}</p>
      </section>
    )
  }

  return (
    <section className="tab-content">
      <form ref={formRef} className="card form-grid" onSubmit={handleSubmit} noValidate>
        <h2>{editingId ? 'Termin bearbeiten' : 'Neuer Termin'}</h2>
        <label className="full">
          Titel
          <input
            type="text"
            placeholder="z. B. Estrich, Elektriker"
            value={form.title}
            onChange={setField('title')}
            autoComplete="off"
          />
        </label>
        <label className="full checkbox-label">
          <input type="checkbox" checked={form.allDay} onChange={setField('allDay')} />
          Ganztägig
        </label>
        <label>
          {form.allDay ? 'Erster Tag' : 'Beginn'}
          <input type="date" value={form.startDate} onChange={setField('startDate')} />
        </label>
        {!form.allDay && (
          <label>
            Uhrzeit
            <input type="time" value={form.startTime} onChange={setField('startTime')} />
          </label>
        )}
        <label>
          {form.allDay ? 'Letzter Tag' : 'Ende'}
          <input type="date" value={form.endDate} min={form.startDate} onChange={setField('endDate')} />
        </label>
        {!form.allDay && (
          <label>
            Uhrzeit
            <input type="time" value={form.endTime} onChange={setField('endTime')} />
          </label>
        )}
        <label className="full">
          Ort
          <input type="text" value={form.location} onChange={setField('location')} autoComplete="off" />
        </label>
        <label className="full">
          Beschreibung
          <textarea rows="3" value={form.description} onChange={setField('description')} />
        </label>
        {editingEvent?.recurring && (
          <p className="full form-hint muted">Teil einer Serie: Änderungen gelten nur für diesen einen Termin.</p>
        )}
        {error && <p className="full error">{error}</p>}
        <div className="full form-actions">
          <button type="submit" disabled={Boolean(busy)}>
            {busy || (editingId ? 'Änderungen speichern' : 'In den Kalender eintragen')}
          </button>
          {editingId && (
            <button type="button" className="secondary" onClick={resetForm} disabled={Boolean(busy)}>
              Abbrechen
            </button>
          )}
        </div>
      </form>

      <div className="card calendar-events">
        <h2>Kommende Termine</h2>
        {listState === 'disconnected' && (
          <p className="muted">
            Um Termine hier zu bearbeiten oder zu löschen, Google Kalender verbinden.{' '}
            <button type="button" className="link" onClick={connect}>
              Verbinden
            </button>
          </p>
        )}
        {listState === 'loading' && <p className="muted">Termine werden geladen…</p>}
        {listError && (
          <p className="error">
            {listError}{' '}
            {listState === 'error' && (
              <button type="button" className="link" onClick={retry}>
                Erneut versuchen
              </button>
            )}
          </p>
        )}
        {listState === 'ready' && events.length === 0 && <p className="muted">Keine kommenden Termine.</p>}
        {listState === 'ready' && events.length > 0 && (
          <ul className="event-list">
            {events.map((event) => (
              <li key={event.id} className={event.id === editingId ? 'event editing' : 'event'}>
                <div className="event-text">
                  <span className="event-when">{formatWhen(event)}</span>
                  <strong>{event.title || 'Ohne Titel'}</strong>
                  {event.location && <span className="muted">{event.location}</span>}
                </div>
                <div className="event-actions">
                  <button type="button" className="link" onClick={() => startEdit(event)}>
                    Bearbeiten
                  </button>
                  <button type="button" className="link danger" onClick={() => handleDelete(event)}>
                    Löschen
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="card calendar-card">
        <div className="calendar-head">
          <h2>Bauzeitplan</h2>
          {embedUrl && (
            <a href={embedUrl} target="_blank" rel="noreferrer">
              In Google Kalender öffnen ↗
            </a>
          )}
        </div>
        {/* Month view on wide screens, agenda list on phones. */}
        {calendarId && (
          <>
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
          </>
        )}
      </div>
    </section>
  )
}

export default Timetable
