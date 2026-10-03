import { today } from '../storage.js'
import { entryType, isOpen, isOverdue, typeKey } from '../diaryTypes.js'
import { useCollection } from '../useCollection.js'
import DrivePhoto from '../components/DrivePhoto.jsx'
import { fromRow, toRow } from '../diaryEntries.js'

const MAX_APPOINTMENTS = 5
const MAX_TASKS = 8
const MAX_PHOTOS = 12
const MAX_INVOICES = 5

const currency = new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR' })

// "Fr., 3. Okt." (or "3. Okt." without weekday), plus the year if it is
// not this year's.
function shortDate(isoDate, todayDate, weekday = true) {
  const [y, m, d] = isoDate.split('-').map(Number)
  return new Date(y, m - 1, d).toLocaleDateString('de-DE', {
    weekday: weekday ? 'short' : undefined,
    day: 'numeric',
    month: 'short',
    year: isoDate.slice(0, 4) === todayDate.slice(0, 4) ? undefined : 'numeric',
  })
}

function relativeDay(isoDate, todayDate) {
  const days = Math.round((Date.parse(isoDate) - Date.parse(todayDate)) / 86400000)
  if (days === 0) return 'Heute'
  if (days === 1) return 'Morgen'
  return null
}

// The first line of an entry's text, as its title in the lists.
function firstLine(text) {
  return text.split('\n').find((line) => line.trim()) ?? ''
}

function dueDate(entry) {
  return entry.details[entryType(entry.type).progress?.due] || ''
}

