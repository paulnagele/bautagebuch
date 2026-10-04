import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { formatDate, today } from '../storage.js'
import { useCollection } from '../useCollection.js'
import { useDialogs } from '../dialogs.js'

// Gantt chart for the Zeitplan tab: one row per expense category from
// Finanzen, each with any number of time slots (schedule_slots table),
// plus milestones as markers and a line for today. The time axis scrolls
// sideways on its own, so swiping between tabs leaves it alone.

// px per day: a month is about 150px wide, on phones about 90px.
const DAY_WIDTH_WIDE = 5
const DAY_WIDTH_NARROW = 3
const NARROW = '(max-width: 640px)'
const LANE_HEIGHT = 30 // px per stacked bar
const COLORS = Array.from({ length: 8 }, (_, i) => `var(--series-${i + 1})`)

function slotFromRow(row) {
  return {
    id: row.id,
    categoryId: row.category_id,
    name: row.name,
    start: row.start_date,
    end: row.end_date,
  }
}

function slotToRow(slot) {
  return {
    category_id: slot.categoryId,
    name: slot.name,
    start_date: slot.start,
    end_date: slot.end,
  }
}

function categoryFromRow(row) {
  return { id: row.id, type: row.type, name: row.name, sortOrder: row.sort_order }
}

function categoryToRow(category) {
  return { type: category.type, name: category.name, sort_order: category.sortOrder }
}

// Whole days since 1970-01-01 for an ISO date, ignoring time zones.
function dayNumber(isoDate) {
  const [y, m, d] = isoDate.split('-').map(Number)
  return Date.UTC(y, m - 1, d) / 86400000
}

function isoFromDay(day) {
  return new Date(day * 86400000).toISOString().slice(0, 10)
}

function monthStart(day) {
  const d = new Date(day * 86400000)
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1) / 86400000
}

function nextMonth(day) {
  const d = new Date(day * 86400000)
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1) / 86400000
}

function monthLabel(day) {
  return new Date(day * 86400000).toLocaleDateString('de-DE', {
    month: 'short',
    year: '2-digit',
    timeZone: 'UTC',
  })
}

// Puts overlapping slots of one category on separate lanes.
function assignLanes(slots) {
  const laneEnds = []
  const placed = [...slots]
    .sort((a, b) => a.start.localeCompare(b.start) || a.end.localeCompare(b.end))
    .map((slot) => {
      let lane = laneEnds.findIndex((end) => end < slot.start)
      if (lane === -1) lane = laneEnds.length
      laneEnds[lane] = slot.end
      return { ...slot, lane }
    })
  return { placed, lanes: Math.max(1, laneEnds.length) }
}

// Whole months around all slots, milestones and today, with at least
// four months shown.
function timeRange(slots, milestones, todayDay) {
  const days = [todayDay]
  for (const slot of slots) days.push(dayNumber(slot.start), dayNumber(slot.end))
  for (const milestone of milestones) days.push(dayNumber(milestone.date))
  const first = monthStart(Math.min(...days))
  const last = Math.max(...days)
  const months = []
  let end = first
  while (end <= last || months.length < 4) {
    months.push(end)
    end = nextMonth(end)
  }
  return { first, end, months }
}

function useDayWidth() {
  const [narrow, setNarrow] = useState(() => window.matchMedia(NARROW).matches)
  useEffect(() => {
    const query = window.matchMedia(NARROW)
    const onChange = () => setNarrow(query.matches)
    query.addEventListener('change', onChange)
    return () => query.removeEventListener('change', onChange)
  }, [])
  return narrow ? DAY_WIDTH_NARROW : DAY_WIDTH_WIDE
}

function emptyForm(categoryId = '') {
  const start = today()
  return { categoryId, name: '', start, end: start }
}

