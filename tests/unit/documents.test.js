import { describe, expect, it, vi } from 'vitest'

// documents.js also talks to the database; not needed here.
vi.mock('../../src/supabase.js', () => ({ supabase: null }))
const { UNSORTED, canMarkPhotos, collectDocuments, documentTypeId, isImageFile } = await import(
  '../../src/documents.js'
)
const { entry, expense } = await import('./fixtures.js')

const types = [
  { id: 'rechnungen', name: 'Rechnungen', holds: 'receipts' },
  { id: 'angebote', name: 'Angebote', holds: 'quotes' },
  { id: 'plaene', name: 'Pläne', holds: null },
]

describe('Dokumente', () => {
  const status = entry({
    date: '2026-11-02',
    work: 'Baubewilligung\nmit Details',
    photoIds: ['p1', 'p2'],
    files: [{ id: 'plan', name: 'Einreichplan.pdf' }],
  })
  const bill = expense(100, 'open', {})
  bill.date = '2026-11-05'
  bill.photoIds = ['beleg']
  const quotes = [{ budgetItemId: 'i1', company: 'Firma A', files: [{ id: 'q1', name: 'Angebot.pdf' }], createdAt: '2026-10-01T08:00:00Z' }]
  const items = [{ id: 'i1', name: 'Fenster' }]

  it('sammelt Dateien, Belege und Angebote, neueste zuerst', () => {
    const docs = collectDocuments([status, bill], quotes, items, new Map([['p2', null]]))
    expect(docs.map((d) => d.fileId)).toEqual(['beleg', 'plan', 'p2', 'q1'])
    const [receipt, plan, photo, quote] = docs
    expect(receipt).toMatchObject({ photo: true, image: true, optional: false, lands: 'receipts', name: 'Foto' })
    expect(plan).toMatchObject({ photo: false, image: false, lands: null })
    expect(plan.source.label).toBe('Status: Baubewilligung')
    // Fotos von Status-Einträgen nur, wenn sie als Dokument markiert sind.
    expect(photo).toMatchObject({ name: 'Foto 2', optional: true })
    expect(quote).toMatchObject({ lands: 'quotes', date: '2026-10-01', source: { label: 'Angebot: Firma A (Fenster)' } })
  })

  it('ordnet zu: von Hand vor automatisch, sonst Unsortiert', () => {
    const assignments = new Map([['plan', 'plaene'], ['weg', 'geloeschter-typ']])
    expect(documentTypeId({ fileId: 'plan' }, assignments, types)).toBe('plaene')
    expect(documentTypeId({ fileId: 'weg' }, assignments, types)).toBe(UNSORTED)
    expect(documentTypeId({ fileId: 'x', lands: 'receipts' }, assignments, types)).toBe('rechnungen')
    expect(documentTypeId({ fileId: 'x', lands: 'quotes' }, assignments, [])).toBe(UNSORTED)
    expect(documentTypeId({ fileId: 'x', lands: null }, assignments, types)).toBe(UNSORTED)
  })

  it('erkennt Bilder am Dateinamen', () => {
    expect(isImageFile('Foto.HEIC')).toBe(true)
    expect(isImageFile('plan.pdf')).toBe(false)
    expect(isImageFile(undefined)).toBe(false)
    expect(canMarkPhotos(entry())).toBe(true)
    expect(canMarkPhotos(bill)).toBe(false)
  })
})
