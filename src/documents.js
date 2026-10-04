// Documents for the Dokumente tab: every file the app keeps in Google
// Drive (files of diary entries, receipts of expenses, quote PDFs), each
// with its type. The files stay where they are; only the type is stored
// (document_types, document_assignments).
import { entryType, typeKey } from './diaryTypes.js'

export const UNSORTED = 'unsorted'

export function typeFromRow(row) {
  return { id: row.id, name: row.name, holds: row.holds ?? null, createdAt: row.created_at }
}

export function typeToRow(type) {
  return { name: type.name }
}

export function assignmentFromRow(row) {
  return { id: row.file_id, fileId: row.file_id, typeId: row.type_id ?? null }
}

export function assignmentToRow(assignment) {
  return { file_id: assignment.fileId, type_id: assignment.typeId }
}

// All documents, newest first. Photos only count for expenses, where
// they are the receipt; other photos are pictures of the build.
// A document: { fileId, name, photo, date, lands, source }, where `lands`
// is 'receipts' or 'quotes' for documents with a type of their own, and
// source is { kind: 'entry', entry, label } or { kind: 'quote', label }.
export function collectDocuments(entries, quotes, budgetItems) {
  const documents = []
  for (const entry of entries) {
    const receipt = typeKey(entry.type) === 'expense'
    const lands = receipt ? 'receipts' : null
    const label = [entryType(entry.type).label, entry.work.split('\n')[0].trim()]
      .filter(Boolean)
      .join(': ')
    const source = { kind: 'entry', entry, label }
    for (const file of entry.files) {
      documents.push({ fileId: file.id, name: file.name, photo: false, date: entry.date, lands, source })
    }
    if (receipt) {
      entry.photoIds.forEach((fileId, i) => {
        const name = entry.photoIds.length > 1 ? `Foto ${i + 1}` : 'Foto'
        documents.push({ fileId, name, photo: true, date: entry.date, lands, source })
      })
    }
  }
  const itemNames = new Map(budgetItems.map((item) => [item.id, item.name]))
  for (const quote of quotes) {
    const item = itemNames.get(quote.budgetItemId)
    const label = `Angebot: ${quote.company}${item ? ` (${item})` : ''}`
    for (const file of quote.files) {
      documents.push({
        fileId: file.id,
        name: file.name,
        photo: false,
        date: quote.createdAt?.slice(0, 10) ?? '',
        lands: 'quotes',
        source: { kind: 'quote', label },
      })
    }
  }
  return documents.sort((a, b) => b.date.localeCompare(a.date) || a.name.localeCompare(b.name, 'de'))
}

// The type ID of a document, or UNSORTED. Sorted by hand wins; otherwise
// receipts of expenses go to the receipts type (Rechnungen) and quote
// PDFs to the quotes type (Angebote).
export function documentTypeId(document, assignments, types) {
  if (assignments.has(document.fileId)) {
    const typeId = assignments.get(document.fileId)
    return typeId && types.some((t) => t.id === typeId) ? typeId : UNSORTED
  }
  if (document.lands) return types.find((t) => t.holds === document.lands)?.id ?? UNSORTED
  return UNSORTED
}
