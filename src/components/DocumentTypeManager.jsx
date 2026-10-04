import { useState } from 'react'
import { useDialogs } from '../dialogs.js'

// What lands in a type by itself, without being sorted.
const HOLDS = { receipts: 'Belege von Ausgaben', quotes: 'Angebote aus den Finanzen' }

// Add, rename and delete document types. `counts` maps a type ID to its
// number of documents.
function DocumentTypeManager({ types, counts, onAdd, onRename, onDelete }) {
  const [newName, setNewName] = useState('')
  const [editing, setEditing] = useState(null) // { id, name }
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)
  const dialogs = useDialogs()

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

  async function handleAdd(e) {
    e.preventDefault()
    const name = newName.trim()
    if (!name) return
    if (await run(() => onAdd(name))) setNewName('')
  }

  async function handleRename(e) {
    e.preventDefault()
    const name = editing.name.trim()
    const current = types.find((t) => t.id === editing.id)
    if (!name || name === current?.name) {
      setEditing(null)
      return
    }
    if (await run(() => onRename(editing.id, name))) setEditing(null)
  }

  async function handleDelete(type) {
    const count = counts.get(type.id) ?? 0
    const note =
      count > 0
        ? ` ${count === 1 ? 'Sein Dokument kommt' : `Seine ${count} Dokumente kommen`} zurück nach Unsortiert; in Google Drive bleibt alles, wie es ist.`
        : ''
    const question = `Den Typ „${type.name}“ löschen?${note}`
    if (!(await dialogs.confirm(question, { confirmLabel: 'Löschen', danger: true }))) return
    await run(() => onDelete(type.id))
  }

  return (
    <details className="card category-manager">
      <summary>Typen verwalten</summary>
      <p className="muted category-hint">
        Die Zahl neben einem Typ zeigt, wie viele Dokumente ihn haben. Belege von Ausgaben und
        Angebote landen von selbst im markierten Typ, alle anderen Dokumente unter Unsortiert.
      </p>
      <div className="category-list">
        <ul>
          {types.map((type) => {
            const count = counts.get(type.id) ?? 0
            if (editing?.id === type.id) {
              return (
                <li key={type.id}>
                  <form className="category-row" onSubmit={handleRename}>
                    <input
                      aria-label={`Neuer Name für ${type.name}`}
                      value={editing.name}
                      onChange={(e) => setEditing({ ...editing, name: e.target.value })}
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
                </li>
              )
            }
            return (
              <li key={type.id} className="category-row">
                <span className="category-name">
                  {type.name}
                  {HOLDS[type.holds] && <span className="muted"> · {HOLDS[type.holds]}</span>}
                </span>
                <span className="muted category-count">{count > 0 ? count : ''}</span>
                <button
                  type="button"
                  className="link"
                  onClick={() => {
                    setMessage('')
                    setEditing({ id: type.id, name: type.name })
                  }}
                  disabled={busy}
                >
                  Umbenennen
                </button>
                <button
                  type="button"
                  className="link danger"
                  onClick={() => handleDelete(type)}
                  disabled={busy}
                >
                  Löschen
                </button>
              </li>
            )
          })}
        </ul>
        <form className="category-row category-add" onSubmit={handleAdd}>
          <input
            aria-label="Neuer Dokumenttyp"
            placeholder="Neuer Typ"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            disabled={busy}
          />
          <button type="submit" className="secondary" disabled={busy || !newName.trim()}>
            Hinzufügen
          </button>
        </form>
        {message && (
          <p className="error" role="alert">
            {message}
          </p>
        )}
      </div>
    </details>
  )
}

export default DocumentTypeManager
