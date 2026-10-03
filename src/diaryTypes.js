// The kinds of diary entries. To add one, add an entry here (and a badge
// colour in index.css, `.type-<key>`); the database needs no change.
import { formatDate } from './storage.js'

const currency = new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR' })

// Extra fields are stored in the entry's `details` and shown in the form
// and the entry header in the order listed.
//   kind: 'text' | 'date' | 'time' | 'select' | 'amount' (euros, > 0)
//   options: a select's choices { value: label }, or
//   optionsFrom: a list the diary loads, e.g. 'expenseCategories'
//   within: the choices depend on another field's value; optionsFrom then
//     names a list of { id, name } per value of that field, the stored
//     value is the id, and the field is optional and hidden when the list
//     is empty
//   suggestFrom: free text for people, with names from that list (e.g.
//     'contacts') suggested while typing; several separated by commas
//   required: must be filled in before saving
//   summary(value): optional, how the value reads in the list; for
//     suggestFrom fields a list of parts, so names can become links
//   pill: show a select's value as a coloured label (`.state-<value>`)
// progress: for kinds that get done (defects, to-dos): which field holds
// the state, its "done" value, the button labels and the due-date field.
// sortByDue: open ones are listed first, by due date.
export const ENTRY_TYPES = {
  status: {
    label: 'Status',
    plural: 'Status',
    dateLabel: 'Datum',
    textLabel: 'Ausgeführte Arbeiten',
    // Weather and workers on site (own database columns, older than types).
    siteInfo: true,
    fields: [],
  },
  defect: {
    label: 'Mangel',
    plural: 'Mängel',
    dateLabel: 'Festgestellt am',
    textLabel: 'Beschreibung des Mangels',
    sortByDue: true,
    progress: {
      field: 'state',
      done: 'fixed',
      markDone: 'Als behoben markieren',
      reopen: 'Wieder öffnen',
      due: 'deadline',
    },
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
        suggestFrom: 'contacts',
        summary: (v) => ['Zuständig: ', v],
      },
      {
        key: 'deadline',
        label: 'Zu beheben bis',
        kind: 'date',
        summary: (v) => `bis ${formatDate(v)}`,
      },
    ],
  },
  todo: {
    label: 'Aufgabe',
    plural: 'Aufgaben',
    dateLabel: 'Eingetragen am',
    textLabel: 'Was ist zu tun?',
    sortByDue: true,
    progress: {
      field: 'state',
      done: 'done',
      markDone: 'Als erledigt markieren',
      reopen: 'Wieder öffnen',
      due: 'due',
    },
    fields: [
      {
        key: 'state',
        label: 'Stand',
        kind: 'select',
        options: { open: 'Offen', done: 'Erledigt' },
        default: 'open',
        pill: true,
      },
      {
        key: 'due',
        label: 'Erledigen bis',
        kind: 'date',
        required: true,
        summary: (v) => `bis ${formatDate(v)}`,
      },
      {
        key: 'responsible',
        label: 'Wer kümmert sich?',
        kind: 'text',
        suggestFrom: 'contacts',
        summary: (v) => ['Zuständig: ', v],
      },
    ],
  },
  appointment: {
    label: 'Termin',
    plural: 'Termine',
    dateLabel: 'Termin am',
    textLabel: 'Worum geht es?',
    fields: [
      { key: 'time', label: 'Uhrzeit', kind: 'time', summary: (v) => `${v} Uhr` },
      { key: 'location', label: 'Ort', kind: 'text' },
      {
        key: 'participants',
        label: 'Mit wem',
        kind: 'text',
        suggestFrom: 'contacts',
        summary: (v) => ['mit ', v],
      },
    ],
  },
  expense: {
    label: 'Ausgabe',
    plural: 'Ausgaben',
    dateLabel: 'Datum',
    textLabel: 'Wofür?',
    // Each expense entry is also booked in Finanzen, kept in sync by the
    // database (migration 20261002233000_diary_expenses.sql).
    fields: [
      {
        key: 'category',
        label: 'Kategorie',
        kind: 'select',
        optionsFrom: 'expenseCategories',
        required: true,
      },
      {
        // One of the category's budget items, kept on the Finanzen tab.
        key: 'budgetItem',
        label: 'Posten',
        kind: 'select',
        optionsFrom: 'budgetItems',
        within: 'category',
      },
      {
        key: 'amount',
        label: 'Betrag (€)',
        kind: 'amount',
        required: true,
        summary: (v) => currency.format(v),
      },
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

// Whether a defect or to-do still needs doing (false for other kinds).
export function isOpen(entry) {
  const progress = entryType(entry.type).progress
  return Boolean(progress) && entry.details[progress.field] !== progress.done
}

// Open and past its due date (today counts as still on time).
export function isOverdue(entry, todayDate) {
  const due = entry.details[entryType(entry.type).progress?.due]
  return isOpen(entry) && Boolean(due) && due < todayDate
}

export function defaultDetails(key, current = {}) {
  const details = {}
  for (const field of entryType(key).fields) {
    details[field.key] = current[field.key] ?? field.default ?? ''
  }
  return details
}
