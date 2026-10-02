// The kinds of diary entries. To add one, add an entry here (and a badge
// colour in index.css, `.type-<key>`); the database needs no change.
import { formatDate } from './storage.js'

// Extra fields are stored in the entry's `details` and shown in the form
// and the entry header in the order listed.
//   kind: 'text' | 'date' | 'time' | 'select'
//   summary(value): optional, how the value reads in the list
//   pill: show a select's value as a coloured label (`.state-<value>`)
export const ENTRY_TYPES = {
  status: {
    label: 'Status',
    plural: 'Status',
    dateLabel: 'Datum',
    textLabel: 'Ausgeführte Arbeiten',
    notesLabel: 'Notizen / Vorkommnisse',
    // Weather and workers on site (own database columns, older than types).
    siteInfo: true,
    fields: [],
  },
  defect: {
    label: 'Mangel',
    plural: 'Mängel',
    dateLabel: 'Festgestellt am',
    textLabel: 'Beschreibung des Mangels',
    notesLabel: 'Notizen',
    fields: [
      {
        key: 'state',
        label: 'Stand',
        kind: 'select',
        options: { open: 'Offen', fixed: 'Behoben' },
        default: 'open',
        pill: true,
      },
      {
        key: 'responsible',
        label: 'Zuständig (Firma / Gewerk)',
        kind: 'text',
        summary: (v) => `Zuständig: ${v}`,
      },
      {
        key: 'deadline',
        label: 'Zu beheben bis',
        kind: 'date',
        summary: (v) => `bis ${formatDate(v)}`,
      },
    ],
  },
  appointment: {
    label: 'Termin',
    plural: 'Termine',
    dateLabel: 'Termin am',
    textLabel: 'Worum geht es?',
    notesLabel: 'Notizen / Ergebnis',
    fields: [
      { key: 'time', label: 'Uhrzeit', kind: 'time', summary: (v) => `${v} Uhr` },
      { key: 'location', label: 'Ort', kind: 'text' },
      { key: 'participants', label: 'Mit wem', kind: 'text', summary: (v) => `mit ${v}` },
    ],
  },
}

export const TYPE_KEYS = Object.keys(ENTRY_TYPES)

// Unknown kinds (e.g. added in a newer version of the app) are shown as status.
export function typeKey(key) {
  return Object.hasOwn(ENTRY_TYPES, key) ? key : 'status'
}

export function entryType(key) {
  return ENTRY_TYPES[typeKey(key)]
}

export function defaultDetails(key, current = {}) {
  const details = {}
  for (const field of entryType(key).fields) {
    details[field.key] = current[field.key] ?? field.default ?? ''
  }
  return details
}
