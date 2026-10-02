import { useRef, useState } from 'react'
import { useCollection } from '../useCollection.js'

const FIELDS = ['name', 'role', 'company', 'phone', 'email', 'notes']

function fromRow(row) {
  return {
    id: row.id,
    name: row.name,
    role: row.role,
    company: row.company,
    phone: row.phone,
    email: row.email,
    notes: row.notes,
  }
}

function toRow(contact) {
  return {
    name: contact.name,
    role: contact.role,
    company: contact.company,
    phone: contact.phone,
    email: contact.email,
    notes: contact.notes,
  }
}

function emptyForm() {
  return { name: '', role: '', company: '', phone: '', email: '', notes: '' }
}

// Keeps digits and a leading "+" so the number works as a tel: link.
function telHref(phone) {
  return `tel:${phone.replace(/[^\d+]/g, '')}`
}

function matches(contact, query) {
  const q = query.trim().toLowerCase()
  return !q || FIELDS.some((field) => contact[field].toLowerCase().includes(q))
}

function Contacts() {
  const { rows: contacts, status, error: loadError, insert, update, remove } = useCollection(
    'contacts',
    { fromRow, toRow },
  )
  const [form, setForm] = useState(emptyForm)
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const [editingId, setEditingId] = useState(null)
  const [query, setQuery] = useState('')
  const formRef = useRef(null)

  const sorted = [...contacts].sort((a, b) => a.name.localeCompare(b.name))
  const shown = sorted.filter((contact) => matches(contact, query))

  function setField(field) {
    return (e) => setForm({ ...form, [field]: e.target.value })
  }

  async function handleSubmit(e) {
    e.preventDefault()
    const contact = Object.fromEntries(FIELDS.map((field) => [field, form[field].trim()]))
    if (!contact.name) {
      setError('Please enter a name.')
      return
    }
    setSaving(true)
    setError('')
    try {
      if (editingId) {
        await update(editingId, contact)
      } else {
        await insert(contact)
      }
      resetForm()
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

  function startEdit(contact) {
    setForm(Object.fromEntries(FIELDS.map((field) => [field, contact[field]])))
    setEditingId(contact.id)
    setError('')
    formRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  async function handleDelete(contact) {
    if (!window.confirm(`Delete the contact "${contact.name}"?`)) return
    try {
      await remove(contact.id)
      if (editingId === contact.id) resetForm()
    } catch (err) {
      window.alert(err.message)
    }
  }

  return (
    <section className="tab-content">
      <form ref={formRef} className="card form-grid" onSubmit={handleSubmit} noValidate>
        <h2>{editingId ? 'Edit contact' : 'New contact'}</h2>
        <label>
          Name
          <input type="text" value={form.name} onChange={setField('name')} autoComplete="off" />
        </label>
        <label>
          Role / trade
          <input
            type="text"
            placeholder="e.g. Electrician, Architect"
            value={form.role}
            onChange={setField('role')}
          />
        </label>
        <label>
          Company
          <input type="text" value={form.company} onChange={setField('company')} />
        </label>
        <label>
          Phone
          <input type="tel" value={form.phone} onChange={setField('phone')} autoComplete="off" />
        </label>
        <label>
          Email
          <input type="email" value={form.email} onChange={setField('email')} autoComplete="off" />
        </label>
        <label className="full">
          Notes
          <textarea
            rows={2}
            placeholder="e.g. Best reached in the morning, quote from 12 March"
            value={form.notes}
            onChange={setField('notes')}
          />
        </label>

        {error && (
          <p className="error full" role="alert">
            {error}
          </p>
        )}

        <div className="form-actions full">
          <button type="submit" disabled={saving}>
            {saving ? 'Saving…' : editingId ? 'Save changes' : 'Add contact'}
          </button>
          {editingId && (
            <button type="button" className="secondary" onClick={resetForm} disabled={saving}>
              Cancel
            </button>
          )}
        </div>
      </form>

      {contacts.length > 0 && (
        <input
          type="search"
          className="contact-search"
          placeholder="Search contacts"
          aria-label="Search contacts"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      )}

      {status === 'loading' && <p className="empty">Loading contacts…</p>}
      {status === 'error' && (
        <p className="error" role="alert">
          {loadError}
        </p>
      )}
      {status === 'ready' && contacts.length === 0 && <p className="empty">No contacts yet.</p>}
      {contacts.length > 0 && shown.length === 0 && (
        <p className="empty">No contacts match “{query.trim()}”.</p>
      )}

      {shown.length > 0 && (
        <ul className="contact-list">
          {shown.map((contact) => (
            <li
              key={contact.id}
              className={contact.id === editingId ? 'card entry editing' : 'card entry'}
            >
              <strong>{contact.name}</strong>
              {(contact.role || contact.company) && (
                <span className="muted">
                  {[contact.role, contact.company].filter(Boolean).join(' · ')}
                </span>
              )}
              {(contact.phone || contact.email) && (
                <p className="contact-links">
                  {contact.phone && <a href={telHref(contact.phone)}>{contact.phone}</a>}
                  {contact.email && <a href={`mailto:${contact.email}`}>{contact.email}</a>}
                </p>
              )}
              {contact.notes && <p className="entry-text muted">{contact.notes}</p>}
              <div className="entry-actions">
                <button type="button" className="link" onClick={() => startEdit(contact)}>
                  Edit
                </button>
                <button type="button" className="link danger" onClick={() => handleDelete(contact)}>
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

export default Contacts
