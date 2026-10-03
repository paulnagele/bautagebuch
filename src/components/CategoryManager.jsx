import { useState } from 'react'
import { useDialogs } from '../dialogs.js'

// Add, rename and delete the categories of one type (expense or funding).
// `usage` maps a category name to the number of transactions using it.
function CategoryList({ title, categories, usage, readOnly, onAdd, onRename, onDelete }) {
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
    const current = categories.find((c) => c.id === editing.id)
    if (!name || name === current?.name) {
      setEditing(null)
      return
    }
    if (await run(() => onRename(editing.id, name))) setEditing(null)
  }

  async function handleDelete(category) {
    const used = usage.get(category.name) ?? 0
    if (used > 0) {
      setMessage(
        `„${category.name}“ wird von ${used} Buchung${used === 1 ? '' : 'en'} verwendet. ` +
          'Benenne sie um oder ändere zuerst diese Buchungen.',
      )
      return
    }
    const question = `Die Kategorie „${category.name}“ löschen?`
    if (!(await dialogs.confirm(question, { confirmLabel: 'Löschen', danger: true }))) return
    await run(() => onDelete(category.id))
  }

  return (
    <div className="category-list">
      <h3>{title}</h3>
      <ul>
        {categories.map((category) => {
          const used = usage.get(category.name) ?? 0
          if (editing?.id === category.id) {
            return (
              <li key={category.id}>
                <form className="category-row" onSubmit={handleRename}>
                  <input
                    aria-label={`Neuer Name für ${category.name}`}
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
            <li key={category.id} className="category-row">
              <span className="category-name">{category.name}</span>
              <span className="muted category-count">{used > 0 ? used : ''}</span>
              {!readOnly && (
                <>
                  <button
                    type="button"
                    className="link"
                    onClick={() => {
                      setMessage('')
                      setEditing({ id: category.id, name: category.name })
                    }}
                    disabled={busy}
                  >
                    Umbenennen
                  </button>
                  <button
                    type="button"
                    className="link danger"
                    onClick={() => handleDelete(category)}
                    disabled={busy}
                  >
                    Löschen
                  </button>
                </>
              )}
            </li>
          )
        })}
      </ul>
      {!readOnly && (
        <form className="category-row category-add" onSubmit={handleAdd}>
          <input
            aria-label={`${title}: neuer Eintrag`}
            placeholder="Neuer Name"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            disabled={busy}
          />
          <button type="submit" className="secondary" disabled={busy || !newName.trim()}>
            Hinzufügen
          </button>
        </form>
      )}
      {message && (
        <p className="error" role="alert">
          {message}
        </p>
      )}
    </div>
  )
}

function CategoryManager({ expense, funding, usage, readOnly, notice, onAdd, onRename, onDelete }) {
  return (
    <details className="card category-manager">
      <summary>Kategorien verwalten</summary>
      {notice && (
        <p className="error" role="alert">
          {notice}
        </p>
      )}
      <p className="muted category-hint">
        Die Zahl neben einer Kategorie zeigt, wie viele Buchungen sie verwenden. Beim Umbenennen
        wird die Kategorie auch in diesen Buchungen umbenannt.
      </p>
      <div className="category-columns">
        <CategoryList
          title="Ausgabenkategorien"
          categories={expense}
          usage={usage.expense}
          readOnly={readOnly}
          onAdd={(name) => onAdd('expense', name)}
          onRename={onRename}
          onDelete={onDelete}
        />
        <CategoryList
          title="Finanzierungsquellen"
          categories={funding}
          usage={usage.funding}
          readOnly={readOnly}
          onAdd={(name) => onAdd('funding', name)}
          onRename={onRename}
          onDelete={onDelete}
        />
      </div>
    </details>
  )
}

export default CategoryManager
