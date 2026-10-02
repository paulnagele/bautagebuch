import { useRef, useState } from 'react'
import { formatDate, today } from '../storage.js'
import { friendlyError, useCollection } from '../useCollection.js'
import { supabase } from '../supabase.js'
import CategoryManager from '../components/CategoryManager.jsx'
import MoneyFlow from '../components/MoneyFlow.jsx'

// Used only until the finance_categories table exists (schema.sql not yet
// re-run); the same lists are what schema.sql starts the table with.
const DEFAULT_FUNDING_SOURCES = [
  'Own funds',
  'Bank loan',
  'Housing subsidy',
  'Family / private loan',
  'Other funding',
]

const DEFAULT_EXPENSE_CATEGORIES = [
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

// Validated categorical palette (see index.css), used for funding sources in
// the money-flow diagram. A source keeps the colour of its position in the
// category list; beyond eight sources the rest are grouped as "More sources"
// instead of inventing more colours.
const SERIES_COLORS = Array.from({ length: 8 }, (_, i) => `var(--series-${i + 1})`)
const OTHER_COLOR = 'var(--muted)'

function categoryFromRow(row) {
  return { id: row.id, type: row.type, name: row.name, sortOrder: row.sort_order }
}

function categoryToRow(category) {
  return { type: category.type, name: category.name, sort_order: category.sortOrder }
}

function byOrder(a, b) {
  return a.sortOrder - b.sortOrder || a.name.localeCompare(b.name)
}

function defaultCategories(type, names) {
  return names.map((name, i) => ({ id: `default-${type}-${i}`, type, name, sortOrder: i }))
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
  // An empty category means "the first category of this type".
  return { date: today(), type, category: '', description: '', amount: '' }
}

// Funding sources in list order (plus any no longer in the list), coloured
// by position so colours stay put when amounts change.
function flowSources(sourceNames, totals, unfunded) {
  const ordered = [...sourceNames, ...[...totals.keys()].filter((n) => !sourceNames.includes(n))]
  const nodes = []
  let other = 0
  ordered.forEach((name, i) => {
    const value = totals.get(name) ?? 0
    if (value <= 0) return
    if (i < SERIES_COLORS.length) nodes.push({ name, value, color: SERIES_COLORS[i] })
    else other += value
  })
  if (other > 0) nodes.push({ name: 'More sources', value: other, color: OTHER_COLOR })
  if (unfunded > 0) nodes.push({ name: 'Not yet funded', value: unfunded, kind: 'unfunded' })
  return nodes
}

// Expense categories, largest first, then what is left over.
function flowTargets(totals, unspent) {
  const nodes = [...totals.entries()]
    .filter(([, value]) => value > 0)
    .sort((a, b) => b[1] - a[1])
    .map(([name, value]) => ({ name, value }))
  if (unspent > 0) nodes.push({ name: 'Not yet spent', value: unspent, kind: 'unspent' })
  return nodes
}

function Finances() {
  const {
    rows: items,
    status,
    error: loadError,
    insert,
    update,
    remove,
    reload: reloadItems,
  } = useCollection('transactions', { fromRow, toRow })
  const categoryStore = useCollection('finance_categories', {
    fromRow: categoryFromRow,
    toRow: categoryToRow,
  })
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
  // Until the categories table exists, fall back to the built-in lists.
  const categoriesMissing = categoryStore.status === 'error'
  const categoryRows = categoriesMissing
    ? [
        ...defaultCategories('expense', DEFAULT_EXPENSE_CATEGORIES),
        ...defaultCategories('funding', DEFAULT_FUNDING_SOURCES),
      ]
    : categoryStore.rows
  const expenseCategories = categoryRows.filter((c) => c.type === 'expense').sort(byOrder)
  const fundingCategories = categoryRows.filter((c) => c.type === 'funding').sort(byOrder)
  const baseCategories = (form.type === 'funding' ? fundingCategories : expenseCategories).map(
    (c) => c.name,
  )
  const formCategory = form.category || baseCategories[0] || ''
  // Keep an entry's category selectable even if it is no longer in the list.
  const categories =
    !formCategory || baseCategories.includes(formCategory)
      ? baseCategories
      : [...baseCategories, formCategory]

  const usage = { expense: new Map(), funding: new Map() }
  for (const item of items) {
    const counts = usage[item.type]
    counts?.set(item.category, (counts.get(item.category) ?? 0) + 1)
  }

  async function addCategory(type, name) {
    const siblings = type === 'funding' ? fundingCategories : expenseCategories
    const sortOrder = Math.max(0, ...siblings.map((c) => c.sortOrder)) + 1
    await categoryStore.insert({ type, name, sortOrder })
  }

  async function renameCategory(id, name) {
    const { error: renameError } = await supabase.rpc('rename_finance_category', {
      category_id: id,
      new_name: name,
    })
    if (renameError) throw new Error(friendlyError(renameError))
    await Promise.all([categoryStore.reload(), reloadItems()])
  }

  async function deleteCategory(id) {
    await categoryStore.remove(id)
  }

  function setField(field) {
    return (e) => setForm({ ...form, [field]: e.target.value })
  }

  function setType(type) {
    setForm({ ...form, type, category: '' })
  }

  async function handleSubmit(e) {
    e.preventDefault()
    const amount = Math.round(Number(form.amount) * 100) / 100
    if (!form.date || !form.description.trim() || !(amount > 0)) {
      setError('Please enter a date, a description and an amount greater than 0.')
      return
    }
    if (!formCategory) {
      setError('Please add a category first (Manage categories).')
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

      <MoneyFlow
        sources={flowSources(
          fundingCategories.map((c) => c.name),
          sumBy(funding, 'category'),
          Math.max(0, totalSpent - totalFunding),
        )}
        targets={flowTargets(sumBy(expenses, 'category'), Math.max(0, totalFunding - totalSpent))}
        total={Math.max(totalFunding, totalSpent)}
        format={(value) => euros.format(value)}
        formatShare={(share) => percent.format(share)}
      />

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
          <select value={formCategory} onChange={setField('category')}>
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

      <CategoryManager
        expense={expenseCategories}
        funding={fundingCategories}
        usage={usage}
        readOnly={categoriesMissing}
        notice={categoriesMissing ? categoryStore.error : ''}
        onAdd={addCategory}
        onRename={renameCategory}
        onDelete={deleteCategory}
      />

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
