import { friendlyError, useCollection } from '../useCollection.js'
import { supabase } from '../supabase.js'
import CategoryManager from './CategoryManager.jsx'
import { byOrder as itemOrder, itemFromRow, itemToRow } from '../budgetItems.js'
import { quoteFromRow, quoteToRow } from '../planning.js'
import { byOrder, categoryFromRow, categoryToRow } from '../categories.js'
import { fromRow, toRow } from '../transactions.js'

// Kategorien in Einstellungen → Listen: add, rename, reorder and delete
// the expense categories and funding sources used across the app.
function CategorySettings() {
  const transactionStore = useCollection('transactions', { fromRow, toRow })
  const categoryStore = useCollection('finance_categories', {
    fromRow: categoryFromRow,
    toRow: categoryToRow,
  })
  const itemStore = useCollection('budget_items', { fromRow: itemFromRow, toRow: itemToRow })
  const quoteStore = useCollection('quotes', { fromRow: quoteFromRow, toRow: quoteToRow })

  const categoryRows = categoryStore.rows
  const expenseCategories = categoryRows.filter((c) => c.type === 'expense').sort(byOrder)
  const fundingCategories = categoryRows.filter((c) => c.type === 'funding').sort(byOrder)
  const budgetItems = [...itemStore.rows].sort(itemOrder)

  const usage = { expense: new Map(), funding: new Map() }
  for (const item of transactionStore.rows) {
    const counts = usage[item.type]
    counts?.set(item.category, (counts.get(item.category) ?? 0) + 1)
  }
  const itemCounts = new Map()
  for (const item of budgetItems) {
    itemCounts.set(item.categoryId, (itemCounts.get(item.categoryId) ?? 0) + 1)
  }

  async function addCategory(type, name) {
    const siblings = type === 'funding' ? fundingCategories : expenseCategories
    const sortOrder = Math.max(0, ...siblings.map((c) => c.sortOrder)) + 1
    await categoryStore.insert({ type, name, sortOrder })
  }

  async function renameCategory(id, name) {
    const { error } = await supabase.rpc('rename_finance_category', {
      category_id: id,
      new_name: name,
    })
    if (error) throw new Error(friendlyError(error))
    await Promise.all([categoryStore.reload(), transactionStore.reload()])
  }

  // Moves a category one place up (-1) or down (1) within its type, then
  // numbers the list 1, 2, 3, … and saves the rows whose number changed
  // (usually just the two swapped ones).
  async function moveCategory(id, step) {
    const category = categoryRows.find((c) => c.id === id)
    const list = [...(category.type === 'funding' ? fundingCategories : expenseCategories)]
    const from = list.findIndex((c) => c.id === id)
    const to = from + step
    if (from < 0 || to < 0 || to >= list.length) return
    ;[list[from], list[to]] = [list[to], list[from]]
    const changed = list
      .map((c, i) => ({ ...c, sortOrder: i + 1 }))
      .filter((c, i) => list[i].sortOrder !== c.sortOrder)
    await Promise.all(changed.map((c) => categoryStore.update(c.id, c)))
  }

  // Quotes (via the Posten) and the category's time slots in the
  // Bauablauf (Zeitplan) are deleted with it; diary entries that name it
  // as their Bauablauf category lose it.
  async function checkCategoryDelete(category) {
    const itemIds = new Set(budgetItems.filter((i) => i.categoryId === category.id).map((i) => i.id))
    const quotes = quoteStore.rows.filter((q) => itemIds.has(q.budgetItemId)).length
    // Not loaded here, so counted; unknown if that fails.
    const [{ count: slots }, { count: entries }] = await Promise.all([
      supabase
        .from('schedule_slots')
        .select('id', { count: 'exact', head: true })
        .eq('category_id', category.id),
      supabase
        .from('diary_entries')
        .select('id', { count: 'exact', head: true })
        .eq('details->>category', category.name)
        .neq('entry_type', 'expense'),
    ])
    const lost = [
      quotes > 0 && (quotes === 1 ? 'ein Angebot' : `${quotes} Angebote`),
      slots > 0 && (slots === 1 ? 'ein Zeitfenster im Bauablauf' : `${slots} Zeitfenster im Bauablauf`),
    ].filter(Boolean)
    const notes = [
      lost.length > 0 && ` Außerdem werden ${lost.join(' und ')} gelöscht.`,
      entries > 0 &&
        (entries === 1
          ? ' Ein Tagebucheintrag verliert seine Kategorie (Bauablauf).'
          : ` ${entries} Tagebucheinträge verlieren ihre Kategorie (Bauablauf).`),
    ]
    return { note: notes.filter(Boolean).join('') }
  }

  // In the database, so the diary entries naming the category lose it in
  // the same step (see migration 20261011120000).
  async function deleteCategory(id) {
    const { error } = await supabase.rpc('delete_finance_category', { category_id: id })
    if (error) throw new Error(friendlyError(error))
    await categoryStore.reload()
  }

  return (
    <CategoryManager
      expense={expenseCategories}
      funding={fundingCategories}
      usage={usage}
      itemCounts={itemCounts}
      notice={categoryStore.status === 'error' ? categoryStore.error : ''}
      checkDelete={checkCategoryDelete}
      onAdd={addCategory}
      onRename={renameCategory}
      onMove={moveCategory}
      onDelete={deleteCategory}
    />
  )
}

export default CategorySettings