function GanttChart({ milestones }) {
  const slotStore = useCollection('schedule_slots', { fromRow: slotFromRow, toRow: slotToRow })
  const categoryStore = useCollection('finance_categories', {
    fromRow: categoryFromRow,
    toRow: categoryToRow,
  })
  const [form, setForm] = useState(emptyForm)
  const [editingId, setEditingId] = useState(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const formRef = useRef(null)
  const nameRef = useRef(null)
  const scrollRef = useRef(null)
  const scrolledRef = useRef(false)
  const dialogs = useDialogs()
  const dayWidth = useDayWidth()

  const categories = categoryStore.rows
    .filter((c) => c.type === 'expense')
    .sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name, 'de'))
  const slots = slotStore.rows
  const todayDay = dayNumber(today())
  const { first, end, months } = timeRange(slots, milestones, todayDay)
  const width = (end - first) * dayWidth
  const x = (isoDate) => (dayNumber(isoDate) - first) * dayWidth
  const todayX = (todayDay - first) * dayWidth

  const ready = slotStore.status === 'ready' && categoryStore.status === 'ready'

  // Start with today in view, a little in from the left edge.
  useLayoutEffect(() => {
    if (!ready || scrolledRef.current || !scrollRef.current) return
    scrolledRef.current = true
    scrollRef.current.scrollLeft = Math.max(0, todayX - 3 * 7 * dayWidth)
  }, [ready, todayX, dayWidth])

  // A category picked in the chart that has since been deleted.
  useEffect(() => {
    if (form.categoryId && categoryStore.status === 'ready' && !categories.some((c) => c.id === form.categoryId)) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setForm((current) => ({ ...current, categoryId: '' }))
    }
  }, [form.categoryId, categoryStore.status, categories])

  function setField(field) {
    return (e) => {
      const value = e.target.value
      setForm((current) => {
        const next = { ...current, [field]: value }
        // Moving the start past the end moves the end along.
        if (field === 'start' && value && next.end < value) next.end = value
        return next
      })
    }
  }

  function resetForm() {
    setForm(emptyForm())
    setEditingId(null)
    setError('')
  }

  function focusForm() {
    formRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
    nameRef.current?.focus({ preventScroll: true })
  }

  function startAdd(category) {
    setForm(emptyForm(category.id))
    setEditingId(null)
    setError('')
    focusForm()
  }

  function startEdit(slot) {
    setForm({ categoryId: slot.categoryId, name: slot.name, start: slot.start, end: slot.end })
    setEditingId(slot.id)
    setError('')
    focusForm()
  }

  async function handleSubmit(e) {
    e.preventDefault()
    const name = form.name.trim()
    if (!form.categoryId || !name || !form.start || !form.end) {
      setError('Bitte Kategorie, Aufgabe, Beginn und Ende angeben.')
      return
    }
    if (form.end < form.start) {
      setError('Das Ende liegt vor dem Beginn.')
      return
    }
    setBusy(true)
    setError('')
    const slot = { categoryId: form.categoryId, name, start: form.start, end: form.end }
    try {
      if (editingId) await slotStore.update(editingId, slot)
      else await slotStore.insert(slot)
      resetForm()
    } catch (err) {
      setError(err.message)
    }
    setBusy(false)
  }

  async function handleDelete() {
    const slot = slots.find((s) => s.id === editingId)
    if (!slot) return
    const question = `Den Zeitraum „${slot.name}“ löschen?`
    if (!(await dialogs.confirm(question, { confirmLabel: 'Löschen', danger: true }))) return
    try {
      await slotStore.remove(slot.id)
      resetForm()
    } catch (err) {
      await dialogs.alert(err.message)
    }
  }

  const loadError = slotStore.error || categoryStore.error

  return (
    <div className="card gantt">
      <h2>Bauablauf</h2>
      {!ready && !loadError && <p className="muted">Bauablauf wird geladen…</p>}
      {loadError && (
        <p className="error" role="alert">
          {loadError}
        </p>
      )}
      {ready && categories.length === 0 && (
        <p className="muted">Lege zuerst unter Finanzen Kategorien an.</p>
      )}
      {ready && categories.length > 0 && (
        <div className="gantt-scroll" ref={scrollRef}>
          <div className="gantt-grid" style={{ '--timeline-width': `${width}px` }}>
            <div className="gantt-corner" />
            <div className="gantt-header">
              {months.map((day) => (
                <div
                  key={day}
                  className="gantt-month"
                  style={{ left: (day - first) * dayWidth, width: (nextMonth(day) - day) * dayWidth }}
                >
                  {monthLabel(day)}
                </div>
              ))}
              {milestones.map((milestone) => (
                <div
                  key={milestone.id}
                  className={`gantt-milestone-flag${milestone.reached ? ' reached' : ''}`}
                  style={{ left: x(milestone.date) + dayWidth / 2 }}
                  title={`${milestone.name} · ${formatDate(milestone.date)}`}
                >
                  <span className="gantt-diamond" aria-hidden="true" />
                  <span className="gantt-milestone-name">{milestone.name}</span>
                </div>
              ))}
            </div>

            {categories.map((category, index) => {
              const { placed, lanes } = assignLanes(slots.filter((s) => s.categoryId === category.id))
              const color = COLORS[index % COLORS.length]
              return (
                <div className="gantt-row" key={category.id} style={{ '--bar-color': color }}>
                  <div className="gantt-label">
                    <span className="gantt-label-name">{category.name}</span>
                    <button
                      type="button"
                      className="gantt-add"
                      onClick={() => startAdd(category)}
                      aria-label={`Zeitraum für ${category.name} hinzufügen`}
                      title="Zeitraum hinzufügen"
                    >
                      +
                    </button>
                  </div>
                  <div className="gantt-track" style={{ minHeight: lanes * LANE_HEIGHT + 8 }}>
                    {months.map((day) => (
                      <div key={day} className="gantt-gridline" style={{ left: (day - first) * dayWidth }} />
                    ))}
                    {milestones.map((milestone) => (
                      <div
                        key={milestone.id}
                        className="gantt-milestone-line"
                        style={{ left: x(milestone.date) + dayWidth / 2 }}
                      />
                    ))}
                    {placed.map((slot) => (
                      <button
                        type="button"
                        key={slot.id}
                        className={`gantt-bar${slot.id === editingId ? ' editing' : ''}`}
                        style={{
                          left: x(slot.start),
                          width: Math.max(dayWidth, x(isoFromDay(dayNumber(slot.end) + 1)) - x(slot.start)),
                          top: slot.lane * LANE_HEIGHT + 4,
                        }}
                        onClick={() => startEdit(slot)}
                        title={`${slot.name} · ${formatDate(slot.start)} – ${formatDate(slot.end)}`}
                      >
                        {slot.name}
                      </button>
                    ))}
                    {todayX >= 0 && todayX < width && (
                      <div className="gantt-today" style={{ left: todayX + dayWidth / 2 }} />
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}
      {ready && categories.length > 0 && (
        <div className="gantt-legend muted">
          <span>
            <span className="gantt-legend-today" aria-hidden="true" /> Heute
          </span>
          {milestones.length > 0 && (
            <span>
              <span className="gantt-diamond" aria-hidden="true" /> Meilenstein
            </span>
          )}
          <span>Tippe auf „+“ für einen neuen Zeitraum oder auf einen Balken zum Bearbeiten.</span>
        </div>
      )}

      {ready && categories.length > 0 && (
        <form ref={formRef} className="form-grid gantt-form" onSubmit={handleSubmit} noValidate>
          <label>
            Kategorie
            <select value={form.categoryId} onChange={setField('categoryId')}>
              <option value="">Bitte wählen</option>
              {categories.map((category) => (
                <option key={category.id} value={category.id}>
                  {category.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            {editingId ? 'Aufgabe bearbeiten' : 'Aufgabe'}
            <input
              ref={nameRef}
              type="text"
              placeholder="z. B. Dachstuhl aufstellen"
              value={form.name}
              onChange={setField('name')}
              autoComplete="off"
            />
          </label>
          <label>
            Beginn
            <input type="date" value={form.start} onChange={setField('start')} />
          </label>
          <label>
            Ende
            <input type="date" value={form.end} min={form.start} onChange={setField('end')} />
          </label>
          {error && (
            <p className="error full" role="alert">
              {error}
            </p>
          )}
          <div className="form-actions full">
            <button type="submit" disabled={busy}>
              {busy ? 'Wird gespeichert…' : editingId ? 'Änderungen speichern' : 'Zeitraum hinzufügen'}
            </button>
            {editingId && (
              <>
                <button type="button" className="secondary" onClick={resetForm} disabled={busy}>
                  Abbrechen
                </button>
                <button type="button" className="link danger" onClick={handleDelete} disabled={busy}>
                  Löschen
                </button>
              </>
            )}
          </div>
        </form>
      )}
    </div>
  )
}

export default GanttChart
