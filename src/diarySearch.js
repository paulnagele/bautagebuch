// Searching the diary: an entry matches when every word of the query
// appears somewhere in it (text, kind, date, people, place, category,
// item, file names, author), ignoring case and accents.
import { entryType } from './diaryTypes.js'
import { WEATHER_LABELS, fieldOptions } from './diaryForm.js'
import { formatDate } from './storage.js'

export function normalize(text) {
  return String(text ?? '')
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
}

export function queryWords(query) {
  return normalize(query).split(/\s+/).filter(Boolean)
}

// Everything about an entry one might search for, as one text.
function searchText(entry, lists) {
  const type = entryType(entry.type)
  const details = type.fields.map((field) => {
    const value = entry.details[field.key]
    if (!value) return ''
    if (field.kind === 'select') return fieldOptions(field, value, lists, entry.details)[value] ?? value
    if (field.kind === 'date') return `${value} ${formatDate(value)}`
    return value
  })
  return normalize(
    [
      type.label,
      entry.work,
      entry.date,
      formatDate(entry.date),
      type.siteInfo ? (WEATHER_LABELS[entry.weather] ?? entry.weather) : '',
      entry.author,
      ...details,
      ...entry.files.map((file) => file.name),
    ].join('\n'),
  )
}

export function matchesEntry(entry, words, lists) {
  if (words.length === 0) return true
  const text = searchText(entry, lists)
  return words.every((word) => text.includes(word))
}

// Within the date range; either end may be empty.
export function inRange(entry, from, to) {
  return (!from || entry.date >= from) && (!to || entry.date <= to)
}

export function matchesContact(contact, words) {
  if (words.length === 0) return false
  const text = normalize([contact.name, contact.role, contact.company].join('\n'))
  return words.every((word) => text.includes(word))
}
