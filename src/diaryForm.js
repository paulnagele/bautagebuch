// The diary form's data: an empty form, the choices of its select fields
// and the checks before saving. Used by tabs/Diary.jsx and
// components/EntryForm.jsx.
import { defaultDetails, entryType, typeKey } from './diaryTypes.js'
import { today } from './storage.js'

// Stored in English so existing entries keep working; shown in German.
export const WEATHER_LABELS = {
  Sunny: 'Sonnig',
  Cloudy: 'Bewölkt',
  Rain: 'Regen',
  Snow: 'Schnee',
  Wind: 'Wind',
  Frost: 'Frost',
}
export const WEATHER_OPTIONS = Object.keys(WEATHER_LABELS)

// Which entries also go into the Google Calendar (see calendar.js).
export const CALENDAR_HINTS = {
  appointment: 'Termine werden auch im Google Kalender (Zeitplan) eingetragen.',
  todo: 'Aufgaben werden am Tag „Erledigen bis“ im Google Kalender (Zeitplan) eingetragen.',
  defect: 'Mängel mit „Zu beheben bis“ werden an diesem Tag im Google Kalender (Zeitplan) eingetragen.',
}

export function emptyForm(type = 'status') {
  // photos: { key, fileId } for photos already in Drive,
  //         { key, blob } for new ones that still need uploading.
  return {
    type,
    date: today(),
    weather: 'Sunny',
    // The weather is filled in automatically until changed.
    weatherAuto: true,
    workers: '',
    work: '',
    details: defaultDetails(type),
    photos: [],
    // files: { key, fileId, name } in Drive, or { key, blob, name } new.
    files: [],
  }
}

// An entry as the form edits it.
export function formFromEntry(entry) {
  return {
    type: typeKey(entry.type),
    date: entry.date,
    weather: entry.weather || 'Sunny',
    weatherAuto: false,
    workers: String(entry.workers),
    work: entry.work,
    details: defaultDetails(entry.type, entry.details),
    photos: entry.photoIds.map((fileId) => ({ key: fileId, fileId })),
    files: entry.files.map((f) => ({ key: f.id, fileId: f.id, name: f.name })),
  }
}

// Newest first; entries on the same day by time (appointments), then by
// when they were written.
export function compareEntries(a, b) {
  return (
    b.date.localeCompare(a.date) ||
    (b.details.time ?? '').localeCompare(a.details.time ?? '')
  )
}

// A select's choices; a value no longer in its list stays selectable.
// A field `within` another one offers "none" plus the choices for that
// field's value, and drops values that are not among them.
export function fieldOptions(field, value, lists, details = {}) {
  if (field.options) return field.options
  if (field.within) {
    // An empty select means its first choice, as shown in the form.
    const byValue = lists[field.optionsFrom] ?? new Map()
    const choices = byValue.get(details[field.within] || byValue.keys().next().value) ?? []
    if (choices.length === 0) return {}
    return { '': '– keiner –', ...Object.fromEntries(choices.map((c) => [c.id, c.name])) }
  }
  const names = lists[field.optionsFrom] ?? []
  const all = !value || names.includes(value) ? names : [...names, value]
  return Object.fromEntries(all.map((name) => [name, name]))
}

// The extra fields as they are saved, or why they cannot be.
// An empty select means its first choice, as shown in the form.
export function checkDetails(type, formDetails, lists) {
  const details = defaultDetails(type, formDetails)
  for (const field of entryType(type).fields) {
    if (field.within) {
      // Checked after the field it depends on, which comes first.
      const options = fieldOptions(field, '', lists, details)
      if (!Object.hasOwn(options, details[field.key])) details[field.key] = ''
      continue
    }
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
