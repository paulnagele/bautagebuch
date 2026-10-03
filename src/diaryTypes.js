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
//   pill: show a select's value as a coloured label (`.state-<value>`),
//     except the value in `quiet`, if given
// progress: for kinds that get done (defects, to-dos, unpaid expenses):
// which field holds the state, its "done" value, the button labels and
// the due-date field. An entry without that field has its default.
// sortByDue: open ones are listed first, by due date.
// dueHeadline: the list shows the due date as the entry's big date, and the
// entry date in the small text.
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
    dueHeadline: true,
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
    dueHeadline: true,
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
    // database (migrations 20261002233000_diary_expenses.sql and
    // 20261003060000_expense_payment.sql). An unpaid invoice is "open"
    // until it is marked paid; expenses from before count as paid.
    progress: {
      field: 'payment',
      done: 'paid',
      markDone: 'Als bezahlt markieren',
      reopen: 'Als offen markieren',
      due: 'payBy',
    },
    // Unpaid invoices are not put into the Google Calendar.
    noCalendar: true,
    // Shown under the form: a photo or PDF of the invoice is the receipt.
    receipts: true,
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
      {
        key: 'payment',
        label: 'Bezahlt?',
        kind: 'select',
        options: { paid: 'Bezahlt', open: 'Offen' },
        default: 'paid',
        pill: true,
        // Only "Offen" gets a label; paid is the usual case.
        quiet: 'paid',
      },
      {
        key: 'payBy',
        label: 'Zahlbar bis',
        kind: 'date',
        summary: (v) => `zahlbar bis ${formatDate(v)}`,
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

// Whether a defect or to-do still needs doing, or an expense paying
// (false for other kinds).
export function isOpen(entry) {
  const { progress, fields } = entryType(entry.type)
  if (!progress) return false
  const state =
    entry.details[progress.field] ?? fields.find((f) => f.key === progress.field)?.default
  return state !== progress.done
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
