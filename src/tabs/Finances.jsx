import { today } from '../storage.js'
import { friendlyError, useCollection } from '../useCollection.js'
import { supabase } from '../supabase.js'
import CategoryManager from '../components/CategoryManager.jsx'
import MoneyFlow from '../components/MoneyFlow.jsx'
import BudgetPlan from '../components/BudgetPlan.jsx'
import QuoteList from '../components/QuoteList.jsx'
import Bookings from '../components/Bookings.jsx'
import { byOrder as itemOrder, itemFromRow, itemToRow } from '../budgetItems.js'
import { quoteFromRow, quoteToRow } from '../planning.js'
import { byOrder, categoryFromRow, categoryToRow } from '../categories.js'
import { contactFromRow, contactToRow } from '../contacts.js'
import { fromRow, toRow } from '../transactions.js'
import { flowSources, flowTargets, sumBy } from '../moneyFlow.js'
import { connectDrive, getEntryFolderId, uploadFile } from '../drive.js'

// Used only until the finance_categories table exists (migrations not yet
// applied); the migrations start the table with the same lists.
const DEFAULT_FUNDING_SOURCES = [
  'Eigenmittel',
  'Bankkredit',
  'Wohnbauförderung',
  'Familien- / Privatdarlehen',
  'Sonstige Finanzierung',
]

const DEFAULT_EXPENSE_CATEGORIES = [
  'Grundstück & Kaufnebenkosten',
  'Planung & Genehmigungen',
  'Rohbau',
  'Dach',
  'Fenster & Türen',
  'Haustechnik',
  'Innenausbau',
  'Küche & Einrichtung',
  'Außenanlagen & Garten',
  'Gebühren & Versicherungen',
  'Sonstiges',
]

const currency = new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR' })
// Whole euros for the overview; the transaction table keeps cents.
const euros = new Intl.NumberFormat('de-DE', {
  style: 'currency',
  currency: 'EUR',
  maximumFractionDigits: 0,
})
const percent = new Intl.NumberFormat('de-DE', { style: 'percent', maximumFractionDigits: 1 })

function defaultCategories(type, names) {
  return names.map((name, i) => ({ id: `default-${type}-${i}`, type, name, sortOrder: i }))
}

