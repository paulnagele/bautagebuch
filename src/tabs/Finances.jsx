import { useRef, useState } from 'react'
import { formatDate, today } from '../storage.js'
import { friendlyError, useCollection } from '../useCollection.js'
import { useDialogs } from '../dialogs.js'
import { supabase } from '../supabase.js'
import CategoryManager from '../components/CategoryManager.jsx'
import MoneyFlow from '../components/MoneyFlow.jsx'
import BudgetPlan from '../components/BudgetPlan.jsx'
import QuoteList from '../components/QuoteList.jsx'
import PaymentPlan from '../components/PaymentPlan.jsx'
import { byOrder as itemOrder, itemFromRow, itemToRow } from '../budgetItems.js'
import { paymentFromRow, paymentToRow, quoteFromRow, quoteToRow } from '../planning.js'
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

// Validated categorical palette (see index.css), used for funding sources in
// the money-flow diagram. A source keeps the colour of its position in the
// category list; beyond eight sources the rest are grouped as "Weitere Quellen"
// instead of inventing more colours.
const SERIES_COLORS = Array.from({ length: 8 }, (_, i) => `var(--series-${i + 1})`)
const OTHER_COLOR = 'var(--muted)'

function categoryFromRow(row) {
  return {
    id: row.id,
    type: row.type,
    name: row.name,
    sortOrder: row.sort_order,
    plannedAmount: row.planned_amount == null ? null : Number(row.planned_amount),
  }
}

function categoryToRow(category) {
  const row = { type: category.type, name: category.name, sort_order: category.sortOrder }
  // Only sent when set, so adding categories keeps working before the
  // planned-budget migration has been applied.
  if (category.plannedAmount !== undefined) row.planned_amount = category.plannedAmount
  return row
}

function byOrder(a, b) {
  return a.sortOrder - b.sortOrder || a.name.localeCompare(b.name, 'de')
}

function defaultCategories(type, names) {
  return names.map((name, i) => ({ id: `default-${type}-${i}`, type, name, sortOrder: i }))
}

function fromRow(row) {
  return {
    id: row.id,
    date: row.tx_date,
    type: row.type,
    category: row.category,
    description: row.description,
    amount: Number(row.amount),
    // Set for expenses entered in the diary; those are changed there.
    diaryEntryId: row.diary_entry_id ?? null,
    // The budget item a diary expense is assigned to, if any.
    budgetItemId: row.budget_item_id ?? null,
    // Diary expenses: false while the invoice is still open, and whether
    // the entry has a photo or file of the receipt.
    paid: row.paid ?? true,
    hasReceipt: row.has_receipt ?? false,
  }
}

function toRow(item) {
  return {
    tx_date: item.date,
    type: item.type,
    category: item.category,
    description: item.description,
    amount: item.amount,
  }
}

function sumBy(items, key) {
  const totals = new Map()
  for (const item of items) {
    totals.set(item[key], (totals.get(item[key]) ?? 0) + item.amount)
  }
  return totals
}

// New expenses are entered in the diary (entry kind "Ausgabe"), so the
// form here adds funding; older expenses can still be edited with it.
function emptyForm(type = 'funding') {
  // An empty category means "the first category of this type".
  return { date: today(), type, category: '', description: '', amount: '' }
}

// Funding sources in list order (plus any no longer in the list), coloured
// by position so colours stay put when amounts change.
const DETAILS_PER_NODE = 3

// The entries behind one source or category, grouped by description: the
// largest few, the rest combined as "+ n weitere".
function entryDetails(items) {
  const totals = sumBy(items, 'description')
  const sorted = [...totals.entries()]
    .map(([name, value]) => ({ name, value }))
    .filter((d) => d.value > 0)
    .sort((a, b) => b.value - a.value)
  if (sorted.length <= DETAILS_PER_NODE + 1) return sorted
  const shown = sorted.slice(0, DETAILS_PER_NODE)
  const rest = sorted.slice(DETAILS_PER_NODE)
  return [
    ...shown,
    { name: `+ ${rest.length} weitere`, value: rest.reduce((sum, d) => sum + d.value, 0) },
  ]
}

