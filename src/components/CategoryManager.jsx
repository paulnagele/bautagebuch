import { useState } from 'react'

// Add, rename and delete the categories of one type (expense or funding).
// `usage` maps a category name to the number of transactions using it.
function CategoryList({ title, categories, usage, readOnly, onAdd, onRename, onDelete }) {
  const [newName, setNewName] = useState('')
  const [editing, setEditing] = useState(null) // { id, name }
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)

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
        `“${category.name}” is used by ${used} transaction${used === 1 ? '' : 's'}. ` +
          'Rename it, or change those transactions first.',
      )
      return
    }
    if (!window.confirm(`Delete the category “${category.name}”?`)) return
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
                    aria-label={`New name for ${category.name}`}
                    value={editing.name}
                    onChange={(e) => setEditing({ ...editing, name: e.target.value })}
                    disabled={busy}
                    autoFocus
                  />
                  <button type="submit" className="link" disabled={busy}>
                    Save
                  </button>
                  <button
                    type="button"
                    className="link"
                    onClick={() => setEditing(null)}
                    disabled={busy}
                  >
                    Cancel
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
                    Rename
                  </button>
                  <button
                    type="button"
                    className="link danger"
                    onClick={() => handleDelete(category)}
                    disabled={busy}
                  >
                    Delete
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
            aria-label={`New ${title.toLowerCase()}`}
            placeholder="New name"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            disabled={busy}
          />
          <button type="submit" className="secondary" disabled={busy || !newName.trim()}>
            Add
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
      <summary>Manage categories</summary>
      {notice && (
        <p className="error" role="alert">
          {notice}
        </p>
      )}
      <p className="muted category-hint">
        The number next to a category shows how many transactions use it. Renaming a category
        also renames it in those transactions.
      </p>
      <div className="category-columns">
        <CategoryList
          title="Expense categories"
          categories={expense}
          usage={usage.expense}
          readOnly={readOnly}
          onAdd={(name) => onAdd('expense', name)}
          onRename={onRename}
          onDelete={onDelete}
        />
        <CategoryList
          title="Funding sources"
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
