import { useState } from 'react'
import { usePersistentState } from '../storage.js'
import { useDialogs } from '../dialogs.js'

// Planned budget per expense category next to what was actually spent.
// `categories` are the expense categories (with `plannedAmount`, null when
// no plan is set); `spent` maps a category name to the amount spent.
// Spending in categories that are no longer in the list is shown too, so
// the totals always match the transactions. `funding` is the secured funding,
// to warn when the plan needs more money than is secured.
//
// A category can be split into items (`items`, e.g. Dachdecker, Spengler),
// each with its own planned amount; the category's plan is then their sum.
// `itemSpent` maps an item id to what was spent on it (diary expenses
// assigned to that item). `unpaid` and `itemUnpaid` hold the part of
// that which is still unpaid invoices, by category name and item id.

function parseAmount(text) {
  const trimmed = text.trim()
  if (trimmed === '') return null
  const amount = Math.round(Number(trimmed) * 100) / 100
  return amount >= 0 ? amount : NaN
}

// Spent vs. planned: a bar (when there is a plan) and "x übrig · a von b".
function Progress({ label, spent, unpaid = 0, planned, format, small }) {
  const share = planned > 0 ? spent / planned : spent > 0 ? Infinity : 0
  const over = planned !== null && spent > planned
  const left = (planned ?? 0) - spent
  return (
    <>
      {planned !== null && (
        <div
          className={small ? 'meter budget-meter small' : 'meter budget-meter'}
          role="meter"
          aria-label={`Ausgegebener Anteil des Budgets für ${label}`}
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
        {planned === null ? (
          <span className="muted">Kein Plan</span>
        ) : (
          <span className={over ? 'negative' : 'muted'}>
            {over ? `${format(-left)} über Plan` : `${format(left)} übrig`}
          </span>
        )}
        <span className="budget-amounts">
          {format(spent)}
          {planned !== null && <span className="muted"> von {format(planned)}</span>}
          {unpaid > 0 && <span className="muted"> · davon {format(unpaid)} offen</span>}
        </span>
      </div>
    </>
  )
}

function BudgetPlan({
  categories,
  spent,
  items = [],
  itemSpent = new Map(),
  unpaid = new Map(),
  itemUnpaid = new Map(),
  itemsReadOnly,
  funding,
  readOnly,
  format,
  onSetPlan,
  onAddItem,
  onUpdateItem,
  onDeleteItem,
}) {
  // { kind: 'plan', id, value } | { kind: 'item', id, name, value }
  // | { kind: 'new-item', categoryId, name, value }
  const [editing, setEditing] = useState(null)
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)
  const dialogs = useDialogs()
  // Remembered on this device: whether the card is open, and which
  // categories show their items (all collapsed at first).
  const [open, setOpen] = usePersistentState('budget.open', true)
  const [openCategories, setOpenCategories] = usePersistentState('budget.openCategories', [])

  function toggleCategory(id) {
    setOpenCategories((ids) => (ids.includes(id) ? ids.filter((i) => i !== id) : [...ids, id]))
  }

  const itemsOf = (categoryId) => items.filter((item) => item.categoryId === categoryId)
  const names = new Set(categories.map((c) => c.name))
  const rows = [
    ...categories.map((c) => ({
      id: c.id,
      name: c.name,
      planned: c.plannedAmount,
      spent: spent.get(c.name) ?? 0,
      unpaid: unpaid.get(c.name) ?? 0,
      items: itemsOf(c.id),
      editable: !readOnly,
    })),
    ...[...spent.entries()]
      .filter(([name, value]) => !names.has(name) && value > 0)
      .map(([name, value]) => ({
        id: `gone-${name}`,
        name,
        planned: null,
        spent: value,
        unpaid: unpaid.get(name) ?? 0,
        items: [],
      })),
  ]
  const totalPlanned = rows.reduce((s, r) => s + (r.planned ?? 0), 0)
  const totalSpent = rows.reduce((s, r) => s + r.spent, 0)
  const anyPlan = rows.some((r) => r.planned !== null)
  const canEditItems = !readOnly && !itemsReadOnly

  async function run(action) {
    setBusy(true)
    setMessage('')
    try {
      await action()
      setEditing(null)
    } catch (err) {
      setMessage(err.message)
    } finally {
      setBusy(false)
    }
  }

  function start(next) {
    setMessage('')
    setEditing(next)
  }

  async function handleSave(e) {
    e.preventDefault()
    const amount = parseAmount(editing.value)
    if (editing.kind === 'plan') {
      if (Number.isNaN(amount)) {
        setMessage('Bitte einen Betrag ab 0 eingeben oder das Feld leeren, um den Plan zu entfernen.')
        return
      }
      await run(() => onSetPlan(editing.id, amount))
      return
    }
    const name = editing.name.trim()
    if (!name || amount === null || Number.isNaN(amount)) {
      setMessage('Bitte einen Namen und einen geplanten Betrag ab 0 eingeben.')
      return
    }
    if (editing.kind === 'item') {
      await run(() => onUpdateItem(editing.id, { name, plannedAmount: amount }))
    } else {
      await run(() => onAddItem(editing.categoryId, name, amount))
    }
  }

  async function handleDeleteItem(item) {
    const used = itemSpent.get(item.id) ?? 0
    const note = used > 0 ? ` Die zugeordneten Ausgaben (${format(used)}) bleiben in der Kategorie.` : ''
    const question = `Den Posten „${item.name}“ löschen?${note}`
    if (!(await dialogs.confirm(question, { confirmLabel: 'Löschen', danger: true }))) return
    await run(() => onDeleteItem(item.id))
  }

  const cancelButton = (
    <button type="button" className="link" onClick={() => setEditing(null)} disabled={busy}>
      Abbrechen
    </button>
  )

  // Name and amount of a new or edited item.
  function itemForm(label) {
    return (
      <form className="budget-edit budget-item-form" onSubmit={handleSave}>
        <input
          className="budget-item-name"
          placeholder="Posten, z. B. Spengler"
          aria-label={`Name des Postens${label ? ` in ${label}` : ''}`}
          value={editing.name}
          onChange={(e) => setEditing({ ...editing, name: e.target.value })}
          disabled={busy}
          autoFocus
        />
        <input
          type="number"
          min="0"
          step="100"
          inputMode="decimal"
          placeholder="Plan (€)"
          aria-label="Geplanter Betrag (€)"
          value={editing.value}
          onChange={(e) => setEditing({ ...editing, value: e.target.value })}
          disabled={busy}
        />
        <button type="submit" className="link" disabled={busy}>
          Speichern
        </button>
        {cancelButton}
      </form>
    )
  }

  return (
    <div className="card budget-plan">
      <div className="budget-head">
        <h2>
          <button
            type="button"
            className="budget-toggle"
            aria-expanded={open}
            onClick={() => setOpen(!open)}
          >
            <span className="budget-chevron" aria-hidden="true">
              {open ? '▾' : '▸'}
            </span>
            Budget nach Kategorie
          </button>
        </h2>
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
      {open && !anyPlan && (
        <p className="muted budget-hint">
          {readOnly
            ? 'Geplante Beträge können festgelegt werden, sobald die Datenbank aktuell ist.'
            : 'Lege pro Kategorie einen geplanten Betrag fest oder teile sie in Posten auf (z. B. Dachdecker, Spengler), um den Plan mit den Ausgaben zu vergleichen.'}
        </p>
      )}
      {open && (
        <ul className="budget-list">
          {rows.map((row) => {
            const hasItems = row.items.length > 0
            const unassigned =
              row.spent - row.items.reduce((s, item) => s + (itemSpent.get(item.id) ?? 0), 0)
            const editingPlan = editing?.kind === 'plan' && editing.id === row.id
            const addingItem = editing?.kind === 'new-item' && editing.categoryId === row.id
            const itemsOpen = hasItems && openCategories.includes(row.id)
            return (
              <li key={row.id} className="budget-row">
                <div className="budget-line">
                  <span className="budget-name">{row.name}</span>
                  {editingPlan ? (
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
                      {cancelButton}
                    </form>
                  ) : (
                    row.editable && (
                      <span className="budget-actions">
                        {!hasItems && (
                          <button
                            type="button"
                            className="link"
                            onClick={() =>
                              start({
                                kind: 'plan',
                                id: row.id,
                                value: row.planned === null ? '' : String(row.planned),
                              })
                            }
                          >
                            {row.planned === null ? 'Plan festlegen' : 'Plan bearbeiten'}
                          </button>
                        )}
                        {canEditItems && (
                          <button
                            type="button"
                            className="link"
                            onClick={() =>
                              start({ kind: 'new-item', categoryId: row.id, name: '', value: '' })
                            }
                          >
                            + Posten
                          </button>
                        )}
                      </span>
                    )
                  )}
                </div>
                <Progress
                  label={row.name}
                  spent={row.spent}
                  unpaid={row.unpaid}
                  planned={row.planned}
                  format={format}
                />
                {hasItems && (
                  <button
                    type="button"
                    className="link budget-items-toggle"
                    aria-expanded={itemsOpen}
                    onClick={() => toggleCategory(row.id)}
                  >
                    <span aria-hidden="true">{itemsOpen ? '▾' : '▸'}</span> {row.items.length}{' '}
                    Posten{itemsOpen ? ' ausblenden' : ' anzeigen'}
                  </button>
                )}
                {(itemsOpen || addingItem) && (
                  <ul className="budget-items">
                    {(itemsOpen ? row.items : []).map((item) => (
                      <li key={item.id} className="budget-item">
                        {editing?.kind === 'item' && editing.id === item.id ? (
                          itemForm(row.name)
                        ) : (
                          <>
                            <div className="budget-line">
                              <span className="budget-name">{item.name}</span>
                              {canEditItems && (
                                <span className="budget-actions">
                                  <button
                                    type="button"
                                    className="link"
                                    onClick={() =>
                                      start({
                                        kind: 'item',
                                        id: item.id,
                                        name: item.name,
                                        value: String(item.plannedAmount),
                                      })
                                    }
                                  >
                                    Bearbeiten
                                  </button>
                                  <button
                                    type="button"
                                    className="link danger"
                                    onClick={() => handleDeleteItem(item)}
                                    disabled={busy}
                                  >
                                    Löschen
                                  </button>
                                </span>
                              )}
                            </div>
                            <Progress
                              label={item.name}
                              spent={itemSpent.get(item.id) ?? 0}
                              unpaid={itemUnpaid.get(item.id) ?? 0}
                              planned={item.plannedAmount}
                              format={format}
                              small
                            />
                          </>
                        )}
                      </li>
                    ))}
                    {itemsOpen && unassigned > 0.005 && (
                      <li className="budget-item">
                        <div className="budget-line budget-detail">
                          <span className="muted">Ohne Posten</span>
                          <span className="budget-amounts">{format(unassigned)}</span>
                        </div>
                      </li>
                    )}
                    {addingItem && (
                      <li className="budget-item">
                        {itemForm(row.name)}
                        {!hasItems && row.planned !== null && (
                          <p className="muted budget-hint">
                            Mit Posten ergibt sich der Plan der Kategorie aus deren Summe.
                          </p>
                        )}
                      </li>
                    )}
                  </ul>
                )}
              </li>
            )
          })}
        </ul>
      )}
      {message && (
        <p className="error" role="alert">
          {message}
        </p>
      )}
    </div>
  )
}

export default BudgetPlan
