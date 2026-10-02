import { useState } from 'react'
import { formatDate, newId, today, usePersistentState } from '../storage.js'

const CATEGORIES = ['Materials', 'Labour', 'Equipment', 'Permits & fees', 'Other']

const currency = new Intl.NumberFormat(undefined, { style: 'currency', currency: 'EUR' })

function emptyForm() {
  return {
    date: today(),
    type: 'expense',
    category: CATEGORIES[0],
    description: '',
    amount: '',
  }
}

function Finances({ storageKey }) {
  const [items, setItems] = usePersistentState(storageKey, [])
  const [form, setForm] = useState(emptyForm)
  const [error, setError] = useState('')

  const sorted = [...items].sort((a, b) => b.date.localeCompare(a.date))
  const income = items.filter((i) => i.type === 'income').reduce((s, i) => s + i.amount, 0)
  const expenses = items.filter((i) => i.type === 'expense').reduce((s, i) => s + i.amount, 0)

  function update(field) {
    return (e) => setForm({ ...form, [field]: e.target.value })
  }

  function handleSubmit(e) {
    e.preventDefault()
    const amount = Number(form.amount)
    if (!form.date || !form.description.trim() || !(amount > 0)) {
      setError('Please enter a date, a description and an amount greater than 0.')
      return
    }
    setItems([
      ...items,
      { ...form, description: form.description.trim(), amount, id: newId() },
    ])
    setForm({ ...emptyForm(), type: form.type, category: form.category })
    setError('')
  }

  function remove(id) {
    if (!window.confirm('Delete this transaction?')) return
    setItems(items.filter((i) => i.id !== id))
  }

  return (
    <section className="tab-content">
      <div className="stats">
        <div className="card stat">
          <span className="muted">Income</span>
          <strong className="positive">{currency.format(income)}</strong>
        </div>
        <div className="card stat">
          <span className="muted">Expenses</span>
          <strong className="negative">{currency.format(expenses)}</strong>
        </div>
        <div className="card stat">
          <span className="muted">Balance</span>
          <strong className={income - expenses < 0 ? 'negative' : 'positive'}>
            {currency.format(income - expenses)}
          </strong>
        </div>
      </div>

      <form className="card form-grid" onSubmit={handleSubmit} noValidate>
        <h2>New transaction</h2>
        <label>
          Date
          <input type="date" value={form.date} onChange={update('date')} />
        </label>
        <label>
          Type
          <select value={form.type} onChange={update('type')}>
            <option value="expense">Expense</option>
            <option value="income">Income / budget</option>
          </select>
        </label>
        <label>
          Category
          <select value={form.category} onChange={update('category')}>
            {CATEGORIES.map((c) => (
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
            onChange={update('amount')}
          />
        </label>
        <label className="full">
          Description
          <input type="text" value={form.description} onChange={update('description')} />
        </label>

        {error && (
          <p className="error full" role="alert">
            {error}
          </p>
        )}

        <div className="form-actions full">
          <button type="submit">Add transaction</button>
        </div>
      </form>

      {sorted.length === 0 ? (
        <p className="empty">No transactions yet.</p>
      ) : (
        <div className="card table-wrap">
          <table>
            <thead>
              <tr>
                <th>Date</th>
                <th>Description</th>
                <th>Category</th>
                <th className="num">Amount</th>
                <th aria-label="Actions"></th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((item) => (
                <tr key={item.id}>
                  <td className="date">{formatDate(item.date)}</td>
                  <td>{item.description}</td>
                  <td>{item.type === 'income' ? 'Income' : item.category}</td>
                  <td className={`num ${item.type === 'income' ? 'positive' : 'negative'}`}>
                    {item.type === 'income' ? '+' : '−'}
                    {currency.format(item.amount)}
                  </td>
                  <td className="num">
                    <button type="button" className="link danger" onClick={() => remove(item.id)}>
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
