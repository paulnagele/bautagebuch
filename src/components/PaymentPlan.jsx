import { useState } from 'react'
import { useDialogs } from '../dialogs.js'
import { formatDate, usePersistentState } from '../storage.js'
import { paymentState } from '../planning.js'

function emptyForm(category = '') {
  return { name: '', category, budgetItemId: '', amount: '', dueDate: '' }
}

// The payment schedule agreed with companies (e.g. "2. Rate nach Rohbau").
// When an invoice comes, "Rechnung erhalten" records the payment as an open
// diary expense, which then shows up in the finances like any other.
function PaymentPlan({
  payments,
  categories,
  itemsByCategory,
  invoices,
  todayDate,
  format,
  readOnly,
  onAdd,
  onUpdate,
  onDelete,
  onRecord,
  onOpenEntry,
}) {
  const [open, setOpen] = usePersistentState('payments.open', true)
  const [form, setForm] = useState(null) // emptyForm() plus id when editing
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const dialogs = useDialogs()

  const rows = [...payments]
    .map((payment) => ({
      payment,
      state: paymentState(payment, invoices.get(payment.diaryEntryId), todayDate),
    }))
    .sort(
      (a, b) =>
        (a.payment.dueDate || '9999').localeCompare(b.payment.dueDate || '9999') ||
        a.payment.name.localeCompare(b.payment.name, 'de'),
    )
  const total = payments.reduce((s, p) => s + p.amount, 0)
  const paid = rows.filter((r) => r.state.key === 'paid').reduce((s, r) => s + r.payment.amount, 0)
  const dueCount = rows.filter((r) => r.state.key === 'due').length

  const formItems = form ? (itemsByCategory.get(form.category || categories[0]) ?? []) : []

  async function run(action) {
    setBusy(true)
    setMessage('')
    try {
      await action()
      return true
    } catch (err) {
      setMessage(err.message)
      return false
    } finally {
      setBusy(false)
    }
  }

  function setField(key) {
    return (e) =>
      setForm({
        ...form,
        [key]: e.target.value,
        // Another category has other items.
        ...(key === 'category' ? { budgetItemId: '' } : {}),
      })
  }

  async function handleSave(e) {
    e.preventDefault()
    const name = form.name.trim()
    const amount = Math.round(Number(form.amount) * 100) / 100
    const category = form.category || categories[0] || ''
    if (!name || !(amount > 0)) {
      setMessage('Bitte eine Bezeichnung und einen Betrag größer als 0 eingeben.')
      return
    }
    if (!category) {
      setMessage('Bitte zuerst eine Ausgabenkategorie anlegen.')
      return
    }
    const payment = {
      name,
      category,
      budgetItemId: formItems.some((i) => i.id === form.budgetItemId) ? form.budgetItemId : null,
      amount,
      dueDate: form.dueDate || null,
    }
    const saved = await run(() => (form.id ? onUpdate(form.id, payment) : onAdd(payment)))
    if (saved) setForm(null)
  }

  function startEdit(payment) {
    setMessage('')
    setForm({
      id: payment.id,
      name: payment.name,
      category: payment.category,
      budgetItemId: payment.budgetItemId ?? '',
      amount: String(payment.amount),
      dueDate: payment.dueDate ?? '',
    })
  }

  async function handleRecord(payment) {
    const due = payment.dueDate ? `, zahlbar bis ${formatDate(payment.dueDate)}` : ''
    const question =
      `Ist die Rechnung für „${payment.name}“ da? Sie wird als offene Ausgabe ` +
      `(${format(payment.amount)}${due}) ins Tagebuch eingetragen. Dort kannst du sie ` +
      'als bezahlt markieren und den Beleg anhängen.'
    if (!(await dialogs.confirm(question, { confirmLabel: 'Eintragen' }))) return
    await run(() => onRecord(payment))
  }

  async function handleDelete(payment) {
    const note = payment.diaryEntryId ? ' Die Ausgabe im Tagebuch bleibt.' : ''
    const question = `„${payment.name}“ aus dem Zahlungsplan löschen?${note}`
    if (!(await dialogs.confirm(question, { confirmLabel: 'Löschen', danger: true }))) return
    await run(() => onDelete(payment.id))
  }

  return (
    <div className="card payment-plan">
      <div className="budget-head">
        <h2>
          <button type="button" className="budget-toggle" aria-expanded={open} onClick={() => setOpen(!open)}>
            <span className="budget-chevron" aria-hidden="true">
              {open ? '▾' : '▸'}
            </span>
            Zahlungsplan
          </button>
          {dueCount > 0 && <span className="state-pill state-overdue">{dueCount} fällig</span>}
        </h2>
        {payments.length > 0 && (
          <span className="muted budget-total">
            {format(paid)} von {format(total)} bezahlt
          </span>
        )}
      </div>
      {open && payments.length === 0 && !form && (
        <p className="muted budget-hint">
          Trage die vereinbarten Zahlungen ein, z. B. die Raten an den Baumeister. Kommt die Rechnung,
          wird die Zahlung mit einem Klick zur offenen Ausgabe im Tagebuch.
        </p>
      )}
      {open && rows.length > 0 && (
        <ul className="payment-list">
          {rows.map(({ payment, state }) => {
            const item = (itemsByCategory.get(payment.category) ?? []).find((i) => i.id === payment.budgetItemId)
            return (
              <li key={payment.id} className={`payment state-row-${state.key}`}>
                <div className="budget-line">
                  <span className="payment-name">
                    {payment.name}
                    <span className={`state-pill ${state.pill}`}>{state.label}</span>
                  </span>
                  <strong className="payment-amount">{format(payment.amount)}</strong>
                </div>
                <div className="budget-line budget-detail">
                  <span className="muted">
                    {[payment.dueDate && `fällig ${formatDate(payment.dueDate)}`, payment.category, item?.name]
                      .filter(Boolean)
                      .join(' · ')}
                  </span>
                  <span className="budget-actions">
                    {payment.diaryEntryId ? (
                      <button type="button" className="link" onClick={() => onOpenEntry(payment.diaryEntryId)}>
                        im Tagebuch
                      </button>
                    ) : (
                      !readOnly && (
                        <button type="button" className="link" onClick={() => handleRecord(payment)} disabled={busy}>
                          Rechnung erhalten
                        </button>
                      )
                    )}
                    {!readOnly && (
                      <>
                        <button type="button" className="link" onClick={() => startEdit(payment)} disabled={busy}>
                          Bearbeiten
                        </button>
                        <button
                          type="button"
                          className="link danger"
                          onClick={() => handleDelete(payment)}
                          disabled={busy}
                        >
                          Löschen
                        </button>
                      </>
                    )}
                  </span>
                </div>
              </li>
            )
          })}
        </ul>
      )}
      {open && form && (
        <form className="form-grid payment-form" onSubmit={handleSave} noValidate>
          <label className="full">
            Bezeichnung
            <input
              value={form.name}
              placeholder="z. B. 2. Rate Baumeister nach Rohbau"
              onChange={setField('name')}
              disabled={busy}
              autoFocus
            />
          </label>
          <label>
            Kategorie
            <select value={form.category || categories[0] || ''} onChange={setField('category')} disabled={busy}>
              {(form.category && !categories.includes(form.category)
                ? [...categories, form.category]
                : categories
              ).map((name) => (
                <option key={name} value={name}>
                  {name}
                </option>
              ))}
            </select>
          </label>
          {formItems.length > 0 && (
            <label>
              Posten
              <select value={form.budgetItemId} onChange={setField('budgetItemId')} disabled={busy}>
                <option value="">– keiner –</option>
                {formItems.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name}
                  </option>
                ))}
              </select>
            </label>
          )}
          <label>
            Betrag (€)
            <input
              type="number"
              min="0"
              step="0.01"
              inputMode="decimal"
              value={form.amount}
              onChange={setField('amount')}
              disabled={busy}
            />
          </label>
          <label>
            Fällig am
            <input type="date" value={form.dueDate} onChange={setField('dueDate')} disabled={busy} />
          </label>
          <div className="form-actions full">
            <button type="submit" disabled={busy}>
              {form.id ? 'Änderungen speichern' : 'Zahlung hinzufügen'}
            </button>
            <button type="button" className="secondary" onClick={() => setForm(null)} disabled={busy}>
              Abbrechen
            </button>
          </div>
        </form>
      )}
      {open && !form && !readOnly && (
        <button
          type="button"
          className="link payment-add"
          onClick={() => {
            setMessage('')
            setForm(emptyForm())
          }}
        >
          + Zahlung
        </button>
      )}
      {message && (
        <p className="error" role="alert">
          {message}
        </p>
      )}
    </div>
  )
}

export default PaymentPlan
