import { useState } from 'react'
import { formatDate, newId, today, usePersistentState } from '../storage.js'

const STATUSES = [
  { id: 'planned', label: 'Planned' },
  { id: 'in-progress', label: 'In progress' },
  { id: 'done', label: 'Done' },
]

function emptyForm() {
  return { task: '', trade: '', start: today(), end: today() }
}

function Timetable({ storageKey }) {
  const [tasks, setTasks] = usePersistentState(storageKey, [])
  const [form, setForm] = useState(emptyForm)
  const [error, setError] = useState('')

  const sorted = [...tasks].sort((a, b) => a.start.localeCompare(b.start))
  const now = today()

  function update(field) {
    return (e) => setForm({ ...form, [field]: e.target.value })
  }

  function handleSubmit(e) {
    e.preventDefault()
    if (!form.task.trim() || !form.start || !form.end) {
      setError('Please enter a task, a start date and an end date.')
      return
    }
    if (form.end < form.start) {
      setError('The end date cannot be before the start date.')
      return
    }
    setTasks([
      ...tasks,
      { ...form, task: form.task.trim(), trade: form.trade.trim(), status: 'planned', id: newId() },
    ])
    setForm(emptyForm())
    setError('')
  }

  function setStatus(id, status) {
    setTasks(tasks.map((t) => (t.id === id ? { ...t, status } : t)))
  }

  function remove(id) {
    if (!window.confirm('Delete this task?')) return
    setTasks(tasks.filter((t) => t.id !== id))
  }

  return (
    <section className="tab-content">
      <form className="card form-grid" onSubmit={handleSubmit} noValidate>
        <h2>New task</h2>
        <label className="full">
          Task
          <input type="text" value={form.task} onChange={update('task')} />
        </label>
        <label>
          Trade / company
          <input type="text" value={form.trade} onChange={update('trade')} />
        </label>
        <label>
          Start
          <input type="date" value={form.start} onChange={update('start')} />
        </label>
        <label>
          End
          <input type="date" value={form.end} onChange={update('end')} />
        </label>

        {error && (
          <p className="error full" role="alert">
            {error}
          </p>
        )}

        <div className="form-actions full">
          <button type="submit">Add task</button>
        </div>
      </form>

      {sorted.length === 0 ? (
        <p className="empty">No tasks scheduled yet.</p>
      ) : (
        <div className="card table-wrap">
          <table>
            <thead>
              <tr>
                <th>Task</th>
                <th>Trade</th>
                <th>Start</th>
                <th>End</th>
                <th>Status</th>
                <th aria-label="Actions"></th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((t) => {
                const overdue = t.status !== 'done' && t.end < now
                return (
                  <tr key={t.id} className={t.status === 'done' ? 'done' : undefined}>
                    <td>
                      {t.task}
                      {overdue && <span className="badge negative">Overdue</span>}
                    </td>
                    <td>{t.trade}</td>
                    <td className="date">{formatDate(t.start)}</td>
                    <td className="date">{formatDate(t.end)}</td>
                    <td>
                      <select
                        aria-label={`Status of ${t.task}`}
                        value={t.status}
                        onChange={(e) => setStatus(t.id, e.target.value)}
                      >
                        {STATUSES.map((s) => (
                          <option key={s.id} value={s.id}>
                            {s.label}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className="num">
                      <button type="button" className="link danger" onClick={() => remove(t.id)}>
                        Delete
                      </button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}

export default Timetable
