import { useState } from 'react'
import { formatDate, newId, today, usePersistentState } from '../storage.js'

const WEATHER_OPTIONS = ['Sunny', 'Cloudy', 'Rain', 'Snow', 'Wind', 'Frost']

function emptyForm() {
  return { date: today(), weather: 'Sunny', workers: '', work: '', notes: '' }
}

function Diary({ storageKey }) {
  const [entries, setEntries] = usePersistentState(storageKey, [])
  const [form, setForm] = useState(emptyForm)
  const [editingId, setEditingId] = useState(null)
  const [error, setError] = useState('')

  const sorted = [...entries].sort((a, b) => b.date.localeCompare(a.date))

  function update(field) {
    return (e) => setForm({ ...form, [field]: e.target.value })
  }

  function handleSubmit(e) {
    e.preventDefault()
    if (!form.date || !form.work.trim()) {
      setError('Please enter a date and the work carried out.')
      return
    }
    const entry = {
      ...form,
      work: form.work.trim(),
      notes: form.notes.trim(),
      workers: form.workers === '' ? '' : Number(form.workers),
    }
    if (editingId) {
      setEntries(entries.map((x) => (x.id === editingId ? { ...entry, id: editingId } : x)))
    } else {
      setEntries([...entries, { ...entry, id: newId() }])
    }
    resetForm()
  }

  function resetForm() {
    setForm(emptyForm())
    setEditingId(null)
    setError('')
  }

  function startEdit(entry) {
    setForm({ ...entry, workers: String(entry.workers ?? '') })
    setEditingId(entry.id)
    setError('')
  }

  function remove(id) {
    if (!window.confirm('Delete this diary entry?')) return
    setEntries(entries.filter((x) => x.id !== id))
    if (editingId === id) resetForm()
  }

  return (
    <section className="tab-content">
      <form className="card form-grid" onSubmit={handleSubmit} noValidate>
        <h2>{editingId ? 'Edit entry' : 'New diary entry'}</h2>

        <label>
          Date
          <input type="date" value={form.date} onChange={update('date')} />
        </label>
        <label>
          Weather
          <select value={form.weather} onChange={update('weather')}>
            {WEATHER_OPTIONS.map((w) => (
              <option key={w}>{w}</option>
            ))}
          </select>
        </label>
        <label>
          Workers on site
          <input
            type="number"
            min="0"
            value={form.workers}
            onChange={update('workers')}
          />
        </label>
        <label className="full">
          Work carried out
          <textarea rows="3" value={form.work} onChange={update('work')} />
        </label>
        <label className="full">
          Notes / incidents
          <textarea rows="2" value={form.notes} onChange={update('notes')} />
        </label>

        {error && (
          <p className="error full" role="alert">
            {error}
          </p>
        )}

        <div className="form-actions full">
          <button type="submit">{editingId ? 'Save changes' : 'Add entry'}</button>
          {editingId && (
            <button type="button" className="secondary" onClick={resetForm}>
              Cancel
            </button>
          )}
        </div>
      </form>

      {sorted.length === 0 ? (
        <p className="empty">No diary entries yet.</p>
      ) : (
        <ul className="entry-list">
          {sorted.map((entry) => (
            <li key={entry.id} className="card entry">
              <div className="entry-head">
                <strong>{formatDate(entry.date)}</strong>
                <span className="muted">
                  {entry.weather}
                  {entry.workers !== '' && ` · ${entry.workers} workers`}
                </span>
              </div>
              <p className="entry-text">{entry.work}</p>
              {entry.notes && <p className="entry-text muted">{entry.notes}</p>}
              <div className="entry-actions">
                <button type="button" className="link" onClick={() => startEdit(entry)}>
                  Edit
                </button>
                <button type="button" className="link danger" onClick={() => remove(entry.id)}>
                  Delete
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

export default Diary