// The start page: what comes next, what is still open, and the newest
// photos. Everything opens in the diary; data is the diary's own and stays
// live through the same Realtime subscription.
function Overview({ onOpenDiary }) {
  const { rows: entries, status, error } = useCollection('diary_entries', { fromRow, toRow })
  const todayDate = today()

  const appointments = entries
    .filter((e) => typeKey(e.type) === 'appointment' && e.date >= todayDate)
    .sort(
      (a, b) =>
        a.date.localeCompare(b.date) ||
        (a.details.time ?? '').localeCompare(b.details.time ?? ''),
    )

  // Soonest due first; without a due date at the end, oldest first.
  const bySoonestDue = (a, b) =>
    (dueDate(a) || '9999').localeCompare(dueDate(b) || '9999') || a.date.localeCompare(b.date)
  const open = entries.filter(isOpen).sort(bySoonestDue)
  const tasks = open.filter((e) => typeKey(e.type) !== 'expense')
  const overdueCount = tasks.filter((e) => isOverdue(e, todayDate)).length
  // Invoices not yet paid (diary expenses marked "Offen").
  const invoices = open.filter((e) => typeKey(e.type) === 'expense')
  const invoiceTotal = invoices.reduce((sum, e) => sum + (Number(e.details.amount) || 0), 0)

  const photos = entries
    .filter((e) => e.photoIds.length > 0)
    .sort((a, b) => b.date.localeCompare(a.date) || (b.createdAt ?? '').localeCompare(a.createdAt ?? ''))
    .flatMap((entry) => entry.photoIds.map((fileId) => ({ fileId, entry })))
    .slice(0, MAX_PHOTOS)

  if (status === 'loading') return <p className="empty">Wird geladen…</p>
  if (status === 'error') {
    return (
      <p className="error" role="alert">
        {error}
      </p>
    )
  }

  return (
    <section className="tab-content overview">
      <div className="card overview-card">
        <div className="overview-head">
          <h2>Nächste Termine</h2>
          <button
            type="button"
            className="link"
            onClick={() => onOpenDiary({ filter: 'appointment' })}
          >
            Alle Termine
          </button>
        </div>
        {appointments.length === 0 ? (
          <p className="muted overview-empty">Keine anstehenden Termine.</p>
        ) : (
          <ul className="overview-list">
            {appointments.slice(0, MAX_APPOINTMENTS).map((entry) => {
              const soon = relativeDay(entry.date, todayDate)
              const where = [entry.details.location, entry.details.participants && `mit ${entry.details.participants}`]
                .filter(Boolean)
                .join(' · ')
              return (
                <li key={entry.id}>
                  <button
                    type="button"
                    className="overview-item type-appointment"
                    onClick={() => onOpenDiary({ entry })}
                  >
                    <span className="overview-when">
                      <strong>{soon ?? shortDate(entry.date, todayDate)}</strong>
                      {entry.details.time && <span>{entry.details.time} Uhr</span>}
                    </span>
                    <span className="overview-what">
                      <span className="overview-title">{firstLine(entry.work)}</span>
                      {where && <span className="muted">{where}</span>}
                    </span>
                  </button>
                </li>
              )
            })}
          </ul>
        )}
        {appointments.length > MAX_APPOINTMENTS && (
          <p className="muted overview-more">
            und {appointments.length - MAX_APPOINTMENTS} weitere
          </p>
        )}
      </div>

      <div className="card overview-card">
        <div className="overview-head">
          <h2>
            Offene Aufgaben und Mängel
            {overdueCount > 0 && (
              <span className="state-pill state-overdue">{overdueCount} überfällig</span>
            )}
          </h2>
          <span className="overview-links">
            <button
              type="button"
              className="link"
              onClick={() => onOpenDiary({ filter: 'todo', openOnly: true })}
            >
              Aufgaben
            </button>
            <button
              type="button"
              className="link"
              onClick={() => onOpenDiary({ filter: 'defect', openOnly: true })}
            >
              Mängel
            </button>
          </span>
        </div>
        {tasks.length === 0 ? (
          <p className="muted overview-empty">Nichts offen.</p>
        ) : (
          <ul className="overview-list">
            {tasks.slice(0, MAX_TASKS).map((entry) => {
              const key = typeKey(entry.type)
              const due = dueDate(entry)
              const overdue = isOverdue(entry, todayDate)
              const who = entry.details.responsible
              return (
                <li key={entry.id}>
                  <button
                    type="button"
                    className={`overview-item type-${key}${overdue ? ' overdue' : ''}`}
                    onClick={() => onOpenDiary({ entry })}
                  >
                    <span className="overview-what">
                      <span className="overview-title">{firstLine(entry.work)}</span>
                      <span className="overview-meta">
                        <span className={`type-badge type-${key}`}>{entryType(key).label}</span>
                        {due ? (
                          <span className={overdue ? 'overdue-date' : undefined}>
                            bis {relativeDay(due, todayDate) ?? shortDate(due, todayDate, false)}
                          </span>
                        ) : (
                          <span className="muted">ohne Frist</span>
                        )}
                        {who && <span className="muted">{who}</span>}
                      </span>
                    </span>
                  </button>
                </li>
              )
            })}
          </ul>
        )}
        {tasks.length > MAX_TASKS && (
          <p className="muted overview-more">und {tasks.length - MAX_TASKS} weitere</p>
        )}
      </div>

      {invoices.length > 0 && (
        <div className="card overview-card">
          <div className="overview-head">
            <h2>
              Offene Rechnungen
              <span className="muted overview-sum">{currency.format(invoiceTotal)}</span>
            </h2>
            <button
              type="button"
              className="link"
              onClick={() => onOpenDiary({ filter: 'expense', openOnly: true })}
            >
              Alle offenen
            </button>
          </div>
          <ul className="overview-list">
            {invoices.slice(0, MAX_INVOICES).map((entry) => {
              const due = dueDate(entry)
              const overdue = isOverdue(entry, todayDate)
              return (
                <li key={entry.id}>
                  <button
                    type="button"
                    className={`overview-item type-expense${overdue ? ' overdue' : ''}`}
                    onClick={() => onOpenDiary({ entry })}
                  >
                    <span className="overview-what">
                      <span className="overview-title">{firstLine(entry.work)}</span>
                      <span className="overview-meta">
                        <strong>{currency.format(Number(entry.details.amount) || 0)}</strong>
                        {due ? (
                          <span className={overdue ? 'overdue-date' : undefined}>
                            zahlbar bis {relativeDay(due, todayDate) ?? shortDate(due, todayDate, false)}
                          </span>
                        ) : (
                          <span className="muted">ohne Frist</span>
                        )}
                        {entry.details.category && <span className="muted">{entry.details.category}</span>}
                      </span>
                    </span>
                  </button>
                </li>
              )
            })}
          </ul>
          {invoices.length > MAX_INVOICES && (
            <p className="muted overview-more">und {invoices.length - MAX_INVOICES} weitere</p>
          )}
        </div>
      )}

      <div className="card overview-card overview-photos">
        <div className="overview-head">
          <h2>Neueste Fotos</h2>
          <button type="button" className="link" onClick={() => onOpenDiary({ filter: 'all' })}>
            Zum Tagebuch
          </button>
        </div>
        {photos.length === 0 ? (
          <p className="muted overview-empty">Noch keine Fotos.</p>
        ) : (
          <ul className="thumb-grid">
            {photos.map(({ fileId, entry }) => (
              <li key={`${entry.id}-${fileId}`} className="thumb">
                <DrivePhoto
                  fileId={fileId}
                  alt={`Foto: ${entryType(entry.type).label} vom ${shortDate(entry.date, todayDate)}`}
                  className="thumb-img"
                  onOpen={() => onOpenDiary({ entry })}
                />
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  )
}

export default Overview