function Finances({ user, onOpenDiary }) {
  const {
    rows: items,
    status,
    error: loadError,
    insert,
    update,
    remove,
    reload: reloadItems,
  } = useCollection('transactions', { fromRow, toRow })
  const categoryStore = useCollection('finance_categories', {
    fromRow: categoryFromRow,
    toRow: categoryToRow,
  })
  const itemStore = useCollection('budget_items', { fromRow: itemFromRow, toRow: itemToRow })
  const quoteStore = useCollection('quotes', { fromRow: quoteFromRow, toRow: quoteToRow })
  const contactStore = useCollection('contacts', { fromRow: contactFromRow, toRow: contactToRow })
  const funding = items.filter((i) => i.type === 'funding')
  const expenses = items.filter((i) => i.type === 'expense')
  const totalFunding = funding.reduce((s, i) => s + i.amount, 0)
  const totalSpent = expenses.reduce((s, i) => s + i.amount, 0)
  // Invoices entered but not yet paid; included in what was spent.
  const unpaid = expenses.filter((i) => !i.paid)
  const totalUnpaid = unpaid.reduce((s, i) => s + i.amount, 0)
  const remaining = totalFunding - totalSpent
  const usedShare = totalFunding > 0 ? totalSpent / totalFunding : 0
  // Until the categories table exists, fall back to the built-in lists.
  const categoriesMissing = categoryStore.status === 'error'
  const categoryRows = categoriesMissing
    ? [
        ...defaultCategories('expense', DEFAULT_EXPENSE_CATEGORIES),
        ...defaultCategories('funding', DEFAULT_FUNDING_SOURCES),
      ]
    : categoryStore.rows
  const expenseCategories = categoryRows.filter((c) => c.type === 'expense').sort(byOrder)
  // Until the budget items table exists, categories have no items.
  const itemsMissing = itemStore.status === 'error'
  const budgetItems = itemsMissing ? [] : [...itemStore.rows].sort(itemOrder)
  // A category split into items is planned as the sum of its items.
  const plannedCategories = expenseCategories.map((c) => {
    const own = budgetItems.filter((item) => item.categoryId === c.id)
    if (own.length === 0) return c
    return { ...c, plannedAmount: own.reduce((sum, item) => sum + item.plannedAmount, 0) }
  })
  const itemSpent = sumBy(
    expenses.filter((e) => e.budgetItemId),
    'budgetItemId',
  )
  const itemUnpaid = sumBy(
    unpaid.filter((e) => e.budgetItemId),
    'budgetItemId',
  )
  const unpaidByCategory = sumBy(unpaid, 'category')
  const itemQuotes = new Map()
  for (const quote of quoteStore.rows) {
    itemQuotes.set(quote.budgetItemId, (itemQuotes.get(quote.budgetItemId) ?? 0) + 1)
  }
  // What the plans still expect to be spent, beyond what already was.
  const spentByCategory = sumBy(expenses, 'category')
  const plannedOpen = plannedCategories.reduce(
    (sum, c) => sum + Math.max(0, (c.plannedAmount ?? 0) - (spentByCategory.get(c.name) ?? 0)),
    0,
  )
  const companyNames = [
    ...new Set(contactStore.rows.flatMap((c) => [c.company, c.name]).filter(Boolean)),
  ].sort((a, b) => a.localeCompare(b, 'de'))
  const fundingCategories = categoryRows.filter((c) => c.type === 'funding').sort(byOrder)
  const usage = { expense: new Map(), funding: new Map() }
  for (const item of items) {
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
    const { error: renameError } = await supabase.rpc('rename_finance_category', {
      category_id: id,
      new_name: name,
    })
    if (renameError) throw new Error(friendlyError(renameError))
    await Promise.all([categoryStore.reload(), reloadItems()])
  }

  async function setPlannedAmount(id, plannedAmount) {
    const category = expenseCategories.find((c) => c.id === id)
    await categoryStore.update(id, { ...category, plannedAmount })
  }

  async function addBudgetItem(categoryId, name, plannedAmount) {
    const siblings = budgetItems.filter((item) => item.categoryId === categoryId)
    const sortOrder = Math.max(0, ...siblings.map((item) => item.sortOrder)) + 1
    await itemStore.insert({ categoryId, name, plannedAmount, sortOrder })
  }

  async function updateBudgetItem(id, changes) {
    const item = budgetItems.find((i) => i.id === id)
    await itemStore.update(id, { ...item, ...changes })
  }

  async function deleteBudgetItem(id) {
    await itemStore.remove(id)
    // Assigned expenses lose their item (on delete set null).
    await reloadItems()
  }

  // ---- quotes (Angebote) per budget item ----

  // Drive folder for quote PDFs: Haus / Angebote / <upload date>.
  function quoteFolderPath() {
    return ['Angebote', today().replaceAll('-', '_')]
  }

  async function addQuote(budgetItemId, { company, amount, file }) {
    let files = []
    if (file) {
      // First, while the click still counts, or the browser blocks Google's popup.
      await connectDrive(user.email)
      const folderId = await getEntryFolderId(quoteFolderPath())
      const id = await uploadFile(file, `${today()} Angebot ${company} ${file.name}`, folderId)
      files = [{ id, name: file.name }]
    }
    await quoteStore.insert({ budgetItemId, company, amount, files })
  }

  async function chooseQuote(quote, pick) {
    const { error: chooseError } = await supabase.rpc('choose_quote', { quote_id: quote.id, pick })
    if (chooseError) throw new Error(friendlyError(chooseError))
    await Promise.all([quoteStore.reload(), itemStore.reload()])
  }

  // Quotes (via the Posten) and the category's time slots in the
  // Bauablauf (Zeitplan) are deleted with it.
  async function checkCategoryDelete(category) {
    const itemIds = new Set(budgetItems.filter((i) => i.categoryId === category.id).map((i) => i.id))
    const quotes = quoteStore.rows.filter((q) => itemIds.has(q.budgetItemId)).length
    // Not loaded on this tab, so counted here; unknown if that fails.
    const { count: slots } = await supabase
      .from('schedule_slots')
      .select('id', { count: 'exact', head: true })
      .eq('category_id', category.id)
    const lost = [
      quotes > 0 && (quotes === 1 ? 'ein Angebot' : `${quotes} Angebote`),
      slots > 0 && (slots === 1 ? 'ein Zeitfenster im Bauablauf' : `${slots} Zeitfenster im Bauablauf`),
    ].filter(Boolean)
    return { note: lost.length > 0 ? ` Außerdem werden ${lost.join(' und ')} gelöscht.` : '' }
  }

  async function deleteCategory(id) {
    await categoryStore.remove(id)
  }

  return (
    <section className="tab-content">
      <div className="stats">
        <div className="card stat">
          <span className="muted">Gesicherte Finanzierung</span>
          <strong>{euros.format(totalFunding)}</strong>
        </div>
        <div className="card stat">
          <span className="muted">Bisher ausgegeben</span>
          <strong>{euros.format(totalSpent)}</strong>
          {totalUnpaid > 0 && (
            <span className="muted stat-note">davon {euros.format(totalUnpaid)} noch nicht bezahlt</span>
          )}
        </div>
        <div className="card stat">
          <span className="muted">Verbleibend</span>
          <strong className={remaining < 0 ? 'negative' : undefined}>
            {euros.format(remaining)}
          </strong>
        </div>
      </div>

      {totalFunding > 0 && (
        <div className="card meter-card">
          <div className="meter-head">
            <span>Budget verbraucht</span>
            <strong>{percent.format(usedShare)}</strong>
          </div>
          <div
            className="meter"
            role="meter"
            aria-label="Anteil der ausgegebenen Finanzierung"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round(usedShare * 100)}
          >
            <span
              className={usedShare > 1 ? 'meter-fill over' : 'meter-fill'}
              style={{ width: `${Math.min(usedShare, 1) * 100}%` }}
            />
          </div>
          {usedShare > 1 && (
            <p className="negative meter-note">
              ⚠ Die Ausgaben übersteigen die gesicherte Finanzierung um {euros.format(-remaining)}.
            </p>
          )}
        </div>
      )}

      <MoneyFlow
        sources={flowSources(
          fundingCategories.map((c) => c.name),
          funding,
          Math.max(0, totalSpent + plannedOpen - totalFunding),
        )}
        targets={flowTargets(expenses, plannedCategories, totalFunding)}
        total={Math.max(totalFunding, totalSpent + plannedOpen)}
        format={(value) => euros.format(value)}
        formatShare={(share) => percent.format(share)}
      />

      <BudgetPlan
        categories={plannedCategories}
        spent={spentByCategory}
        items={budgetItems}
        itemSpent={itemSpent}
        unpaid={unpaidByCategory}
        itemUnpaid={itemUnpaid}
        itemQuotes={itemQuotes}
        itemsReadOnly={itemsMissing}
        funding={totalFunding}
        readOnly={categoriesMissing}
        format={(value) => euros.format(value)}
        onSetPlan={setPlannedAmount}
        onAddItem={addBudgetItem}
        onUpdateItem={updateBudgetItem}
        onDeleteItem={deleteBudgetItem}
        expenses={expenses}
        onOpenDiary={onOpenDiary}
        itemExtra={
          quoteStore.status === 'error'
            ? undefined
            : (item) => (
                <QuoteList
                  item={item}
                  quotes={quoteStore.rows.filter((q) => q.budgetItemId === item.id)}
                  companies={companyNames}
                  format={(value) => currency.format(value)}
                  readOnly={categoriesMissing}
                  onAdd={addQuote}
                  onChoose={chooseQuote}
                  onDelete={(quote) => quoteStore.remove(quote.id)}
                />
              )
        }
      />

      <Bookings
        items={items}
        status={status}
        loadError={loadError}
        insert={insert}
        update={update}
        remove={remove}
        expenseCategories={expenseCategories}
        fundingCategories={fundingCategories}
        onOpenDiary={onOpenDiary}
      >
        <CategoryManager
          expense={expenseCategories}
          funding={fundingCategories}
          usage={usage}
          itemCounts={itemCounts}
          readOnly={categoriesMissing}
          notice={categoriesMissing ? categoryStore.error : ''}
          checkDelete={checkCategoryDelete}
          onAdd={addCategory}
          onRename={renameCategory}
          onDelete={deleteCategory}
        />
      </Bookings>
    </section>
  )
}

export default Finances