function itemsByCategory(items) {
  const groups = new Map()
  for (const item of items) {
    if (!groups.has(item.category)) groups.set(item.category, [])
    groups.get(item.category).push(item)
  }
  return groups
}

// Funding sources in list order (plus any no longer in the list), coloured
// by position so colours stay put when amounts change.
function flowSources(sourceNames, funding, unfunded) {
  const groups = itemsByCategory(funding)
  const ordered = [...sourceNames, ...[...groups.keys()].filter((n) => !sourceNames.includes(n))]
  const nodes = []
  const folded = []
  ordered.forEach((name, i) => {
    const items = groups.get(name) ?? []
    const value = items.reduce((sum, item) => sum + item.amount, 0)
    if (value <= 0) return
    if (i < SERIES_COLORS.length) {
      nodes.push({ name, value, color: SERIES_COLORS[i], details: entryDetails(items) })
    } else {
      folded.push(...items)
    }
  })
  if (folded.length > 0) {
    nodes.push({
      name: 'Weitere Quellen',
      value: folded.reduce((sum, item) => sum + item.amount, 0),
      color: OTHER_COLOR,
      details: entryDetails(folded),
    })
  }
  if (unfunded > 0) nodes.push({ name: 'Noch nicht finanziert', value: unfunded, kind: 'unfunded' })
  return nodes
}

// Expense categories, largest first, then what is left over.
// Expense categories, largest first, then what is left over. A category
// with a plan it has not used up yet also gets the open rest of that plan
// (`planned`), drawn hatched next to what was spent.
function flowTargets(expenses, categories, funding) {
  const groups = itemsByCategory(expenses)
  const plans = new Map(
    categories.filter((c) => c.plannedAmount != null).map((c) => [c.name, c.plannedAmount]),
  )
  const names = [...new Set([...groups.keys(), ...plans.keys()])]
  const nodes = names
    .map((name) => {
      const items = groups.get(name) ?? []
      const spent = items.reduce((sum, item) => sum + item.amount, 0)
      const planned = Math.max(0, (plans.get(name) ?? 0) - spent)
      return { name, value: spent + planned, spent, planned, details: entryDetails(items) }
    })
    .filter((node) => node.value > 0)
    .sort((a, b) => b.value - a.value)
  const used = nodes.reduce((sum, node) => sum + node.value, 0)
  if (funding > used) {
    nodes.push({
      name: plans.size > 0 ? 'Noch nicht verplant' : 'Noch nicht ausgegeben',
      value: funding - used,
      kind: 'unspent',
    })
  }
  return nodes
}

// Contacts, only to suggest companies for quotes.
function contactFromRow(row) {
  return { id: row.id, name: row.name, company: row.company ?? '' }
}

