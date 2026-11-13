import { useCollection } from '../useCollection.js'
import { fromRow, toRow } from '../diaryEntries.js'
import { itemFromRow, itemToRow } from '../budgetItems.js'
import { quoteFromRow, quoteToRow } from '../planning.js'
import {
  assignmentFromRow,
  assignmentToRow,
  collectDocuments,
  documentTypeId,
  typeFromRow,
  typeToRow,
} from '../documents.js'
import DocumentTypeManager from './DocumentTypeManager.jsx'

// Dokumenttypen in Einstellungen → Listen, with how many documents each has.
function DocumentTypeSettings() {
  const entryStore = useCollection('diary_entries', { fromRow, toRow })
  const quoteStore = useCollection('quotes', { fromRow: quoteFromRow, toRow: quoteToRow })
  const itemStore = useCollection('budget_items', { fromRow: itemFromRow, toRow: itemToRow })
  const typeStore = useCollection('document_types', { fromRow: typeFromRow, toRow: typeToRow })
  const assignmentStore = useCollection('document_assignments', {
    fromRow: assignmentFromRow,
    toRow: assignmentToRow,
  })

  const types = [...typeStore.rows].sort((a, b) => a.name.localeCompare(b.name, 'de'))
  const assignments = new Map(assignmentStore.rows.map((a) => [a.fileId, a.typeId]))
  const counts = new Map()
  for (const document of collectDocuments(
    entryStore.rows,
    quoteStore.rows,
    itemStore.rows,
    assignments,
  )) {
    const typeId = documentTypeId(document, assignments, types)
    counts.set(typeId, (counts.get(typeId) ?? 0) + 1)
  }

  return (
    <>
      {typeStore.status === 'error' && (
        <p className="error" role="alert">
          {typeStore.error}
        </p>
      )}
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
    </>
  )
}

export default DocumentTypeSettings
