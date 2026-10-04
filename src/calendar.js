// The project's Google Calendar ("Bauzeitplan"). Everyone sees it as an
// embedded calendar on the Zeitplan tab. Diary appointments, to-dos,
// defects and the milestones are added, changed and deleted there with
// the person's own Google account, so the calendar must be shared with
// each member with "Make changes to events".
// The calendar ID is stored in the database (app_settings, key
// calendar_id), not in the repository.
// https://developers.google.com/workspace/calendar/api/v3/reference/events

import { config } from './config.js'
import { entryType, typeKey } from './diaryTypes.js'
import { createGoogleAccess } from './google.js'
import { getSetting } from './settings.js'

export const TIME_ZONE = 'Europe/Vienna'
const API = 'https://www.googleapis.com/calendar/v3/calendars'

const calendar = createGoogleAccess({
  scope: 'https://www.googleapis.com/auth/calendar.events',
  storageKey: 'bautagebuch.calendarToken',
  name: 'Google Kalender',
  clientId: config.googleClientId,
})

// For connecting the calendar together with Drive (connectTogether).
export const calendarAccess = calendar

export function getCalendarId() {
  return getSetting('calendar_id', 'der Google Kalender')
}

export function calendarEmbedUrl(calendarId, mode) {
  const params = { src: calendarId, ctz: TIME_ZONE, hl: 'de' }
  if (mode) params.mode = mode
  return `https://calendar.google.com/calendar/embed?${new URLSearchParams(params)}`
}

// Opens Google's consent popup; must be called directly from a click
// handler, or the browser blocks the popup.
export function connectCalendar(email) {
  return calendar.connect(email)
}

// Called on sign-out.
export function disconnectCalendar() {
  calendar.disconnect()
}

async function eventsUrl(path = '') {
  return `${API}/${encodeURIComponent(await getCalendarId())}/events${path}`
}

// ---- diary entries ------------------------------------------------------------
//
// Diary entries of kind "Termin" have an event in the calendar, and so do
// "Aufgabe" and "Mangel" entries with a due date (all day on that date).
// The event's ID is kept in the entry's details (calendarEventId). Date
// and time are in the project's time zone, whatever time zone the device
// is set to.

function addDays(date, days) {
  const d = new Date(`${date}T12:00:00Z`)
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

const pad = (n) => String(n).padStart(2, '0')

// With a time: one hour from then. Without: all day.
function eventTimes(date, time) {
  if (!time) {
    return { start: { date, dateTime: null }, end: { date: addDays(date, 1), dateTime: null } }
  }
  const [h, m] = time.split(':').map(Number)
  const endHour = h + 1
  const endDate = endHour >= 24 ? addDays(date, 1) : date
  return {
    start: { dateTime: `${date}T${pad(h)}:${pad(m)}:00`, timeZone: TIME_ZONE, date: null },
    end: { dateTime: `${endDate}T${pad(endHour % 24)}:${pad(m)}:00`, timeZone: TIME_ZONE, date: null },
  }
}

function shorten(line) {
  return line.length > 100 ? `${line.slice(0, 99)}…` : line
}

// The event for a diary entry ({ type, date, work, details }), or null if
// it has none. Appointments: the first line of the text as the title, the
// whole text and who takes part as the description. To-dos and defects:
// "Aufgabe: …" / "Mangel: …" on the due date, with "✓" once done.
function entryEvent({ type, date, work, details }) {
  const [firstLine] = work.split('\n')
  const footer = 'Aus dem Bautagebuch'
  if (typeKey(type) === 'appointment') {
    return {
      summary: shorten(firstLine),
      location: details.location ?? '',
      description: [work, details.participants && `Mit: ${details.participants}`, footer]
        .filter(Boolean)
        .join('\n\n'),
      ...eventTimes(date, details.time),
    }
  }
  const { label, progress, noCalendar } = entryType(type)
  if (noCalendar) return null
  const due = progress && details[progress.due]
  if (!due) return null
  const done = details[progress.field] === progress.done
  return {
    summary: `${done ? '✓ ' : ''}${label}: ${shorten(firstLine)}`,
    location: '',
    description: [work, details.responsible && `Zuständig: ${details.responsible}`, footer]
      .filter(Boolean)
      .join('\n\n'),
    ...eventTimes(due, ''),
  }
}

export function entryHasEvent(entry) {
  return entryEvent(entry) !== null
}

// The nulls only matter when changing an event (they clear the other kind
// of time); a new event does not need them.
const withoutNulls = (key, value) => (value === null ? undefined : value)

// ---- milestones -----------------------------------------------------------------
//
// Each milestone on the Zeitplan tab is an all-day event on its date,
// "Meilenstein: …", with "✓" once reached.

function milestoneEvent({ name, date, reached }) {
  return {
    summary: `${reached ? '✓ ' : ''}Meilenstein: ${shorten(name)}`,
    location: '',
    description: 'Meilenstein aus dem Bautagebuch',
    ...eventTimes(date, ''),
  }
}

// ---- API calls ------------------------------------------------------------------

// Creates, updates or deletes the event to match `body` (null: no event)
// and returns its ID (null when there is none). An event deleted in
// Google Calendar meanwhile comes back: Google keeps deleted events as
// "cancelled" and a change alone leaves them so, hence the status.
async function syncEvent(body, eventId) {
  if (!body) {
    if (eventId) await deleteEvent(eventId)
    return null
  }
  if (eventId) {
    try {
      await calendar.fetch(await eventsUrl(`/${encodeURIComponent(eventId)}`), {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...body, status: 'confirmed' }),
      })
      return eventId
    } catch (err) {
      if (err.status !== 404 && err.status !== 410) throw err
    }
  }
  const response = await calendar.fetch(await eventsUrl(), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body, withoutNulls),
  })
  return (await response.json()).id
}

export function syncEntryEvent(entry, eventId) {
  return syncEvent(entryEvent(entry), eventId)
}

export function syncMilestoneEvent(milestone, eventId) {
  return syncEvent(milestoneEvent(milestone), eventId)
}

export async function deleteEvent(eventId) {
  try {
    await calendar.fetch(await eventsUrl(`/${encodeURIComponent(eventId)}`), { method: 'DELETE' })
  } catch (err) {
    // Already deleted in Google Calendar.
    if (err.status !== 404 && err.status !== 410) throw err
  }
}
