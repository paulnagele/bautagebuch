// The mappings between database rows and the app's objects.
import { describe, expect, it } from 'vitest'
import { quoteFromRow, quoteToRow } from '../../src/planning.js'
import { byOrder as itemOrder, itemFromRow, itemToRow } from '../../src/budgetItems.js'
import { byOrder, categoryFromRow, categoryToRow, expenseCategories } from '../../src/categories.js'
import { contactFromRow, contactToRow, telHref } from '../../src/contacts.js'
import { fromRow as entryFromRow, toRow as entryToRow } from '../../src/diaryEntries.js'
import { fromRow as txFromRow, toRow as txToRow } from '../../src/transactions.js'

describe('Zeilen aus der Datenbank', () => {
  it('Kategorien: Zahlen aus Text, Plan darf fehlen', () => {
    const row = { id: 'c1', type: 'expense', name: 'Dach', sort_order: 2, planned_amount: '46000.00' }
    const category = categoryFromRow(row)
    expect(category).toEqual({ id: 'c1', type: 'expense', name: 'Dach', sortOrder: 2, plannedAmount: 46000 })
    expect(categoryFromRow({ ...row, planned_amount: null }).plannedAmount).toBeNull()
    expect(categoryToRow(category)).toEqual({ type: 'expense', name: 'Dach', sort_order: 2, planned_amount: 46000 })
  })

  it('Kategorien: Reihenfolge wie auf Finanzen, dann nach Name', () => {
    const list = [
      { type: 'expense', name: 'Öl', sortOrder: 1 },
      { type: 'funding', name: 'Bank', sortOrder: 0 },
      { type: 'expense', name: 'Dach', sortOrder: 1 },
      { type: 'expense', name: 'Rohbau', sortOrder: 0 },
    ]
    expect(expenseCategories(list).map((c) => c.name)).toEqual(['Rohbau', 'Dach', 'Öl'])
    expect([...list].sort(byOrder)[0].name).toBe('Bank')
  })

  it('Posten', () => {
    const item = itemFromRow({ id: 'i', category_id: 'c', name: 'Statik', planned_amount: '4500', sort_order: 1 })
    expect(item.plannedAmount).toBe(4500)
    expect(itemToRow(item)).toEqual({ category_id: 'c', name: 'Statik', planned_amount: 4500, sort_order: 1 })
    expect(itemOrder({ sortOrder: 1, name: 'B' }, { sortOrder: 1, name: 'A' })).toBeGreaterThan(0)
  })

  it('Angebote', () => {
    const quote = quoteFromRow({ id: 'q', budget_item_id: 'i', company: 'Firma', amount: '10.5', note: null, files: null, chosen: true, created_at: 't' })
    expect(quote).toMatchObject({ amount: 10.5, note: '', files: [], chosen: true })
    expect(quoteToRow(quote)).toEqual({ budget_item_id: 'i', company: 'Firma', amount: 10.5, note: '', files: [] })
  })

  it('Kontakte: leere Felder werden leerer Text, Telefonlinks nur mit Ziffern', () => {
    const contact = contactFromRow({ id: 'k', name: 'Erika Beispiel', role: null, company: null, phone: null, email: null, notes: null, pinned: null })
    expect(contact).toMatchObject({ role: '', phone: '', pinned: false })
    expect(contactToRow(contact)).not.toHaveProperty('id')
    expect(telHref('+43 (660) 000-12 34')).toBe('tel:+436600001234')
  })

  it('Buchungen: Ausgaben aus dem Tagebuch sind ohne Angabe bezahlt', () => {
    const tx = txFromRow({ id: 't', tx_date: '2026-11-01', type: 'expense', category: 'Dach', description: 'x', amount: '99.90' })
    expect(tx).toMatchObject({ amount: 99.9, paid: true, hasReceipt: false, diaryEntryId: null, budgetItemId: null })
    expect(txToRow(tx)).toEqual({ tx_date: '2026-11-01', type: 'expense', category: 'Dach', description: 'x', amount: 99.9 })
  })

  it('Tagebucheinträge: Wetter und Arbeiter nur bei Status', () => {
    const entry = entryFromRow({ id: 'e', entry_type: null, entry_date: '2026-11-01', weather: 'Rain', workers: null, work: 'x', details: null, photo_ids: null, files: null, author_name: 'A', created_at: 't' })
    expect(entry).toMatchObject({ type: 'status', workers: '', details: {}, photoIds: [], files: [] })
    expect(entryToRow({ ...entry, workers: '4' })).toMatchObject({ weather: 'Rain', workers: 4 })
    expect(entryToRow({ ...entry, workers: '' }).workers).toBeNull()
    const appointment = entryToRow({ ...entry, type: 'appointment', workers: '4' })
    expect(appointment).toMatchObject({ entry_type: 'appointment', weather: '', workers: null })
  })
})
