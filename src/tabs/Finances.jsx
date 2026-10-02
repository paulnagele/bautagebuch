import { useRef, useState } from 'react'
import { formatDate, today } from '../storage.js'
import { useCollection } from '../useCollection.js'

// Funding sources keep a fixed colour slot each, so a source never changes
// colour when others are added or removed.
const FUNDING_SOURCES = [
  { name: 'Own funds', color: 'var(--series-1)' },
  { name: 'Bank loan', color: 'var(--series-2)' },
  { name: 'Housing subsidy', color: 'var(--series-3)' },
  { name: 'Family / private loan', color: 'var(--series-4)' },
  { name: 'Other funding', color: 'var(--series-5)' },
]

const SPENDING_CATEGORIES = [
  'Land & purchase costs',
  'Planning & permits',
  'Shell construction',
  'Roof',
  'Windows & doors',
  'Building services',
  'Interior finishing',
  'Kitchen & furnishing',
  'Outdoor & landscaping',
  'Fees & insurance',
  'Other',
]

const currency = new Intl.NumberFormat(undefined, { style: 'currency', currency: 'EUR' })
// Whole euros for the overview; the transaction table keeps cents.
const euros = new Intl.NumberFormat(undefined, {
  style: 'currency',
  currency: 'EUR',
  maximumFractionDigits: 0,
})
const percent = new Intl.NumberFormat(undefined, { style: 'percent', maximumFractionDigits: 1 })

const KIND_DEFAULT_CATEGORY = {
  funding: FUNDING_SOURCES[0].name,
  expense: SPENDING_CATEGORIES[0],
}

function fromRow(row) {
  return {
    id: row.id,
    date: row.tx_date,
    type: row.type,
    category: row.category,
    description: row.description,
    amount: Number(row.amount),
  }
}

function toRow(item) {
  return {
    tx_date: item.date,
    type: item.type,
    category: item.category,
    description: item.description,
    amount: item.amount,
  }
}

function sumBy(items, key) {
  const totals = new Map()
  for (const item of items) {
    totals.set(item[key], (totals.get(item[key]) ?? 0) + item.amount)
  }
  return totals
}

function emptyForm(type = 'expense') {
  return {
    date: today(),
    type,
    category: KIND_DEFAULT_CATEGORY[type],
    description: '',
    amount: '',
  }
}

function useTooltip() {
  const [tip, setTip] = useState(null)
  function bind(text) {
    return {
      tabIndex: 0,
      'aria-label': text,
      onMouseMove: (e) => {
        const box = e.currentTarget.closest('.chart').getBoundingClientRect()
        setTip({ text, x: e.clientX - box.left, y: e.clientY - box.top })
      },
      onFocus: (e) => {
        const box = e.currentTarget.closest('.chart').getBoundingClientRect()
        const mark = e.currentTarget.getBoundingClientRect()
        setTip({ text, x: mark.left - box.left + mark.width / 2, y: mark.top - box.top })
      },
      onMouseLeave: () => setTip(null),
      onBlur: () => setTip(null),
    }
  }
  const element = tip && (
    <div className="chart-tooltip" style={{ left: tip.x, top: tip.y }} role="status">
      {tip.text}
    </div>
  )
  return [bind, element]
}

function FundingChart({ totals, total }) {
  const [bind, tooltip] = useTooltip()
  const sources = FUNDING_SOURCES.filter((s) => totals.get(s.name) > 0)

  return (
    <div className="card chart">
      <h2>How the project is financed</h2>
      {total === 0 ? (
        <p className="muted chart-empty">Add funding (own funds, loans, subsidies) to see the mix.</p>
      ) : (
        <>
          <div className="stack-bar">
            {sources.map((s) => {
              const value = totals.get(s.name)
              return (
                <div
                  key={s.name}
                  className="stack-segment"
                  style={{ flexGrow: value, background: s.color }}
                  {...bind(`${s.name}: ${euros.format(value)} (${percent.format(value / total)})`)}
                />
              )
            })}
          </div>
          <ul className="legend">
            {sources.map((s) => {
              const value = totals.get(s.name)
              return (
                <li key={s.name}>
                  <span className="swatch" style={{ background: s.color }} />
                  <span className="legend-name">{s.name}</span>
                  <span className="legend-value">{euros.format(value)}</span>
                  <span className="legend-share muted">{percent.format(value / total)}</span>
                </li>
              )
            })}
          </ul>
        </>
      )}
      {tooltip}
    </div>
  )
}

