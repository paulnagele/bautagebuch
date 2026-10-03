// Budget items: planned line items under an expense category, kept on the
// Finanzen tab and selectable for diary expenses (budget_items table).

export function itemFromRow(row) {
  return {
    id: row.id,
    categoryId: row.category_id,
    name: row.name,
    plannedAmount: Number(row.planned_amount),
    sortOrder: row.sort_order,
  }
}

export function itemToRow(item) {
  return {
    category_id: item.categoryId,
    name: item.name,
    planned_amount: item.plannedAmount,
    sort_order: item.sortOrder,
  }
}

export function byOrder(a, b) {
  return a.sortOrder - b.sortOrder || a.name.localeCompare(b.name, 'de')
}
