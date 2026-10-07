import { useRef, useState } from 'react'
import { formatDate, today, usePersistentState } from '../storage.js'
import { useDialogs } from '../dialogs.js'
import DateInput from './DateInput.jsx'

const currency = new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR' })

// New expenses are entered in the diary (entry kind "Ausgabe"), so the
// form here adds funding; older expenses can still be edited with it.
function emptyForm(type = 'funding') {
  // An empty category means "the first category of this type".
  return { date: today(), type, category: '', description: '', amount: '' }
}

// The Finanzen tab's bookings: the funding form (folded behind a button)
// and the table of all transactions. `children` (the category manager)
// sits between the two.
function Bookings({
  items,
  status,
  loadError,
  insert,
  update,
  remove,
  expenseCategories,
  fundingCategories,
  onOpenDiary,
  children,
}) {
  const [form, setForm] = useState(() => emptyForm())
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const [editingId, setEditingId] = useState(null)
  // The funding form stays folded behind a button until needed; it opens
  // by itself to edit a booking.
  const [formOpen, setFormOpen] = useState(false)
  // Remembered on this device, like the budget plan.
  const [bookingsOpen, setBookingsOpen] = usePersistentState('bookings.open', true)
  const formRef = useRef(null)
  const dialogs = useDialogs()

  const sorted = [...items].sort((a, b) => b.date.localeCompare(a.date))
  const baseCategories = (form.type === 'funding' ? fundingCategories : expenseCategories).map(
    (c) => c.name,
  )
  const formCategory = form.category || baseCategories[0] || ''
  // Keep an entry's category selectable even if it is no longer in the list.
  const categories =
    !formCategory || baseCategories.includes(formCategory)
      ? baseCategories
      : [...baseCategories, formCategory]

  function setField(field) {
    return (e) => setForm({ ...form, [field]: e.target.value })
  }

  async function handleSubmit(e) {
    e.preventDefault()
    const amount = Math.round(Number(form.amount) * 100) / 100
    if (!form.date || !form.description.trim() || !(amount > 0)) {
      setError('Bitte Datum, Beschreibung und einen Betrag größer als 0 eingeben.')
      return
    }
    if (!formCategory) {
      setError('Bitte zuerst eine Kategorie anlegen (Kategorien verwalten).')
      return
    }
    setSaving(true)
    setError('')
    const item = {
      date: form.date,
      type: form.type,
      category: formCategory,
      description: form.description.trim(),
      amount,
    }
    try {
      if (editingId) {
        await update(editingId, item)
        resetForm()
      } else {
        await insert(item)
        setForm({ ...emptyForm(form.type), category: formCategory })
      }
    } catch (err) {
      setError(err.message)
    } finally {
      setSaving(false)
    }
  }

  function resetForm() {
    setForm(emptyForm())
    setEditingId(null)
    setError('')
    setFormOpen(false)
  }

  function startEdit(item) {
    setForm({
      date: item.date,
      type: item.type,
      category: item.category,
      description: item.description,
      amount: String(item.amount),
    })
    setEditingId(item.id)
    setError('')
    setFormOpen(true)
    // Once the opened form is on the page.
    requestAnimationFrame(() => formRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }))
  }

  async function handleDelete(id) {
    if (!(await dialogs.confirm('Diese Buchung löschen?', { confirmLabel: 'Löschen', danger: true }))) return
    try {
      await remove(id)
      if (editingId === id) resetForm()
    } catch (err) {
      await dialogs.alert(err.message)
    }
  }

  return (
    <>
      {!formOpen && (
        <button type="button" className="secondary add-funding" onClick={() => setFormOpen(true)}>
          + Finanzierung hinzufügen
        </button>
      )}
      {formOpen && (
        <form ref={formRef} className="card form-grid" onSubmit={handleSubmit} noValidate>
          <h2>
            {!editingId
              ? 'Neue Finanzierung'
              : form.type === 'funding'
                ? 'Finanzierung bearbeiten'
                : 'Ausgabe bearbeiten'}
          </h2>
          {!editingId && (
            <p className="muted full form-hint">
              Ausgaben trägst du im Tagebuch ein (Eintragsart „Ausgabe“).
            </p>
          )}
          <label>
            Datum
            <DateInput value={form.date} onChange={setField('date')} />
          </label>
          <label>
            {form.type === 'funding' ? 'Quelle' : 'Kategorie'}
            <select value={formCategory} onChange={setField('category')}>
              {categories.map((c) => (
                <option key={c}>{c}</option>
              ))}
            </select>
          </label>
          <label>
            Betrag (€)
            <input
              type="number"
              min="0"
              step="0.01"
              value={form.amount}
              onChange={setField('amount')}
            />
          </label>
          <label className="full">
            Beschreibung
            <input
              type="text"
              placeholder={form.type === 'funding' ? 'z. B. Kredit, 1. Tranche' : 'z. B. Beton für Fundament'}
              value={form.description}
              onChange={setField('description')}
            />
          </label>

          {error && (
            <p className="error full" role="alert">
              {error}
            </p>
          )}

          <div className="form-actions full">
            <button type="submit" disabled={saving}>
              {saving
                ? 'Wird gespeichert…'
                : editingId
                  ? 'Änderungen speichern'
                  : form.type === 'funding'
                    ? 'Finanzierung hinzufügen'
                    : 'Ausgabe hinzufügen'}
            </button>
            <button type="button" className="secondary" onClick={resetForm} disabled={saving}>
              Abbrechen
            </button>
          </div>
        </form>
      )}

      {children}

      {status === 'loading' && <p className="empty">Finanzen werden geladen…</p>}
      {status === 'error' && (
        <p className="error" role="alert">
          {loadError}
        </p>
      )}
      {status === 'ready' && sorted.length === 0 ? (
        <p className="empty">Noch keine Buchungen.</p>
      ) : sorted.length === 0 ? null : (
        <div className="card bookings">
          <div className="budget-head">
            <h2>
              <button
                type="button"
                className="budget-toggle"
                aria-expanded={bookingsOpen}
                onClick={() => setBookingsOpen(!bookingsOpen)}
              >
                <span className="budget-chevron" aria-hidden="true">
                  {bookingsOpen ? '▾' : '▸'}
                </span>
                Buchungen <span className="chip-count">{sorted.length}</span>
              </button>
            </h2>
          </div>
          {bookingsOpen && (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Datum</th>
                    <th>Beschreibung</th>
                    <th>Quelle / Kategorie</th>
                    <th className="num">Betrag</th>
                    <th aria-label="Aktionen"></th>
                  </tr>
                </thead>
                <tbody>
                  {sorted.map((item) => (
                    <tr key={item.id} className={item.id === editingId ? 'editing' : undefined}>
                      <td className="date">{formatDate(item.date)}</td>
                      <td>
                        {item.description}
                        {(!item.paid || item.hasReceipt) && (
                          <span className="tx-tags">
                            {!item.paid && <span className="state-pill state-open">Offen</span>}
                            {item.hasReceipt && (
                              <span className="state-pill" title="Beleg im Tagebucheintrag">
                                🧾 Beleg
                              </span>
                            )}
                          </span>
                        )}
                      </td>
                      <td>{item.category}</td>
                      <td className="num">
                        {item.type === 'funding' ? '+' : '−'}
                        {currency.format(item.amount)}
                      </td>
                      <td className="num row-actions">
                        {item.diaryEntryId ? (
                          <button
                            type="button"
                            className="link"
                            title="Im Tagebuch ansehen, bearbeiten oder löschen"
                            onClick={() => onOpenDiary({ entry: { id: item.diaryEntryId, type: 'expense' } })}
                          >
                            im Tagebuch
                          </button>
                        ) : (
                          <>
                            <button type="button" className="link" onClick={() => startEdit(item)}>
                              Bearbeiten
                            </button>
                            <button
                              type="button"
                              className="link danger"
                              onClick={() => handleDelete(item.id)}
                            >
                              Löschen
                            </button>
                          </>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </>
  )
}

export default Bookings
