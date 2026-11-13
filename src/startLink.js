// Links that open the app on one tab, e.g. ".../?tab=haus&vollbild" opens
// the Haus tab with the 3D model covering the screen. Read once when the
// app loads; the parameters are then removed from the address bar, so
// switching tabs and reloading behaves as usual.
const url = new URL(window.location.href)
const tab = (url.searchParams.get('tab') ?? '').trim().toLowerCase()
let full = url.searchParams.has('vollbild')

if (url.searchParams.has('tab') || url.searchParams.has('vollbild')) {
  url.searchParams.delete('tab')
  url.searchParams.delete('vollbild')
  window.history.replaceState(window.history.state, '', url)
}

// The tab the link asks for (matched by id or by its German label), or null.
export function startTab(tabs) {
  if (!tab) return null
  return tabs.find((t) => t.id === tab || t.label.toLowerCase() === tab)?.id ?? null
}

// True when the link asks for Einstellungen (?tab=einstellungen).
export function startSettings() {
  return tab === 'einstellungen' || tab === 'settings'
}

// True once, for the first model shown after a "vollbild" link.
export function takeFullStart() {
  const value = full
  full = false
  return value
}
