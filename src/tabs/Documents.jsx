import { useState } from 'react'
import { supabase } from '../supabase.js'
import { friendlyError, useCollection } from '../useCollection.js'
import { usePersistentState, formatDate } from '../storage.js'
import { fromRow, toRow } from '../diaryEntries.js'
import { itemFromRow, itemToRow } from '../budgetItems.js'
import { quoteFromRow, quoteToRow } from '../planning.js'
import { driveFileUrl } from '../drive.js'
import {
  UNSORTED,
  assignmentFromRow,
  assignmentToRow,
  collectDocuments,
  documentTypeId,
  typeFromRow,
  typeToRow,
} from '../documents.js'
import DocumentTypeManager from '../components/DocumentTypeManager.jsx'

function matches(document, query) {
  const q = query.trim().toLowerCase()
  return !q || `${document.name} ${document.source.label}`.toLowerCase().includes(q)
}

// All documents in Google Drive, sorted by type (Rechnungen, Pläne, …).
// Receipts of expenses are Rechnungen by themselves; everything else is
// Unsortiert until someone picks its type.
function Documents({ onOpenDiary, onOpenTab }) {
  const entryStore = useCollection('diary_entries', { fromRow, toRow })
  const quoteStore = useCollection('quotes', { fromRow: quoteFromRow, toRow: quoteToRow })
  const itemStore = useCollection('budget_items', { fromRow: itemFromRow, toRow: itemToRow })
  const typeStore = useCollection('document_types', { fromRow: typeFromRow, toRow: typeToRow })
  const assignmentStore = useCollection('document_assignments', {
    fromRow: assignmentFromRow,
    toRow: assignmentToRow,
  })
  const [filter, setFilter] = usePersistentState('documents.filter', 'all')
  const [query, setQuery] = useState('')
  const [saving, setSaving] = useState(null) // file ID being changed
  const [error, setError] = useState('')

  const types = [...typeStore.rows].sort((a, b) => a.name.localeCompare(b.name, 'de'))
  const assignments = new Map(assignmentStore.rows.map((a) => [a.fileId, a.typeId]))
  const documents = collectDocuments(entryStore.rows, quoteStore.rows, itemStore.rows).map(
    (document) => ({ ...document, typeId: documentTypeId(document, assignments, types) }),
  )
  const found = documents.filter((document) => matches(document, query))
  const groups = [
    { id: UNSORTED, name: 'Unsortiert' },
    ...types.map((type) => ({ id: type.id, name: type.name })),
  ].map((group) => ({ ...group, documents: found.filter((d) => d.typeId === group.id) }))
  const activeFilter = groups.some((g) => g.id === filter) ? filter : 'all'
  const shown =
    activeFilter === 'all'
      ? groups.filter((group) => group.documents.length > 0)
      : groups.filter((group) => group.id === activeFilter)
  const counts = new Map(documents.map((d) => [d.typeId, 0]))
  for (const document of documents) counts.set(document.typeId, counts.get(document.typeId) + 1)

  const loadError = [entryStore, quoteStore, itemStore, typeStore, assignmentStore].find(
    (store) => store.status === 'error',
  )?.error
  const loading = [entryStore, typeStore, assignmentStore].some((store) => store.status === 'loading')

  async function assign(document, typeId) {
    setSaving(document.fileId)
    setError('')
    const { error: saveError } = await supabase.from('document_assignments').upsert({
      file_id: document.fileId,
      type_id: typeId === UNSORTED ? null : typeId,
      updated_at: new Date().toISOString(),
    })
    if (saveError) setError(friendlyError(saveError))
    else await assignmentStore.reload()
    setSaving(null)
  }

  function openSource(document) {
    if (document.source.kind === 'entry') onOpenDiary({ entry: document.source.entry })
    else onOpenTab('finances')
  }

  return (
    <section className="tab-content">
      <div className="card documents-head">
        <div className="filter-chips" role="group" aria-label="Nach Typ filtern">
          <button
            type="button"
            className={activeFilter === 'all' ? 'chip active' : 'chip'}
            aria-pressed={activeFilter === 'all'}
            onClick={() => setFilter('all')}
          >
            Alle <span className="chip-count">{documents.length}</span>
          </button>
          {groups.map((group) => (
            <button
              key={group.id}
              type="button"
              className={activeFilter === group.id ? 'chip active' : 'chip'}
              aria-pressed={activeFilter === group.id}
              onClick={() => setFilter(group.id)}
            >
              {group.name} <span className="chip-count">{counts.get(group.id) ?? 0}</span>
            </button>
          ))}
        </div>
        <input
          type="search"
          className="contact-search"
          placeholder="Dokumente durchsuchen"
          aria-label="Dokumente durchsuchen"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>

      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {loadError && (
        <p className="error" role="alert">
          {loadError}
        </p>
      )}
      {loading && !loadError && <p className="empty">Dokumente werden geladen…</p>}
      {!loading && documents.length === 0 && (
        <p className="empty">
          Noch keine Dokumente. Dateien an Tagebucheinträgen, Belege von Ausgaben und Angebote
          erscheinen hier.
        </p>
      )}
      {!loading && documents.length > 0 && query.trim() && found.length === 0 && (
        <p className="empty">Keine Dokumente passen zu „{query.trim()}“.</p>
      )}

      {!loading &&
        shown.map((group) => (
          <section key={group.id} className="entry-section">
            <h2 className="entry-section-title documents-group-title">
              {group.name} <span className="chip-count">{group.documents.length}</span>
            </h2>
            {group.documents.length === 0 ? (
              <p className="empty">
                {group.id === UNSORTED ? 'Alles einsortiert.' : 'Keine Dokumente dieses Typs.'}
              </p>
            ) : (
              <ul className="document-list">
                {group.documents.map((document) => (
                  <li key={document.fileId} className="card document">
                    <a
                      className="document-name"
                      href={driveFileUrl(document.fileId)}
                      target="_blank"
                      rel="noreferrer"
                    >
                      <span aria-hidden="true">{document.photo ? '🧾' : '📄'}</span>
                      <span className="file-name">{document.name}</span>
                    </a>
                    <span className="muted document-meta">
                      {document.date && `${formatDate(document.date)} · `}
                      <button type="button" className="link" onClick={() => openSource(document)}>
                        {document.source.label}
                      </button>
                    </span>
                    <select
                      className="document-type"
                      aria-label={`Typ von ${document.name}`}
                      value={document.typeId}
                      disabled={saving === document.fileId}
                      onChange={(e) => assign(document, e.target.value)}
                    >
                      <option value={UNSORTED}>Unsortiert</option>
                      {types.map((type) => (
                        <option key={type.id} value={type.id}>
                          {type.name}
                        </option>
                      ))}
                    </select>
                  </li>
                ))}
              </ul>
            )}
          </section>
        ))}

      <DocumentTypeManager
        types={types}
        counts={counts}
        onAdd={(name) => typeStore.insert({ name })}
        onRename={(id, name) => typeStore.update(id, { name })}
        onDelete={async (id) => {
          await typeStore.remove(id)
          await assignmentStore.reload()
        }}
      />
    </section>
  )
}

export default Documents
