// Quotes (Angebote) per budget item and the payment schedule
// (Zahlungsplan), as stored in the database (quotes, payment_plan) and the
// shape the Finanzen tab works with.

export function quoteFromRow(row) {
  return {
    id: row.id,
    budgetItemId: row.budget_item_id,
    company: row.company,
    amount: Number(row.amount),
    note: row.note ?? '',
    files: row.files ?? [],
    chosen: row.chosen,
  }
}

export function quoteToRow(quote) {
  return {
    budget_item_id: quote.budgetItemId,
    company: quote.company,
    amount: quote.amount,
    note: quote.note ?? '',
    files: quote.files ?? [],
  }
}

export function paymentFromRow(row) {
  return {
    id: row.id,
    name: row.name,
    category: row.category,
    budgetItemId: row.budget_item_id ?? null,
    amount: Number(row.amount),
    dueDate: row.due_date ?? null,
    diaryEntryId: row.diary_entry_id ?? null,
  }
}

export function paymentToRow(payment) {
  return {
    name: payment.name,
    category: payment.category,
    budget_item_id: payment.budgetItemId,
    amount: payment.amount,
    due_date: payment.dueDate,
  }
}

// Payments due soon are marked a few days ahead.
const SOON_DAYS = 14

function addDays(isoDate, days) {
  const d = new Date(`${isoDate}T12:00:00Z`)
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

// Where a payment stands: still planned, due, invoice recorded but open,
// or paid. `invoice` is its diary expense's transaction, if recorded.
export function paymentState(payment, invoice, todayDate) {
  if (payment.diaryEntryId && invoice) {
    return invoice.paid
      ? { key: 'paid', label: 'Bezahlt', pill: 'state-done' }
      : { key: 'invoiced', label: 'Rechnung offen', pill: 'state-open' }
  }
  if (payment.dueDate && payment.dueDate < todayDate) {
    return { key: 'due', label: 'Fällig', pill: 'state-overdue' }
  }
  if (payment.dueDate && payment.dueDate <= addDays(todayDate, SOON_DAYS)) {
    return { key: 'soon', label: 'Bald fällig', pill: 'state-upcoming' }
  }
  return { key: 'planned', label: 'Geplant', pill: '' }
}
