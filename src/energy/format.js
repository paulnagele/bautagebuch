// Numbers in German format for the Heizwärme tab, e.g. 1.234,5.
export function fmt(value, digits = 0) {
  if (!Number.isFinite(value)) return '–'
  return value.toLocaleString('de-DE', { minimumFractionDigits: digits, maximumFractionDigits: digits })
}