function contactToRow(contact) {
  return { name: contact.name, company: contact.company }
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
  const paymentStore = useCollection('payment_plan', { fromRow: paymentFromRow, toRow: paymentToRow })
  const contactStore = useCollection('contacts', { fromRow: contactFromRow, toRow: contactToRow })
  const [form, setForm] = useState(() => emptyForm())
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const [editingId, setEditingId] = useState(null)
  const formRef = useRef(null)
  const dialogs = useDialogs()

  const funding = items.filter((i) => i.type === 'funding')
  const expenses = items.filter((i) => i.type === 'expense')
  const totalFunding = funding.reduce((s, i) => s + i.amount, 0)
  const totalSpent = expenses.reduce((s, i) => s + i.amount, 0)
  // Invoices entered but not yet paid; included in what was spent.
  const unpaid = expenses.filter((i) => !i.paid)
  const totalUnpaid = unpaid.reduce((s, i) => s + i.amount, 0)
  const remaining = totalFunding - totalSpent
  const usedShare = totalFunding > 0 ? totalSpent / totalFunding : 0
  const sorted = [...items].sort((a, b) => b.date.localeCompare(a.date))
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
  // What the plans still expect to be spent, beyond what already was.
  const spentByCategory = sumBy(expenses, 'category')
  const plannedOpen = plannedCategories.reduce(
    (sum, c) => sum + Math.max(0, (c.plannedAmount ?? 0) - (spentByCategory.get(c.name) ?? 0)),
    0,
  )
  const itemsByCategoryName = new Map(
    expenseCategories.map((c) => [c.name, budgetItems.filter((item) => item.categoryId === c.id)]),
  )
  const companyNames = [
    ...new Set(contactStore.rows.flatMap((c) => [c.company, c.name]).filter(Boolean)),
  ].sort((a, b) => a.localeCompare(b, 'de'))
  // Diary expenses by their entry, for the payment schedule's state.
  const invoicesByEntry = new Map(expenses.filter((e) => e.diaryEntryId).map((e) => [e.diaryEntryId, e]))
  const fundingCategories = categoryRows.filter((c) => c.type === 'funding').sort(byOrder)
  const baseCategories = (form.type === 'funding' ? fundingCategories : expenseCategories).map(
    (c) => c.name,
  )
  const formCategory = form.category || baseCategories[0] || ''
  // Keep an entry's category selectable even if it is no longer in the list.
  const categories =
    !formCategory || baseCategories.includes(formCategory)
      ? baseCategories
      : [...baseCategories, formCategory]

  const usage = { expense: new Map(), funding: new Map() }
  for (const item of items) {
    const counts = usage[item.type]
    counts?.set(item.category, (counts.get(item.category) ?? 0) + 1)
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

  // ---- payment schedule (Zahlungsplan) ----

  async function recordPayment(payment) {
    const { error: recordError } = await supabase.rpc('record_planned_payment', {
      payment_id: payment.id,
      entry_date: today(),
    })
    if (recordError) throw new Error(friendlyError(recordError))
    await Promise.all([paymentStore.reload(), reloadItems()])
  }

  function openDiaryEntry(id) {
    onOpenDiary({ entry: { id, type: 'expense' } })
  }

  async function deleteCategory(id) {
    await categoryStore.remove(id)
  }

  function setField(field) {
    return (e) => setForm({ ...form, [field]: e.target.value })
  }

  async function handleSubmit(e) {
    e.preventDefault()
    const amount = Math.round(Number(form.amount) * 100) / 100
    if (!form.date || !form.description.trim() || !(amount > 0)) {
      setError('Bitte Datum, Beschreibung und einen Betrag größer als 0 eingeben.')
      return
    }
    if (!formCategory) {
      setError('Bitte zuerst eine Kategorie anlegen (Kategorien verwalten).')
      return
    }
    setSaving(true)
    setError('')
    const item = {
      date: form.date,
      type: form.type,
      category: formCategory,
      description: form.description.trim(),
      amount,
    }
    try {
      if (editingId) {
        await update(editingId, item)
        resetForm()
      } else {
        await insert(item)
        setForm({ ...emptyForm(form.type), category: formCategory })
      }
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

  function startEdit(item) {
    setForm({
      date: item.date,
      type: item.type,
      category: item.category,
      description: item.description,
      amount: String(item.amount),
    })
    setEditingId(item.id)
    setError('')
    formRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  async function handleDelete(id) {
    if (!(await dialogs.confirm('Diese Buchung löschen?', { confirmLabel: 'Löschen', danger: true }))) return
    try {
      await remove(id)
      if (editingId === id) resetForm()
    } catch (err) {
      await dialogs.alert(err.message)
    }
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
        itemsReadOnly={itemsMissing}
        funding={totalFunding}
        readOnly={categoriesMissing}
        format={(value) => euros.format(value)}
        onSetPlan={setPlannedAmount}
        onAddItem={addBudgetItem}
        onUpdateItem={updateBudgetItem}
        onDeleteItem={deleteBudgetItem}
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

      {paymentStore.status !== 'error' && (
        <PaymentPlan
          payments={paymentStore.rows}
          categories={expenseCategories.map((c) => c.name)}
          itemsByCategory={itemsByCategoryName}
          invoices={invoicesByEntry}
          todayDate={today()}
          format={(value) => currency.format(value)}
          readOnly={categoriesMissing}
          onAdd={(payment) => paymentStore.insert(payment)}
          onUpdate={(id, payment) => paymentStore.update(id, payment)}
          onDelete={(id) => paymentStore.remove(id)}
          onRecord={recordPayment}
          onOpenEntry={openDiaryEntry}
        />
      )}

      <form ref={formRef} className="card form-grid" onSubmit={handleSubmit} noValidate>
        <h2>
          {!editingId
            ? 'Neue Finanzierung'
            : form.type === 'funding'
              ? 'Finanzierung bearbeiten'
              : 'Ausgabe bearbeiten'}
        </h2>
        {!editingId && (
          <p className="muted full form-hint">
            Ausgaben trägst du im Tagebuch ein (Eintragsart „Ausgabe“).
          </p>
        )}
        <label>
          Datum
          <input type="date" value={form.date} onChange={setField('date')} />
        </label>
        <label>
          {form.type === 'funding' ? 'Quelle' : 'Kategorie'}
          <select value={formCategory} onChange={setField('category')}>
            {categories.map((c) => (
              <option key={c}>{c}</option>
            ))}
          </select>
        </label>
        <label>
          Betrag (€)
          <input
            type="number"
            min="0"
            step="0.01"
            value={form.amount}
            onChange={setField('amount')}
          />
        </label>
        <label className="full">
          Beschreibung
          <input
            type="text"
            placeholder={form.type === 'funding' ? 'z. B. Kredit, 1. Tranche' : 'z. B. Beton für Fundament'}
            value={form.description}
            onChange={setField('description')}
          />
        </label>

        {error && (
          <p className="error full" role="alert">
            {error}
          </p>
        )}

        <div className="form-actions full">
          <button type="submit" disabled={saving}>
            {saving
              ? 'Wird gespeichert…'
              : editingId
                ? 'Änderungen speichern'
                : form.type === 'funding'
                  ? 'Finanzierung hinzufügen'
                  : 'Ausgabe hinzufügen'}
          </button>
          {editingId && (
            <button type="button" className="secondary" onClick={resetForm} disabled={saving}>
              Abbrechen
            </button>
          )}
        </div>
      </form>

      <CategoryManager
        expense={expenseCategories}
        funding={fundingCategories}
        usage={usage}
        readOnly={categoriesMissing}
        notice={categoriesMissing ? categoryStore.error : ''}
        onAdd={addCategory}
        onRename={renameCategory}
        onDelete={deleteCategory}
      />

      {status === 'loading' && <p className="empty">Finanzen werden geladen…</p>}
      {status === 'error' && (
        <p className="error" role="alert">
          {loadError}
        </p>
      )}
      {status === 'ready' && sorted.length === 0 ? (
        <p className="empty">Noch keine Buchungen.</p>
      ) : sorted.length === 0 ? null : (
        <div className="card table-wrap">
          <table>
            <thead>
              <tr>
                <th>Datum</th>
                <th>Beschreibung</th>
                <th>Quelle / Kategorie</th>
                <th className="num">Betrag</th>
                <th aria-label="Aktionen"></th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((item) => (
                <tr key={item.id} className={item.id === editingId ? 'editing' : undefined}>
                  <td className="date">{formatDate(item.date)}</td>
                  <td>
                    {item.description}
                    {(!item.paid || item.hasReceipt) && (
                      <span className="tx-tags">
                        {!item.paid && <span className="state-pill state-open">Offen</span>}
                        {item.hasReceipt && (
                          <span className="state-pill" title="Beleg im Tagebucheintrag">
                            🧾 Beleg
                          </span>
                        )}
                      </span>
                    )}
                  </td>
                  <td>{item.category}</td>
                  <td className="num">
                    {item.type === 'funding' ? '+' : '−'}
                    {currency.format(item.amount)}
                  </td>
                  <td className="num row-actions">
                    {item.diaryEntryId ? (
                      <button
                        type="button"
                        className="link"
                        title="Im Tagebuch ansehen, bearbeiten oder löschen"
                        onClick={() => onOpenDiary({ entry: { id: item.diaryEntryId, type: 'expense' } })}
                      >
                        im Tagebuch
                      </button>
                    ) : (
                      <>
                        <button type="button" className="link" onClick={() => startEdit(item)}>
                          Bearbeiten
                        </button>
                        <button
                          type="button"
                          className="link danger"
                          onClick={() => handleDelete(item.id)}
                        >
                          Löschen
                        </button>
                      </>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}

export default Finances
