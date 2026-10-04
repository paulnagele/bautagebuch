// The nodes of the money-flow diagram on Finanzen (components/MoneyFlow.jsx):
// funding sources on the left, expense categories on the right.

// Validated categorical palette (see styles/base.css), used for funding sources in
// the money-flow diagram. A source keeps the colour of its position in the
// category list; beyond eight sources the rest are grouped as "Weitere Quellen"
// instead of inventing more colours.
const SERIES_COLORS = Array.from({ length: 8 }, (_, i) => `var(--series-${i + 1})`)
const OTHER_COLOR = 'var(--muted)'

// Totals of `amount` per value of `key`.
export function sumBy(items, key) {
  const totals = new Map()
  for (const item of items) {
    totals.set(item[key], (totals.get(item[key]) ?? 0) + item.amount)
  }
  return totals
}

// How many entries a node names before "+ n weitere".
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
export function flowSources(sourceNames, funding, unfunded) {
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

// Expense categories, largest first, then what is left over. A category
// with a plan it has not used up yet also gets the open rest of that plan
// (`planned`), drawn hatched next to what was spent.
export function flowTargets(expenses, categories, funding) {
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
