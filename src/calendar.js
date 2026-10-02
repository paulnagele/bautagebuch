// The project's Google Calendar ("Bauzeitplan"). Everyone sees it as an
// embedded calendar on the Zeitplan tab. Diary appointments are added,
// changed and deleted there with the person's own Google account, so the
// calendar must be shared with each member with "Make changes to events".
// The calendar ID is stored in the database (app_settings, key
// calendar_id), not in the repository.
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

// Called on sign-out.
export function disconnectCalendar() {
  calendar.disconnect()
}

async function eventsUrl(path = '') {
  return `${API}/${encodeURIComponent(await getCalendarId())}/events${path}`
}

// ---- diary appointments -------------------------------------------------------
//
// Each diary entry of kind "Termin" has an event in the calendar; its ID
// is kept in the entry's details (calendarEventId). Date and time are in
// the project's time zone, whatever time zone the device is set to.

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

// The event for an appointment entry: its first line as the title, the
// whole text and who takes part as the description.
function appointmentEvent({ date, work, details }) {
  const [firstLine] = work.split('\n')
  const title = firstLine.length > 100 ? `${firstLine.slice(0, 99)}…` : firstLine
  const description = [work, details.participants && `Mit: ${details.participants}`, 'Aus dem Bautagebuch']
    .filter(Boolean)
    .join('\n\n')
  return {
    summary: title,
    location: details.location ?? '',
    description,
    ...eventTimes(date, details.time),
  }
}

// The nulls only matter when changing an event (they clear the other kind
// of time); a new event does not need them.
const withoutNulls = (key, value) => (value === null ? undefined : value)

// Creates or updates the appointment's event and returns its ID. An event
// deleted in Google Calendar meanwhile is created again.
export async function saveAppointmentEvent(entry, eventId) {
  const body = appointmentEvent(entry)
  if (eventId) {
    try {
      await calendar.fetch(await eventsUrl(`/${encodeURIComponent(eventId)}`), {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
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

export async function deleteAppointmentEvent(eventId) {
  try {
    await calendar.fetch(await eventsUrl(`/${encodeURIComponent(eventId)}`), { method: 'DELETE' })
  } catch (err) {
    // Already deleted in Google Calendar.
    if (err.status !== 404 && err.status !== 410) throw err
  }
}