function SpendingChart({ totals, total }) {
  const [bind, tooltip] = useTooltip()
  const rows = [...totals.entries()].sort((a, b) => b[1] - a[1])
  const max = rows[0]?.[1] ?? 0

  return (
    <div className="card chart">
      <h2>Where the money is spent</h2>
      {total === 0 ? (
        <p className="muted chart-empty">Add expenses to see spending by category.</p>
      ) : (
        <ul className="bar-list">
          {rows.map(([category, value]) => (
            <li key={category}>
              <span className="bar-label" title={category}>
                {category}
              </span>
              <span className="bar-track">
                <span
                  className="bar-fill"
                  style={{ width: `${(value / max) * 100}%` }}
                  {...bind(`${category}: ${euros.format(value)} (${percent.format(value / total)} of spending)`)}
                />
              </span>
              <span className="bar-value">{euros.format(value)}</span>
            </li>
          ))}
        </ul>
      )}
      {tooltip}
    </div>
  )
}

function Finances() {
  const { rows: items, status, error: loadError, insert, update, remove } = useCollection(
    'transactions',
    { fromRow, toRow },
  )
  const [form, setForm] = useState(() => emptyForm())
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const [editingId, setEditingId] = useState(null)
  const formRef = useRef(null)

  const funding = items.filter((i) => i.type === 'funding')
  const expenses = items.filter((i) => i.type === 'expense')
  const totalFunding = funding.reduce((s, i) => s + i.amount, 0)
  const totalSpent = expenses.reduce((s, i) => s + i.amount, 0)
  const remaining = totalFunding - totalSpent
  const usedShare = totalFunding > 0 ? totalSpent / totalFunding : 0
  const sorted = [...items].sort((a, b) => b.date.localeCompare(a.date))
  const baseCategories =
    form.type === 'funding' ? FUNDING_SOURCES.map((s) => s.name) : SPENDING_CATEGORIES
  // Keep an entry's category selectable even if it is no longer in the list.
  const categories = baseCategories.includes(form.category)
    ? baseCategories
    : [...baseCategories, form.category]

  function setField(field) {
    return (e) => setForm({ ...form, [field]: e.target.value })
  }

  function setType(type) {
    setForm({ ...form, type, category: KIND_DEFAULT_CATEGORY[type] })
  }

  async function handleSubmit(e) {
    e.preventDefault()
    const amount = Math.round(Number(form.amount) * 100) / 100
    if (!form.date || !form.description.trim() || !(amount > 0)) {
      setError('Please enter a date, a description and an amount greater than 0.')
      return
    }
    setSaving(true)
    setError('')
    const item = {
      date: form.date,
      type: form.type,
      category: form.category,
      description: form.description.trim(),
      amount,
    }
    try {
      if (editingId) {
        await update(editingId, item)
        resetForm()
      } else {
        await insert(item)
        setForm({ ...emptyForm(form.type), category: form.category })
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
    formRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  async function handleDelete(id) {
    if (!window.confirm('Delete this transaction?')) return
    try {
      await remove(id)
      if (editingId === id) resetForm()
    } catch (err) {
      window.alert(err.message)
    }
  }

  return (
    <section className="tab-content">
      <div className="stats">
        <div className="card stat">
          <span className="muted">Funding secured</span>
          <strong>{euros.format(totalFunding)}</strong>
        </div>
        <div className="card stat">
          <span className="muted">Spent so far</span>
          <strong>{euros.format(totalSpent)}</strong>
        </div>
        <div className="card stat">
          <span className="muted">Remaining</span>
          <strong className={remaining < 0 ? 'negative' : undefined}>
            {euros.format(remaining)}
          </strong>
        </div>
      </div>

      {totalFunding > 0 && (
        <div className="card meter-card">
          <div className="meter-head">
            <span>Budget used</span>
            <strong>{percent.format(usedShare)}</strong>
          </div>
          <div
            className="meter"
            role="meter"
            aria-label="Share of funding spent"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round(usedShare * 100)}
          >
            <span
              className={usedShare > 1 ? 'meter-fill over' : 'meter-fill'}
              style={{ width: `${Math.min(usedShare, 1) * 100}%` }}
            />
          </div>
          {usedShare > 1 && (
            <p className="negative meter-note">
              ⚠ Spending exceeds secured funding by {euros.format(-remaining)}.
            </p>
          )}
        </div>
      )}

      <div className="chart-grid">
        <FundingChart totals={sumBy(funding, 'category')} total={totalFunding} />
        <SpendingChart totals={sumBy(expenses, 'category')} total={totalSpent} />
      </div>

      <form ref={formRef} className="card form-grid" onSubmit={handleSubmit} noValidate>
        <h2>{editingId ? 'Edit transaction' : 'New transaction'}</h2>
        <div className="segmented full" role="group" aria-label="Transaction type">
          <button
            type="button"
            className={form.type === 'expense' ? 'active' : undefined}
            aria-pressed={form.type === 'expense'}
            onClick={() => setType('expense')}
          >
            Expense
          </button>
          <button
            type="button"
            className={form.type === 'funding' ? 'active' : undefined}
            aria-pressed={form.type === 'funding'}
            onClick={() => setType('funding')}
          >
            Funding
          </button>
        </div>
        <label>
          Date
          <input type="date" value={form.date} onChange={setField('date')} />
        </label>
        <label>
          {form.type === 'funding' ? 'Source' : 'Category'}
          <select value={form.category} onChange={setField('category')}>
            {categories.map((c) => (
              <option key={c}>{c}</option>
            ))}
          </select>
        </label>
        <label>
          Amount (€)
          <input
            type="number"
            min="0"
            step="0.01"
            value={form.amount}
            onChange={setField('amount')}
          />
        </label>
        <label className="full">
          Description
          <input
            type="text"
            placeholder={form.type === 'funding' ? 'e.g. Loan tranche 1' : 'e.g. Concrete for foundation'}
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
              ? 'Saving…'
              : editingId
                ? 'Save changes'
                : form.type === 'funding'
                  ? 'Add funding'
                  : 'Add expense'}
          </button>
          {editingId && (
            <button type="button" className="secondary" onClick={resetForm} disabled={saving}>
              Cancel
            </button>
          )}
        </div>
      </form>

      {status === 'loading' && <p className="empty">Loading finances…</p>}
      {status === 'error' && (
        <p className="error" role="alert">
          {loadError}
        </p>
      )}
      {status === 'ready' && sorted.length === 0 ? (
        <p className="empty">No transactions yet.</p>
      ) : sorted.length === 0 ? null : (
        <div className="card table-wrap">
          <table>
            <thead>
              <tr>
                <th>Date</th>
                <th>Description</th>
                <th>Source / category</th>
                <th className="num">Amount</th>
                <th aria-label="Actions"></th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((item) => (
                <tr key={item.id} className={item.id === editingId ? 'editing' : undefined}>
                  <td className="date">{formatDate(item.date)}</td>
                  <td>{item.description}</td>
                  <td>{item.category}</td>
                  <td className="num">
                    {item.type === 'funding' ? '+' : '−'}
                    {currency.format(item.amount)}
                  </td>
                  <td className="num row-actions">
                    <button type="button" className="link" onClick={() => startEdit(item)}>
                      Edit
                    </button>
                    <button type="button" className="link danger" onClick={() => handleDelete(item.id)}>
                      Delete
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}

export default Finances
