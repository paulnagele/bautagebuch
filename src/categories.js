// Finance categories (finance_categories table): expense categories and
// funding sources, kept on the Finanzen tab and used by the diary
// (Ausgabe, Kategorie (Bauablauf)) and the Bauablauf on Zeitplan.

export function categoryFromRow(row) {
  return {
    id: row.id,
    type: row.type,
    name: row.name,
    sortOrder: row.sort_order,
    plannedAmount: row.planned_amount == null ? null : Number(row.planned_amount),
  }
}

export function categoryToRow(category) {
  return {
    type: category.type,
    name: category.name,
    sort_order: category.sortOrder,
    // Left out (undefined) when adding a category: it starts without a plan.
    planned_amount: category.plannedAmount,
  }
}

// List order as set on the Finanzen tab, then by name.
export function byOrder(a, b) {
  return a.sortOrder - b.sortOrder || a.name.localeCompare(b.name, 'de')
}

// The expense categories in list order.
export function expenseCategories(categories) {
  return categories.filter((c) => c.type === 'expense').sort(byOrder)
}
