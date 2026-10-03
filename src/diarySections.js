import { entryType, isOpen, typeKey } from './diaryTypes.js'

// The date an entry is listed under: the due date for kinds headed by it
// (to-dos, defects), otherwise the entry's own date.
export function shownDate(entry) {
  const type = entryType(entry.type)
  return (type.dueHeadline && entry.details[type.progress.due]) || entry.date
}

function dueDate(entry) {
  return entry.details[entryType(entry.type).progress.due] || ''
}

// The diary list in three parts, each in one direction:
//   Offen: what still needs doing (to-dos, defects, unpaid invoices), soonest
//     due first, those without a due date after them
//   Demnächst: appointments from today on, soonest first
//   Verlauf: everything else, newest first by the date shown on the card
// Empty parts are left out.
export function diarySections(entries, todayDate) {
  const open = []
  const upcoming = []
  const history = []
  for (const entry of entries) {
    if (isOpen(entry)) open.push(entry)
    else if (typeKey(entry.type) === 'appointment' && entry.date >= todayDate) upcoming.push(entry)
    else history.push(entry)
  }
  const time = (e) => e.details.time ?? ''
  open.sort(
    (a, b) =>
      (dueDate(a) || '9999').localeCompare(dueDate(b) || '9999') || a.date.localeCompare(b.date),
  )
  upcoming.sort((a, b) => a.date.localeCompare(b.date) || time(a).localeCompare(time(b)))
  history.sort((a, b) => shownDate(b).localeCompare(shownDate(a)) || time(b).localeCompare(time(a)))
  return [
    { key: 'open', title: 'Offen', entries: open },
    { key: 'upcoming', title: 'Demnächst', entries: upcoming },
    { key: 'history', title: 'Verlauf', entries: history },
  ].filter((section) => section.entries.length > 0)
}
