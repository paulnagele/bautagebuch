import { useState } from 'react'

// Planned budget per expense category next to what was actually spent.
// `categories` are the expense categories (with `plannedAmount`, null when
// no plan is set); `spent` maps a category name to the amount spent.
// Spending in categories that are no longer in the list is shown too, so
// the totals always match the transactions. `funding` is the secured funding,
// to warn when the plan needs more money than is secured.
function BudgetPlan({ categories, spent, funding, readOnly, format, onSetPlan }) {
  const [editing, setEditing] = useState(null) // { id, value }
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)

  const names = new Set(categories.map((c) => c.name))
  const rows = [
    ...categories.map((c) => ({
      id: c.id,
      name: c.name,
      planned: c.plannedAmount,
      spent: spent.get(c.name) ?? 0,
      editable: !readOnly,
    })),
    ...[...spent.entries()]
      .filter(([name, value]) => !names.has(name) && value > 0)
      .map(([name, value]) => ({ id: `gone-${name}`, name, planned: null, spent: value })),
  ]
  const totalPlanned = rows.reduce((s, r) => s + (r.planned ?? 0), 0)
  const totalSpent = rows.reduce((s, r) => s + r.spent, 0)
  const anyPlan = rows.some((r) => r.planned !== null)

  function startEdit(row) {
    setMessage('')
    setEditing({ id: row.id, value: row.planned === null ? '' : String(row.planned) })
  }

  async function handleSave(e) {
    e.preventDefault()
    const text = editing.value.trim()
    const amount = text === '' ? null : Math.round(Number(text) * 100) / 100
    if (amount !== null && !(amount >= 0)) {
      setMessage('Bitte einen Betrag ab 0 eingeben oder das Feld leeren, um den Plan zu entfernen.')
      return
    }
    setBusy(true)
    setMessage('')
    try {
      await onSetPlan(editing.id, amount)
      setEditing(null)
    } catch (err) {
      setMessage(err.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="card budget-plan">
      <div className="budget-head">
        <h2>Budget nach Kategorie</h2>
        {anyPlan && (
          <span className="muted budget-total">
            {format(totalSpent)} von {format(totalPlanned)} geplant
          </span>
        )}
      </div>
      {anyPlan && totalPlanned > funding && (
        <p className="negative budget-hint">
          ⚠ Der Plan braucht {format(totalPlanned - funding)} mehr als die gesicherte Finanzierung.
        </p>
      )}
      {!anyPlan && (
        <p className="muted budget-hint">
          {readOnly
            ? 'Geplante Beträge können festgelegt werden, sobald die Datenbank aktuell ist.'
            : 'Lege pro Kategorie einen geplanten Betrag fest, um ihn mit den Ausgaben zu vergleichen.'}
        </p>
      )}
      <ul className="budget-list">
        {rows.map((row) => {
          const share = row.planned > 0 ? row.spent / row.planned : row.spent > 0 ? Infinity : 0
          const over = row.planned !== null && row.spent > row.planned
          const left = (row.planned ?? 0) - row.spent
          return (
            <li key={row.id} className="budget-row">
              <div className="budget-line">
                <span className="budget-name">{row.name}</span>
                {editing?.id === row.id ? (
                  <form className="budget-edit" onSubmit={handleSave}>
                    <input
                      type="number"
                      min="0"
                      step="100"
                      inputMode="decimal"
                      placeholder="Kein Plan"
                      aria-label={`Geplanter Betrag für ${row.name} (€)`}
                      value={editing.value}
                      onChange={(e) => setEditing({ ...editing, value: e.target.value })}
                      disabled={busy}
                      autoFocus
                    />
                    <button type="submit" className="link" disabled={busy}>
                      Speichern
                    </button>
                    <button
                      type="button"
                      className="link"
                      onClick={() => setEditing(null)}
                      disabled={busy}
                    >
                      Abbrechen
                    </button>
                  </form>
                ) : (
                  row.editable && (
                    <button type="button" className="link" onClick={() => startEdit(row)}>
                      {row.planned === null ? 'Plan festlegen' : 'Plan bearbeiten'}
                    </button>
                  )
                )}
              </div>
              {row.planned !== null && (
                <div
                  className="meter budget-meter"
                  role="meter"
                  aria-label={`Ausgegebener Anteil des Budgets für ${row.name}`}
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-valuenow={Math.round(Math.min(share, 9.99) * 100)}
                >
                  <span
                    className={over ? 'meter-fill over' : 'meter-fill'}
                    style={{ width: `${Math.min(share, 1) * 100}%` }}
                  />
                </div>
              )}
              <div className="budget-line budget-detail">
                {row.planned === null ? (
                  <span className="muted">Kein Plan</span>
                ) : (
                  <span className={over ? 'negative' : 'muted'}>
                    {over ? `${format(-left)} über Plan` : `${format(left)} übrig`}
                  </span>
                )}
                <span className="budget-amounts">
                  {format(row.spent)}
                  {row.planned !== null && <span className="muted"> von {format(row.planned)}</span>}
                </span>
              </div>
            </li>
          )
        })}
      </ul>
      {message && (
        <p className="error" role="alert">
          {message}
        </p>
      )}
    </div>
  )
}

export default BudgetPlan
