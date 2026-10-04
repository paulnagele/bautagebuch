// Bookings (transactions table): funding entered on Finanzen and the
// expenses booked from diary Ausgabe entries (kept in sync by the
// database), in the shape the Finanzen tab works with.

export function fromRow(row) {
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

export function toRow(item) {
  return {
    tx_date: item.date,
    type: item.type,
    category: item.category,
    description: item.description,
    amount: item.amount,
  }
}
