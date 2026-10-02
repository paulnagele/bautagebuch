// The project's Google Calendar ("Bauzeitplan"). Everyone sees it as an
// embedded calendar; events are added, changed and deleted with the
// person's own Google account, so the calendar must be shared with each
// member with "Make changes to events". The calendar ID is stored in the
// database (app_settings, key calendar_id), not in the repository.
// https://developers.google.com/workspace/calendar/api/v3/reference/events

import { config } from './config.js'
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

export const calendarConnected = calendar.connected

// Called on sign-out.
export function disconnectCalendar() {
  calendar.disconnect()
}

async function eventsUrl(path = '') {
  return `${API}/${encodeURIComponent(await getCalendarId())}/events${path}`
}

// ---- dates ------------------------------------------------------------------
//
// The form works with plain local values ("2026-10-15", "08:00") in the
// project's time zone, whatever time zone the device is set to.

function addDays(date, days) {
  const d = new Date(`${date}T12:00:00Z`)
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

// "2026-10-15T08:00:00+02:00" → { date: '2026-10-15', time: '08:00' } in Vienna.
function localParts(dateTime) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', {
      timeZone: TIME_ZONE,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    })
      .formatToParts(new Date(dateTime))
      .map((p) => [p.type, p.value]),
  )
  return { date: `${parts.year}-${parts.month}-${parts.day}`, time: `${parts.hour}:${parts.minute}` }
}

// Today's date in the project's time zone, e.g. "2026-10-15".
export function todayDate() {
  return localParts(new Date()).date
}

// Google event → form values. All-day events end the day after their
// last day (exclusive), the form shows the last day itself.
function fromEvent(event) {
  const allDay = Boolean(event.start?.date)
  const start = allDay ? { date: event.start.date, time: '' } : localParts(event.start.dateTime)
  const end = allDay ? { date: addDays(event.end.date, -1), time: '' } : localParts(event.end.dateTime)
  return {
    id: event.id,
    title: event.summary ?? '',
    location: event.location ?? '',
    description: event.description ?? '',
    allDay,
    startDate: start.date,
    startTime: start.time,
    endDate: end.date,
    endTime: end.time,
    recurring: Boolean(event.recurringEventId),
  }
}

function toEvent(form) {
  const when = form.allDay
    ? {
        start: { date: form.startDate, dateTime: null },
        end: { date: addDays(form.endDate, 1), dateTime: null },
      }
    : {
        start: { dateTime: `${form.startDate}T${form.startTime}:00`, timeZone: TIME_ZONE, date: null },
        end: { dateTime: `${form.endDate}T${form.endTime}:00`, timeZone: TIME_ZONE, date: null },
      }
  return {
    summary: form.title,
    location: form.location,
    description: form.description,
    ...when,
  }
}

// ---- API calls ----------------------------------------------------------------

// Events from the start of today on, earliest first. Recurring events
// come as their single occurrences.
export async function listUpcomingEvents() {
  const today = todayDate()
  const params = new URLSearchParams({
    singleEvents: 'true',
    orderBy: 'startTime',
    maxResults: '100',
    // A day early, so nothing of today is missed whatever the offset;
    // yesterday's events are dropped below.
    timeMin: new Date(`${addDays(today, -1)}T00:00:00Z`).toISOString(),
  })
  const response = await calendar.fetch(`${await eventsUrl()}?${params}`)
  const { items = [] } = await response.json()
  return items
    .filter((e) => e.status !== 'cancelled')
    .map(fromEvent)
    .filter((e) => e.endDate >= today)
}

export async function createEvent(form) {
  const response = await calendar.fetch(await eventsUrl(), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    // The nulls only matter when changing an event (they clear the other
    // kind of time); a new event does not need them.
    body: JSON.stringify(toEvent(form), (key, value) => (value === null ? undefined : value)),
  })
  return fromEvent(await response.json())
}

export async function updateEvent(id, form) {
  const response = await calendar.fetch(await eventsUrl(`/${encodeURIComponent(id)}`), {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(toEvent(form)),
  })
  return fromEvent(await response.json())
}

export async function deleteEvent(id) {
  await calendar.fetch(await eventsUrl(`/${encodeURIComponent(id)}`), { method: 'DELETE' })
}
