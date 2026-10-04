// Quotes (Angebote) per budget item, as stored in the database (quotes)
// and the shape the Finanzen tab works with.

export function quoteFromRow(row) {
  return {
    id: row.id,
    budgetItemId: row.budget_item_id,
    company: row.company,
    amount: Number(row.amount),
    note: row.note ?? '',
    files: row.files ?? [],
    chosen: row.chosen,
    createdAt: row.created_at,
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
